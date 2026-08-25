<?php

declare(strict_types=1);

namespace DK\Audit;

use DK\Support\Html;
use DK\Support\Http;
use DK\Support\UrlGuard;

/**
 * Fetches pages and reduces each one to a small "fact sheet".
 *
 * Raw HTML is never carried between steps — only the facts are, which keeps the
 * per-request footprint small enough for shared hosting.
 */
final class Crawler
{
    private Http $http;
    private int $maxPages;

    public function __construct(Http $http, int $maxPages = 8)
    {
        $this->http     = $http;
        $this->maxPages = max(1, $maxPages);
    }

    /** @return array<string,mixed> page facts for a single URL */
    public function fetchOne(string $url, string $role = 'home'): array
    {
        $res = $this->http->get($url);
        return $this->facts($res, $role);
    }

    /**
     * @param  array<string,string> $urlToRole
     * @return array<int,array<string,mixed>>
     */
    public function fetchMany(array $urlToRole, float $deadline): array
    {
        $responses = $this->http->getMany(array_keys($urlToRole), $deadline);
        $out = [];
        foreach ($responses as $url => $res) {
            $out[] = $this->facts($res, $urlToRole[$url] ?? 'page');
        }
        return $out;
    }

    /**
     * Rank internal links into the pages worth reading.
     *
     * @param  array<string,mixed> $home page facts of the homepage
     * @return array<string,string> url => role
     */
    public function discover(array $home): array
    {
        $base    = $home['final_url'] ?? $home['url'];
        $buckets = [
            'campaign'   => '~(f-?and-?o|f&o|futures|options|derivative|intraday|commodit|currency|ipo|margin|mutual-?fund|sip|equity|trading-?account)~i',
            'conversion' => '~(open-?an?-?account|open-?account|account-?open|sign-?up|signup|register|onboard|kyc|demat|get-?started|apply)~i',
            'trust'      => '~(about|why-?us|trust|regulat|compliance|investor|grievance|disclosure|policies|security|safety)~i',
            'pricing'    => '~(pricing|charges|brokerage|fees|plans|cost)~i',
            'app'        => '~(app|download|mobile)~i',
            'contact'    => '~(contact|support|help)~i',
        ];

        $seen = [strtolower(rtrim($base, '/')) => true];

        // Collect candidates per bucket first, then take turns. Draining one
        // bucket would fill the whole budget with eight product pages and never
        // look at conversion, trust or pricing.
        $candidates = [];
        foreach ($buckets as $role => $pattern) {
            $candidates[$role] = [];
            foreach (($home['links'] ?? []) as $link) {
                $url = $link['url'] ?? '';
                if ($url === '' || !UrlGuard::sameSite($base, $url)) {
                    continue;
                }
                $url = strtok($url, '#');
                if ($url === false || $url === '') {
                    continue;
                }
                $key = strtolower(rtrim($url, '/'));
                if (isset($seen[$key]) || isset($candidates[$role][$url])) {
                    continue;
                }
                $path = (string) parse_url($url, PHP_URL_PATH);
                $hay  = $path . ' ' . ($link['text'] ?? '');
                if (!preg_match($pattern, $hay)) {
                    continue;
                }
                if (preg_match('~\.(pdf|jpg|jpeg|png|gif|zip|doc|docx|xls|xlsx|ppt|pptx|mp4)$~i', $path)) {
                    continue;
                }
                // Calculators, tools and blog posts are not campaign pages.
                if ($role === 'campaign' && preg_match('~(calculator|calc|tool|glossary|blog|news|varsity|faq|chart)~i', $path)) {
                    continue;
                }
                $candidates[$role][$url] = true;
            }
        }

        $picked = [];
        $budget = $this->maxPages - 1;
        for ($round = 0; $round < 4 && count($picked) < $budget; $round++) {
            foreach (array_keys($buckets) as $role) {
                if (count($picked) >= $budget) {
                    break;
                }
                foreach (array_keys($candidates[$role]) as $url) {
                    $key = strtolower(rtrim($url, '/'));
                    unset($candidates[$role][$url]);
                    if (isset($seen[$key])) {
                        continue;
                    }
                    $seen[$key]   = true;
                    $picked[$url] = $role;
                    break;
                }
            }
        }

        return $picked;
    }

    // ------------------------------------------------------------------ facts

