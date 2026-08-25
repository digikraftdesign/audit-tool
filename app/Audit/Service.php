<?php

declare(strict_types=1);

namespace DK\Audit;

use DK\Audit\Analyzer\Branding;
use DK\Audit\Analyzer\DocumentFile;
use DK\Audit\Analyzer\LandingPage;
use DK\Audit\Analyzer\SocialMedia;
use DK\Support\Db;
use DK\Support\DocText;
use DK\Support\Html;
use DK\Support\Http;
use DK\Support\UrlGuard;
use RuntimeException;

/**
 * Runs one scoped audit as a sequence of short steps.
 *
 * Shared hosting has no workers and a short max_execution_time, so the browser
 * drives the run: one HTTP request per step, each well inside the budget. State
 * lives in the database between steps, never in memory.
 */
final class Service
{
    private Http $http;
    private float $deadline;

    public function __construct()
    {
        $this->http     = new Http((array) dk_config('crawl', []));
        $this->deadline = microtime(true) + (float) dk_config('step_budget', 20);
    }

    /** The steps the browser should walk for this audit type. @return array<int,string> */
    public static function steps(string $type): array
    {
        $ids = array_column(Types::get($type)['steps'], 'id');
        $ids[] = 'finalize';
        return $ids;
    }

    // ------------------------------------------------------------------- create

    /**
     * @param  array<string,mixed> $in
     * @return array{id:string,token:string,type:string,steps:array<int,string>}
     */
    public function create(array $in): array
    {
        $type = (string) ($in['type'] ?? '');
        if (!Types::exists($type)) {
            throw new RuntimeException('Choose which audit to run.');
        }

        $company = trim((string) ($in['company'] ?? ''));
        if ($company === '') {
            throw new RuntimeException('Add a company name before we scan.');
        }

        $answers = [];
        foreach (Types::fields($type) as $field) {
            $name = (string) $field['name'];
            $val  = $in[$name] ?? '';
            $val  = is_string($val) ? trim($val) : $val;

            if (($field['kind'] ?? '') === 'url' && is_string($val) && $val !== '') {
                $check = UrlGuard::check($val, (bool) dk_config('crawl.allow_private_hosts', false));
                if (!$check['ok']) {
                    throw new RuntimeException($field['label'] . ': ' . $check['error'] . '.');
                }
                $val = $check['normalised'];
            }
            if (!empty($field['required']) && ($field['kind'] ?? '') !== 'file' && ($val === '' || $val === null)) {
                throw new RuntimeException($field['label'] . ' is required for a ' . mb_strtolower(Types::get($type)['name']) . ' audit.');
            }
            $answers[$name] = $val;
        }

        // Type-specific entry requirements.
        $upload = null;
        if ($type === Types::DOCUMENT) {
            $uploadId = trim((string) ($in['upload_id'] ?? ''));
            if ($uploadId !== '') {
                $upload = self::findUpload($uploadId);
                if (!$upload) {
                    throw new RuntimeException('That upload has expired. Choose the file again.');
                }
                $answers['upload_id'] = $uploadId;
            } elseif (($answers['url'] ?? '') === '') {
                throw new RuntimeException('Upload a document or paste a link to one.');
            }
        }
        if ($type === Types::SOCIAL) {
            $any = false;
            foreach (['instagram', 'facebook', 'linkedin', 'youtube', 'x'] as $net) {
                if (($answers[$net] ?? '') !== '') {
                    $any = true;
                }
            }
            if (!$any) {
                throw new RuntimeException('Add at least one social profile URL.');
            }
        }

        $id    = substr(str_replace('-', '', dk_token(16)), 0, 32);
        $token = dk_token(16);
        $site  = (string) ($answers['url'] ?? ($upload['name'] ?? ''));

        Db::run(
            'INSERT INTO dk_audits (id, token, created_at, updated_at, status, step, audit_type, company, sector, site, structure, answers, manual, tier, followup_day, closed, client_ip)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)',
            [
                $id, $token, dk_now(), dk_now(), 'running', self::steps($type)[0], $type,
                mb_substr($company, 0, 180),
                mb_substr((string) ($answers['sector'] ?? ''), 0, 110),
                mb_substr($site, 0, 480),
                mb_substr((string) ($answers['structure'] ?? ''), 0, 4000),
                json_encode($answers, JSON_UNESCAPED_UNICODE),
                json_encode([]),
                'growth', 'Tuesday',
                dk_client_ip(),
            ]
        );
        Db::putArtifact($id, 'log', []);

        return ['id' => $id, 'token' => $token, 'type' => $type, 'steps' => self::steps($type)];
    }

    // --------------------------------------------------------------------- step

