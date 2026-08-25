export const LANDING = 'landing';
export const SOCIAL = 'social';
export const DOCUMENT = 'document';
export const BRANDING = 'branding';

export type AuditTypeId = typeof LANDING | typeof SOCIAL | typeof DOCUMENT | typeof BRANDING;

export interface ParameterDef {
  label: string;
  weight: number;
  blurb: string;
}

export interface AuditTypeDef {
  id: string;
  index: string;
  name: string;
  tagline: string;
  intro: string;
  headline: string;
  steps: Array<{ id: string; label: string; note: string }>;
  parameters: Record<string, ParameterDef>;
}

export interface FieldDef {
  name: string;
  label: string;
  kind: string;
  required?: boolean;
  placeholder?: string;
  help?: string;
  half?: boolean;
  options?: string[];
  accept?: string;
}

const ALL: Record<string, AuditTypeDef> = {
  "landing": {
    "id": "landing",
    "index": "01",
    "name": "Landing page",
    "tagline": "Home, campaign, account open — where paid traffic has to convert.",
    "intro": "One page, read the way a paid click reads it.",
    "headline": "Does this page do one job well?",
    "steps": [
      {
        "id": "fetch",
        "label": "Page",
        "note": "Fetching the page and its stylesheets"
      },
      {
        "id": "content",
        "label": "Message",
        "note": "Reading the offer, the CTA and the structure"
      },
      {
        "id": "tech",
        "label": "Delivery",
        "note": "Speed, mobile rendering and assets"
      },
      {
        "id": "trust",
        "label": "Trust",
        "note": "Proof, credentials and security signals"
      }
    ],
    "parameters": {
      "value-prop": {
        "label": "Value proposition",
        "weight": 25,
        "blurb": "A clear headline that instantly says what you offer and why it matters."
      },
      "cta": {
        "label": "Call to action",
        "weight": 20,
        "blurb": "Visible, high-contrast buttons that push toward one primary goal."
      },
      "ux": {
        "label": "User experience",
        "weight": 20,
        "blurb": "A simple layout and smooth navigation that prevent confusion."
      },
      "speed": {
        "label": "Speed & performance",
        "weight": 15,
        "blurb": "Load times fast enough that visitors do not leave first."
      },
      "mobile": {
        "label": "Mobile responsiveness",
        "weight": 10,
        "blurb": "Layout that adapts properly to phones and tablets."
      },
      "trust": {
        "label": "Trust & credibility",
        "weight": 10,
        "blurb": "Testimonials, security badges and credentials that build confidence."
      }
    }
  },
  "social": {
    "id": "social",
    "index": "02",
    "name": "Social media",
    "tagline": "Instagram, LinkedIn, YouTube — formats that can support always-on paid.",
    "intro": "The profiles, read the way a new follower reads them.",
    "headline": "Can this account carry paid spend?",
    "steps": [
      {
        "id": "reach",
        "label": "Profiles",
        "note": "Reaching each profile supplied"
      },
      {
        "id": "profile",
        "label": "Bio & links",
        "note": "Reading the bio, avatar and links"
      },
      {
        "id": "cadence",
        "label": "Cadence",
        "note": "Post history and publishing rhythm"
      },
      {
        "id": "signals",
        "label": "Engagement",
        "note": "Whatever engagement data is public"
      }
    ],
    "parameters": {
      "profile-optimization": {
        "label": "Profile optimisation",
        "weight": 25,
        "blurb": "Complete bio, clear profile picture and working links in the header."
      },
      "engagement": {
        "label": "Content engagement",
        "weight": 25,
        "blurb": "Healthy likes, comments, shares and saves on recent posts."
      },
      "visual-consistency": {
        "label": "Visual consistency",
        "weight": 20,
        "blurb": "Uniform colour and templates that make posts instantly recognisable."
      },
      "posting-consistency": {
        "label": "Posting consistency",
        "weight": 15,
        "blurb": "A regular, predictable schedule that keeps the audience active."
      },
      "interaction": {
        "label": "Audience interaction",
        "weight": 15,
        "blurb": "Active replies and conversation in comments and DMs."
      }
    }
  },
  "document": {
    "id": "document",
    "index": "03",
    "name": "Document",
    "tagline": "AO kit, risk, partner decks — the files a client actually keeps.",
    "intro": "One file, read the way the client reads it.",
    "headline": "Is this file worth keeping?",
    "steps": [
      {
        "id": "ingest",
        "label": "File",
        "note": "Reading the file"
      },
      {
        "id": "text",
        "label": "Text",
        "note": "Extracting text and structure"
      },
      {
        "id": "style",
        "label": "Design",
        "note": "Type, colour and layout"
      },
      {
        "id": "review",
        "label": "Review",
        "note": "Clarity, accuracy and next steps"
      }
    ],
    "parameters": {
      "clarity": {
        "label": "Clarity & readability",
        "weight": 30,
        "blurb": "Structure, headings and bullets that make the text easy to digest."
      },
      "actionability": {
        "label": "Actionability",
        "weight": 25,
        "blurb": "Clear takeaways, summaries or next steps for the reader."
      },
      "accuracy": {
        "label": "Content accuracy",
        "weight": 20,
        "blurb": "Grammar, spelling and factual consistency that protect credibility."
      },
      "visual-design": {
        "label": "Visual design",
        "weight": 15,
        "blurb": "Consistent fonts, margins and colour that read as professional."
      },
      "accessibility": {
        "label": "Accessibility",
        "weight": 10,
        "blurb": "Contrast and font sizes that keep the document readable for everyone."
      }
    }
  },
  "branding": {
    "id": "branding",
    "index": "04",
    "name": "Branding",
    "tagline": "Trust, app, identity — one lockup, one type stack, one signal.",
    "intro": "The identity, read across every surface it appears on.",
    "headline": "Is there one system, or a pile of files?",
    "steps": [
      {
        "id": "site",
        "label": "Site",
        "note": "Reading the brand pages"
      },
      {
        "id": "identity",
        "label": "Identity",
        "note": "Logo, type and colour across pages"
      },
      {
        "id": "market",
        "label": "Market",
        "note": "Competitors and differentiation"
      },
      {
        "id": "voice",
        "label": "Voice",
        "note": "Tone, mission and stated values"
      }
    ],
    "parameters": {
      "visual-identity": {
        "label": "Visual identity",
        "weight": 30,
        "blurb": "Consistent logo, colour palette and typography across platforms."
      },
      "brand-voice": {
        "label": "Brand voice",
        "weight": 25,
        "blurb": "A distinct, steady tone across everything written and spoken."
      },
      "audience-alignment": {
        "label": "Target audience alignment",
        "weight": 20,
        "blurb": "Visuals and messaging that speak to the ideal customer."
      },
      "uniqueness": {
        "label": "Uniqueness",
        "weight": 15,
        "blurb": "Clear differentiation from the main competitors."
      },
      "core-values": {
        "label": "Core values",
        "weight": 10,
        "blurb": "A visible, authentic mission that says what the business stands for."
      }
    }
  }
};

