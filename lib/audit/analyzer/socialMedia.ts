import * as Rules from '@/lib/audit/rules';
import type { Finding, ProofItem } from '@/lib/audit/rules';
import type { AnalyzerResult } from '@/lib/audit/analyzer/landingPage';

/**
 * Social media audit — port of Analyzer/SocialMedia.php.
 */
export const NETWORKS: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  x: 'X / Twitter',
};

const EXPECTED = ['instagram', 'linkedin', 'youtube'];

function charLen(s: string): number {
  return [...s].length;
}

export function run(
  profiles: Record<string, Record<string, unknown>>,
  intake: Record<string, unknown>,
): AnalyzerResult {
  const findings: Finding[] = [];
  const coverage: Record<string, string> = {
    'profile-optimization': 'manual',
    engagement: 'manual',
    'visual-consistency': 'manual',
    'posting-consistency': 'manual',
    interaction: 'manual',
  };

  const readable = Object.values(profiles).filter((p) =>
    ['ok', 'thin'].includes(String(p.state ?? '')),
  );
  const handles: Record<string, string> = {};
  const names: Record<string, string> = {};
  const avatars: Record<string, string> = {};

  for (const [net, p] of Object.entries(profiles)) {
    const label = NETWORKS[net] ?? net.charAt(0).toUpperCase() + net.slice(1);

    if (String(p.state ?? '') === 'missing') {
      findings.push(
        Rules.make(
          'sm-profile-unreachable',
          `The ${label} URL returned HTTP ${Number(p.status ?? 0)}.`,
          { network: label },
          [
            { label: 'URL', value: String(p.url), url: String(p.url) },
            { label: 'Response', value: `HTTP ${Number(p.status ?? 0)}` },
          ],
        ),
      );
      coverage['profile-optimization'] = 'auto';
      continue;
    }
    if (!['ok', 'thin'].includes(String(p.state ?? ''))) {
      continue;
    }

    coverage['profile-optimization'] = 'auto';

    const bio = String(p.bio ?? '').trim();
    if (bio === '') {
      findings.push(
        Rules.make(
          'sm-no-bio',
          `The ${label} profile returned no description at all.`,
          { network: label },
          [{ label: 'Profile', value: String(p.url), url: String(p.url) }],
        ),
      );
    } else if (charLen(bio) < 60) {
      findings.push(
        Rules.make(
          'sm-thin-bio',
          `The ${label} bio reads “${bio}” — ${charLen(bio)} characters.`,
          { network: label, n: String(charLen(bio)) },
          [{ label: 'Bio', value: bio }],
        ),
      );
    }

    if (String(p.avatar ?? '').trim() === '') {
      findings.push(
        Rules.make(
          'sm-no-avatar',
          `No profile image could be read from the ${label} profile.`,
          { network: label },
          [{ label: 'Profile', value: String(p.url), url: String(p.url) }],
        ),
      );
    } else {
      avatars[net] = String(p.avatar);
    }

    if (!p.outbound_link && net !== 'youtube') {
      findings.push(
        Rules.make(
          'sm-no-link',
          `No outbound link was found in the ${label} profile header.`,
          { network: label },
          [{ label: 'Profile', value: String(p.url), url: String(p.url) }],
        ),
      );
    }

    if (p.handle) handles[net] = String(p.handle);
    if (p.display_name) names[net] = String(p.display_name);
  }

  const uniqueHandles = [
    ...new Set(
      Object.values(handles).map((h) => {
        const norm = h.toLowerCase().replace(/[^a-z0-9]/g, '');
        return norm || h;
      }),
    ),
  ];
  if (Object.keys(handles).length >= 2 && uniqueHandles.length > 1) {
    const vals = Object.values(handles);
    findings.push(
      Rules.make(
        'sm-handle-drift',
        `The account is @${vals.join(' on one platform and @')} on another.`,
        {},
        Object.entries(handles).map(([net, h]) => ({
          label: NETWORKS[net] ?? net,
          value: '@' + h,
        })),
      ),
    );
  }

  const uniqueNames = [...new Set(Object.values(names).map((n) => n.trim()))];
  if (uniqueNames.length > 1) {
    findings.push(
      Rules.make(
        'sm-name-drift',
        `The display name reads ${uniqueNames.map((n) => `“${n}”`).join(' / ')} across platforms.`,
        { n: Rules.spell(uniqueNames.length) },
        Object.entries(names).map(([net, n]) => ({
          label: NETWORKS[net] ?? net,
          value: n,
        })),
      ),
    );
  }

  const present = Object.entries(profiles)
    .filter(([, p]) => String(p.state ?? '') !== 'missing')
    .map(([net]) => net);
  const gaps: string[] = [];
  for (const net of EXPECTED) {
    if (!present.includes(net)) gaps.push(NETWORKS[net]);
  }
  if (gaps.length) {
    findings.push(
      Rules.make(
        'sm-network-gap',
        `No ${gaps.join(' and no ')} profile was supplied for this audit.`,
        { list: gaps.join(' or ') },
        gaps.map((g) => ({ label: 'Missing channel', value: g })),
      ),
    );
    coverage['profile-optimization'] = 'auto';
  }

  for (const [net, p] of Object.entries(profiles)) {
    const feed = p.feed as Record<string, unknown> | null | undefined;
    if (!feed || typeof feed !== 'object' || !Array.isArray(feed.dates) || !feed.dates.length) {
      continue;
    }
    coverage['posting-consistency'] = 'auto';
    const label = NETWORKS[net] ?? net.charAt(0).toUpperCase() + net.slice(1);

    const dates = [...(feed.dates as string[])].sort().reverse();
    const newest = Date.parse(String(dates[0])) || 0;
    const days = newest ? Math.floor((Date.now() - newest) / 86400000) : 999;

    if (days > 30) {
      findings.push(
        Rules.make(
          'sm-stale-account',
          `The most recent ${label} post is dated ${String(dates[0]).slice(0, 10)}.`,
          { network: label, days: String(days) },
          [
            { label: 'Last post', value: String(dates[0]).slice(0, 10) },
            { label: 'Days since', value: String(days) },
          ],
          days > 90 ? 'high' : 'medium',
        ),
      );
    }

    let recent = 0;
    const cut = Date.now() - 90 * 86400000;
    for (const d of dates) {
      if ((Date.parse(String(d)) || 0) >= cut) recent++;
    }
    if (recent < 6 && dates.length >= 3) {
      findings.push(
        Rules.make(
          'sm-low-volume',
          `${label} published ${recent} time${recent === 1 ? '' : 's'} in the last 90 days, from a visible feed of ${dates.length} posts.`,
          { network: label, n: String(recent) },
          [{ label: 'Posts in 90 days', value: String(recent) }],
        ),
      );
    }

    const gap = gapStats(dates);
    if (gap !== null && gap.cv > 1.0 && dates.length >= 5) {
      findings.push(
        Rules.make(
          'sm-irregular-cadence',
          `${label} posts land ${Math.round(gap.mean)} days apart on average, but the gap swings from ${gap.min} to ${gap.max} days.`,
          { network: label },
          [
            { label: 'Average gap', value: `${Math.round(gap.mean)} days` },
            { label: 'Range', value: `${gap.min}–${gap.max} days` },
          ],
        ),
      );
    }

    const titles = (feed.titles as string[]) ?? [];
    if (titles.length >= 6) {
      coverage['visual-consistency'] = 'auto';
      if (!hasSeriesPattern(titles)) {
        findings.push(
          Rules.make(
            'sm-title-drift',
            `None of the last ${titles.length} ${label} posts share a prefix, tag or naming pattern.`,
            {},
            titles.slice(0, 3).map((t) => ({
              label: 'Recent post',
              value: String(t).slice(0, 60),
            })),
          ),
        );
      }
    }

    const views = (feed.views as number[]) ?? [];
    if (views.length && p.followers) {
      coverage.engagement = 'auto';
      const avgViews = views.reduce((a, b) => a + b, 0) / Math.max(1, views.length);
      const followers = Number(p.followers);
      const rate = followers > 0 ? avgViews / followers : 0;
      if (rate > 0 && rate < 0.05) {
        findings.push(
          Rules.make(
            'sm-flat-reach',
            `${label} averages ${Math.round(avgViews).toLocaleString('en-US')} views per post against ${followers.toLocaleString('en-US')} subscribers — ${Math.round(rate * 1000) / 10}% of the audience.`,
            { network: label },
            [
              { label: 'Average views', value: Math.round(avgViews).toLocaleString('en-US') },
              { label: 'Followers', value: followers.toLocaleString('en-US') },
              { label: 'Reach', value: `${Math.round(rate * 1000) / 10}%` },
            ],
          ),
        );
      }
    }
  }

  if (Object.keys(avatars).length >= 2) {
    const sizes = Object.keys(avatars)
      .map((net) => String(profiles[net]?.avatar_hash ?? ''))
      .filter(Boolean);
    if (new Set(sizes).size > 1 && sizes.length === Object.keys(avatars).length) {
      coverage['visual-consistency'] = 'auto';
      const nets = Object.keys(avatars);
      findings.push(
        Rules.make(
          'sm-avatar-drift',
          `The profile images on ${nets.map((n) => NETWORKS[n] ?? n).join(' and ')} are different files, not one lockup exported twice.`,
          {},
          nets.map((net) => ({
            label: NETWORKS[net] ?? net,
            value: 'avatar',
            url: avatars[net],
          })) as ProofItem[],
        ),
      );
    }
  }

  return {
    findings,
    coverage,
    metrics: {
      profiles,
      handles,
      names,
      readable: readable.length,
      supplied: Object.keys(profiles).length,
      blocked: Object.values(profiles).filter((p) => String(p.state ?? '') === 'blocked').length,
      primary: String(intake.primary_network ?? ''),
    },
  };
}

