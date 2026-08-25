<?php
/**
 * DigiKraft Creative Growth Audit — configuration.
 *
 * Copy this file to config.php and edit. config.php is never overwritten by updates.
 * Everything here has a working default, so a fresh upload runs with no changes at all.
 */

return [
    // ---------------------------------------------------------------- branding
    'app_name'    => 'DigiKraft · Creative Growth Audit',
    'brand_short' => 'DigiKraft',

    // Optional shared passcode. Empty string = open tool (fine behind a private URL).
    // Set a value when the tool sits on a public domain: it stops strangers using your
    // server as a URL fetcher.
    'passcode' => '',

    // ---------------------------------------------------------------- database
    // sqlite works on every shared host with zero setup. Switch to mysql if your host
    // puts the document root on a read-only or ephemeral filesystem.
    'db' => [
        'driver'      => 'sqlite',
        // Leave empty and the app creates storage/audits-<random>.sqlite, so the
        // file cannot be guessed and downloaded on hosts that ignore .htaccess.
        // Set an absolute path here to put the database outside the web root.
        'sqlite_path' => '',
        'mysql'       => [
            'host'    => 'localhost',
            'port'    => 3306,
            'name'    => '',
            'user'    => '',
            'pass'    => '',
            'charset' => 'utf8mb4',
        ],
    ],

    // ---------------------------------------------------------------- crawler
    'crawl' => [
        'max_pages'          => 8,        // pages fetched per audit (homepage included)
        'timeout'            => 12,       // seconds per request
        'connect_timeout'    => 6,
        'max_bytes'          => 2500000,  // hard cap per response (2.5 MB)
        'max_redirects'      => 4,
        'user_agent'         => 'DigiKraftAuditBot/1.0 (+https://digikraft.in; creative growth audit)',
        'obey_robots'        => true,
        // Leave false in production. True only for auditing a site on the same box/LAN.
        'allow_private_hosts' => false,
    ],

    // ---------------------------------------------------------------- uploads
    // Document audits accept a file. Files are staged in storage/uploads and
    // deleted after keep_hours; the audit itself keeps only the extracted facts.
    'upload' => [
        'max_bytes'  => 20 * 1024 * 1024,
        'extensions' => ['pdf', 'docx', 'pptx', 'txt', 'md', 'html', 'htm'],
        'keep_hours' => 24,
    ],

    // Wall-clock budget for a single /api step. Keep it under the host's
    // max_execution_time (usually 30s on shared hosting).
    'step_budget' => 20,

    // Simple abuse guard, per client IP.
    'rate_limit' => [
        'audits_per_hour' => 30,
    ],

    // Optional. With a Google PageSpeed Insights key the landing surface gets real
    // Core Web Vitals instead of server-side timing only.
    // https://developers.google.com/speed/docs/insights/v5/get-started
    'psi_api_key' => '',
];
