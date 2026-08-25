export const WEIGHT: Record<string, number> = { high: 4, medium: 2, low: 1 };

export interface RuleDef {
  type: string;
  parameter: string;
  severity: string;
  title: string;
  cost: string;
  service: string;
  month: string;
}

export interface ProofItem {
  label: string;
  value: string;
  url?: string;
}

export interface Finding {
  id: string;
  type: string;
  parameter: string;
  severity: string;
  title: string;
  evidence: string;
  cost: string;
  service: string;
  month: string;
  proof: ProofItem[];
}

const RULES: Record<string, RuleDef> = {
  "lp-no-h1": {
    "type": "landing",
    "parameter": "value-prop",
    "severity": "high",
    "title": "The page never states the offer",
    "cost": "A visitor cannot tell in three seconds what this is. Paid clicks bounce before the scroll.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-multi-h1": {
    "type": "landing",
    "parameter": "value-prop",
    "severity": "medium",
    "title": "{n} headlines compete for the same job",
    "cost": "There is no single claim to test, so message testing has nothing to move.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-vague-headline": {
    "type": "landing",
    "parameter": "value-prop",
    "severity": "medium",
    "title": "The headline says nothing specific",
    "cost": "A generic promise reads as every competitor. Nothing in it earns the next scroll.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-headline-title-mismatch": {
    "type": "landing",
    "parameter": "value-prop",
    "severity": "low",
    "title": "Search preview and headline promise different things",
    "cost": "The click is sold on one message and the page opens on another.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-no-subhead": {
    "type": "landing",
    "parameter": "value-prop",
    "severity": "low",
    "title": "Nothing supports the headline above the fold",
    "cost": "The claim lands with no proof or detail behind it.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-no-cta": {
    "type": "landing",
    "parameter": "cta",
    "severity": "high",
    "title": "No conversion action above the fold",
    "cost": "Traffic arrives with nothing to do. The media spend ends at the scroll.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-cta-collision": {
    "type": "landing",
    "parameter": "cta",
    "severity": "high",
    "title": "{n} calls to action fight in the hero",
    "cost": "The page cannot choose a job, so the visitor does not either.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-cta-below-fold": {
    "type": "landing",
    "parameter": "cta",
    "severity": "medium",
    "title": "The first real CTA is {depth}% down the page",
    "cost": "Most visitors never reach the ask.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-cta-not-repeated": {
    "type": "landing",
    "parameter": "cta",
    "severity": "low",
    "title": "The CTA appears once on a long page",
    "cost": "A reader convinced at the bottom has to scroll back up to act.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-cta-low-contrast": {
    "type": "landing",
    "parameter": "cta",
    "severity": "medium",
    "title": "The primary button sits at {ratio}:1 contrast",
    "cost": "The button does not read as a button. Conversion leaks to a design detail.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-cta-vague": {
    "type": "landing",
    "parameter": "cta",
    "severity": "medium",
    "title": "The button says “{label}”",
    "cost": "A label with no outcome in it converts worse than one that names the result.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-nav-overload": {
    "type": "landing",
    "parameter": "ux",
    "severity": "medium",
    "title": "{n} navigation links pull away from the offer",
    "cost": "A campaign page with full site navigation leaks the click it paid for.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-heading-gaps": {
    "type": "landing",
    "parameter": "ux",
    "severity": "medium",
    "title": "The page has no section structure",
    "cost": "Nothing guides a skim reader, and screen readers get no map.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-wall-of-text": {
    "type": "landing",
    "parameter": "ux",
    "severity": "medium",
    "title": "Copy runs {words} words to a paragraph",
    "cost": "Nobody reads it. The argument is on the page but not in the visitor.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-link-density": {
    "type": "landing",
    "parameter": "ux",
    "severity": "low",
    "title": "One link for every {ratio} words",
    "cost": "Every link is an exit. The page is a directory, not an argument.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-form-friction": {
    "type": "landing",
    "parameter": "ux",
    "severity": "medium",
    "title": "The form asks for {fields} fields in one step",
    "cost": "Every extra field is a drop-off, right where the budget is finally spent.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-slow-ttfb": {
    "type": "landing",
    "parameter": "speed",
    "severity": "high",
    "title": "Server takes {ttfb}s to answer",
    "cost": "The paid click is burned before a pixel renders.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-heavy-html": {
    "type": "landing",
    "parameter": "speed",
    "severity": "medium",
    "title": "{weight} of HTML before a single image",
    "cost": "Heavy pages punish exactly the mobile traffic paid media buys.",
    "service": "Web & landing pages",
    "month": "Month 2"
  },
  "lp-many-requests": {
    "type": "landing",
    "parameter": "speed",
    "severity": "medium",
    "title": "The page pulls {n} separate assets",
    "cost": "Each one is a round trip on a phone on mobile data.",
    "service": "Web & landing pages",
    "month": "Month 2"
  },
  "lp-blocking-scripts": {
    "type": "landing",
    "parameter": "speed",
    "severity": "medium",
    "title": "{n} scripts block the first paint",
    "cost": "The visitor stares at white while third-party code loads.",
    "service": "Web & landing pages",
    "month": "Month 2"
  },
  "lp-no-lazyload": {
    "type": "landing",
    "parameter": "speed",
    "severity": "low",
    "title": "{n} images load whether they are seen or not",
    "cost": "Bandwidth is spent on content below the fold that most visitors never reach.",
    "service": "Web & landing pages",
    "month": "Month 2"
  },
  "lp-no-viewport": {
    "type": "landing",
    "parameter": "mobile",
    "severity": "high",
    "title": "No mobile viewport declared",
    "cost": "The page renders desktop-wide on phones, where most of the spend lands.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-no-media-queries": {
    "type": "landing",
    "parameter": "mobile",
    "severity": "medium",
    "title": "The stylesheet has no responsive rules",
    "cost": "One fixed layout is being served to every screen size.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-fixed-widths": {
    "type": "landing",
    "parameter": "mobile",
    "severity": "medium",
    "title": "{n} layout blocks use fixed pixel widths",
    "cost": "Fixed widths force sideways scrolling on the smallest screens.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-small-type": {
    "type": "landing",
    "parameter": "mobile",
    "severity": "low",
    "title": "Body copy is set at {size}",
    "cost": "Type under 16px triggers zooming on a phone, and zoom breaks layouts.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-not-https": {
    "type": "landing",
    "parameter": "trust",
    "severity": "high",
    "title": "The page is not served over HTTPS",
    "cost": "The browser labels it “Not secure”. For a financial brand that ends the visit.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-mixed-content": {
    "type": "landing",
    "parameter": "trust",
    "severity": "medium",
    "title": "{n} assets still load over plain HTTP",
    "cost": "The padlock drops on load and undercuts the ad that paid for the click.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-no-trust-markers": {
    "type": "landing",
    "parameter": "trust",
    "severity": "high",
    "title": "No proof of any kind on the page",
    "cost": "No licence, no review, no client, no badge. Trust is the first sale in this category.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-trust-buried": {
    "type": "landing",
    "parameter": "trust",
    "severity": "medium",
    "title": "The first proof appears {depth}% down",
    "cost": "Credibility arrives after the decision has already been made.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-no-testimonials": {
    "type": "landing",
    "parameter": "trust",
    "severity": "medium",
    "title": "No customer voice anywhere on the page",
    "cost": "The brand is the only one making the claim. Social proof is doing nothing.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-no-contact": {
    "type": "landing",
    "parameter": "trust",
    "severity": "low",
    "title": "No phone, email or address on the page",
    "cost": "A financial brand with no way to reach a human reads as a risk.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "lp-meta-thin": {
    "type": "landing",
    "parameter": "value-prop",
    "severity": "low",
    "title": "The search and share preview is thin",
    "cost": "The click is decided in the preview, before the page ever loads.",
    "service": "Web & landing pages",
    "month": "Month 1"
  },
  "sm-no-bio": {
    "type": "social",
    "parameter": "profile-optimization",
    "severity": "high",
    "title": "{network} has no bio",
    "cost": "The first thing a new visitor reads is blank.",
    "service": "Social & content design",
    "month": "Month 1"
  },
  "sm-thin-bio": {
    "type": "social",
    "parameter": "profile-optimization",
    "severity": "medium",
    "title": "{network} bio is {n} characters",
    "cost": "There is no room for what the brand does or who it is for.",
    "service": "Social & content design",
    "month": "Month 1"
  },
  "sm-no-avatar": {
    "type": "social",
    "parameter": "profile-optimization",
    "severity": "medium",
    "title": "{network} has no profile image",
    "cost": "The account reads as abandoned or fake in a feed.",
    "service": "Social & content design",
    "month": "Month 1"
  },
  "sm-no-link": {
    "type": "social",
    "parameter": "profile-optimization",
    "severity": "high",
    "title": "{network} carries no link out",
    "cost": "Audience built on the platform has nowhere to convert.",
    "service": "Social & content design",
    "month": "Month 1"
  },
  "sm-profile-unreachable": {
    "type": "social",
    "parameter": "profile-optimization",
    "severity": "high",
    "title": "The {network} URL does not resolve",
    "cost": "A dead profile link is a dead end wherever it is published.",
    "service": "Social & content design",
    "month": "Month 1"
  },
  "sm-handle-drift": {
    "type": "social",
    "parameter": "profile-optimization",
    "severity": "medium",
    "title": "The handle changes between platforms",
    "cost": "Nobody can guess the account, and reporting has to be stitched by hand.",
    "service": "Social & content design",
    "month": "Month 1"
  },
  "sm-name-drift": {
    "type": "social",
    "parameter": "profile-optimization",
    "severity": "medium",
    "title": "The display name is written {n} different ways",
    "cost": "Search on the platform does not connect the accounts to one brand.",
    "service": "Social & content design",
    "month": "Month 1"
  },
  "sm-network-gap": {
    "type": "social",
    "parameter": "profile-optimization",
    "severity": "medium",
    "title": "No {list} presence supplied",
    "cost": "A channel the category earns trust on cheaply is simply missing.",
    "service": "Social & content design",
    "month": "Month 2"
  },
  "sm-low-engagement": {
    "type": "social",
    "parameter": "engagement",
    "severity": "high",
    "title": "{network} averages {rate} engagement per post",
    "cost": "The content is being published, not received. Paid cannot lean on it.",
    "service": "Social & content design",
    "month": "Month 2"
  },
  "sm-flat-reach": {
    "type": "social",
    "parameter": "engagement",
    "severity": "medium",
    "title": "{network} views sit far below the follower count",
    "cost": "The algorithm is not distributing the work the team is producing.",
    "service": "Social & content design",
    "month": "Month 2"
  },
  "sm-stale-account": {
    "type": "social",
    "parameter": "posting-consistency",
    "severity": "high",
    "title": "{network} last posted {days} days ago",
    "cost": "A dormant account undermines every ad that points at it.",
    "service": "Social & content design",
    "month": "Month 1"
  },
  "sm-irregular-cadence": {
    "type": "social",
    "parameter": "posting-consistency",
    "severity": "medium",
    "title": "{network} posts in bursts, not on a rhythm",
    "cost": "The audience never learns when to expect anything, and the algorithm cools off.",
    "service": "Social & content design",
    "month": "Month 1"
  },
  "sm-low-volume": {
    "type": "social",
    "parameter": "posting-consistency",
    "severity": "medium",
    "title": "{network} published {n} times in the last 90 days",
    "cost": "There is not enough volume to learn what works, let alone to scale it.",
    "service": "Social & content design",
    "month": "Month 1"
  },
  "sm-title-drift": {
    "type": "social",
    "parameter": "visual-consistency",
    "severity": "medium",
    "title": "Recent posts share no naming pattern",
    "cost": "Nothing signals a series, so nothing compounds.",
    "service": "Social & content design",
    "month": "Month 2"
  },
  "sm-avatar-drift": {
    "type": "social",
    "parameter": "visual-consistency",
    "severity": "medium",
    "title": "Profile images differ across platforms",
    "cost": "The same brand looks like different accounts in a feed.",
    "service": "Social & content design",
    "month": "Month 1"
  },
  "doc-no-text": {
    "type": "document",
    "parameter": "clarity",
    "severity": "high",
    "title": "The file has no selectable text",
    "cost": "It is a picture of a document. Nobody can search, copy or read it aloud.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-no-headings": {
    "type": "document",
    "parameter": "clarity",
    "severity": "high",
    "title": "No headings break up {words} words",
    "cost": "A reader cannot find anything. The document is read once, or not at all.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-long-sentences": {
    "type": "document",
    "parameter": "clarity",
    "severity": "medium",
    "title": "Sentences average {n} words",
    "cost": "Long sentences hide the point. Comprehension drops with every clause.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-long-paragraphs": {
    "type": "document",
    "parameter": "clarity",
    "severity": "medium",
    "title": "Paragraphs run to {n} words",
    "cost": "Dense blocks get skipped, including the parts that matter legally.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-no-lists": {
    "type": "document",
    "parameter": "clarity",
    "severity": "medium",
    "title": "Nothing is set as a list",
    "cost": "Steps and conditions are buried in prose instead of being scannable.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-hard-reading": {
    "type": "document",
    "parameter": "clarity",
    "severity": "medium",
    "title": "Reads at roughly grade {grade}",
    "cost": "The reading level is above the audience. The document technically informs and practically does not.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-no-summary": {
    "type": "document",
    "parameter": "actionability",
    "severity": "high",
    "title": "No summary or overview anywhere",
    "cost": "The reader has to do the work of extracting the point themselves.",
    "service": "Sales enablement",
    "month": "Month 3"
  },
  "doc-no-next-steps": {
    "type": "document",
    "parameter": "actionability",
    "severity": "high",
    "title": "The document never says what to do next",
    "cost": "It informs and then stops. Nothing moves after it is read.",
    "service": "Sales enablement",
    "month": "Month 3"
  },
  "doc-no-contact": {
    "type": "document",
    "parameter": "actionability",
    "severity": "medium",
    "title": "No contact route in the document",
    "cost": "A reader ready to act has to go and find the brand again.",
    "service": "Sales enablement",
    "month": "Month 3"
  },
  "doc-no-cta": {
    "type": "document",
    "parameter": "actionability",
    "severity": "medium",
    "title": "Nothing asks the reader to act",
    "cost": "The file is a leave-behind with no ask attached.",
    "service": "Sales enablement",
    "month": "Month 3"
  },
  "doc-placeholders": {
    "type": "document",
    "parameter": "accuracy",
    "severity": "high",
    "title": "Placeholder text is still in the file",
    "cost": "A client-facing document with “TBD” in it says the brand did not check.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-repeated-words": {
    "type": "document",
    "parameter": "accuracy",
    "severity": "medium",
    "title": "{n} doubled words in the text",
    "cost": "Small errors add up to a document nobody proofread.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-misspellings": {
    "type": "document",
    "parameter": "accuracy",
    "severity": "medium",
    "title": "{n} common misspellings found",
    "cost": "Spelling is the cheapest credibility there is, and this is spending it.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-spacing": {
    "type": "document",
    "parameter": "accuracy",
    "severity": "low",
    "title": "{n} spacing and punctuation slips",
    "cost": "Typographic noise reads as a document assembled in a hurry.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-brand-drift": {
    "type": "document",
    "parameter": "accuracy",
    "severity": "medium",
    "title": "The brand name is written {n} ways in one file",
    "cost": "If the document cannot spell the brand consistently, nothing else in it reads as checked.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-stale": {
    "type": "document",
    "parameter": "accuracy",
    "severity": "medium",
    "title": "Last modified {date}",
    "cost": "The first file a client keeps is out of date with the product it describes.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-font-sprawl": {
    "type": "document",
    "parameter": "visual-design",
    "severity": "medium",
    "title": "{n} typefaces in one document",
    "cost": "The file looks assembled from other files, because it was.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-size-sprawl": {
    "type": "document",
    "parameter": "visual-design",
    "severity": "medium",
    "title": "{n} different type sizes in use",
    "cost": "With no type scale there is no hierarchy, only variation.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-office-export": {
    "type": "document",
    "parameter": "visual-design",
    "severity": "medium",
    "title": "Exported straight from {tool}",
    "cost": "Sales material is a leftover file, not a system. The room still needs a designer.",
    "service": "Sales enablement",
    "month": "Month 3"
  },
  "doc-no-title-meta": {
    "type": "document",
    "parameter": "visual-design",
    "severity": "low",
    "title": "The file carries no title metadata",
    "cost": "It shows as a raw filename in search, in mail clients and on a client desktop.",
    "service": "Brand systems",
    "month": "Month 2"
  },
  "doc-heavy": {
    "type": "document",
    "parameter": "visual-design",
    "severity": "medium",
    "title": "The file weighs {weight}",
    "cost": "On mobile data it is never opened, so it is never read.",
    "service": "Brand systems",
    "month": "Month 2"
  },
  "doc-tiny-type": {
    "type": "document",
    "parameter": "accessibility",
    "severity": "high",
    "title": "Body text is set at {size}pt",
    "cost": "Below 9pt the document is unreadable on a phone and hostile in print.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-low-contrast": {
    "type": "document",
    "parameter": "accessibility",
    "severity": "medium",
    "title": "Text contrast measures {ratio}:1",
    "cost": "Below 4.5:1 a chunk of the audience simply cannot read it.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "doc-no-lang": {
    "type": "document",
    "parameter": "accessibility",
    "severity": "low",
    "title": "No language is declared",
    "cost": "Screen readers guess the pronunciation, usually wrongly.",
    "service": "Brand systems",
    "month": "Month 2"
  },
  "doc-untagged": {
    "type": "document",
    "parameter": "accessibility",
    "severity": "medium",
    "title": "The PDF has no structure tags",
    "cost": "Assistive technology reads it as one undifferentiated block.",
    "service": "Brand systems",
    "month": "Month 2"
  },
  "br-multi-logo": {
    "type": "branding",
    "parameter": "visual-identity",
    "severity": "high",
    "title": "{n} different logo files are in circulation",
    "cost": "A brand that cannot recognise itself will not be recognised in a feed.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-no-logo": {
    "type": "branding",
    "parameter": "visual-identity",
    "severity": "medium",
    "title": "No brand mark is declared anywhere",
    "cost": "There is no reusable lockup to hand to media, partners or an app store.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-no-favicon": {
    "type": "branding",
    "parameter": "visual-identity",
    "severity": "medium",
    "title": "No favicon or app icon declared",
    "cost": "The brand is blank in a tab, a bookmark and a home screen.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-no-og-image": {
    "type": "branding",
    "parameter": "visual-identity",
    "severity": "medium",
    "title": "No share image on {n} of the pages read",
    "cost": "Every share and paid social preview renders unbranded.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-type-sprawl": {
    "type": "branding",
    "parameter": "visual-identity",
    "severity": "medium",
    "title": "{n} type families are loaded across the site",
    "cost": "Every campaign rebriefs type from scratch. There is no system to scale.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-palette-sprawl": {
    "type": "branding",
    "parameter": "visual-identity",
    "severity": "medium",
    "title": "{n} accent colours are in use",
    "cost": "No colour is doing brand work. Nothing survives at thumbnail size.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-category-colour": {
    "type": "branding",
    "parameter": "visual-identity",
    "severity": "medium",
    "title": "Category green and red are carrying the identity",
    "cost": "The brand disappears next to every competitor. Colour is doing category, not brand.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-tone-drift": {
    "type": "branding",
    "parameter": "brand-voice",
    "severity": "medium",
    "title": "Tone swings between pages",
    "cost": "Each page reads like a different writer, so no personality accumulates.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-no-tagline": {
    "type": "branding",
    "parameter": "brand-voice",
    "severity": "medium",
    "title": "No consistent positioning line",
    "cost": "There is no sentence the company repeats, so nothing gets remembered.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-jargon-heavy": {
    "type": "branding",
    "parameter": "brand-voice",
    "severity": "medium",
    "title": "The copy runs on category jargon",
    "cost": "Language borrowed from the sector says nothing about this brand in particular.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-name-drift": {
    "type": "branding",
    "parameter": "brand-voice",
    "severity": "medium",
    "title": "The brand name appears {n} different ways",
    "cost": "Titles, share cards and documents disagree on the name. Recall never compounds.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-audience-absent": {
    "type": "branding",
    "parameter": "audience-alignment",
    "severity": "high",
    "title": "The stated audience is never named on the site",
    "cost": "The customer the business is built for cannot tell the site is for them.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-audience-thin": {
    "type": "branding",
    "parameter": "audience-alignment",
    "severity": "medium",
    "title": "Only {n} of the audience themes show up in the copy",
    "cost": "The messaging is about the product, not about who it is for.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-reading-mismatch": {
    "type": "branding",
    "parameter": "audience-alignment",
    "severity": "medium",
    "title": "Copy reads at grade {grade} for a general audience",
    "cost": "The reading level filters out part of the market the brand is paying to reach.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-cliche": {
    "type": "branding",
    "parameter": "uniqueness",
    "severity": "medium",
    "title": "{n} category clichés in the headline copy",
    "cost": "Phrases every competitor uses cannot differentiate anybody.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-palette-overlap": {
    "type": "branding",
    "parameter": "uniqueness",
    "severity": "medium",
    "title": "Palette overlaps {competitor}",
    "cost": "Side by side in a feed, the two brands are the same brand.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-type-overlap": {
    "type": "branding",
    "parameter": "uniqueness",
    "severity": "low",
    "title": "Same typefaces as {competitor}",
    "cost": "Type is the cheapest way to look different, and it is being spent on looking the same.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-message-overlap": {
    "type": "branding",
    "parameter": "uniqueness",
    "severity": "medium",
    "title": "Headline claims match {competitor}",
    "cost": "Both brands are promising the same thing in nearly the same words.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-no-mission": {
    "type": "branding",
    "parameter": "core-values",
    "severity": "high",
    "title": "No mission or purpose stated anywhere",
    "cost": "There is nothing for staff, partners or customers to believe in beyond the product.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-no-values": {
    "type": "branding",
    "parameter": "core-values",
    "severity": "medium",
    "title": "No values are published",
    "cost": "Culture and conduct are implied rather than stated, so nobody can hold to them.",
    "service": "Brand systems",
    "month": "Month 1"
  },
  "br-mission-generic": {
    "type": "branding",
    "parameter": "core-values",
    "severity": "low",
    "title": "The mission statement could belong to anyone",
    "cost": "A purpose with no specifics in it does not move a customer or a hire.",
    "service": "Brand systems",
    "month": "Month 1"
  }
};

export function all(): Record<string, RuleDef> {
  return RULES;
}

export function make(
  id: string,
  evidence: string,
  tokens: Record<string, string | number> = {},
  proof: ProofItem[] = [],
  severity: string | null = null,
): Finding {
  const rule = RULES[id];
  if (!rule) throw new Error('Unknown rule: ' + id);
  let title = rule.title;
  const leads = title.startsWith('{');
  for (const [key, value] of Object.entries(tokens)) {
    title = title.split('{' + key + '}').join(String(value));
  }
  if (leads && title.length) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }
  return {
    id,
    type: rule.type,
    parameter: rule.parameter,
    severity: severity || rule.severity,
    title,
    evidence,
    cost: rule.cost,
    service: rule.service,
    month: rule.month,
    proof: [...proof],
  };
}

export function spell(n: number): string {
  const words: Record<number, string> = {
    2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine',
  };
  return words[n] ?? String(n);
}

export function plural(n: number, singular: string, pluralForm?: string): string {
  return n + ' ' + (n === 1 ? singular : (pluralForm ?? singular + 's'));
}

const Rules = { WEIGHT, all, make, spell, plural };
export default Rules;