function gapStats(
  dates: string[],
): { mean: number; min: number; max: number; cv: number } | null {
  const stamps = dates
    .map((d) => Date.parse(String(d)) || 0)
    .filter(Boolean)
    .sort((a, b) => b - a);
  if (stamps.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 0; i < stamps.length - 1; i++) {
    gaps.push(Math.round((stamps[i] - stamps[i + 1]) / 86400000));
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean <= 0) return null;
  let variance = 0;
  for (const g of gaps) variance += (g - mean) ** 2;
  const sd = Math.sqrt(variance / gaps.length);
  return { mean, min: Math.min(...gaps), max: Math.max(...gaps), cv: sd / mean };
}

function hasSeriesPattern(titles: string[]): boolean {
  const prefixes: Record<string, number> = {};
  let tags = 0;
  for (const raw of titles) {
    const t = String(raw).trim();
    if (t === '') continue;
    const m = t.match(/^([^|:\-–—#]{3,28})\s*[|:\-–—]/u);
    if (m) {
      const key = m[1].trim().toLowerCase();
      prefixes[key] = (prefixes[key] ?? 0) + 1;
    }
    if (/#\w{3,}/u.test(t)) tags++;
  }
  for (const count of Object.values(prefixes)) {
    if (count >= 3) return true;
  }
  return tags >= Math.max(3, Math.floor(titles.length / 2));
}

/** Extract the account handle from a profile URL. */
export function handle(network: string, url: string): string {
  let path = '';
  try {
    path = new URL(url).pathname.replace(/^\/+|\/+$/g, '');
  } catch {
    return '';
  }
  if (path === '') return '';
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return '';

  if (network === 'linkedin') {
    if (
      parts.length >= 2 &&
      ['company', 'school', 'in', 'showcase'].includes(parts[0].toLowerCase())
    ) {
      return parts[1].toLowerCase();
    }
    return parts[0].toLowerCase();
  }
  if (network === 'youtube') {
    if (parts.length >= 2 && ['c', 'channel', 'user'].includes(parts[0].toLowerCase())) {
      return parts[1].toLowerCase();
    }
    return parts[0].replace(/^@/, '').toLowerCase();
  }
  if (network === 'facebook' && parts[0].toLowerCase() === 'pages' && parts.length >= 2) {
    return parts[1].toLowerCase();
  }
  return parts[0].split('?')[0].replace(/^@/, '').toLowerCase();
}

export function detect(url: string): string {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
  const map: Record<string, RegExp> = {
    instagram: /(^|\.)instagram\.com$/i,
    facebook: /(^|\.)facebook\.com$/i,
    linkedin: /(^|\.)linkedin\.com$/i,
    youtube: /(^|\.)(youtube\.com|youtu\.be)$/i,
    x: /(^|\.)(twitter\.com|x\.com)$/i,
  };
  for (const [net, re] of Object.entries(map)) {
    if (re.test(host)) return net;
  }
  return '';
}

const SocialMedia = { NETWORKS, run, handle, detect };
export default SocialMedia;