    /** @return array<string,mixed> */
    public function step(array $audit, string $step): array
    {
        $id      = (string) $audit['id'];
        $type    = (string) $audit['audit_type'];
        $answers = json_decode((string) $audit['answers'], true) ?: [];
        $steps   = self::steps($type);

        if (!in_array($step, $steps, true)) {
            throw new RuntimeException('Unknown step for this audit.');
        }

        try {
            $log = $step === 'finalize'
                ? $this->finalize($audit, $type, $answers)
                : $this->runStep($audit, $type, $step, $answers);
        } catch (\Throwable $e) {
            Db::run('UPDATE dk_audits SET status = ?, error = ?, updated_at = ? WHERE id = ?', ['failed', $e->getMessage(), dk_now(), $id]);
            throw $e;
        }

        $stored = (array) Db::getArtifact($id, 'log', []);
        foreach ($log as $line) {
            $stored[] = $line;
        }
        Db::putArtifact($id, 'log', array_slice($stored, -40));

        $index = array_search($step, $steps, true);
        $next  = $steps[$index + 1] ?? null;
        Db::run('UPDATE dk_audits SET step = ?, updated_at = ? WHERE id = ?', [$next ?? 'done', dk_now(), $id]);

        return ['step' => $step, 'next' => $next, 'done' => $next === null, 'log' => $log];
    }

    /** @return array<int,array{text:string,strong:bool}> */
    private function runStep(array $audit, string $type, string $step, array $answers): array
    {
        switch ($type) {
            case Types::LANDING:
                return $this->landingStep($audit, $step, $answers);
            case Types::SOCIAL:
                return $this->socialStep($audit, $step, $answers);
            case Types::DOCUMENT:
                return $this->documentStep($audit, $step, $answers);
            case Types::BRANDING:
                return $this->brandingStep($audit, $step, $answers);
        }
        return [];
    }

    // ============================================================ landing steps

    private function landingStep(array $audit, string $step, array $answers): array
    {
        $id      = (string) $audit['id'];
        $crawler = new Crawler($this->http, 4);

        if ($step === 'fetch') {
            $url  = (string) $answers['url'];
            $page = $crawler->fetchOne($url, 'landing');
            if (empty($page['ok'])) {
                throw new RuntimeException('Could not read ' . $url . ' — ' . ($page['error'] ?: 'no response') . '.');
            }
            Db::putArtifact($id, 'page', $page);
            return [
                ['text' => 'Fetched ' . LandingPage::shortUrl((string) $page['final_url']) . ' · HTTP ' . (int) $page['status']
                    . ' in ' . number_format((float) $page['ttfb'], 2) . 's', 'strong' => true],
                ['text' => LandingPage::bytes((int) $page['bytes']) . ' of HTML · ' . (int) $page['image_count'] . ' images · '
                    . (int) $page['scripts'] . ' scripts', 'strong' => false],
            ];
        }

        if ($step === 'content') {
            $page  = (array) Db::getArtifact($id, 'page', []);
            $css   = (string) ($page['inline_css'] ?? '');
            $sheets = [];
            foreach ((array) ($page['stylesheets'] ?? []) as $href) {
                if (count($sheets) >= 4) {
                    break;
                }
                if (UrlGuard::sameSite((string) $page['final_url'], (string) $href)) {
                    $sheets[$href] = 'css';
                }
            }
            $read = 0;
            foreach ($this->http->getMany(array_keys($sheets), $this->deadline) as $res) {
                if (!empty($res['ok'])) {
                    $css .= "\n" . mb_substr((string) $res['body'], 0, 500000);
                    $read++;
                }
            }
            Db::putArtifact($id, 'css', $css);
            return [
                ['text' => 'Read ' . $read . ' stylesheet' . ($read === 1 ? '' : 's') . ' · '
                    . number_format(strlen($css)) . ' characters of CSS', 'strong' => false],
                ['text' => 'Headline: ' . (($page['h1'][0] ?? '') !== '' ? '“' . mb_substr((string) $page['h1'][0], 0, 60) . '”' : 'none found'), 'strong' => true],
            ];
        }

        if ($step === 'tech') {
            // A real mobile fetch, not an assumption about one.
            $page   = (array) Db::getArtifact($id, 'page', []);
            $mobile = $this->fetchAsMobile((string) $page['final_url']);
            Db::putArtifact($id, 'mobile', $mobile);
            return [
                ['text' => $mobile['ok']
                    ? 'Mobile user agent served ' . LandingPage::bytes((int) $mobile['bytes']) . ' · viewport tag '
                        . ($mobile['viewport'] ? 'present' : 'missing')
                    : 'Mobile fetch did not complete: ' . $mobile['error'], 'strong' => false],
            ];
        }

        if ($step === 'trust') {
            // Do the policy and grievance links actually resolve?
            $page  = (array) Db::getArtifact($id, 'page', []);
            $links = [];
            foreach ((array) ($page['links'] ?? []) as $l) {
                if (count($links) >= 3) {
                    break;
                }
                if (preg_match('~(privacy|terms|grievance|disclosure|complaint|policy)~i', (string) $l['url'] . ' ' . (string) $l['text'])) {
                    $links[(string) $l['url']] = 'policy';
                }
            }
            $dead = [];
            foreach ($this->http->getMany(array_keys($links), $this->deadline) as $url => $res) {
                if (empty($res['ok'])) {
                    $dead[] = $url;
                }
            }
            Db::putArtifact($id, 'policy', ['checked' => count($links), 'dead' => $dead]);
            $trust = (array) ($page['trust'] ?? []);
            return [
                ['text' => $trust
                    ? 'Trust markers found: ' . implode(', ', array_slice(array_keys($trust), 0, 4))
                    : 'No regulator, registration or grievance marker on the page', 'strong' => true],
                ['text' => count($links) . ' policy link' . (count($links) === 1 ? '' : 's') . ' checked'
                    . ($dead ? ', ' . count($dead) . ' did not resolve' : ', all resolved'), 'strong' => false],
            ];
        }

        return [];
    }