const FIELDS: Record<string, FieldDef[]> = {
  "landing": [
    {
      "name": "company",
      "label": "Company",
      "kind": "text",
      "required": true,
      "placeholder": "Client name"
    },
    {
      "name": "sector",
      "label": "Sector",
      "kind": "select",
      "options": [
        "Broking & trading",
        "Fintech & payments",
        "Wealth & advisory",
        "Financial services"
      ]
    },
    {
      "name": "url",
      "label": "Landing page URL",
      "kind": "url",
      "required": true,
      "placeholder": "https://example.com/open-account",
      "help": "The exact page paid traffic lands on — not the homepage, unless that is the destination."
    },
    {
      "name": "goal",
      "label": "Primary conversion",
      "kind": "select",
      "options": [
        "Open an account",
        "Sign up / register",
        "App install",
        "Book a demo",
        "Lead form",
        "Purchase",
        "Newsletter",
        "Other"
      ]
    },
    {
      "name": "source",
      "label": "Traffic source",
      "kind": "select",
      "options": [
        "Meta ads",
        "Google ads",
        "YouTube",
        "Organic search",
        "Email",
        "Mixed / always-on"
      ]
    },
    {
      "name": "structure",
      "label": "Marketing structure",
      "kind": "textarea",
      "placeholder": "Team size, in-house designers, who buys media, always-on campaigns, launch calendar. This shapes which growth bets the audit recommends."
    }
  ],
  "social": [
    {
      "name": "company",
      "label": "Company",
      "kind": "text",
      "required": true,
      "placeholder": "Client name"
    },
    {
      "name": "sector",
      "label": "Sector",
      "kind": "select",
      "options": [
        "Broking & trading",
        "Fintech & payments",
        "Wealth & advisory",
        "Financial services"
      ]
    },
    {
      "name": "instagram",
      "label": "Instagram profile URL",
      "kind": "url",
      "placeholder": "https://instagram.com/…",
      "half": true
    },
    {
      "name": "facebook",
      "label": "Facebook page URL",
      "kind": "url",
      "placeholder": "https://facebook.com/…",
      "half": true
    },
    {
      "name": "linkedin",
      "label": "LinkedIn company URL",
      "kind": "url",
      "placeholder": "https://linkedin.com/company/…",
      "half": true
    },
    {
      "name": "youtube",
      "label": "YouTube channel URL",
      "kind": "url",
      "placeholder": "https://youtube.com/@…",
      "half": true
    },
    {
      "name": "x",
      "label": "X / Twitter URL",
      "kind": "url",
      "placeholder": "https://x.com/…",
      "half": true
    },
    {
      "name": "primary_network",
      "label": "Primary platform",
      "kind": "select",
      "half": true,
      "options": [
        "Instagram",
        "LinkedIn",
        "YouTube",
        "Facebook",
        "X / Twitter"
      ]
    },
    {
      "name": "structure",
      "label": "Marketing structure",
      "kind": "textarea",
      "placeholder": "Team size, in-house designers, who buys media, always-on campaigns, launch calendar. This shapes which growth bets the audit recommends."
    }
  ],
  "document": [
    {
      "name": "company",
      "label": "Company",
      "kind": "text",
      "required": true,
      "placeholder": "Client name"
    },
    {
      "name": "sector",
      "label": "Sector",
      "kind": "select",
      "options": [
        "Broking & trading",
        "Fintech & payments",
        "Wealth & advisory",
        "Financial services"
      ]
    },
    {
      "name": "file",
      "label": "Document file",
      "kind": "file",
      "accept": ".pdf,.docx,.pptx,.txt,.md,.html",
      "help": "PDF, Word, PowerPoint, text or Markdown, up to 20 MB. Or paste a public URL below instead."
    },
    {
      "name": "url",
      "label": "Or document URL",
      "kind": "url",
      "placeholder": "https://example.com/account-opening-kit.pdf"
    },
    {
      "name": "doc_kind",
      "label": "Document type",
      "kind": "select",
      "options": [
        "Account opening kit",
        "Risk disclosure",
        "Partner / RM deck",
        "Sales proposal",
        "Report or factsheet",
        "Brochure",
        "Policy document",
        "Other"
      ]
    },
    {
      "name": "reader",
      "label": "Intended reader",
      "kind": "text",
      "placeholder": "New retail client, partner, relationship manager…"
    },
    {
      "name": "structure",
      "label": "Marketing structure",
      "kind": "textarea",
      "placeholder": "Team size, in-house designers, who buys media, always-on campaigns, launch calendar. This shapes which growth bets the audit recommends."
    }
  ],
  "branding": [
    {
      "name": "company",
      "label": "Company",
      "kind": "text",
      "required": true,
      "placeholder": "Client name"
    },
    {
      "name": "sector",
      "label": "Sector",
      "kind": "select",
      "options": [
        "Broking & trading",
        "Fintech & payments",
        "Wealth & advisory",
        "Financial services"
      ]
    },
    {
      "name": "url",
      "label": "Website URL",
      "kind": "url",
      "required": true,
      "placeholder": "https://example.com"
    },
    {
      "name": "audience",
      "label": "Target audience",
      "kind": "textarea",
      "required": true,
      "placeholder": "Who the brand is built for — age, city tier, income, experience level, what they are trying to do.",
      "help": "Audience alignment is scored against this. Without it that parameter is left for you to mark by hand."
    },
    {
      "name": "competitors",
      "label": "Main competitors",
      "kind": "textarea",
      "placeholder": "One URL per line, up to three.\nhttps://competitor-one.com\nhttps://competitor-two.com",
      "help": "Uniqueness is measured against these. Leave blank and only category clichés are checked."
    },
    {
      "name": "instagram",
      "label": "Instagram (optional)",
      "kind": "url",
      "placeholder": "https://instagram.com/…",
      "half": true
    },
    {
      "name": "linkedin",
      "label": "LinkedIn (optional)",
      "kind": "url",
      "placeholder": "https://linkedin.com/company/…",
      "half": true
    },
    {
      "name": "structure",
      "label": "Marketing structure",
      "kind": "textarea",
      "placeholder": "Team size, in-house designers, who buys media, always-on campaigns, launch calendar. This shapes which growth bets the audit recommends."
    }
  ]
};