    /**
     * @param  array<string,mixed> $res raw Http result
     * @return array<string,mixed>
     */
    private function facts(array $res, string $role): array
    {
        $url   = (string) ($res['final_url'] ?: $res['url']);
        $facts = [
            'role'         => $role,
            'url'          => (string) $res['url'],
            'final_url'    => $url,
            'status'       => (int) $res['status'],
            'ok'           => (bool) $res['ok'],
            'error'        => (string) $res['error'],
            'ttfb'         => (float) $res['ttfb'],
            'total'        => (float) $res['total'],
            'bytes'        => (int) $res['bytes'],
            'content_type' => (string) $res['content_type'],
            'https'        => strpos($url, 'https://') === 0,
        ];

        $body = (string) ($res['body'] ?? '');
        if (!$facts['ok'] || $body === '' || (strpos($facts['content_type'], 'html') === false && $facts['content_type'] !== '')) {
            return $facts + $this->emptyFacts();
        }

        $h = new Html($url, $body);
        if (!$h->ok()) {
            return $facts + $this->emptyFacts();
        }

        $text     = $h->visibleText();
        $textLen  = max(1, mb_strlen($text));
        $links    = $h->links();
        $images   = $h->images();
        $noAlt    = 0;
        foreach ($images as $img) {
            if ($img['alt'] === '') {
                $noAlt++;
            }
        }

        $htmlEl = $h->first('//html');
        $facts += [
            'title'        => $h->title(),
            'description'  => $h->meta('description'),
            'canonical'    => $h->canonical(),
            'viewport'     => $h->hasViewportMeta(),
            'lang'         => $htmlEl ? trim($htmlEl->getAttribute('lang')) : '',
            'og'           => [
                'title'     => $h->og('og:title'),
                'image'     => $h->og('og:image'),
                'site_name' => $h->og('og:site_name'),
                'desc'      => $h->og('og:description'),
            ],
            'twitter_card' => $h->og('twitter:card'),
            'h1'           => $h->headings(1),
            'h2_count'     => count($h->headings(2)),
            'links'        => array_slice($links, 0, 400),
            'link_count'   => count($links),
            'image_count'  => count($images),
            'image_no_alt' => $noAlt,
            'image_srcs'   => array_slice(array_column($images, 'src'), 0, 60),
            'stylesheets'  => $h->stylesheets(),
            'icons'        => $h->icons(),
            'inline_css'   => mb_substr($h->inlineCss(), 0, 120000),
            'forms'        => $h->forms(),
            'ctas'         => $h->ctas(),
            'nav_labels'   => $h->navLabels(),
            'chrome_sig'   => $h->chromeSignature(),
            'logos'        => $h->logoCandidates(),
            'text_len'     => $textLen,
            'text'         => mb_substr($text, 0, 240000),
            'scripts'      => count($h->query('//script')),
            'client_rendered' => $textLen < 1200 && count($h->query('//script')) >= 4,
            'scripts_blocking' => count($h->query('//head/script[@src][not(@async)][not(@defer)][not(@type="module")]')),
            'images_lazy'  => count($h->query('//img[@loading="lazy"]')),
            'nav_link_count' => count($h->query('//nav//a | //header//a')),
            'list_items'   => count($h->query('//li')),
            'paragraph_words' => self::paragraphWords($h),
            'testimonials' => self::testimonials($h, $text),
            'contact'      => self::contact($h, $text),
            'policy_links' => self::policyLinks($links),
            'cta_classes'  => self::ctaClasses($h),
            'jsonld'       => $this->jsonLdSummary($h),
            'trust'        => $this->trustSignals($text, $textLen),
            'pdf_links'    => $this->pdfLinks($links),
            'social_links' => $this->socialLinks($links),
            'mixed'        => $facts['https'] ? $this->mixedContent($body) : 0,
            'declared_img_bytes' => 0,
            'headline'     => $h->headings(1)[0] ?? '',
        ];

        return $facts;
    }

    /** Word counts of the substantive paragraphs on the page. @return array<int,int> */
    private static function paragraphWords(Html $h): array
    {
        $out = [];
        foreach ($h->query('//p') as $p) {
            $text = Html::text($p);
            if ($text === '') {
                continue;
            }
            $n = count(preg_split('/\s+/u', $text) ?: []);
            if ($n >= 4) {
                $out[] = $n;
            }
        }
        return array_slice($out, 0, 200);
    }

