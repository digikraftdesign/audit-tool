<?php

declare(strict_types=1);

namespace DK\Support;

use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;

/**
 * Thin DOM helper around a fetched page. Everything the analysers need to ask
 * about a page lives here so the rules stay readable.
 */
final class Html
{
    public string $url;
    public string $raw;
    public ?DOMDocument $doc = null;
    public ?DOMXPath $xp = null;

    public function __construct(string $url, string $html)
    {
        $this->url = $url;
        $this->raw = $html;

        if (trim($html) === '') {
            return;
        }
        $prev = libxml_use_internal_errors(true);
        $doc  = new DOMDocument();
        // Force UTF-8 interpretation regardless of what the page declares.
        $prefix = '<?xml encoding="utf-8" ?>';
        if (@$doc->loadHTML($prefix . $html, LIBXML_NOWARNING | LIBXML_NOERROR)) {
            $this->doc = $doc;
            $this->xp  = new DOMXPath($doc);
        }
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
    }

    public function ok(): bool
    {
        return $this->doc !== null;
    }

    /** @return array<int,DOMElement> */
    public function query(string $xpath): array
    {
        if (!$this->xp) {
            return [];
        }
        $nodes = $this->xp->query($xpath);
        $out   = [];
        if ($nodes) {
            foreach ($nodes as $n) {
                if ($n instanceof DOMElement) {
                    $out[] = $n;
                }
            }
        }
        return $out;
    }

    public function first(string $xpath): ?DOMElement
    {
        $all = $this->query($xpath);
        return $all[0] ?? null;
    }

    public static function text(?DOMNode $node): string
    {
        if (!$node) {
            return '';
        }
        $text = preg_replace('/\s+/u', ' ', $node->textContent ?? '');
        return trim((string) $text);
    }

    public function title(): string
    {
        return self::text($this->first('//title'));
    }

    public function meta(string $name): string
    {
        $name = strtolower($name);
        foreach ($this->query('//meta[@name]') as $m) {
            if (strtolower($m->getAttribute('name')) === $name) {
                return trim($m->getAttribute('content'));
            }
        }
        return '';
    }

    public function og(string $property): string
    {
        $property = strtolower($property);
        foreach ($this->query('//meta[@property]') as $m) {
            if (strtolower($m->getAttribute('property')) === $property) {
                return trim($m->getAttribute('content'));
            }
        }
        foreach ($this->query('//meta[@name]') as $m) {
            if (strtolower($m->getAttribute('name')) === $property) {
                return trim($m->getAttribute('content'));
            }
        }
        return '';
    }

    public function canonical(): string
    {
        foreach ($this->query('//link[@rel]') as $l) {
            if (strtolower($l->getAttribute('rel')) === 'canonical') {
                return trim($l->getAttribute('href'));
            }
        }
        return '';
    }

    public function hasViewportMeta(): bool
    {
        return $this->meta('viewport') !== '';
    }

    /** @return array<int,string> heading texts for the given level */
    public function headings(int $level): array
    {
        $out = [];
        foreach ($this->query('//h' . $level) as $h) {
            $t = self::text($h);
            if ($t !== '') {
                $out[] = $t;
            }
        }
        return $out;
    }

    /** @return array<int,array{url:string,text:string,rel:string,nofollow:bool}> */
    public function links(): array
    {
        $out = [];
        foreach ($this->query('//a[@href]') as $a) {
            $abs = UrlGuard::resolveRelative($this->url, $a->getAttribute('href'));
            if ($abs === null) {
                continue;
            }
            $rel = strtolower($a->getAttribute('rel'));
            $out[] = [
                'url'      => $abs,
                'text'     => self::text($a),
                'rel'      => $rel,
                'nofollow' => strpos($rel, 'nofollow') !== false,
            ];
        }
        return $out;
    }