export function ids(): AuditTypeId[] {
  return [LANDING, SOCIAL, DOCUMENT, BRANDING];
}

export function exists(id: string): boolean {
  return (ids() as string[]).includes(id);
}

export function get(id: string): AuditTypeDef {
  if (!ALL[id]) throw new Error('Unknown audit type: ' + id);
  return ALL[id];
}

export function grade(score: number): { band: string; label: string; note: string } {
  if (score >= 80) {
    return { band: 'excellent', label: 'Excellent', note: 'No major changes needed — minor optimisations only.' };
  }
  if (score >= 50) {
    return { band: 'improve', label: 'Needs improvement', note: 'Moderate issues. Focus on the high-weight parameters first.' };
  }
  return { band: 'critical', label: 'Critical', note: 'Severe flaws. This needs a redesign or rewrite, not a tweak.' };
}

export function all(): Record<string, AuditTypeDef> {
  return ALL;
}

export function fields(type: string): FieldDef[] {
  return FIELDS[type] ?? FIELDS[BRANDING];
}

export function parameters(type: string): Record<string, ParameterDef> {
  return get(type).parameters;
}

export function parameterLabel(type: string, parameter: string): string {
  return parameters(type)[parameter]?.label ?? parameter;
}

export const Types = {
  LANDING, SOCIAL, DOCUMENT, BRANDING,
  ids, exists, get, grade, all, fields, parameters, parameterLabel,
};
export default Types;
