<?php

declare(strict_types=1);

namespace DK\Support;

use PDO;
use PDOException;
use RuntimeException;

/**
 * PDO wrapper + schema install. SQLite by default (nothing to configure on a
 * shared host); MySQL when the host prefers it.
 */
final class Db
{
    private static ?PDO $pdo = null;
    private static string $driver = 'sqlite';

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $cfg    = dk_config('db', []);
        $driver = strtolower((string) ($cfg['driver'] ?? 'sqlite'));

        if ($driver === 'mysql') {
            $m   = $cfg['mysql'] ?? [];
            $dsn = sprintf(
                'mysql:host=%s;port=%d;dbname=%s;charset=%s',
                $m['host'] ?? 'localhost',
                (int) ($m['port'] ?? 3306),
                $m['name'] ?? '',
                $m['charset'] ?? 'utf8mb4'
            );
            try {
                $pdo = new PDO($dsn, (string) ($m['user'] ?? ''), (string) ($m['pass'] ?? ''), [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES   => false,
                ]);
            } catch (PDOException $e) {
                throw new RuntimeException('MySQL connection failed: ' . $e->getMessage(), 0, $e);
            }
            self::$driver = 'mysql';
        } else {
            $path = trim((string) ($cfg['sqlite_path'] ?? ''));
            if ($path === '' || $path === dk_storage_path('audits.sqlite')) {
                $path = dk_default_sqlite_path();
            }
            $dir  = dirname($path);
            if (!is_dir($dir)) {
                @mkdir($dir, 0775, true);
            }
            try {
                $pdo = new PDO('sqlite:' . $path, null, null, [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                ]);
            } catch (PDOException $e) {
                throw new RuntimeException('SQLite open failed (' . $path . '): ' . $e->getMessage(), 0, $e);
            }
            $pdo->exec('PRAGMA journal_mode = WAL');
            $pdo->exec('PRAGMA busy_timeout = 5000');
            self::$driver = 'sqlite';
        }