    /** @return array<int,array{src:string,alt:string,width:string,height:string,loading:string}> */
    public function images(): array
    {
        $out = [];
        foreach ($this->query('//img') as $img) {
            $src = $img->getAttribute('src');
            if ($src === '') {
                $src = $img->getAttribute('data-src');
            }
            if ($src === '' || strpos($src, 'data:') === 0) {
                continue;
            }
            $abs = UrlGuard::resolveRelative($this->url, $src);
            if ($abs === null) {
                continue;
            }
            $out[] = [
                'src'     => $abs,
                'alt'     => trim($img->getAttribute('alt')),
                'width'   => $img->getAttribute('width'),
                'height'  => $img->getAttribute('height'),
                'loading' => strtolower($img->getAttribute('loading')),
            ];
        }
        return $out;
    }

    /** @return array<int,string> absolute stylesheet URLs */
    public function stylesheets(): array
    {
        $out = [];
        foreach ($this->query('//link[@rel]') as $l) {
            if (strpos(strtolower($l->getAttribute('rel')), 'stylesheet') === false) {
                continue;
            }
            $abs = UrlGuard::resolveRelative($this->url, $l->getAttribute('href'));
            if ($abs !== null) {
                $out[] = $abs;
            }
        }
        return array_values(array_unique($out));
    }

    public function inlineCss(): string
    {
        $css = '';
        foreach ($this->query('//style') as $s) {
            $css .= "\n" . $s->textContent;
        }
        foreach ($this->query('//*[@style]') as $el) {
            $css .= "\n" . $el->getAttribute('style');
        }
        return $css;
    }

    /** Favicon / apple-touch-icon URLs. @return array<int,string> */
    public function icons(): array
    {
        $out = [];
        foreach ($this->query('//link[@rel]') as $l) {
            $rel = strtolower($l->getAttribute('rel'));
            if (strpos($rel, 'icon') === false) {
                continue;
            }
            $abs = UrlGuard::resolveRelative($this->url, $l->getAttribute('href'));
            if ($abs !== null) {
                $out[] = $abs;
            }
        }
        return array_values(array_unique($out));
    }

    /** @return array<int,array<string,mixed>> parsed JSON-LD blocks */
    public function jsonLd(): array
    {
        $out = [];
        foreach ($this->query('//script[@type]') as $s) {
            if (strtolower($s->getAttribute('type')) !== 'application/ld+json') {
                continue;
            }
            $data = json_decode(trim($s->textContent), true);
            if (is_array($data)) {
                $out[] = $data;
            }
        }
        return $out;
    }

    /** @return array<int,array{action:string,method:string,fields:int,required:int,labels:int,types:array<int,string>}> */
    public function forms(): array
    {
        $out = [];
        foreach ($this->query('//form') as $f) {
            $fields   = 0;
            $required = 0;
            $types    = [];
            foreach ($f->getElementsByTagName('input') as $i) {
                $type = strtolower($i->getAttribute('type') ?: 'text');
                if (in_array($type, ['hidden', 'submit', 'button', 'image'], true)) {
                    continue;
                }
                $fields++;
                $types[] = $type;
                if ($i->hasAttribute('required')) {
                    $required++;
                }
            }
            foreach (['select', 'textarea'] as $tag) {
                foreach ($f->getElementsByTagName($tag) as $el) {
                    $fields++;
                    $types[] = $tag;
                    if ($el instanceof DOMElement && $el->hasAttribute('required')) {
                        $required++;
                    }
                }
            }
            $out[] = [
                'action'   => trim($f->getAttribute('action')),
                'method'   => strtolower($f->getAttribute('method') ?: 'get'),
                'fields'   => $fields,
                'required' => $required,
                'labels'   => $f->getElementsByTagName('label')->length,
                'types'    => array_values(array_unique($types)),
            ];
        }
        return $out;
    }

    /**
     * Call-to-action candidates.
     *
     * "hero" means the control sits above the first section heading — the
     * closest honest proxy for above-the-fold without rendering the page.
     * Strong CTAs ask for the account; soft ones ("learn more") only browse.
     *
     * @return array<int,array{text:string,href:string,tag:string,order:int,hero:bool,strong:bool}>
     */
    public function ctas(): array
    {
        $out   = [];
        $order = 0;
        foreach ($this->query('//a[@href] | //button | //input[@type="submit"]') as $el) {
            $tag  = strtolower($el->nodeName);
            $text = $tag === 'input' ? trim($el->getAttribute('value')) : self::text($el);
            $text = trim(preg_replace('/\s+/u', ' ', $text) ?? '');
            $order++;
            if ($text === '' || mb_strlen($text) > 42) {
                continue;
            }
            $kind = self::ctaKind($text);
            if ($kind === '') {
                continue;
            }
            if (self::inChrome($el)) {
                continue;
            }
            $href = $tag === 'a' ? (string) UrlGuard::resolveRelative($this->url, $el->getAttribute('href')) : '';
            $out[] = [
                'text'   => $text,
                'href'   => $href,
                'tag'    => $tag,
                'order'  => $order,
                'hero'   => $this->aboveFirstSection($el),
                'strong' => $kind === 'strong',
            ];
        }
        return $out;
    }