    /**
     * Customer voice on the page: a marked-up quote, a review widget, a star
     * rating, or copy that reads as a testimonial.
     *
     * @return array{found:bool,quote:string,signals:array<int,string>}
     */
    private static function testimonials(Html $h, string $text): array
    {
        $signals = [];

        foreach ($h->query('//blockquote | //*[@itemprop="review"] | //*[@itemtype]') as $el) {
            $type = strtolower($el->getAttribute('itemtype') . ' ' . $el->getAttribute('itemprop'));
            if (strtolower($el->nodeName) === 'blockquote' || strpos($type, 'review') !== false || strpos($type, 'rating') !== false) {
                $signals[] = 'marked-up quote';
                break;
            }
        }
        foreach ($h->query('//*[@class]') as $el) {
            $cls = strtolower($el->getAttribute('class'));
            if (preg_match('~\b(testimonial|review|rating|trustpilot|customer-say|client-say)~', $cls)) {
                $signals[] = 'testimonial block';
                break;
            }
        }
        if (preg_match('~\b(\d[\d,.]*)\+?\s*(reviews?|ratings?|customers?|users?|clients?|investors?|traders?)\b~i', $text, $m)) {
            $signals[] = 'social proof count: ' . trim($m[0]);
        }
        if (preg_match('~[“"][^”"]{40,240}[”"]\s*[—–-]\s*[A-Z]~u', $text, $m)) {
            $signals[] = 'attributed quote';
        }

        $quote = '';
        if (preg_match('~[“"]([^”"]{40,200})[”"]~u', $text, $m)) {
            $quote = trim($m[1]);
        }

        return ['found' => $signals !== [], 'quote' => $quote, 'signals' => array_values(array_unique($signals))];
    }

    /** @return array{tel:string,email:string,address:bool} */
    private static function contact(Html $h, string $text): array
    {
        $tel   = '';
        $email = '';
        foreach ($h->query('//a[@href]') as $a) {
            $href = strtolower(trim($a->getAttribute('href')));
            if ($tel === '' && strpos($href, 'tel:') === 0) {
                $tel = substr($href, 4);
            }
            if ($email === '' && strpos($href, 'mailto:') === 0) {
                $email = substr($href, 7);
            }
        }
        if ($email === '' && preg_match('~[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}~i', $text, $m)) {
            $email = $m[0];
        }
        if ($tel === '' && preg_match('~(?:\+91[\s-]?)?[6-9]\d{9}\b~', $text, $m)) {
            $tel = $m[0];
        }
        $address = (bool) preg_match('~\b(registered office|corporate office|address|floor|tower|road|marg|sector)\b~i', $text);

        return ['tel' => $tel, 'email' => $email, 'address' => $address];
    }

    /** @param array<int,array<string,mixed>> $links */
    private static function policyLinks(array $links): int
    {
        $n = 0;
        foreach ($links as $l) {
            if (preg_match('~(privacy|terms|disclaimer|refund|grievance|cookie|policy|disclosure)~i', (string) $l['url'] . ' ' . (string) $l['text'])) {
                $n++;
            }
        }
        return $n;
    }

    /** Class names on the first conversion-seeking button, for a contrast lookup. */
    private static function ctaClasses(Html $h): string
    {
        foreach ($h->ctas() as $cta) {
            if (!empty($cta['strong']) && !empty($cta['hero'])) {
                break;
            }
        }
        foreach ($h->query('//a[@href] | //button') as $el) {
            $text = Html::text($el);
            if ($text === '' || mb_strlen($text) > 42) {
                continue;
            }
            if (!preg_match('~(open an? account|open account|get started|sign ?up|register|start (trading|investing|free|now)|download app|book a demo|apply now|invest now|create account)~i', $text)) {
                continue;
            }
            $cls = trim($el->getAttribute('class'));
            if ($cls !== '') {
                return $cls;
            }
        }
        return '';
    }

    /** @return array<string,mixed> */
    private function emptyFacts(): array
    {
        return [
            'title' => '', 'description' => '', 'canonical' => '', 'viewport' => false, 'lang' => '',
            'og' => ['title' => '', 'image' => '', 'site_name' => '', 'desc' => ''], 'twitter_card' => '',
            'h1' => [], 'h2_count' => 0, 'links' => [], 'link_count' => 0,
            'image_count' => 0, 'image_no_alt' => 0, 'image_srcs' => [], 'stylesheets' => [], 'icons' => [],
            'inline_css' => '', 'forms' => [], 'ctas' => [], 'nav_labels' => [], 'chrome_sig' => '',
            'scripts' => 0, 'client_rendered' => false, 'text' => '',
            'scripts_blocking' => 0, 'images_lazy' => 0, 'nav_link_count' => 0, 'list_items' => 0,
            'paragraph_words' => [], 'testimonials' => ['found' => false, 'quote' => '', 'signals' => []],
            'contact' => ['tel' => '', 'email' => '', 'address' => false], 'policy_links' => 0, 'cta_classes' => '',
            'logos' => [], 'text_len' => 0, 'jsonld' => ['types' => [], 'org_names' => [], 'has_logo' => false],
            'trust' => [], 'pdf_links' => [], 'social_links' => [], 'mixed' => 0,
            'declared_img_bytes' => 0, 'headline' => '',
        ];
    }

