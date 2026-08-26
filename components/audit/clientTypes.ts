import type { AuditTypeDef, FieldDef, ParameterDef } from '@/lib/audit/types';

export type ViewId = 'landing' | 'intake' | 'scan' | 'workspace' | 'report' | 'close';

export interface BootConfig {
  needPasscode: boolean;
  brand: string;
  maxUpload: number;
  landingKicker?: string;
  kicker?: string;
  endpoint?: string;
  report?: string;
}

export interface ClientTypeDef extends AuditTypeDef {
  fields: FieldDef[];
}

export type TypesMap = Record<string, ClientTypeDef>;

export interface UploadState {
  id: string;
  name: string;
  bytes: number;
}

export interface GradeInfo {
  band: string;
  label: string;
  note: string;
}

export interface ParamScore {
  id?: string;
  label: string;
  blurb: string;
  weight: number;
  score: number | null;
  source: string;
  findings: number;
  high?: number;
  points?: number | null;
}

export interface ProofItem {
  label: string;
  value: string;
  url?: string;
}

export interface Finding {
  id: string;
  title: string;
  evidence: string;
  severity: string;
  parameter: string;
  service: string;
  month: string;
  cost: string;
  proof?: ProofItem[];
}

export interface WorkOrder {
  service: string;
  month: string;
  months: number[];
  findings: number;
}

export interface FixOrBet {
  title: string;
  body: string;
  service: string;
  month: string;
  parameter?: string;
}

export interface MethodSource {
  url?: string;
  label: string;
  status?: number;
  state?: string;
  ttfb?: number;
  bytes?: number;
  note?: string;
}

export interface ShotBox {
  kind: 'headline' | 'cta' | 'form' | 'nav' | 'media';
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  below_fold: boolean;
}

export interface ShotFrame {
  variant: string;
  file: string;
  width: number;
  height: number;
  bytes: number;
}

export interface ShotData {
  ok: boolean;
  error: string;
  url: string;
  captured_at: string;
  fold_height: number;
  page_height: number;
  fold_ratio: number;
  frames: Record<string, ShotFrame>;
  boxes: ShotBox[];
  background: string;
}

export interface AuditResult {
  type: string;
  type_name: string;
  company: string;
  sector: string;
  subject: string;
  score: {
    overall: number;
    provisional: boolean;
    unscored: string[];
    scored_weight: number;
    parameters: Record<string, ParamScore>;
    counts: { high?: number; medium?: number; low?: number };
    grade: GradeInfo;
  };
  findings: Finding[];
  orders: WorkOrder[];
  fixes: FixOrBet[];
  bets: FixOrBet[];
  direction: {
    name: string;
    copy: string;
    swatches?: Array<{ tone: string; label: string }>;
  };
  tiers: Record<
    string,
    { name: string; price: string; blurb: string; width: string | number }
  >;
  recommended_tier: string;
  metrics?: Record<string, unknown>;
  shot?: ShotData | null;
  method: {
    sources: MethodSource[];
    crawled_at: string;
    user_agent: string;
  };
}

export interface AuditPayload {
  id: string;
  type: string;
  status: string;
  step: string;
  steps: string[];
  company: string;
  sector: string;
  subject: string;
  answers: Record<string, unknown>;
  manual: Record<string, number>;
  tier: string;
  day: string;
  closed: boolean;
  direction: string;
  created_at: string;
  error: string;
  result: AuditResult | null;
}

export interface RecentAudit {
  id: string;
  token: string;
  company: string;
  site: string;
  type: string;
  created: string;
  score: number;
  grade: string;
  findings: number;
}

export type { ParameterDef, FieldDef };