    /** True when nothing that reads as a section heading precedes this node. */
    private function aboveFirstSection(DOMNode $node): bool
    {
        if (!$this->xp) {
            return false;
        }
        $before = $this->xp->query('preceding::h2 | preceding::h3', $node);
        return $before === false ? false : $before->length === 0;
    }

    /** '' = not a CTA, 'strong' = asks for the conversion, 'soft' = browse. */
    private static function ctaKind(string $text): string
    {
        $t = mb_strtolower(trim($text, " \t\n\r.!→›»"));
        $strong = [
            'open an account', 'open account', 'open demat', 'open free', 'get started', 'start trading',
            'start investing', 'sign up', 'signup', 'register', 'create account', 'join now', 'apply now',
            'download app', 'download the app', 'get the app', 'book a demo', 'request a demo', 'talk to us',
            'contact sales', 'try free', 'start free', 'invest now', 'trade now', 'buy now', 'get a quote',
            'start now', 'claim', 'subscribe',
        ];
        foreach ($strong as $v) {
            if (strpos($t, $v) !== false) {
                return 'strong';
            }
        }
        $soft = ['know more', 'learn more', 'explore', 'discover', 'see how', 'find out', 'read more', 'view all'];
        foreach ($soft as $v) {
            if (strpos($t, $v) !== false) {
                return 'soft';
            }
        }
        return '';
    }

    /** Skip anything inside nav/header/footer chrome — those repeat on every page. */
    private static function inChrome(DOMNode $node): bool
    {
        $depth = 0;
        for ($p = $node->parentNode; $p !== null && $depth < 12; $p = $p->parentNode, $depth++) {
            $name = strtolower($p->nodeName);
            if (in_array($name, ['nav', 'header', 'footer'], true)) {
                return true;
            }
            if ($p instanceof DOMElement) {
                $hint = strtolower($p->getAttribute('class') . ' ' . $p->getAttribute('id') . ' ' . $p->getAttribute('role'));
                if (preg_match('/\b(nav|navbar|navigation|header|topbar|footer|menu)\b/', $hint)) {
                    return true;
                }
            }
        }
        return false;
    }

    /** Visible page text with script/style/noscript stripped. */
    public function visibleText(): string
    {
        if (!$this->doc) {
            return trim(preg_replace('/\s+/u', ' ', strip_tags($this->raw)) ?? '');
        }
        $clone = clone $this->doc;
        $xp    = new DOMXPath($clone);
        foreach (['script', 'style', 'noscript', 'template', 'svg'] as $tag) {
            $nodes = $xp->query('//' . $tag);
            if ($nodes) {
                foreach (iterator_to_array($nodes) as $n) {
                    $n->parentNode && $n->parentNode->removeChild($n);
                }
            }
        }
        $body = $clone->getElementsByTagName('body')->item(0);
        return self::text($body ?: $clone->documentElement);
    }

    /** Character offset of the first match, or -1. Case-insensitive. */
    public function offsetOf(string $needle, ?string $haystack = null): int
    {
        $hay = $haystack ?? $this->visibleText();
        $pos = mb_stripos($hay, $needle);
        return $pos === false ? -1 : (int) $pos;
    }

    /** Markup of the nav + footer, used to compare page templates. */
    public function chromeSignature(): string
    {
        $bits = [];
        foreach (['//nav', '//header', '//footer'] as $q) {
            foreach ($this->query($q) as $el) {
                $bits[] = self::text($el);
            }
        }
        $sig = mb_strtolower(implode(' | ', $bits));
        return trim(preg_replace('/\s+/u', ' ', $sig) ?? '');
    }