        self::$pdo = $pdo;
        self::install();
        return $pdo;
    }

    public static function driver(): string
    {
        self::pdo();
        return self::$driver;
    }

    private static function install(): void
    {
        $pdo  = self::$pdo;
        $text = self::$driver === 'mysql' ? 'LONGTEXT' : 'TEXT';
        $vc   = static fn(int $n): string => 'VARCHAR(' . $n . ')';
        $eng  = self::$driver === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';

        $pdo->exec("CREATE TABLE IF NOT EXISTS dk_audits (
            id {$vc(32)} NOT NULL PRIMARY KEY,
            token {$vc(64)} NOT NULL,
            created_at {$vc(20)} NOT NULL,
            updated_at {$vc(20)} NOT NULL,
            status {$vc(20)} NOT NULL,
            step {$vc(20)} NOT NULL,
            audit_type {$vc(20)} NOT NULL,
            company {$vc(190)} NOT NULL,
            sector {$vc(120)} NULL,
            site {$vc(500)} NULL,
            structure {$text} NULL,
            answers {$text} NULL,
            manual {$text} NULL,
            result {$text} NULL,
            direction {$text} NULL,
            tier {$vc(20)} NULL,
            followup_day {$vc(20)} NULL,
            closed INTEGER NOT NULL DEFAULT 0,
            client_ip {$vc(45)} NULL,
            error {$text} NULL
        )" . $eng);

        $pdo->exec("CREATE TABLE IF NOT EXISTS dk_uploads (
            id {$vc(64)} NOT NULL PRIMARY KEY,
            stored {$vc(120)} NOT NULL,
            name {$vc(255)} NOT NULL,
            mime {$vc(120)} NULL,
            bytes INTEGER NOT NULL DEFAULT 0,
            created_at {$vc(20)} NOT NULL,
            client_ip {$vc(45)} NULL
        )" . $eng);

        $pdo->exec("CREATE TABLE IF NOT EXISTS dk_artifacts (
            audit_id {$vc(32)} NOT NULL,
            akey {$vc(60)} NOT NULL,
            payload " . (self::$driver === 'mysql' ? 'LONGBLOB' : 'BLOB') . " NULL,
            updated_at {$vc(20)} NOT NULL,
            PRIMARY KEY (audit_id, akey)
        )" . $eng);

        $pdo->exec("CREATE TABLE IF NOT EXISTS dk_hits (
            ip {$vc(45)} NOT NULL,
            ts INTEGER NOT NULL
        )" . $eng);

        // Installs made before the audit-type rework are brought forward here.
        foreach ([
            'audit_type' => $vc(20) . " NOT NULL DEFAULT 'landing'",
            'answers'    => $text . ' NULL',
            'manual'     => $text . ' NULL',
        ] as $column => $definition) {
            try {
                $pdo->exec('ALTER TABLE dk_audits ADD COLUMN ' . $column . ' ' . $definition);
            } catch (PDOException $e) {
                // column already present
            }
        }

        try {
            $pdo->exec('CREATE INDEX idx_dk_hits_ts ON dk_hits (ts)');
        } catch (PDOException $e) {
            // index already there
        }
        try {
            $pdo->exec('CREATE INDEX idx_dk_audits_created ON dk_audits (created_at)');
        } catch (PDOException $e) {
            // index already there
        }
    }

    /** @param array<int|string,mixed> $args */
    public static function run(string $sql, array $args = []): \PDOStatement
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($args);
        return $st;
    }

    /** @return array<string,mixed>|null */
    public static function one(string $sql, array $args = []): ?array
    {
        $row = self::run($sql, $args)->fetch();
        return $row === false ? null : $row;
    }

    /** @return array<int,array<string,mixed>> */
    public static function all(string $sql, array $args = []): array
    {
        return self::run($sql, $args)->fetchAll() ?: [];
    }

    // ---------------------------------------------------------------- artifacts

    public static function putArtifact(string $auditId, string $key, $value): void
    {
        $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $blob = function_exists('gzencode') ? gzencode((string) $json, 6) : (string) $json;
        self::run('DELETE FROM dk_artifacts WHERE audit_id = ? AND akey = ?', [$auditId, $key]);
        $st = self::pdo()->prepare('INSERT INTO dk_artifacts (audit_id, akey, payload, updated_at) VALUES (?, ?, ?, ?)');
        $st->bindValue(1, $auditId);
        $st->bindValue(2, $key);
        $st->bindValue(3, $blob, PDO::PARAM_LOB);
        $st->bindValue(4, dk_now());
        $st->execute();
    }

    public static function getArtifact(string $auditId, string $key, $default = null)
    {
        $row = self::one('SELECT payload FROM dk_artifacts WHERE audit_id = ? AND akey = ?', [$auditId, $key]);
        if (!$row) {
            return $default;
        }
        $blob = $row['payload'];
        if (is_resource($blob)) {
            $blob = stream_get_contents($blob);
        }
        $blob = (string) $blob;
        if ($blob === '') {
            return $default;
        }
        if (function_exists('gzdecode') && strncmp($blob, "\x1f\x8b", 2) === 0) {
            $plain = @gzdecode($blob);
            if ($plain !== false) {
                $blob = $plain;
            }
        }
        $data = json_decode($blob, true);
        return $data === null ? $default : $data;
    }

    public static function dropArtifacts(string $auditId): void
    {
        self::run('DELETE FROM dk_artifacts WHERE audit_id = ?', [$auditId]);
    }

    // ---------------------------------------------------------------- rate limit

    public static function rateOk(string $ip, int $perHour): bool
    {
        $cut = time() - 3600;
        self::run('DELETE FROM dk_hits WHERE ts < ?', [$cut - 3600]);
        $row = self::one('SELECT COUNT(*) AS c FROM dk_hits WHERE ip = ? AND ts >= ?', [$ip, $cut]);
        if ($row && (int) $row['c'] >= $perHour) {
            return false;
        }
        self::run('INSERT INTO dk_hits (ip, ts) VALUES (?, ?)', [$ip, time()]);
        return true;
    }
}
