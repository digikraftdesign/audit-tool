<?php

declare(strict_types=1);

require __DIR__ . '/app/bootstrap.php';

use DK\Audit\Service;
use DK\Support\Db;

// Plenty of shared hosts ship with display_errors on. A stray notice printed
// ahead of the payload would corrupt every response, so this endpoint swallows
// output and reports problems as JSON instead.
@ini_set('display_errors', '0');
@ini_set('log_errors', '1');
ob_start();

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

/** @param array<string,mixed> $data */
function out(array $data, int $status = 200): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

register_shutdown_function(static function (): void {
    $fatal = error_get_last();
    if ($fatal && in_array($fatal['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode([
            'ok'    => false,
            'error' => 'The server hit a fatal error: ' . $fatal['message'],
        ]);
    }
});

function fail(string $message, int $status = 400, array $extra = []): void
{
    out(['ok' => false, 'error' => $message] + $extra, $status);
}

/** @return array<string,mixed> */
function body(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $raw  = file_get_contents('php://input') ?: '';
    $json = json_decode($raw, true);
    $cache = is_array($json) ? $json : $_POST;
    return $cache;
}

$action = (string) ($_GET['a'] ?? '');
$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));

// Same-origin guard for anything that writes.
if ($method === 'POST') {
    $site = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    if ($site !== '' && !in_array($site, ['same-origin', 'same-site', 'none'], true)) {
        fail('Cross-origin request refused', 403);
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $host = $_SERVER['HTTP_HOST'] ?? '';
        if ($host !== '' && stripos($origin, (string) $host) === false) {
            fail('Cross-origin request refused', 403);
        }
    }
}

// ------------------------------------------------------------------ passcode

if ($action === 'login') {
    $code = (string) dk_config('passcode', '');
    if ($code === '') {
        out(['ok' => true, 'authorised' => true]);
    }
    $given = (string) (body()['passcode'] ?? '');
    if (!hash_equals($code, $given)) {
        usleep(400000);
        fail('That passcode did not match.', 401);
    }
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
    session_regenerate_id(true);
    $_SESSION['dk_auth'] = true;
    out(['ok' => true, 'authorised' => true]);
}

if (!dk_authorised()) {
    fail('Passcode required', 401, ['need_passcode' => true]);
}

// -------------------------------------------------------------------- routes