    // ============================================================= social steps

    private function socialStep(array $audit, string $step, array $answers): array
    {
        $id   = (string) $audit['id'];
        $nets = ['instagram', 'facebook', 'linkedin', 'youtube', 'x'];

        if ($step === 'reach') {
            $profiles = [];
            foreach ($nets as $net) {
                $url = trim((string) ($answers[$net] ?? ''));
                if ($url === '') {
                    continue;
                }
                if (microtime(true) > $this->deadline) {
                    $profiles[$net] = ['url' => $url, 'state' => 'unchecked', 'status' => 0, 'note' => 'Not checked — step budget reached'];
                    continue;
                }
                $profiles[$net] = $this->checkProfile($net, $url);
            }
            Db::putArtifact($id, 'profiles', $profiles);

            $ok      = count(array_filter($profiles, static fn($p) => in_array($p['state'], ['ok', 'thin'], true)));
            $blocked = count(array_filter($profiles, static fn($p) => $p['state'] === 'blocked'));
            return [
                ['text' => 'Checked ' . count($profiles) . ' profile' . (count($profiles) === 1 ? '' : 's') . ' · '
                    . $ok . ' readable' . ($blocked ? ', ' . $blocked . ' blocked by the platform' : ''), 'strong' => true],
            ];
        }

        if ($step === 'profile') {
            $profiles = (array) Db::getArtifact($id, 'profiles', []);
            $lines    = [];
            foreach ($profiles as $net => $p) {
                if (!in_array($p['state'], ['ok', 'thin'], true)) {
                    $lines[] = ['text' => ucfirst($net) . ': ' . $p['note'], 'strong' => false];
                    continue;
                }
                $bits = [];
                $bits[] = ($p['bio'] ?? '') !== '' ? mb_strlen((string) $p['bio']) . '-char bio' : 'no bio';
                $bits[] = ($p['avatar'] ?? '') !== '' ? 'avatar' : 'no avatar';
                if (!empty($p['followers'])) {
                    $bits[] = number_format((int) $p['followers']) . ' followers';
                }
                $lines[] = ['text' => ucfirst((string) $net) . ': ' . implode(' · ', $bits), 'strong' => false];
            }
            return $lines ?: [['text' => 'No profile data could be read', 'strong' => false]];
        }

        if ($step === 'cadence') {
            $profiles = (array) Db::getArtifact($id, 'profiles', []);
            $found    = 0;
            foreach ($profiles as $net => $p) {
                if ($net !== 'youtube' || empty($p['channel_id'])) {
                    continue;
                }
                if (microtime(true) > $this->deadline) {
                    break;
                }
                $feed = $this->youtubeFeed((string) $p['channel_id']);
                if ($feed) {
                    $profiles[$net]['feed'] = $feed;
                    $found += count($feed['dates']);
                }
            }
            Db::putArtifact($id, 'profiles', $profiles);
            return [
                ['text' => $found > 0
                    ? 'Read ' . $found . ' recent posts from the public feed'
                    : 'No public post feed available — cadence needs a manual score', 'strong' => $found > 0],
            ];
        }

        if ($step === 'signals') {
            $profiles = (array) Db::getArtifact($id, 'profiles', []);
            $auto     = 0;
            foreach ($profiles as $p) {
                if (in_array($p['state'] ?? '', ['ok', 'thin'], true)) {
                    $auto++;
                }
                if (!empty($p['feed'])) {
                    $auto++;
                }
            }
            return [['text' => $auto . ' measurable signal' . ($auto === 1 ? '' : 's') . ' collected', 'strong' => false]];
        }

        return [];
    }

    // =========================================================== document steps

