import * as Types from '@/lib/audit/types';
import type { Finding } from '@/lib/audit/rules';

const FIX_TITLE: Record<string, string> = {
  "lp-no-h1": "State the offer in one line.",
  "lp-multi-h1": "Give the page one headline.",
  "lp-vague-headline": "Say something only this brand can say.",
  "lp-headline-title-mismatch": "Make the preview and the page agree.",
  "lp-no-subhead": "Back the headline with proof.",
  "lp-meta-thin": "Write the preview the click is sold on.",
  "lp-no-cta": "Put the ask above the fold.",
  "lp-cta-collision": "Give the hero one job.",
  "lp-cta-below-fold": "Move the ask up the page.",
  "lp-cta-not-repeated": "Repeat the ask down the page.",
  "lp-cta-low-contrast": "Make the button look like a button.",
  "lp-cta-vague": "Name the outcome on the button.",
  "lp-nav-overload": "Strip the navigation off the campaign.",
  "lp-heading-gaps": "Give the page a spine.",
  "lp-wall-of-text": "Break the copy into something scannable.",
  "lp-link-density": "Close the exits.",
  "lp-form-friction": "Shorten the form to the first yes.",
  "lp-slow-ttfb": "Fix the first byte before the creative.",
  "lp-heavy-html": "Cut the page to what converts.",
  "lp-many-requests": "Consolidate the asset pile.",
  "lp-blocking-scripts": "Stop scripts blocking the first paint.",
  "lp-no-lazyload": "Load images only when they are seen.",
  "lp-no-viewport": "Make the page render on a phone.",
  "lp-no-media-queries": "Build the mobile layout properly.",
  "lp-fixed-widths": "Replace fixed widths with a fluid grid.",
  "lp-small-type": "Set body copy at a readable size.",
  "lp-not-https": "Serve the page securely.",
  "lp-mixed-content": "Clear the insecure assets.",
  "lp-no-trust-markers": "Put the proof on the page.",
  "lp-trust-buried": "Move credentials above the fold.",
  "lp-no-testimonials": "Let a customer make the claim.",
  "lp-no-contact": "Show there is a human behind it.",
  "sm-no-bio": "Write the bio.",
  "sm-thin-bio": "Make the bio do a job.",
  "sm-no-avatar": "Put the lockup on the profile.",
  "sm-no-link": "Give the audience somewhere to go.",
  "sm-profile-unreachable": "Fix the dead profile link.",
  "sm-handle-drift": "Use one handle everywhere.",
  "sm-name-drift": "Write the name one way.",
  "sm-network-gap": "Open the missing channel.",
  "sm-low-engagement": "Rebuild the content formats.",
  "sm-flat-reach": "Fix distribution before volume.",
  "sm-stale-account": "Restart the publishing rhythm.",
  "sm-irregular-cadence": "Put the calendar on a rhythm.",
  "sm-low-volume": "Raise the volume to a testable level.",
  "sm-title-drift": "Install a series system.",
  "sm-avatar-drift": "Ship one avatar to every platform.",
  "doc-no-text": "Rebuild the file as a real document.",
  "doc-no-headings": "Give the document a structure.",
  "doc-long-sentences": "Cut the sentences down.",
  "doc-long-paragraphs": "Break the blocks apart.",
  "doc-no-lists": "Set the steps as a list.",
  "doc-hard-reading": "Rewrite for the actual reader.",
  "doc-no-summary": "Open with the point.",
  "doc-no-next-steps": "Tell the reader what to do next.",
  "doc-no-contact": "Put a way to reach you in the file.",
  "doc-no-cta": "Add the ask.",
  "doc-placeholders": "Finish the file before it ships.",
  "doc-repeated-words": "Proofread it properly.",
  "doc-misspellings": "Run a real spelling pass.",
  "doc-spacing": "Clean up the typography.",
  "doc-brand-drift": "Spell the brand one way.",
  "doc-stale": "Redraw the client documents.",
  "doc-font-sprawl": "Collapse the type to one system.",
  "doc-size-sprawl": "Build a type scale.",
  "doc-office-export": "Replace the default export with a system.",
  "doc-no-title-meta": "Give the file a real title.",
  "doc-heavy": "Make the file openable on mobile.",
  "doc-tiny-type": "Set the body type readable.",
  "doc-low-contrast": "Fix the contrast.",
  "doc-no-lang": "Declare the language.",
  "doc-untagged": "Tag the document for screen readers.",
  "br-multi-logo": "Lock one brand system.",
  "br-no-logo": "Ship a real lockup.",
  "br-no-favicon": "Claim the tab and the home screen.",
  "br-no-og-image": "Design the share card once.",
  "br-type-sprawl": "Collapse the type stack.",
  "br-palette-sprawl": "Cut the palette to a signal.",
  "br-category-colour": "Own a colour the category does not.",
  "br-tone-drift": "Write one voice, everywhere.",
  "br-no-tagline": "Own one sentence.",
  "br-jargon-heavy": "Drop the category language.",
  "br-name-drift": "Write the name one way, everywhere.",
  "br-audience-absent": "Name the customer on the page.",
  "br-audience-thin": "Write to the audience, not the product.",
  "br-reading-mismatch": "Bring the reading level down.",
  "br-cliche": "Retire the category clichés.",
  "br-palette-overlap": "Move the palette off the competitor.",
  "br-type-overlap": "Differentiate the typography.",
  "br-message-overlap": "Claim different ground.",
  "br-no-mission": "Publish what the business is for.",
  "br-no-values": "Put the values in public.",
  "br-mission-generic": "Make the mission specific."
};