try {
    switch ($action) {
        case 'create': {
            if ($method !== 'POST') {
                fail('POST required', 405);
            }
            $perHour = (int) dk_config('rate_limit.audits_per_hour', 30);
            if ($perHour > 0 && !Db::rateOk(dk_client_ip(), $perHour)) {
                fail('Too many audits from this connection in the last hour. Try again shortly.', 429);
            }
            $svc = new Service();
            $new = $svc->create(body());
            out(['ok' => true] + $new);
        }

        case 'step': {
            if ($method !== 'POST') {
                fail('POST required', 405);
            }
            $in    = body();
            $audit = Service::find((string) ($in['id'] ?? ''), (string) ($in['token'] ?? ''));
            if (!$audit) {
                fail('Audit not found', 404);
            }
            $step = (string) ($in['step'] ?? '');
            if (!in_array($step, Service::steps((string) $audit['audit_type']), true)) {
                fail('Unknown step');
            }
            $svc  = new Service();
            $data = $svc->step($audit, $step);
            if ($data['done']) {
                $fresh = Service::find((string) $audit['id'], (string) $audit['token']);
                $data['audit'] = $fresh ? Service::payload($fresh) : null;
            }
            out(['ok' => true] + $data);
        }

        case 'get': {
            $audit = Service::find((string) ($_GET['id'] ?? ''), (string) ($_GET['token'] ?? ''));
            if (!$audit) {
                fail('Audit not found', 404);
            }
            out(['ok' => true, 'audit' => Service::payload($audit)]);
        }

        case 'close': {
            if ($method !== 'POST') {
                fail('POST required', 405);
            }
            $in    = body();
            $audit = Service::find((string) ($in['id'] ?? ''), (string) ($in['token'] ?? ''));
            if (!$audit) {
                fail('Audit not found', 404);
            }
            $tiers = array_keys(\DK\Audit\Playbook::tiers());
            $tier  = in_array((string) ($in['tier'] ?? ''), $tiers, true) ? (string) $in['tier'] : (string) $audit['tier'];
            $day   = in_array((string) ($in['day'] ?? ''), ['Tuesday', 'Wednesday'], true) ? (string) $in['day'] : (string) $audit['followup_day'];
            $dir   = array_key_exists('direction', $in) ? mb_substr(trim((string) $in['direction']), 0, 2000) : (string) $audit['direction'];
            $closed = array_key_exists('closed', $in) ? (int) (bool) $in['closed'] : (int) $audit['closed'];

            Db::run(
                'UPDATE dk_audits SET tier = ?, followup_day = ?, direction = ?, closed = ?, updated_at = ? WHERE id = ?',
                [$tier, $day, $dir, $closed, dk_now(), (string) $audit['id']]
            );

            // Keep the stored result in step with the edits so the report matches.
            $result = json_decode((string) $audit['result'], true);
            if (is_array($result)) {
                $result['recommended_tier']  = $tier;
                $result['followup_day']      = $day;
                $result['direction']['copy'] = $dir;
                Db::run('UPDATE dk_audits SET result = ? WHERE id = ?', [
                    json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    (string) $audit['id'],
                ]);
            }

            $fresh = Service::find((string) $audit['id'], (string) $audit['token']);
            out(['ok' => true, 'audit' => $fresh ? Service::payload($fresh) : null]);
        }

        case 'types': {
            $out = [];
            foreach (\DK\Audit\Types::all() as $id => $t) {
                $out[$id] = [
                    'id'         => $id,
                    'index'      => $t['index'],
                    'name'       => $t['name'],
                    'tagline'    => $t['tagline'],
                    'intro'      => $t['intro'],
                    'headline'   => $t['headline'],
                    'steps'      => $t['steps'],
                    'parameters' => $t['parameters'],
                    'fields'     => \DK\Audit\Types::fields($id),
                ];
            }
            out(['ok' => true, 'types' => $out]);
        }

        case 'upload': {
            if ($method !== 'POST') {
                fail('POST required', 405);
            }
            if (empty($_FILES['file']) || !is_uploaded_file((string) ($_FILES['file']['tmp_name'] ?? ''))) {
                $code = (int) ($_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE);
                fail($code === UPLOAD_ERR_INI_SIZE || $code === UPLOAD_ERR_FORM_SIZE
                    ? 'That file is larger than this server accepts. Try a smaller file or paste a link instead.'
                    : 'No file was received.');
            }

            $file = $_FILES['file'];
            $max  = (int) dk_config('upload.max_bytes', 20 * 1024 * 1024);
            if ((int) $file['size'] > $max) {
                fail('The file is ' . round($file['size'] / 1048576, 1) . ' MB. The limit is ' . round($max / 1048576) . ' MB.');
            }

            $name = (string) $file['name'];
            $ext  = strtolower((string) pathinfo($name, PATHINFO_EXTENSION));
            $allowed = (array) dk_config('upload.extensions', ['pdf', 'docx', 'pptx', 'txt', 'md', 'html', 'htm']);
            if (!in_array($ext, $allowed, true)) {
                fail('Only ' . implode(', ', $allowed) . ' files can be audited.');
            }

            $mime = '';
            if (function_exists('finfo_open')) {
                $fi = finfo_open(FILEINFO_MIME_TYPE);
                if ($fi) {
                    $mime = (string) finfo_file($fi, (string) $file['tmp_name']);
                    finfo_close($fi);
                }
            }

            $dir = dk_storage_path('uploads');
            if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
                fail('The uploads folder is not writable on this server.', 500);
            }
            dk_prune_uploads();

            $uploadId = dk_token(16);
            $stored   = $uploadId . '.' . $ext;
            if (!move_uploaded_file((string) $file['tmp_name'], $dir . '/' . $stored)) {
                fail('The file could not be saved on this server.', 500);
            }
            @chmod($dir . '/' . $stored, 0640);

            Db::run(
                'INSERT INTO dk_uploads (id, stored, name, mime, bytes, created_at, client_ip) VALUES (?,?,?,?,?,?,?)',
                [$uploadId, $stored, mb_substr($name, 0, 240), $mime, (int) $file['size'], dk_now(), dk_client_ip()]
            );

            out(['ok' => true, 'upload_id' => $uploadId, 'name' => $name, 'bytes' => (int) $file['size'], 'mime' => $mime]);
        }

        case 'score': {
            if ($method !== 'POST') {
                fail('POST required', 405);
            }
            $in    = body();
            $audit = Service::find((string) ($in['id'] ?? ''), (string) ($in['token'] ?? ''));
            if (!$audit) {
                fail('Audit not found', 404);
            }
            $parameter = (string) ($in['parameter'] ?? '');
            $params    = \DK\Audit\Types::parameters((string) $audit['audit_type']);
            if (!isset($params[$parameter])) {
                fail('Unknown parameter');
            }

            $manual = json_decode((string) $audit['manual'], true) ?: [];
            if (array_key_exists('score', $in) && ($in['score'] === null || $in['score'] === '')) {
                unset($manual[$parameter]);
            } else {
                $manual[$parameter] = max(0, min(10, (int) $in['score']));
            }
            Db::run('UPDATE dk_audits SET manual = ?, updated_at = ? WHERE id = ?', [json_encode($manual), dk_now(), (string) $audit['id']]);

            $fresh = Service::find((string) $audit['id'], (string) $audit['token']);
            if ($fresh) {
                Service::rescore($fresh);
                $fresh = Service::find((string) $audit['id'], (string) $audit['token']);
            }
            out(['ok' => true, 'audit' => $fresh ? Service::payload($fresh) : null]);
        }

        case 'recent': {
            $rows = Db::all(
                "SELECT id, token, company, site, audit_type, created_at, status, result FROM dk_audits
                 WHERE status = 'complete' ORDER BY created_at DESC LIMIT 12"
            );
            $out = [];
            foreach ($rows as $r) {
                $res = json_decode((string) $r['result'], true);
                $out[] = [
                    'id'      => (string) $r['id'],
                    'token'   => (string) $r['token'],
                    'company' => (string) $r['company'],
                    'site'    => (string) $r['site'],
                    'type'    => (string) $r['audit_type'],
                    'created' => (string) $r['created_at'],
                    'score'   => is_array($res) ? (int) ($res['score']['overall'] ?? 0) : 0,
                    'grade'   => is_array($res) ? (string) ($res['score']['grade']['label'] ?? '') : '',
                    'findings'=> is_array($res) ? count((array) ($res['findings'] ?? [])) : 0,
                ];
            }
            out(['ok' => true, 'audits' => $out]);
        }

        case 'health': {
            $checks = [
                'php'     => PHP_VERSION,
                'curl'    => extension_loaded('curl'),
                'dom'     => extension_loaded('dom'),
                'mbstring'=> extension_loaded('mbstring'),
                'db'      => false,
                'writable'=> is_writable(dk_storage_path()),
                'uploads' => is_dir(dk_storage_path('uploads')) ? is_writable(dk_storage_path('uploads')) : is_writable(dk_storage_path()),
                'zip'     => class_exists('ZipArchive'),
                'zlib'    => function_exists('gzinflate'),
            ];
            try {
                Db::pdo();
                $checks['db'] = Db::driver();
            } catch (Throwable $e) {
                $checks['db_error'] = $e->getMessage();
            }
            out(['ok' => true, 'checks' => $checks]);
        }

        default:
            fail('Unknown action', 404);
    }
} catch (Throwable $e) {
    fail($e->getMessage(), 500);
}