    private function documentStep(array $audit, string $step, array $answers): array
    {
        $id = (string) $audit['id'];

        if ($step === 'ingest') {
            $uploadId = trim((string) ($answers['upload_id'] ?? ''));
            if ($uploadId !== '') {
                $upload = self::findUpload($uploadId);
                if (!$upload || !is_file($upload['path'])) {
                    throw new RuntimeException('The uploaded file is no longer on the server. Upload it again.');
                }
                $bytes = (string) file_get_contents($upload['path']);
                $file  = ['name' => $upload['name'], 'bytes' => strlen($bytes), 'source' => 'upload', 'url' => '', 'mime' => $upload['mime']];
            } else {
                $url = (string) $answers['url'];
                $res = $this->http->get($url);
                if (empty($res['ok'])) {
                    throw new RuntimeException('Could not download ' . $url . ' — ' . ($res['error'] ?: 'no response') . '.');
                }
                $bytes = (string) $res['body'];
                $file  = [
                    'name'   => basename((string) parse_url((string) $res['final_url'], PHP_URL_PATH)) ?: 'document',
                    'bytes'  => strlen($bytes),
                    'source' => 'url',
                    'url'    => (string) $res['final_url'],
                    'mime'   => (string) $res['content_type'],
                ];
                if ($res['truncated']) {
                    $file['truncated'] = true;
                }
            }

            Db::putArtifact($id, 'file', $file);
            Db::putArtifact($id, 'raw', base64_encode($bytes));
            return [
                ['text' => 'Loaded ' . $file['name'] . ' · ' . LandingPage::bytes((int) $file['bytes'])
                    . ' from ' . ($file['source'] === 'upload' ? 'upload' : 'the web'), 'strong' => true],
            ];
        }

        if ($step === 'text') {
            $file = (array) Db::getArtifact($id, 'file', []);
            $raw  = base64_decode((string) Db::getArtifact($id, 'raw', ''), true);
            if ($raw === false || $raw === '') {
                throw new RuntimeException('The staged file could not be read back.');
            }
            $doc = DocText::read($raw, (string) $file['name'], (string) ($file['mime'] ?? ''));
            Db::putArtifact($id, 'doc', $doc);
            Db::run('DELETE FROM dk_artifacts WHERE audit_id = ? AND akey = ?', [$id, 'raw']);

            return [
                ['text' => $doc['ok']
                    ? 'Extracted ' . number_format((int) $doc['words']) . ' words'
                        . ($doc['pages'] ? ' across ' . $doc['pages'] . ' pages' : '')
                        . ' · ' . count((array) $doc['headings']) . ' headings'
                    : 'No text could be extracted: ' . $doc['error'], 'strong' => true],
            ];
        }

        if ($step === 'style') {
            $doc = (array) Db::getArtifact($id, 'doc', []);
            return [
                ['text' => count((array) $doc['fonts']) . ' typeface' . (count((array) $doc['fonts']) === 1 ? '' : 's')
                    . ' · ' . count((array) $doc['sizes']) . ' type sizes · ' . count((array) $doc['colors']) . ' colours', 'strong' => false],
                ['text' => 'Produced with ' . (($doc['producer'] ?: $doc['creator']) ?: 'an unnamed tool')
                    . ($doc['modified'] ? ' · last modified ' . $doc['modified'] : ''), 'strong' => false],
            ];
        }

        if ($step === 'review') {
            $doc = (array) Db::getArtifact($id, 'doc', []);
            $r   = DocumentFile::readability((string) $doc['text']);
            Db::putArtifact($id, 'readability', $r);
            return [
                ['text' => $r['sentences'] > 0
                    ? 'Reads at grade ' . $r['grade'] . ' · sentences average ' . $r['avg_sentence'] . ' words'
                    : 'Not enough prose to measure reading level', 'strong' => true],
            ];
        }

        return [];
    }

    // =========================================================== branding steps