const BETS: Record<string, { title: string; body: string; service: string; month: string }> = {
  "performance": {
    "title": "Always-on performance creative.",
    "body": "Live campaigns with no variant depth. Hooks, formats and refreshes ship weekly instead of as one-off banners.",
    "service": "Performance creatives",
    "month": "Month 2"
  },
  "web": {
    "title": "A landing page system.",
    "body": "Templates for campaign, product and launch pages that marketing can ship without a rebuild each time.",
    "service": "Web & landing pages",
    "month": "Month 2"
  },
  "launch": {
    "title": "Launch and campaign kits.",
    "body": "Every launch week restarts from a blank file. One reusable system covers key visual, landing page, social, motion and RM lines.",
    "service": "Product launches",
    "month": "Month 3"
  },
  "enablement": {
    "title": "Sales enablement that survives the floor.",
    "body": "Partner and relationship-manager material is a leftover export. The team needs a system it can open in front of a client.",
    "service": "Sales enablement",
    "month": "Month 3"
  },
  "content": {
    "title": "An education engine, not posts.",
    "body": "Series-level formats for the channels that compound — explainers, market hours, product education — so organic can carry paid.",
    "service": "Social & content design",
    "month": "Month 2"
  },
  "systems": {
    "title": "One brand system, rolled out.",
    "body": "Lockup, type, colour and layout applied across site, app, social and documents so every new asset starts from the system.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "docs": {
    "title": "A document system, not one file.",
    "body": "Templates for onboarding, risk, reports and proposals so every client-facing file leaves the building on-brand.",
    "service": "Brand systems",
    "month": "Month 2"
  }
};

const BETS_BY_TYPE: Record<string, string[]> = {
  "landing": [
    "web",
    "performance",
    "launch"
  ],
  "social": [
    "content",
    "performance",
    "systems"
  ],
  "document": [
    "docs",
    "enablement",
    "systems"
  ],
  "branding": [
    "systems",
    "web",
    "content"
  ]
};

const DIRECTION: Record<string, string> = {
  "Broking & trading": "Clear Markets",
  "Fintech & payments": "Plain Money",
  "Wealth & advisory": "Long Horizon",
  "Financial services": "Quiet Conviction"
};

export function fixes(type: string, findings: Finding[]): Array<Record<string, unknown>> {
  const weights: Record<string, number> = {};
  for (const [id, def] of Object.entries(Types.parameters(type))) {
    weights[id] = Number(def.weight);
  }

  const ranked = [...findings];
  ranked.sort((a, b) => {
    const sev: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const cmp = (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3);
    if (cmp !== 0) return cmp;
    return (weights[b.parameter] ?? 0) - (weights[a.parameter] ?? 0);
  });

  const out: Array<Record<string, unknown>> = [];
  const seen: Record<string, boolean> = {};
  for (const f of ranked) {
    if (out.length >= 3 || seen[f.parameter]) continue;
    seen[f.parameter] = true;
    out.push(fixCard(type, f));
  }
  for (const f of ranked) {
    if (out.length >= 3) break;
    if (out.some((o) => o.id === f.id)) continue;
    out.push(fixCard(type, f));
  }
  return out;
}

function fixCard(type: string, f: Finding): Record<string, unknown> {
  return {
    id: f.id,
    title: FIX_TITLE[f.id] ?? f.title,
    body: f.evidence,
    service: f.service,
    month: f.month,
    parameter: Types.parameterLabel(type, String(f.parameter)),
  };
}