    /** Nav link labels, used for "campaign page still carries global nav". */
    public function navLabels(): array
    {
        $labels = [];
        foreach ($this->query('//nav//a | //header//a') as $a) {
            $t = self::text($a);
            if ($t !== '' && mb_strlen($t) <= 32) {
                $labels[] = mb_strtolower($t);
            }
        }
        return array_values(array_unique($labels));
    }

    /**
     * The brand lockup as served in the masthead.
     *
     * Deliberately narrow: header/nav only, and anything that reads as a social
     * icon, store badge, payment mark or partner logo is thrown out. A loose
     * match here would report every icon on the page as a second logo.
     *
     * @return array<int,string>
     */
    public function logoCandidates(): array
    {
        $out  = [];
        $home = $this->homeHrefs();

        foreach ($this->query('//header//img | //nav//img') as $img) {
            $src = $img->getAttribute('src') ?: $img->getAttribute('data-src');
            $hay = strtolower($src . ' ' . $img->getAttribute('alt') . ' ' . $img->getAttribute('class') . ' ' . $img->getAttribute('id'));
            // Named-only on purpose. Treating any masthead image as a lockup
            // pulled in product icons from inner-page navigation, and a wrong
            // "you have six logos" is worse in a meeting than a missed one.
            $named = strpos($hay, 'logo') !== false || strpos($hay, 'brand') !== false || strpos($hay, 'wordmark') !== false;
            if (!$named && !self::insideHomeLink($img, $home)) {
                continue;
            }
            if (self::isNotABrandMark($hay)) {
                continue;
            }
            $abs = UrlGuard::resolveRelative($this->url, $src);
            if ($abs !== null) {
                $out[] = $abs;
            }
        }
        // Inline SVG lockups count too, but only as a marker (no URL to compare).
        foreach ($this->query('//header//svg | //nav//svg') as $svg) {
            $hay = strtolower($svg->getAttribute('class') . ' ' . $svg->getAttribute('id') . ' ' . self::text($svg));
            $named = strpos($hay, 'logo') !== false || strpos($hay, 'brand') !== false;
            if (!$named && !self::insideHomeLink($svg, $home)) {
                continue;
            }
            if (self::isNotABrandMark($hay)) {
                continue;
            }
            $out[] = 'inline-svg:' . substr(md5($this->doc ? (string) $this->doc->saveHTML($svg) : $hay), 0, 10);
        }
        return array_values(array_unique($out));
    }

    /** Every href that means "the homepage" on this page. @return array<int,string> */
    private function homeHrefs(): array
    {
        $parts  = parse_url($this->url);
        $origin = ($parts['scheme'] ?? 'https') . '://' . ($parts['host'] ?? '');
        return ['/', $origin, $origin . '/', './', $this->url];
    }

    /**
     * True only when the nearest enclosing link points at the homepage — the
     * classic "click the logo to go home" pattern.
     *
     * @param array<int,string> $home
     */
    private static function insideHomeLink(DOMNode $node, array $home): bool
    {
        $depth = 0;
        for ($p = $node->parentNode; $p !== null && $depth < 6; $p = $p->parentNode, $depth++) {
            if (!($p instanceof DOMElement) || strtolower($p->nodeName) !== 'a') {
                continue;
            }
            $href = rtrim(trim($p->getAttribute('href')), '/');
            foreach ($home as $candidate) {
                if ($href !== '' && $href === rtrim($candidate, '/')) {
                    return true;
                }
            }
            return false; // nearest link is not the home link — stop looking
        }
        return false;
    }

    /** Social icons, store badges, payment marks and partner logos are not the brand. */
    private static function isNotABrandMark(string $hay): bool
    {
        return (bool) preg_match(
            '~(facebook|instagram|linkedin|twitter|x-logo|youtube|whatsapp|telegram|pinterest|tiktok|threads|'
            . 'app-?store|play-?store|google-?play|appstore|playstore|'
            . 'visa|mastercard|rupay|upi|paytm|razorpay|stripe|payment|'
            . 'partner|client|award|badge|certificate|sponsor|member|press|media-?logo)~',
            $hay
        );
    }
}