    private function brandingStep(array $audit, string $step, array $answers): array
    {
        $id      = (string) $audit['id'];
        $crawler = new Crawler($this->http, (int) dk_config('crawl.max_pages', 8));

        if ($step === 'site') {
            $url  = (string) $answers['url'];
            $home = $crawler->fetchOne($url, 'home');
            if (empty($home['ok'])) {
                throw new RuntimeException('Could not read ' . $url . ' — ' . ($home['error'] ?: 'no response') . '.');
            }
            $targets = $crawler->discover($home);
            Db::putArtifact($id, 'pages', [$this->trimPage($home, true)]);
            Db::putArtifact($id, 'targets', $targets);
            return [
                ['text' => 'Connected to ' . parse_url((string) $home['final_url'], PHP_URL_HOST) . ' · HTTP ' . (int) $home['status'], 'strong' => true],
                ['text' => $targets
                    ? 'Reading ' . count($targets) . ' more brand pages: ' . implode(', ', array_map(
                        static fn($u) => rtrim((string) parse_url($u, PHP_URL_PATH), '/') ?: '/', array_slice(array_keys($targets), 0, 4)))
                    : 'No other brand pages linked from the homepage', 'strong' => false],
            ];
        }

        if ($step === 'identity') {
            $pages   = (array) Db::getArtifact($id, 'pages', []);
            $targets = (array) Db::getArtifact($id, 'targets', []);
            if ($targets) {
                foreach ($crawler->fetchMany($targets, $this->deadline) as $p) {
                    $pages[] = $this->trimPage($p, count($pages) < 4);
                }
            }
            Db::putArtifact($id, 'pages', $pages);

            $css    = '';
            $sheets = [];
            foreach ($pages as $p) {
                $css .= "\n" . (string) ($p['inline_css'] ?? '');
                foreach ((array) ($p['stylesheets'] ?? []) as $href) {
                    if (count($sheets) >= 4) {
                        break 2;
                    }
                    if (UrlGuard::sameSite((string) $pages[0]['final_url'], (string) $href)) {
                        $sheets[$href] = 'css';
                    }
                }
            }
            foreach ($this->http->getMany(array_keys($sheets), $this->deadline) as $res) {
                if (!empty($res['ok'])) {
                    $css .= "\n" . mb_substr((string) $res['body'], 0, 400000);
                }
            }
            Db::putArtifact($id, 'css', $css);

            $faviconFound = false;
            if (empty($pages[0]['icons'])) {
                $fav = $this->http->getRange(self::origin((string) $pages[0]['final_url']) . '/favicon.ico', 2048);
                $faviconFound = !empty($fav['ok']);
            }
            Db::putArtifact($id, 'extra', ['favicon_found' => $faviconFound]);

            $logos = [];
            foreach ($pages as $p) {
                foreach ((array) ($p['logos'] ?? []) as $l) {
                    $logos[$l] = true;
                }
            }
            return [
                ['text' => count($pages) . ' pages read · ' . count($logos) . ' logo file' . (count($logos) === 1 ? '' : 's')
                    . ' · ' . number_format(strlen($css)) . ' characters of CSS', 'strong' => true],
            ];
        }

        if ($step === 'market') {
            $urls = self::competitorUrls((string) ($answers['competitors'] ?? ''));
            if (!$urls) {
                Db::putArtifact($id, 'competitors', []);
                return [['text' => 'No competitors supplied — uniqueness is checked against category clichés only', 'strong' => false]];
            }

            $rivals = [];
            foreach ($this->http->getMany($urls, $this->deadline) as $url => $res) {
                if (empty($res['ok'])) {
                    continue;
                }
                $h    = new Html((string) $res['final_url'], (string) $res['body']);
                $css  = $h->ok() ? $h->inlineCss() : '';
                $link = $h->ok() ? array_slice($h->stylesheets(), 0, 2) : [];
                foreach ($this->http->getMany($link, $this->deadline) as $sheet) {
                    if (!empty($sheet['ok'])) {
                        $css .= "\n" . mb_substr((string) $sheet['body'], 0, 250000);
                    }
                }
                $rivals[] = [
                    'host'     => (string) parse_url((string) $res['final_url'], PHP_URL_HOST),
                    'title'    => $h->ok() ? $h->title() : '',
                    'headline' => $h->ok() ? ($h->headings(1)[0] ?? '') : '',
                    'css'      => $css,
                ];
            }
            Db::putArtifact($id, 'competitors', $rivals);
            return [
                ['text' => 'Compared against ' . count($rivals) . ' competitor site' . (count($rivals) === 1 ? '' : 's') . ': '
                    . implode(', ', array_column($rivals, 'host')), 'strong' => true],
            ];
        }

        if ($step === 'voice') {
            $pages = (array) Db::getArtifact($id, 'pages', []);
            $words = 0;
            foreach ($pages as $p) {
                $words += (int) round(mb_strlen((string) ($p['text'] ?? '')) / 5.5);
            }
            return [['text' => 'Read roughly ' . number_format($words) . ' words of copy for tone and mission', 'strong' => false]];
        }

        return [];
    }

    // ----------------------------------------------------------------- finalize