export function bets(
  type: string,
  findings: Finding[],
  structure: string,
): Array<Record<string, unknown>> {
  const ids = findings.map((f) => f.id);
  const struct = structure.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [i, key] of (BETS_BY_TYPE[type] ?? []).entries()) {
    scores[key] = 6 - i;
  }

  if (/(paid|meta|google|performance|campaign|ads?|media buy|ppc)/.test(struct)) {
    scores.performance = (scores.performance ?? 0) + 3;
  }
  if (/(launch|ipo|new product|nfo|listing)/.test(struct)) {
    scores.launch = (scores.launch ?? 0) + 3;
  }
  if (/(rm|relationship manager|partner|sales|branch|distributor|advisor)/.test(struct)) {
    scores.enablement = (scores.enablement ?? 0) + 3;
  }
  if (/(content|education|youtube|webinar|blog|organic)/.test(struct)) {
    scores.content = (scores.content ?? 0) + 2;
  }
  if (ids.includes('doc-office-export') || ids.includes('doc-stale')) {
    scores.enablement = (scores.enablement ?? 0) + 2;
  }
  if (ids.includes('br-multi-logo') || ids.includes('br-type-sprawl')) {
    scores.systems = (scores.systems ?? 0) + 2;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const out: Array<Record<string, unknown>> = [];
  for (const [key] of sorted) {
    if (out.length >= 3 || !BETS[key]) continue;
    out.push({ ...BETS[key], key });
  }
  for (const [key, bet] of Object.entries(BETS)) {
    if (out.length >= 3) break;
    if (!out.some((o) => o.key === key)) {
      out.push({ ...bet, key });
    }
  }
  return out.slice(0, 3);
}

export function direction(
  type: string,
  company: string,
  sector: string,
  findings: Finding[],
  metrics: Record<string, unknown>,
): { name: string; copy: string; swatches: Array<{ label: string; tone: string }> } {
  const ids = findings.map((f) => f.id);
  const name = DIRECTION[sector] ?? 'Clear Markets';
  const lines = [
    'Treat ' + company + ' as a regulated instrument, not a casino: editorial type, real desks and product UI in photography, motion that ticks instead of explodes.',
  ];

  const families = (metrics.families ?? metrics.fonts ?? []) as string[];
  const accents = (metrics.accents ?? []) as string[];

  if (ids.includes('br-category-colour')) {
    lines.push('Retire market green and red as brand colour — keep them for data only — and let one signal colour carry the brand at thumbnail size.');
  } else if (accents.length > 8) {
    lines.push('Cut ' + accents.length + ' accent colours down to one signal used as a mark, never as a page wash.');
  } else {
    lines.push('One signal colour used as a mark, never as a page wash.');
  }

  if (families.length > 3) {
    lines.push('Collapse ' + families.length + ' type families into one display and one UI face, and let type do the differentiation.');
  } else {
    lines.push('One display face, one UI face, and let type do the differentiation.');
  }

  const tail: Record<string, string> = {
    [Types.LANDING]: 'Campaign pages inherit the same system as the app, so every new page starts finished.',
    [Types.SOCIAL]: 'Feed formats inherit the same system as the site, so organic and paid finally look like one brand.',
    [Types.DOCUMENT]: 'Client documents inherit the same system as the site, so the file a client keeps is on-brand.',
    [Types.BRANDING]: 'Every surface inherits the same system, so a new asset starts finished instead of starting over.',
  };
  lines.push(tail[type] ?? tail[Types.BRANDING]);

  return {
    name,
    copy: lines.join(' '),
    swatches: [
      {
        label: families.length > 1 ? families.slice(0, 2).join(' · ') : 'One display · one UI face',
        tone: '',
      },
      { label: 'Paper for proof · void for product', tone: 'paper' },
      { label: 'Signal as a tick, not a gradient', tone: 'rule' },
    ],
  };
}

export function tiers(): Record<string, Record<string, unknown>> {
  return {
  "starter": {
    "name": "Starter Creative Retainer",
    "price": "₹75k–₹1L / month",
    "blurb": "Static creatives, social content, ad variations, basic campaign support. Too thin if paid and web are already live.",
    "width": 0.32
  },
  "growth": {
    "name": "Growth Creative Retainer",
    "price": "₹1.5L–₹2L / month",
    "blurb": "Dedicated creative support, paid ads, landing pages, motion, launch communication, priority turnaround. The 90-day pilot lives here.",
    "width": 0.58
  },
  "scale": {
    "name": "Scale Creative Retainer",
    "price": "₹2.5L–₹4L+ / month",
    "blurb": "Dedicated team and high-volume performance creative. Right when the calendar is already a full in-house department.",
    "width": 1
  }
};
}

export function recommendTier(
  findings: Finding[],
  workOrders: Array<{ findings: number }>,
  score: number,
): string {
  const high = findings.filter((f) => f.severity === 'high').length;
  if (high >= 6 || workOrders.length >= 4 || score < 35) return 'scale';
  if (high >= 2 || workOrders.length >= 2 || score < 70) return 'growth';
  return 'starter';
}

const Playbook = { fixes, bets, direction, tiers, recommendTier };
export default Playbook;