    /**
     * Where regulatory / trust proof appears, as a fraction down the page.
     * @return array<string,float>
     */
    private function trustSignals(string $text, int $textLen): array
    {
        $terms = [
            'sebi'        => '/\bsebi\b/i',
            'exchange'    => '/\b(nse|bse|mcx|ncdex)\b/i',
            'registration'=> '/\b(inz|inh|inp|arn|cin)[a-z0-9]{5,}/i',
            'grievance'   => '/\bgrievance|complaint|ombudsman\b/i',
            'risk'        => '/risk disclosur|market risk|subject to market/i',
            'custody'     => '/\b(cdsl|nsdl|depositor(y|ies)|custody)\b/i',
            'regulated'   => '/\b(regulated|licens|registered with|rbi|irdai)\b/i',
        ];
        $out = [];
        foreach ($terms as $key => $pattern) {
            if (preg_match($pattern, $text, $m, PREG_OFFSET_CAPTURE)) {
                $bytePos = (int) $m[0][1];
                $ratio   = mb_strlen(substr($text, 0, $bytePos)) / $textLen;
                $out[$key] = round(min(1.0, $ratio), 3);
            }
        }
        return $out;
    }

    /** @param array<int,array<string,mixed>> $links */
    private function pdfLinks(array $links): array
    {
        $out = [];
        foreach ($links as $l) {
            $url  = (string) $l['url'];
            $path = strtolower((string) parse_url($url, PHP_URL_PATH));
            if (substr($path, -4) === '.pdf') {
                $out[$url] = trim((string) $l['text']);
            }
        }
        return $out;
    }

    /** @param array<int,array<string,mixed>> $links */
    private function socialLinks(array $links): array
    {
        $networks = [
            'instagram' => '~^https?://(www\.)?instagram\.com/~i',
            'facebook'  => '~^https?://(www\.|m\.)?facebook\.com/~i',
            'linkedin'  => '~^https?://([a-z]{2}\.)?(www\.)?linkedin\.com/~i',
            'youtube'   => '~^https?://(www\.)?(youtube\.com|youtu\.be)/~i',
            'x'         => '~^https?://(www\.)?(twitter\.com|x\.com)/~i',
            'telegram'  => '~^https?://(www\.)?(t\.me|telegram\.me)/~i',
            'whatsapp'  => '~^https?://(wa\.me|api\.whatsapp\.com)/~i',
            'gbp'       => '~^https?://(www\.)?(g\.page|maps\.app\.goo\.gl|goo\.gl/maps|business\.google\.com)~i',
        ];
        $out = [];
        foreach ($links as $l) {
            $url = (string) $l['url'];
            foreach ($networks as $net => $pattern) {
                if (preg_match($pattern, $url)) {
                    $out[$net][] = $url;
                }
            }
        }
        foreach ($out as $net => $urls) {
            $out[$net] = array_values(array_unique($urls));
        }
        return $out;
    }

    /**
     * Subresources requested over http:// on an https page.
     *
     * Only things the browser actually loads count — a plain outbound <a href>
     * to an http site is not mixed content and must not be reported as one.
     */
    private function mixedContent(string $body): int
    {
        $n = 0;
        if (preg_match_all('~\bsrc\s*=\s*["\']http://[^"\']+~i', $body, $m)) {
            $n += count($m[0]);
        }
        if (preg_match_all('~<link\b[^>]*\bhref\s*=\s*["\']http://[^"\']+~i', $body, $m)) {
            $n += count($m[0]);
        }
        if (preg_match_all('~\b(?:srcset|data-src|poster)\s*=\s*["\']http://[^"\']+~i', $body, $m)) {
            $n += count($m[0]);
        }
        return $n;
    }

    /** @return array{types:array<int,string>,org_names:array<int,string>,has_logo:bool} */
    private function jsonLdSummary(Html $h): array
    {
        $types = [];
        $names = [];
        $logo  = false;

        $walk = function ($node) use (&$walk, &$types, &$names, &$logo): void {
            if (!is_array($node)) {
                return;
            }
            if (isset($node['@type'])) {
                foreach ((array) $node['@type'] as $t) {
                    if (is_string($t)) {
                        $types[] = $t;
                        if (in_array(strtolower($t), ['organization', 'corporation', 'financialservice', 'localbusiness', 'brand'], true)) {
                            if (!empty($node['name']) && is_string($node['name'])) {
                                $names[] = trim($node['name']);
                            }
                            if (!empty($node['logo'])) {
                                $logo = true;
                            }
                        }
                    }
                }
            }
            foreach ($node as $child) {
                if (is_array($child)) {
                    $walk($child);
                }
            }
        };
        foreach ($h->jsonLd() as $block) {
            $walk($block);
        }

        return [
            'types'     => array_values(array_unique($types)),
            'org_names' => array_values(array_unique($names)),
            'has_logo'  => $logo,
        ];
    }
}