    private function finalize(array $audit, string $type, array $answers): array
    {
        $id = (string) $audit['id'];

        switch ($type) {
            case Types::LANDING:
                $page   = (array) Db::getArtifact($id, 'page', []);
                $css    = (string) Db::getArtifact($id, 'css', '');
                $result = LandingPage::run($page, $css, $answers);
                $result['metrics']['mobile'] = (array) Db::getArtifact($id, 'mobile', []);
                $result['metrics']['policy'] = (array) Db::getArtifact($id, 'policy', []);
                $sources = [[
                    'url' => (string) $page['final_url'], 'status' => (int) $page['status'],
                    'ttfb' => (float) $page['ttfb'], 'bytes' => (int) $page['bytes'], 'label' => 'Landing page',
                ]];
                break;

            case Types::SOCIAL:
                $profiles = (array) Db::getArtifact($id, 'profiles', []);
                $result   = SocialMedia::run($profiles, $answers);
                $sources  = [];
                foreach ($profiles as $net => $p) {
                    $sources[] = [
                        'url' => (string) $p['url'], 'status' => (int) ($p['status'] ?? 0),
                        'label' => SocialMedia::NETWORKS[$net] ?? $net, 'state' => (string) ($p['state'] ?? ''),
                        'note' => (string) ($p['note'] ?? ''),
                    ];
                }
                break;

            case Types::DOCUMENT:
                $doc    = (array) Db::getArtifact($id, 'doc', []);
                $file   = (array) Db::getArtifact($id, 'file', []);
                $result = DocumentFile::run($doc, $file, $answers + ['brand' => (string) $audit['company']]);
                $sources = [[
                    'url' => (string) ($file['url'] ?? ''), 'label' => (string) ($file['name'] ?? 'document'),
                    'bytes' => (int) ($file['bytes'] ?? 0), 'status' => 200,
                    'note' => $doc['kind'] . ($doc['pages'] ? ' · ' . $doc['pages'] . ' pages' : ''),
                ]];
                break;

            case Types::BRANDING:
            default:
                $pages   = (array) Db::getArtifact($id, 'pages', []);
                $css     = (string) Db::getArtifact($id, 'css', '');
                $extra   = (array) Db::getArtifact($id, 'extra', []);
                $rivals  = (array) Db::getArtifact($id, 'competitors', []);
                $result  = Branding::run($pages, $css, $extra, $rivals, $answers + ['company' => (string) $audit['company']]);
                $sources = array_map(static fn($p) => [
                    'url' => (string) $p['final_url'], 'status' => (int) $p['status'],
                    'ttfb' => (float) $p['ttfb'], 'bytes' => (int) $p['bytes'], 'label' => 'Page',
                ], array_filter($pages, static fn($p) => !empty($p['ok'])));
                foreach ($rivals as $r) {
                    $sources[] = ['url' => 'https://' . $r['host'], 'label' => 'Competitor', 'status' => 200];
                }
                break;
        }

        $findings = $result['findings'];
        $coverage = $result['coverage'];
        $manual   = json_decode((string) $audit['manual'], true) ?: [];

        $score  = Scorer::score($type, $findings, $coverage, $manual);
        $orders = Scorer::workOrders($findings);
        $fixes  = Playbook::fixes($type, $findings);
        $bets   = Playbook::bets($type, $findings, (string) $audit['structure']);
        $dir    = Playbook::direction($type, (string) $audit['company'], (string) $audit['sector'], $findings, $result['metrics']);
        $tier   = Playbook::recommendTier($findings, $orders, (int) $score['overall']);

        $payload = [
            'type'      => $type,
            'type_name' => Types::get($type)['name'],
            'company'   => (string) $audit['company'],
            'sector'    => (string) $audit['sector'],
            'subject'   => (string) $audit['site'],
            'answers'   => $answers,
            'structure' => (string) $audit['structure'],
            'score'     => $score,
            'coverage'  => $coverage,
            'findings'  => $findings,
            'orders'    => $orders,
            'fixes'     => $fixes,
            'bets'      => $bets,
            'direction' => $dir,
            'tiers'     => Playbook::tiers(),
            'recommended_tier' => $tier,
            'metrics'   => $result['metrics'],
            'method'    => [
                'sources'    => array_values($sources),
                'crawled_at' => dk_now(),
                'user_agent' => (string) dk_config('crawl.user_agent', ''),
            ],
        ];

        Db::run(
            'UPDATE dk_audits SET status = ?, result = ?, direction = ?, tier = ?, updated_at = ? WHERE id = ?',
            ['complete', json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $dir['copy'], $tier, dk_now(), $id]
        );
        foreach (['pages', 'targets', 'page', 'css', 'raw', 'competitors', 'doc'] as $key) {
            Db::run('DELETE FROM dk_artifacts WHERE audit_id = ? AND akey = ?', [$id, $key]);
        }

        $unscored = count($score['unscored']);
        return [[
            'text' => count($findings) . ' findings · score ' . $score['overall'] . '/100 · ' . $score['grade']['label']
                . ($unscored ? ' · ' . $unscored . ' parameter' . ($unscored === 1 ? '' : 's') . ' need your score' : ''),
            'strong' => true,
        ]];
    }

