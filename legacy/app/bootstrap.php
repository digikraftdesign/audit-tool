<?php
/**
 * Shared bootstrap: autoloading, config, tiny helpers.
 * No Composer — shared hosting should stay a plain FTP upload.
 */

declare(strict_types=1);

define('DK_ROOT', dirname(__DIR__));
define('DK_APP', __DIR__);

spl_autoload_register(static function (string $class): void {
    if (strpos($class, 'DK\\') !== 0) {
        return;
    }
    $rel  = str_replace('\\', '/', substr($class, 3));
    $file = DK_APP . '/' . $rel . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});

/**
 * @return array<string,mixed>
 */
function dk_config(?string $key = null, $default = null)
{
    static $config = null;
    if ($config === null) {
        $file = is_file(DK_ROOT . '/config.php')
            ? DK_ROOT . '/config.php'
            : DK_ROOT . '/config.sample.php';
        $config = require $file;
        if (!is_array($config)) {
            $config = [];
        }
    }
    if ($key === null) {
        return $config;
    }
    $node = $config;
    foreach (explode('.', $key) as $part) {
        if (!is_array($node) || !array_key_exists($part, $node)) {
            return $default;
        }
        $node = $node[$part];
    }
    return $node;
}

function dk_storage_path(string $rel = ''): string
{
    $base = DK_ROOT . '/storage';
    if (!is_dir($base)) {
        @mkdir($base, 0775, true);
    }
    return $rel === '' ? $base : $base . '/' . ltrim($rel, '/');
}

/**
 * Where the SQLite database lives.
 *
 * `.htaccess` protects `storage/` on Apache and LiteSpeed, but nginx-backed
 * shared hosts ignore it and would happily serve the database as a download.
 * So the filename itself is unguessable, and the name is remembered in a .php
 * file — which every server that can run this app executes rather than serves.
 */
function dk_default_sqlite_path(): string
{
    $legacy = dk_storage_path('audits.sqlite');
    if (is_file($legacy)) {
        return $legacy; // an existing install keeps its database
    }

    $pointer = dk_storage_path('db-name.php');
    if (is_file($pointer)) {
        $name = require $pointer;
        if (is_string($name) && preg_match('/^audits-[0-9a-f]{16,}\.sqlite$/', $name)) {
            return dk_storage_path($name);
        }
    }

    $name = 'audits-' . dk_token(12) . '.sqlite';
    @file_put_contents(
        $pointer,
        "<?php\n// Generated on first run. Keeps the database filename unguessable\n"
        . "// on hosts that ignore .htaccess. Do not edit or the app loses its data.\nreturn '" . $name . "';\n"
    );
    return dk_storage_path($name);
}

function dk_token(int $bytes = 16): string
{
    try {
        return bin2hex(random_bytes($bytes));
    } catch (Throwable $e) {
        return bin2hex(pack('NNNN', mt_rand(), mt_rand(), mt_rand(), mt_rand()));
    }
}

/** Remove staged uploads older than the retention window. */
function dk_prune_uploads(): void
{
    $dir = dk_storage_path('uploads');
    if (!is_dir($dir)) {
        return;
    }
    $ttl = (int) dk_config('upload.keep_hours', 24) * 3600;
    $cut = time() - max(3600, $ttl);
    foreach ((array) glob($dir . '/*') as $file) {
        if (is_file($file) && filemtime($file) < $cut) {
            @unlink($file);
        }
    }
    try {
        \DK\Support\Db::run('DELETE FROM dk_uploads WHERE created_at < ?', [gmdate('Y-m-d H:i:s', $cut)]);
    } catch (Throwable $e) {
        // pruning is housekeeping; never let it break a request
    }
}

function dk_now(): string
{
    return gmdate('Y-m-d H:i:s');
}

function dk_client_ip(): string
{
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'] as $key) {
        if (!empty($_SERVER[$key])) {
            $val = explode(',', (string) $_SERVER[$key])[0];
            $val = trim($val);
            if (filter_var($val, FILTER_VALIDATE_IP)) {
                return $val;
            }
        }
    }
    return '0.0.0.0';
}

function dk_e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Passcode gate. Returns true when the caller is allowed through. */
function dk_authorised(): bool
{
    $code = (string) dk_config('passcode', '');
    if ($code === '') {
        return true;
    }
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
    return !empty($_SESSION['dk_auth']);
}