    /** Re-score an existing audit after the consultant sets a manual mark. */
    public static function rescore(array $audit): ?array
    {
        $result = json_decode((string) $audit['result'], true);
        if (!is_array($result)) {
            return null;
        }
        $manual = json_decode((string) $audit['manual'], true) ?: [];
        $result['score'] = Scorer::score(
            (string) $audit['audit_type'],
            (array) $result['findings'],
            (array) $result['coverage'],
            $manual
        );
        Db::run('UPDATE dk_audits SET result = ?, updated_at = ? WHERE id = ?', [
            json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), dk_now(), (string) $audit['id'],
        ]);
        return $result;
    }

    // ------------------------------------------------------------------ helpers

    /** Fetch the same URL as a phone would, to see what mobile actually gets. */
    private function fetchAsMobile(string $url): array
    {
        $cfg = (array) dk_config('crawl', []);
        $cfg['user_agent'] = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36 (compatible; DigiKraftAuditBot/1.0)';
        $http = new Http($cfg);
        $res  = $http->get($url);
        if (empty($res['ok'])) {
            return ['ok' => false, 'error' => (string) $res['error'], 'bytes' => 0, 'viewport' => false];
        }
        $h = new Html((string) $res['final_url'], (string) $res['body']);
        return [
            'ok'       => true,
            'error'    => '',
            'bytes'    => (int) $res['bytes'],
            'ttfb'     => (float) $res['ttfb'],
            'viewport' => $h->ok() && $h->hasViewportMeta(),
        ];
    }

    /** @return array<string,mixed> */
    private function checkProfile(string $net, string $url): array
    {
        $res    = $this->http->get($url);
        $status = (int) $res['status'];
        $row    = [
            'url'    => $url,
            'status' => $status,
            'handle' => SocialMedia::handle($net, $url),
            'state'  => 'unverified',
            'note'   => '',
            'bio'    => '',
            'avatar' => '',
            'display_name'  => '',
            'followers'     => 0,
            'outbound_link' => false,
        ];

        if ($status === 404 || $status === 410) {
            $row['state'] = 'missing';
            $row['note']  = 'Profile not found';
            return $row;
        }
        if (in_array($status, [401, 403, 429, 999], true)) {
            $row['state'] = 'blocked';
            $row['note']  = 'Platform blocked the check (HTTP ' . $status . ') — score this one by hand';
            return $row;
        }
        if ($status < 200 || $status >= 300 || $res['body'] === '') {
            $row['note'] = $res['error'] !== '' ? (string) $res['error'] : 'HTTP ' . $status;
            return $row;
        }

        $h = new Html((string) $res['final_url'], (string) $res['body']);
        if (!$h->ok()) {
            $row['note'] = 'Response could not be parsed';
            return $row;
        }

        $ogTitle = $h->og('og:title');
        $ogDesc  = $h->og('og:description');
        $ogImage = $h->og('og:image');

        $row['display_name'] = trim(preg_replace('~\s*[|(].*$~u', '', $ogTitle) ?? $ogTitle);
        $row['avatar']       = $ogImage;
        $row['bio']          = trim($ogDesc);

        // Instagram publishes the counts in og:description; use the real numbers.
        if (preg_match('~([\d,.]+[KMkm]?)\s+Followers~', $ogDesc, $m)) {
            $row['followers'] = self::humanNumber($m[1]);
            $row['bio']       = trim((string) preg_replace('~^.*?on Instagram:\s*~u', '', $ogDesc));
            if ($row['bio'] === $ogDesc) {
                $row['bio'] = trim((string) preg_replace('~^[\d,.KMkm]+\s+Followers.*?-\s*~u', '', $ogDesc));
            }
        }
        if (preg_match('~"subscriberCountText".{0,80}?"([\d.,]+[KMkm]?) subscribers~', (string) $res['body'], $m)) {
            $row['followers'] = self::humanNumber($m[1]);
        }
        if ($net === 'youtube' && preg_match('~"(?:externalId|channelId)":"(UC[\w-]{20,26})"~', (string) $res['body'], $m)) {
            $row['channel_id'] = $m[1];
        }

        // Any outbound link that leaves the platform counts as a link in bio.
        $host = strtolower((string) parse_url((string) $res['final_url'], PHP_URL_HOST));
        foreach (array_slice($h->links(), 0, 400) as $l) {
            $lHost = strtolower((string) parse_url((string) $l['url'], PHP_URL_HOST));
            if ($lHost !== '' && strpos($lHost, str_replace('www.', '', $host)) === false
                && !preg_match('~(facebook|instagram|linkedin|twitter|x|youtube|google|apple|microsoft|whatsapp|threads)\.~', $lHost)) {
                $row['outbound_link'] = true;
                break;
            }
        }

        $row['avatar_hash'] = $ogImage !== '' ? substr(md5(strtok($ogImage, '?') ?: $ogImage), 0, 12) : '';
        $row['state'] = ($ogTitle !== '' || $ogImage !== '') ? 'ok' : 'thin';
        $row['note']  = $row['state'] === 'ok' ? 'Reachable, profile data read' : 'Reachable, no profile data exposed';

        return $row;
    }

    /** YouTube publishes a public Atom feed per channel — real dates, real titles. */
    private function youtubeFeed(string $channelId): ?array
    {
        $res = $this->http->get('https://www.youtube.com/feeds/videos.xml?channel_id=' . urlencode($channelId));
        if (empty($res['ok'])) {
            return null;
        }
        $xml = (string) $res['body'];
        $dates = $titles = $views = [];
        if (preg_match_all('~<published>([^<]+)</published>~', $xml, $m)) {
            $dates = $m[1];
        }
        if (preg_match_all('~<media:title>([^<]*)</media:title>~', $xml, $m)) {
            $titles = array_map(static fn($t) => html_entity_decode($t, ENT_QUOTES | ENT_XML1, 'UTF-8'), $m[1]);
        }
        if (preg_match_all('~<media:statistics\s+views="(\d+)"~', $xml, $m)) {
            $views = array_map('intval', $m[1]);
        }
        if (!$dates) {
            return null;
        }
        return ['dates' => $dates, 'titles' => $titles, 'views' => $views];
    }

    private static function humanNumber(string $raw): int
    {
        $raw  = strtolower(trim($raw));
        $mult = 1;
        if (substr($raw, -1) === 'k') {
            $mult = 1000;
            $raw  = substr($raw, 0, -1);
        } elseif (substr($raw, -1) === 'm') {
            $mult = 1000000;
            $raw  = substr($raw, 0, -1);
        }
        return (int) round((float) str_replace(',', '', $raw) * $mult);
    }

    /** @return array<int,string> */
    private static function competitorUrls(string $raw): array
    {
        $out = [];
        foreach (preg_split('/[\s,]+/', $raw) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || count($out) >= 3) {
                continue;
            }
            $check = UrlGuard::check($line, false);
            if ($check['ok']) {
                $out[] = $check['normalised'];
            }
        }
        return $out;
    }

    private function trimPage(array $page, bool $keepCss): array
    {
        $page['inline_css'] = $keepCss ? mb_substr((string) ($page['inline_css'] ?? ''), 0, 60000) : '';
        $page['links']      = array_slice((array) ($page['links'] ?? []), 0, 120);
        $page['text']       = mb_substr((string) ($page['text'] ?? ''), 0, 60000);
        return $page;
    }

    private static function origin(string $url): string
    {
        $p = parse_url($url);
        if (!$p || empty($p['host'])) {
            return $url;
        }
        return ($p['scheme'] ?? 'https') . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
    }

    // ------------------------------------------------------------------ uploads

    /** @return array{id:string,name:string,path:string,mime:string,bytes:int}|null */
    public static function findUpload(string $uploadId): ?array
    {
        if (!preg_match('/^[a-f0-9]{24,64}$/', $uploadId)) {
            return null;
        }
        $row = Db::one('SELECT * FROM dk_uploads WHERE id = ?', [$uploadId]);
        if (!$row) {
            return null;
        }
        return [
            'id'    => (string) $row['id'],
            'name'  => (string) $row['name'],
            'path'  => dk_storage_path('uploads/' . $row['stored']),
            'mime'  => (string) $row['mime'],
            'bytes' => (int) $row['bytes'],
        ];
    }

    // ------------------------------------------------------------------ records

    public static function find(string $id, string $token): ?array
    {
        $row = Db::one('SELECT * FROM dk_audits WHERE id = ?', [$id]);
        if (!$row || !hash_equals((string) $row['token'], $token)) {
            return null;
        }
        return $row;
    }

    /** @return array<string,mixed> */
    public static function payload(array $row): array
    {
        $result = json_decode((string) ($row['result'] ?? ''), true);
        return [
            'id'         => (string) $row['id'],
            'type'       => (string) $row['audit_type'],
            'status'     => (string) $row['status'],
            'step'       => (string) $row['step'],
            'steps'      => Types::exists((string) $row['audit_type']) ? self::steps((string) $row['audit_type']) : [],
            'company'    => (string) $row['company'],
            'sector'     => (string) $row['sector'],
            'subject'    => (string) $row['site'],
            'answers'    => json_decode((string) $row['answers'], true) ?: [],
            'manual'     => json_decode((string) $row['manual'], true) ?: [],
            'tier'       => (string) ($row['tier'] ?? 'growth'),
            'day'        => (string) ($row['followup_day'] ?? 'Tuesday'),
            'closed'     => (int) ($row['closed'] ?? 0) === 1,
            'direction'  => (string) ($row['direction'] ?? ''),
            'created_at' => (string) $row['created_at'],
            'error'      => (string) ($row['error'] ?? ''),
            'result'     => is_array($result) ? $result : null,
        ];
    }
}
