'use client';

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  ApiError,
  closeAudit,
  createAudit,
  fetchRecent,
  getAudit,
  login,
  runStep,
  setParameterScore,
  apiUpload,
} from '@/components/audit/api';
import PageShot from '@/components/audit/diagnose/PageShot';
import RecoveryLadder from '@/components/audit/diagnose/RecoveryLadder';
import ScoreHero from '@/components/audit/diagnose/ScoreHero';
import type {
  AuditPayload,
  AuditResult,
  BootConfig,
  Finding,
  RecentAudit,
  TypesMap,
  UploadState,
  ViewId,
} from '@/components/audit/clientTypes';
import {
  MONTH_TITLES,
  STORAGE_KEY,
  VIEWS,
  bytes,
  clip,
  subjectLabel,
  trimUrl,
} from '@/components/audit/helpers';

type Props = {
  boot: BootConfig;
  types: TypesMap;
};

type ScanBar = {
  pct: number;
  meta: string;
  cls?: 'error' | '';
  live?: boolean;
};

type LogLine = { text: string; strong?: boolean };

function isView(id: string): id is ViewId {
  return (VIEWS as readonly string[]).includes(id);
}

function reportPath(id: string, token: string, print = false): string {
  const q = new URLSearchParams({ t: token });
  if (print) q.set('print', '1');
  return `/report/${encodeURIComponent(id)}?${q.toString()}`;
}

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduce(mq.matches);
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduce;
}

export default function AuditApp({ boot, types }: Props) {
  const reduce = useReducedMotion();
  const [view, setViewState] = useState<ViewId>('landing');
  const [choice, setChoice] = useState('');
  const [id, setId] = useState('');
  const [token, setToken] = useState('');
  const [audit, setAudit] = useState<AuditPayload | null>(null);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState('');
  const [running, setRunning] = useState(false);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [gateOpen, setGateOpen] = useState(boot.needPasscode);
  const [passcode, setPasscode] = useState('');
  const [gateError, setGateError] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [toastOn, setToastOn] = useState(false);
  const [toastHidden, setToastHidden] = useState(true);
  const [recents, setRecents] = useState<RecentAudit[]>([]);
  const [intakeError, setIntakeError] = useState('');
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [fileStatus, setFileStatus] = useState('');
  const [scanStatus, setScanStatus] = useState('Preparing.');
  const [scanError, setScanError] = useState('');
  const [scanLog, setScanLog] = useState<LogLine[]>([]);
  const [scanBars, setScanBars] = useState<Record<string, ScanBar>>({});
  const [showScanBack, setShowScanBack] = useState(false);
  const [findingSearch, setFindingSearch] = useState('');
  const [directionCopy, setDirectionCopy] = useState('');
  const [chartsTick, setChartsTick] = useState(0);
  const [booted, setBooted] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const auditRef = useRef<AuditPayload | null>(null);
  const stateRef = useRef({
    view,
    choice,
    id,
    token,
    filter,
    selected,
    draft,
  });

  stateRef.current = { view, choice, id, token, filter, selected, draft };
  runningRef.current = running;
  auditRef.current = audit;

  const hasResult = !!(audit && audit.result);
  const result = (): AuditResult | null => (audit ? audit.result : null);
  const typeDef = () =>
    types[choice] || types[(audit && audit.type) || ''] || null;

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastHidden(false);
    setToastOn(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (toastHideTimer.current) clearTimeout(toastHideTimer.current);
    toastTimer.current = setTimeout(() => {
      setToastOn(false);
      toastHideTimer.current = setTimeout(() => setToastHidden(true), 220);
    }, 2400);
  }, []);

  const persistSession = useCallback(() => {
    const s = stateRef.current;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          id: s.id,
          token: s.token,
          view: s.view,
          choice: s.choice,
          filter: s.filter,
          selected: s.selected,
          draft: s.draft,
        }),
      );
    } catch {
      /* private mode */
    }
  }, []);

  const resetScroll = () => {
    const html = document.documentElement;
    const prev = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    html.style.scrollBehavior = prev;
  };

  const revealCharts = useCallback(() => {
    setChartsTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!chartsTick) return;
    const nodes = document.querySelectorAll<HTMLElement>('[data-w]');
    nodes.forEach((el) => {
      const w = el.getAttribute('data-w') || '0';
      el.style.setProperty('--w', '0');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.setProperty('--w', w);
        });
      });
    });
  }, [chartsTick, view]);

  const loadRecents = useCallback(() => {
    fetchRecent()
      .then((data) => {
        const list = (data.audits as RecentAudit[]) || [];
        setRecents(list);
      })
      .catch(() => {
        /* convenience only */
      });
  }, []);

  const refreshAudit = useCallback(async (): Promise<AuditPayload | null> => {
    const s = stateRef.current;
    if (!s.id || !s.token) return null;
    const data = await getAudit(s.id, s.token);
    const next = data.audit as AuditPayload;
    auditRef.current = next;
    setAudit(next);
    if (next?.type) setChoice(next.type);
    return next;
  }, []);

  const setView = useCallback(
    (nextId: string, push = true) => {
      let idv: ViewId = isView(nextId) ? nextId : 'landing';
      const s = stateRef.current;
      const current = auditRef.current;
      const has = !!(current && current.result);

      if (idv === 'intake' && !s.choice) idv = 'landing';
      if (
        (idv === 'workspace' || idv === 'report' || idv === 'close') &&
        !has
      ) {
        idv = s.choice ? 'intake' : 'landing';
      }
      if (idv === 'scan' && !runningRef.current && has) {
        idv = 'workspace';
      }

      const changing = stateRef.current.view !== idv;
      setViewState(idv);

      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            id: s.id,
            token: s.token,
            view: idv,
            choice: s.choice,
            filter: s.filter,
            selected: s.selected,
            draft: s.draft,
          }),
        );
      } catch {
        /* ignore */
      }

      if (push !== false) {
        try {
          history.pushState({ view: idv }, '', '#' + idv);
        } catch {
          /* file:// */
        }
      }
      if (changing) resetScroll();

      if (idv === 'landing') loadRecents();
      if (idv === 'workspace' || idv === 'report' || idv === 'close') {
        queueMicrotask(() => revealCharts());
      }
    },
    [loadRecents, revealCharts],
  );

  // Keep direction textarea in sync when audit loads
  useEffect(() => {
    if (!audit?.result) return;
    const copy =
      audit.direction || audit.result.direction?.copy || '';
    setDirectionCopy(copy);
  }, [audit?.id, audit?.direction, audit?.result?.direction?.copy]);

  const persistClose = useCallback(
    async (extra: Record<string, unknown> = {}) => {
      const s = stateRef.current;
      if (!s.id || !s.token || !audit) return;
      try {
        const data = await closeAudit(s.id, s.token, {
          tier: audit.tier,
          day: audit.day,
          direction: directionCopy,
          closed: audit.closed ? 1 : 0,
          ...extra,
        });
        if (data.audit) {
          auditRef.current = data.audit as AuditPayload;
          setAudit(data.audit as AuditPayload);
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
      }
    },
    [audit, directionCopy, toast],
  );

  const setBar = (
    stepId: string,
    pct: number,
    meta: string,
    cls: 'error' | '' = '',
  ) => {
    setScanBars((prev) => ({
      ...prev,
      [stepId]: {
        pct,
        meta,
        cls,
        live: pct > 0 && pct < 100,
      },
    }));
  };

  const logLine = (text: string, strong?: boolean) => {
    setScanLog((prev) => {
      const next = [...prev, { text, strong }];
      return next.slice(-5);
    });
  };

  const runScan = useCallback(
    async (steps?: string[], from?: string) => {
      const def = typeDef();
      const stepIds =
        steps ||
        (def
          ? def.steps.map((s) => s.id).concat(['finalize'])
          : ['finalize']);
      let start = from ? stepIds.indexOf(from) : 0;
      if (start < 0) start = 0;

      setRunning(true);
      runningRef.current = true;
      setScanLog([]);
      setScanError('');
      setShowScanBack(false);

      const bars: Record<string, ScanBar> = {};
      (def?.steps || []).forEach((s) => {
        bars[s.id] = { pct: 0, meta: 'Queued' };
      });
      if (start > 0) {
        stepIds.slice(0, start).forEach((done) => {
          if (done !== 'finalize') {
            bars[done] = { pct: 100, meta: 'Done' };
          }
        });
        setScanLog([{ text: 'Resuming from where the scan stopped', strong: true }]);
      }
      setScanBars(bars);
      setScanStatus(
        `Working through ${(def?.steps || []).length} passes.`,
      );

      try {
        for (const step of stepIds.slice(start)) {
          const s = stateRef.current;
          if (step !== 'finalize') {
            setBar(step, 55, 'Reading');
          } else {
            setScanStatus('Scoring the parameters.');
          }
          const data = await runStep(s.id, s.token, step);
          const logs = (data.log as LogLine[]) || [];
          logs.forEach((l) => logLine(l.text, l.strong));
          if (step !== 'finalize') setBar(step, 100, 'Done');
        }
        setRunning(false);
        runningRef.current = false;
        setScanStatus('Scan complete. Scoring the parameters.');
        await refreshAudit();
        setView('workspace');
      } catch (e) {
        setRunning(false);
        runningRef.current = false;
        setScanStatus('The scan stopped.');
        setScanError(e instanceof Error ? e.message : String(e));
        setShowScanBack(true);
        setScanBars((prev) => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(next)) {
            if (v.live) {
              next[k] = {
                pct: 100,
                meta: 'Failed',
                cls: 'error',
                live: false,
              };
            }
          }
          return next;
        });
      }
    },
    // typeDef uses choice/audit from closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [choice, audit, refreshAudit, setView],
  );

  // Boot once
  useEffect(() => {
    if (booted) return;
    let saved: Record<string, unknown> = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<
        string,
        unknown
      >;
    } catch {
      saved = {};
    }

    let nextId = String(saved.id || '');
    let nextToken = String(saved.token || '');
    let nextChoice = types[String(saved.choice || '')]
      ? String(saved.choice)
      : '';
    let nextFilter = String(saved.filter || 'all');
    let nextSelected = String(saved.selected || '');
    let nextDraft =
      saved.draft && typeof saved.draft === 'object'
        ? (saved.draft as Record<string, string>)
        : {};
    let nextView: ViewId = isView(String(saved.view || ''))
      ? (saved.view as ViewId)
      : 'landing';

    const params = new URLSearchParams(window.location.search);
    if (params.get('id') && params.get('t')) {
      nextId = params.get('id') || '';
      nextToken = params.get('t') || '';
      nextView = 'workspace';
    }
    const hash = (window.location.hash || '').replace('#', '');
    if (isView(hash)) nextView = hash;

    setId(nextId);
    setToken(nextToken);
    setChoice(nextChoice);
    setFilter(nextFilter);
    setSelected(nextSelected);
    setDraft(nextDraft);
    setViewState(nextView);
    setBooted(true);

    if (!window.location.hash) {
      try {
        history.replaceState({ view: nextView }, '', '#' + nextView);
      } catch {
        /* ignore */
      }
    }

    if (boot.needPasscode) {
      setViewState('landing');
      return;
    }

    if (nextId && nextToken) {
      const wanted = nextView;
      getAudit(nextId, nextToken)
        .then((data) => {
          const a = data.audit as AuditPayload;
          auditRef.current = a;
          setAudit(a);
          if (a?.type) setChoice(a.type);
          if (a && a.result) {
            setView(wanted === 'scan' ? 'workspace' : wanted, false);
          } else if (
            a &&
            a.status === 'running' &&
            Array.isArray(a.steps) &&
            a.steps.indexOf(a.step) > 0
          ) {
            setChoice(a.type);
            setView('scan', false);
            void runScan(a.steps, a.step);
          } else {
            setView('landing', false);
          }
        })
        .catch(() => {
          setId('');
          setToken('');
          try {
            localStorage.setItem(
              STORAGE_KEY,
              JSON.stringify({
                id: '',
                token: '',
                view: 'landing',
                choice: nextChoice,
                filter: nextFilter,
                selected: '',
                draft: nextDraft,
              }),
            );
          } catch {
            /* ignore */
          }
          setView('landing', false);
        });
    } else {
      setView(nextView, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted]);

  useEffect(() => {
    if (!booted) return;
    persistSession();
  }, [view, choice, id, token, filter, selected, draft, booted, persistSession]);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const idv =
        (e.state && e.state.view) ||
        (window.location.hash || '').replace('#', '') ||
        'landing';
      setView(String(idv), false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [setView]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (
        e.key === '/' &&
        stateRef.current.view === 'workspace' &&
        document.activeElement &&
        document.activeElement.tagName !== 'INPUT' &&
        document.activeElement.tagName !== 'TEXTAREA' &&
        document.activeElement.tagName !== 'SELECT'
      ) {
        e.preventDefault();
        document.getElementById('finding-search')?.focus();
      }
      if (e.key === 'Escape' && stateRef.current.view === 'workspace') {
        if (findingSearch) {
          setFindingSearch('');
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [findingSearch]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (runningRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const def = types[choice];
  const brandSub = def
    ? def.name + ' audit'
    : 'Creative Growth Audit';
  const ctaStartLabel = def
    ? 'Start the ' + def.name.toLowerCase() + ' audit'
    : 'Choose an audit above';

  const phaseKey = view === 'workspace' ? 'scan' : view;
  const phaseUnlocked = (key: string) =>
    (key === 'intake' && !!choice) ||
    hasResult ||
    (key === 'scan' && view === 'scan');

  const findings = (): Finding[] =>
    (hasResult && result()?.findings) || [];

  const paramLabel = (r: AuditResult, pid: string) => {
    const p = r.score.parameters[pid];
    return p ? p.label : pid;
  };

  const filteredFindings = (() => {
    if (!hasResult) return [] as Finding[];
    const q = findingSearch.toLowerCase();
    return findings().filter((f) => {
      if (filter === 'high' && f.severity !== 'high') return false;
      if (filter !== 'all' && filter !== 'high' && f.parameter !== filter)
        return false;
      if (
        q &&
        (f.title + ' ' + f.evidence + ' ' + f.service)
          .toLowerCase()
          .indexOf(q) === -1
      )
        return false;
      return true;
    });
  })();

  const selectedFinding =
    filteredFindings.find((f) => f.id === selected) ||
    filteredFindings[0] ||
    null;

  useEffect(() => {
    if (!hasResult || view !== 'workspace') return;
    if (
      selectedFinding &&
      selectedFinding.id !== selected &&
      filteredFindings.length
    ) {
      setSelected(selectedFinding.id);
    }
  }, [hasResult, view, selectedFinding, selected, filteredFindings.length]);

  const onIntakeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const tdef = types[choice];
    if (!tdef) return;
    const payload: Record<string, unknown> = { type: choice };
    tdef.fields.forEach((f) => {
      if (f.kind === 'file') return;
      payload[f.name] = (draft[f.name] || '').trim();
    });
    if (upload) payload.upload_id = upload.id;

    setIntakeError('');
    setIntakeBusy(true);
    try {
      const data = await createAudit(payload);
      setId(String(data.id));
      setToken(String(data.token));
      setAudit(null);
      stateRef.current = {
        ...stateRef.current,
        id: String(data.id),
        token: String(data.token),
      };
      setView('scan');
      const steps = (data.steps as string[]) || undefined;
      await runScan(steps);
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : String(err));
    } finally {
      setIntakeBusy(false);
    }
  };

  const onFileChange = async (file: File | null) => {
    if (!file) {
      setUpload(null);
      setFileStatus('');
      return;
    }
    if (boot.maxUpload && file.size > boot.maxUpload) {
      setFileStatus(
        'That file is ' +
          (file.size / 1048576).toFixed(1) +
          ' MB — the limit is ' +
          Math.round(boot.maxUpload / 1048576) +
          ' MB.',
      );
      return;
    }
    setFileStatus('Uploading ' + file.name + '…');
    try {
      const data = await apiUpload(file);
      setUpload({
        id: String(data.upload_id),
        name: String(data.name),
        bytes: Number(data.bytes),
      });
      setFileStatus(
        'Ready: ' + String(data.name) + ' · ' + bytes(data.bytes),
      );
    } catch (err) {
      setUpload(null);
      setFileStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const onScoreChange = async (param: string, value: string) => {
    const score = value === '' ? null : parseInt(value, 10);
    try {
      const data = await setParameterScore(id, token, param, score);
      const next = data.audit as AuditPayload;
      auditRef.current = next;
      setAudit(next);
      revealCharts();
      toast(score === null ? 'Score cleared' : 'Scored ' + score + '/10');
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  const onFindingListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = filteredFindings;
    if (!items.length) return;
    const i = items.findIndex((f) => f.id === (selectedFinding?.id || ''));
    const next =
      e.key === 'ArrowDown'
        ? Math.min(items.length - 1, Math.max(0, i) + 1)
        : Math.max(0, i - 1);
    setSelected(items[next].id);
    e.preventDefault();
  };

  const onReset = () => {
    setId('');
    setToken('');
    setAudit(null);
    setChoice('');
    setFilter('all');
    setSelected('');
    setUpload(null);
    setDraft({});
    setIntakeError('');
    setFindingSearch('');
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    if (history.replaceState) history.replaceState({}, '', location.pathname);
    setView('landing');
    toast('Meeting reset');
  };

  const onGateSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setGateError('');
    try {
      await login(passcode);
      setGateOpen(false);
      loadRecents();
    } catch (err) {
      setGateError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
      );
    }
  };

  const kicker =
    boot.landingKicker || boot.kicker || 'Money Expo India 2026';

  const r = result();
  const scanDef = typeDef();

  // Pair fields for intake
  const intakeFieldNodes = (() => {
    if (!def) return null;
    const nodes: ReactNode[] = [];
    let pending: typeof def.fields = [];
    const fieldEl = (f: (typeof def.fields)[0]) => {
      const fid = 'f-' + f.name;
      const val = draft[f.name] || '';
      return (
        <div className="field" key={f.name}>
          <label htmlFor={fid}>{f.label}</label>
          {f.kind === 'textarea' ? (
            <textarea
              id={fid}
              name={f.name}
              value={val}
              placeholder={f.placeholder}
              required={!!f.required}
              onChange={(e) =>
                setDraft((d) => ({ ...d, [f.name]: e.target.value }))
              }
            />
          ) : f.kind === 'select' ? (
            <select
              id={fid}
              name={f.name}
              value={val || (f.options && f.options[0]) || ''}
              required={!!f.required}
              onChange={(e) =>
                setDraft((d) => ({ ...d, [f.name]: e.target.value }))
              }
            >
              {(f.options || []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : f.kind === 'file' ? (
            <>
              <input
                id={fid}
                name={f.name}
                type="file"
                className="filepick"
                accept={f.accept}
                onChange={(e) =>
                  void onFileChange(e.target.files?.[0] || null)
                }
              />
              <p className="hint filestatus" id="file-status">
                {fileStatus ||
                  (upload ? 'Ready: ' + upload.name : '')}
              </p>
            </>
          ) : (
            <input
              id={fid}
              name={f.name}
              type="text"
              inputMode={f.kind === 'url' ? 'url' : undefined}
              value={val}
              placeholder={f.placeholder}
              required={!!f.required}
              autoComplete={f.name === 'company' ? 'organization' : 'off'}
              onChange={(e) =>
                setDraft((d) => ({ ...d, [f.name]: e.target.value }))
              }
            />
          )}
          {f.help ? <p className="hint">{f.help}</p> : null}
        </div>
      );
    };

    def.fields.forEach((f) => {
      if (f.half) {
        pending.push(f);
        return;
      }
      if (pending.length) {
        nodes.push(
          <div
            className={pending.length > 1 ? 'pair' : ''}
            key={'pair-' + pending.map((p) => p.name).join('-')}
          >
            {pending.map(fieldEl)}
          </div>,
        );
        pending = [];
      }
      nodes.push(fieldEl(f));
    });
    if (pending.length) {
      nodes.push(
        <div
          className={pending.length > 1 ? 'pair' : ''}
          key={'pair-' + pending.map((p) => p.name).join('-')}
        >
          {pending.map(fieldEl)}
        </div>,
      );
    }
    return nodes;
  })();

  return (
    <>
      <div className="app" data-od-id="app-shell">
        <header className="topbar" data-od-id="topbar">
          <div className="topbar-inner">
            <a
              className="brand"
              href="#landing"
              data-od-id="brand-lockup"
              data-go="landing"
              onClick={(e) => {
                e.preventDefault();
                setView('landing');
              }}
            >
              <img
                className="wordmark"
                src="/assets/img/logo-eng-light.svg"
                alt="DIGIKRAFT"
                width={188}
                height={18}
              />
              <span className="brand-copy">
                <span id="brand-sub">{brandSub}</span>
              </span>
            </a>
            <nav
              className="phases"
              aria-label="Meeting phases"
              data-od-id="meeting-phase"
            >
              {(
                [
                  ['intake', '1', 'Understand'],
                  ['scan', '2', 'Diagnose'],
                  ['report', '3', 'Direction'],
                  ['close', '4', 'Propose'],
                ] as const
              ).map(([key, num, lbl]) => (
                <button
                  key={key}
                  className="phase"
                  type="button"
                  data-phase={key}
                  data-go={key}
                  disabled={!phaseUnlocked(key)}
                  aria-current={
                    phaseKey === 'landing'
                      ? 'false'
                      : key === phaseKey
                        ? 'step'
                        : 'false'
                  }
                  onClick={() => {
                    if (!phaseUnlocked(key)) return;
                    setView(key);
                  }}
                >
                  <b>{num}</b>
                  <span className="lbl">{lbl}</span>
                </button>
              ))}
            </nav>
            <div className="top-actions">
              <button
                className="btn btn-line"
                type="button"
                data-od-id="btn-download"
                id="btn-download"
                disabled={!hasResult}
                aria-label="Download report"
                onClick={() => {
                  if (!hasResult) return;
                  window.open(
                    reportPath(id, token, true),
                    '_blank',
                    'noopener',
                  );
                }}
              >
                <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path
                    d="M7 1.5v8M4 7.5L7 10.5 10 7.5M2.5 12.5h9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="square"
                  />
                </svg>
                <span className="btn-label">Download report</span>
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                data-od-id="btn-reset"
                id="btn-reset"
                onClick={onReset}
              >
                Start Over
              </button>
            </div>
          </div>
        </header>

        <main>
          {/* landing */}
          <section
            className={
              'view hero-grid landing' + (view === 'landing' ? ' is-on' : '')
            }
            data-view="landing"
            data-od-id="view-landing"
            hidden={view !== 'landing'}
          >
            <div className="wrap">
              <span className="spark spark-a" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0l1.7 10.3L24 12l-10.3 1.7L12 24l-1.7-10.3L0 12l10.3-1.7z" />
                </svg>
              </span>
              <span className="spark spark-b" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0l1.7 10.3L24 12l-10.3 1.7L12 24l-1.7-10.3L0 12l10.3-1.7z" />
                </svg>
              </span>
              <p className="kicker" data-od-id="landing-kicker">
                {kicker}
              </p>
              <h1 data-od-id="landing-title">Creative Growth Audit</h1>
              <p className="lede" data-od-id="landing-lede">
                Pick one surface. We read the real page, profiles, file, or
                identity — then turn the gaps into DigiKraft work, with the
                evidence attached.
              </p>

              <p className="kicker choose-label" data-od-id="choose-label">
                Choose what to audit
              </p>
              <div
                className="pitch-grid"
                role="radiogroup"
                aria-label="Choose what to audit"
                data-od-id="landing-surfaces"
              >
                {Object.entries(types).map(([tid, t]) => (
                  <button
                    key={tid}
                    type="button"
                    className="tile pitch-card lift choice"
                    role="radio"
                    aria-checked={choice === tid ? 'true' : 'false'}
                    data-choice={tid}
                    data-od-id={'choice-' + tid}
                    onClick={() => setChoice(tid)}
                  >
                    <p className="kicker">{t.index}</p>
                    <h3>{t.name}</h3>
                    <p>{t.tagline}</p>
                    <span className="choice-mark" aria-hidden="true">
                      <svg viewBox="0 0 12 12" fill="none">
                        <path
                          d="M2 6.2l2.4 2.4L10 3.2"
                          stroke="currentColor"
                          strokeWidth="1.6"
                        />
                      </svg>
                    </span>
                  </button>
                ))}
              </div>

              <div className="landing-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  id="cta-start"
                  data-od-id="cta-get-started"
                  disabled={!def}
                  onClick={() => {
                    if (!choice) return;
                    setView('intake');
                  }}
                >
                  <span id="cta-start-label">{ctaStartLabel}</span>
                  <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path
                      d="M3 7h8M8 3.5L11.5 7 8 10.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                  </svg>
                </button>
              </div>

              <div
                className="recents"
                id="recents"
                hidden={recents.length === 0}
                data-od-id="recent-audits"
              >
                <p className="kicker">Recent audits</p>
                <div className="recent-list" id="recent-list">
                  {recents.map((a) => {
                    const typeName = types[a.type]?.name || a.type;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className="recent"
                        onClick={() => {
                          setId(a.id);
                          setToken(a.token);
                          setChoice(a.type);
                          setSelected('');
                          setFilter('all');
                          stateRef.current = {
                            ...stateRef.current,
                            id: a.id,
                            token: a.token,
                            choice: a.type,
                          };
                          refreshAudit()
                            .then(() => setView('workspace'))
                            .catch((err) =>
                              toast(
                                err instanceof Error
                                  ? err.message
                                  : String(err),
                              ),
                            );
                        }}
                      >
                        <span>
                          <b>{a.company}</b>
                          <small>
                            {typeName} · {trimUrl(a.site) || 'file'} ·{' '}
                            {String(a.created).slice(0, 10)}
                          </small>
                        </span>
                        <span className="r-score">
                          {a.findings} findings
                        </span>
                        <span className="r-score">{a.score}/100</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="quote">
                “You drive the growth strategy. We make sure creative never
                becomes the bottleneck.”
              </p>
            </div>
          </section>

          {/* intake */}
          <section
            className={'view' + (view === 'intake' ? ' is-on' : '')}
            data-view="intake"
            data-od-id="view-intake"
            hidden={view !== 'intake'}
          >
            <div className="wrap-form">
              <div className="intake-head">
                <p className="kicker" id="intake-kicker">
                  Understand · 0–5 min
                </p>
                <h2 id="intake-title">
                  {def?.intro || 'Tell the audit what to read.'}
                </h2>
                <p className="muted" id="intake-intro">
                  {def?.headline || ''}
                </p>
              </div>
              <form
                className="tile form-tile"
                id="intake-form"
                data-od-id="intake-form"
                onSubmit={onIntakeSubmit}
              >
                <div id="intake-fields">{intakeFieldNodes}</div>
                <p
                  className="error"
                  id="intake-error"
                  data-od-id="intake-error"
                >
                  {intakeError}
                </p>
                <button
                  className="btn btn-primary btn-full"
                  type="submit"
                  data-od-id="cta-begin-audit"
                  id="cta-begin-audit"
                  disabled={intakeBusy}
                >
                  <span id="begin-label">
                    {def
                      ? 'Begin ' + def.name.toLowerCase() + ' audit'
                      : 'Begin audit'}
                  </span>
                  <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path
                      d="M3 7h8M8 3.5L11.5 7 8 10.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                  </svg>
                </button>
                <p
                  className="hint"
                  style={{ marginTop: 10 }}
                  id="intake-hint"
                >
                  The audit reads public pages, stylesheets, documents and
                  profile URLs. It respects robots.txt and never signs in
                  anywhere.
                </p>
              </form>
              <div className="scope-note tile" data-od-id="scope-note">
                <p className="kicker">Scope</p>
                <p className="muted" id="scope-copy">
                  {def
                    ? 'This audit scores ' +
                      Object.keys(def.parameters).length +
                      ' parameters, weighted to 100. Nothing outside this list is measured.'
                    : ''}
                </p>
                <ul className="scope-list" id="scope-list">
                  {def
                    ? Object.entries(def.parameters).map(([pid, p]) => (
                        <li key={pid}>
                          <b>{p.label}</b>
                          <span>{p.weight}%</span>
                          <em>{p.blurb}</em>
                        </li>
                      ))
                    : null}
                </ul>
              </div>
            </div>
          </section>

          {/* scan */}
          <section
            className={
              'view hero-grid scan-stage' + (view === 'scan' ? ' is-on' : '')
            }
            data-view="scan"
            data-od-id="view-scan"
            aria-busy={running ? 'true' : 'false'}
            hidden={view !== 'scan'}
          >
            <div className="wrap">
              <p className="kicker">5–15 min · Diagnose</p>
              <h1 data-od-id="scan-title" id="scan-title">
                {scanDef?.headline || 'Reading the creative system.'}
              </h1>
              <p className="muted" id="scan-status" data-od-id="scan-status">
                {scanStatus}
              </p>
              <div
                className="scan-log"
                id="scan-log"
                data-od-id="scan-log"
                aria-live="polite"
              >
                {scanLog.map((l, i) => (
                  <p key={i} className={l.strong ? 'on' : undefined}>
                    {l.text}
                  </p>
                ))}
              </div>
              <div
                className="scan-grid"
                id="scan-grid"
                data-od-id="scan-surfaces"
              >
                {(scanDef?.steps || []).map((s) => {
                  const bar = scanBars[s.id] || {
                    pct: 0,
                    meta: 'Queued',
                  };
                  return (
                    <article
                      key={s.id}
                      className={
                        'tile scan-card lift' +
                        (bar.live ? ' is-live' : '') +
                        (bar.cls === 'error' ? ' is-fail' : '')
                      }
                      data-scan-card={s.id}
                    >
                      <div className={'mini mini-' + s.id}>
                        <span>{s.label}</span>
                      </div>
                      <h3>{s.label}</h3>
                      <div className="track">
                        <i
                          id={'bar-' + s.id}
                          style={
                            {
                              ['--w' as string]: String(bar.pct / 100),
                            } as CSSProperties
                          }
                        />
                      </div>
                      <p
                        className={
                          'meta' + (bar.cls === 'error' ? ' is-error' : '')
                        }
                        id={'meta-' + s.id}
                      >
                        {bar.meta}
                      </p>
                    </article>
                  );
                })}
              </div>
              <p className="error" id="scan-error" data-od-id="scan-error">
                {scanError}
              </p>
              <div style={{ marginTop: 22 }}>
                <button
                  className="btn btn-line"
                  type="button"
                  id="btn-scan-back"
                  data-od-id="btn-scan-back"
                  hidden={!showScanBack}
                  onClick={() => setView('intake')}
                >
                  Back to intake
                </button>
              </div>
            </div>
          </section>

          {/* workspace */}
          <section
            className={'view' + (view === 'workspace' ? ' is-on' : '')}
            data-view="workspace"
            data-od-id="view-workspace"
            hidden={view !== 'workspace'}
          >
            {r ? (
              <div className="wrap-wide">
                <ScoreHero result={r} subject={subjectLabel(r)} reduce={reduce} />

                <PageShot
                  shot={r.shot}
                  auditId={id}
                  token={token}
                  reduce={reduce}
                />

                <RecoveryLadder
                  result={r}
                  reduce={reduce}
                  onPick={(pid) => setFilter(pid)}
                  onScore={(pid, value) => void onScoreChange(pid, value)}
                />


                <div className="toolbar">
                  <div
                    className="filters"
                    id="filters"
                    data-od-id="finding-filters"
                  >
                    <button
                      className="chip"
                      type="button"
                      data-filter="all"
                      aria-pressed={filter === 'all' ? 'true' : 'false'}
                      onClick={() => setFilter('all')}
                    >
                      All
                    </button>
                    {Object.entries(r.score.parameters).map(([pid, p]) =>
                      p.findings ? (
                        <button
                          key={pid}
                          className="chip"
                          type="button"
                          data-filter={pid}
                          aria-pressed={
                            filter === pid ? 'true' : 'false'
                          }
                          onClick={() => setFilter(pid)}
                        >
                          {p.label} <b>{p.findings}</b>
                        </button>
                      ) : null,
                    )}
                    {(r.score.counts.high || 0) > 0 ? (
                      <button
                        className="chip"
                        type="button"
                        data-filter="high"
                        aria-pressed={
                          filter === 'high' ? 'true' : 'false'
                        }
                        onClick={() => setFilter('high')}
                      >
                        High only
                      </button>
                    ) : null}
                  </div>
                  <input
                    className="search"
                    id="finding-search"
                    type="search"
                    placeholder="Search findings"
                    data-od-id="finding-search"
                    value={findingSearch}
                    onChange={(e) => setFindingSearch(e.target.value)}
                  />
                </div>

                <div className="workspace">
                  <div
                    className="tile list"
                    id="finding-list"
                    data-od-id="finding-list"
                    onKeyDown={onFindingListKey}
                  >
                    {!filteredFindings.length ? (
                      <p className="empty">
                        {findings().length
                          ? 'No findings in this filter.'
                          : 'Nothing was raised on this surface — every parameter scored clean.'}
                      </p>
                    ) : (
                      filteredFindings.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className="finding"
                          data-od-id={'finding-card-' + f.id}
                          aria-selected={
                            (selectedFinding?.id || '') === f.id
                              ? 'true'
                              : 'false'
                          }
                          onClick={() => setSelected(f.id)}
                        >
                          <span className={'sev sev-' + f.severity}>
                            {f.severity}
                          </span>
                          <h3>{f.title}</h3>
                          <span className="surf">
                            {paramLabel(r, f.parameter)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                  <aside
                    className={
                      'tile detail' + (selectedFinding ? ' is-in' : '')
                    }
                    id="finding-detail"
                    data-od-id="finding-detail"
                  >
                    {!selectedFinding ? (
                      <p className="empty">
                        Select a finding to see evidence and the DigiKraft
                        work order.
                      </p>
                    ) : (
                      <>
                        <p className="kicker">
                          {paramLabel(r, selectedFinding.parameter)}
                          {r.score.parameters[selectedFinding.parameter]
                            ? ' · ' +
                              r.score.parameters[
                                selectedFinding.parameter
                              ].weight +
                              '% weight'
                            : ''}{' '}
                          · {selectedFinding.severity}
                        </p>
                        <h2>{selectedFinding.title}</h2>
                        <p>{selectedFinding.evidence}</p>
                        {(selectedFinding.proof || []).length ? (
                          <div className="work">
                            <dt className="proof-head">Measured</dt>
                            <ul className="proof">
                              {selectedFinding.proof!.map((p, i) => (
                                <li key={i}>
                                  <span className="p-label">
                                    {p.label}
                                  </span>
                                  <span className="p-value">
                                    {p.url ? (
                                      <a
                                        href={p.url}
                                        target="_blank"
                                        rel="noopener noreferrer nofollow"
                                      >
                                        {p.value}
                                      </a>
                                    ) : (
                                      p.value
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        <dl
                          className="work"
                          data-od-id={
                            'work-order-' + selectedFinding.id
                          }
                        >
                          <dt>Growth cost</dt>
                          <dd>{selectedFinding.cost}</dd>
                          <dt>DigiKraft service</dt>
                          <dd>{selectedFinding.service}</dd>
                          <dt>90-day slot</dt>
                          <dd>{selectedFinding.month}</dd>
                        </dl>
                        <p className="hint">
                          Work orders become the pilot scope. The client is
                          not buying a design. They are buying capacity.
                        </p>
                      </>
                    )}
                  </aside>
                </div>

                <article
                  className="tile panel lift method"
                  data-od-id="audit-method"
                  style={{ marginTop: 12 }}
                >
                  <p className="kicker">What was read</p>
                  <h3>Every finding traces back to one of these.</h3>
                  <div id="method-body">
                    <div className="method-group">
                      <p className="kicker">Sources read</p>
                      {(r.method.sources || []).map((s, i) => {
                        const ok =
                          !s.status ||
                          (s.status >= 200 && s.status < 300);
                        const state2 =
                          s.state ||
                          (s.status ? String(s.status) : 'read');
                        const cls =
                          s.state === 'blocked' ||
                          s.state === 'unverified'
                            ? 'warn'
                            : ok
                              ? 'ok'
                              : 'bad';
                        return (
                          <div className="method-row" key={i}>
                            {s.url ? (
                              <a
                                href={s.url}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                              >
                                {s.label + ' · ' + trimUrl(s.url)}
                              </a>
                            ) : (
                              <span className="m-name">{s.label}</span>
                            )}
                            <span className={'badge ' + cls}>
                              {state2}
                            </span>
                            <span>
                              {s.ttfb ? s.ttfb.toFixed(2) + 's' : '—'}
                            </span>
                            <span>
                              {s.bytes
                                ? bytes(s.bytes)
                                : s.note
                                  ? clip(s.note, 28)
                                  : '—'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="hint">
                      Read {r.method.crawled_at} UTC as{' '}
                      {r.method.user_agent}. Findings come only from these
                      responses. Anything a platform blocked is marked, never
                      assumed — those parameters are left for you to score.
                    </p>
                  </div>
                </article>

                <div className="foot-cta">
                  <button
                    className="btn btn-primary"
                    type="button"
                    data-go="report"
                    data-od-id="cta-open-report"
                    onClick={() => setView('report')}
                  >
                    Continue to direction
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          {/* report */}
          <section
            className={'view' + (view === 'report' ? ' is-on' : '')}
            data-view="report"
            data-od-id="view-report"
            hidden={view !== 'report'}
          >
            {r ? (
              <div className="wrap-wide">
                <div className="dash-head">
                  <div>
                    <p className="kicker" data-od-id="report-kicker">
                      Direction · 15–22 min
                    </p>
                    <h1 data-od-id="report-title">
                      The audit, as a brief.
                    </h1>
                    <p className="lede" id="report-lede">
                      {r.fixes.length} thing
                      {r.fixes.length === 1 ? '' : 's'} to fix now.{' '}
                      {r.bets.length} bet
                      {r.bets.length === 1 ? '' : 's'} that turn creative
                      into capacity. One direction so {r.company} stops
                      looking like the rest of the category.
                    </p>
                  </div>
                </div>

                <article
                  className="tile gantt lift"
                  data-od-id="direction-gantt"
                >
                  <p className="kicker">90-day sequence</p>
                  <h3
                    style={{
                      fontSize: 16,
                      letterSpacing: '-0.02em',
                      margin: '6px 0 14px',
                    }}
                  >
                    Work orders on the calendar — not a wishlist.
                  </h3>
                  <div className="gantt-head">
                    <span />
                    <span>Month 1</span>
                    <span>Month 2</span>
                    <span>Month 3</span>
                  </div>
                  <div id="gantt-rows">
                    {r.orders.length ? (
                      r.orders.map((o, i) => (
                        <div className="gantt-row" key={i}>
                          <span>{o.service}</span>
                          {[1, 2, 3].map((m) => (
                            <div
                              key={m}
                              className={
                                'g-cell' +
                                (o.months.indexOf(m) !== -1 ? ' on' : '')
                              }
                            />
                          ))}
                        </div>
                      ))
                    ) : (
                      <p className="hint">
                        No work orders — nothing on this file needs a slot.
                      </p>
                    )}
                  </div>
                </article>

                <p className="kicker" style={{ marginBottom: 10 }}>
                  Immediate improvements
                </p>
                <div
                  className="trio"
                  data-od-id="fixes-row"
                  id="fixes-row"
                >
                  {r.fixes.map((f, i) => (
                    <article
                      key={i}
                      className="tile fix lift"
                      data-od-id={'fix-' + (i + 1)}
                    >
                      <span className="idx">0{i + 1}</span>
                      <h3>{f.title}</h3>
                      <p>{f.body}</p>
                      <p className="svc">
                        {f.parameter || ''} · {f.service} · {f.month}
                      </p>
                    </article>
                  ))}
                </div>

                <p className="kicker" style={{ margin: '18px 0 10px' }}>
                  Growth opportunities
                </p>
                <div className="trio" data-od-id="bets-row" id="bets-row">
                  {r.bets.map((b, i) => (
                    <article
                      key={i}
                      className="tile fix lift"
                      data-od-id={'bet-' + (i + 1)}
                    >
                      <span className="idx">0{i + 1}</span>
                      <h3>{b.title}</h3>
                      <p>{b.body}</p>
                      <p className="svc">
                        DigiKraft · {b.service} · {b.month}
                      </p>
                    </article>
                  ))}
                </div>

                <article
                  className="tile invert"
                  data-od-id="direction-clear-markets"
                >
                  <div>
                    <p className="kicker">Creative direction</p>
                    <h2 id="direction-name">
                      {r.direction.name || '—'}
                    </h2>
                    <textarea
                      id="direction-copy"
                      className="dirbox"
                      rows={6}
                      aria-label="Creative direction"
                      data-od-id="direction-copy"
                      value={directionCopy}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDirectionCopy(v);
                        if (saveCloseTimer.current)
                          clearTimeout(saveCloseTimer.current);
                        saveCloseTimer.current = setTimeout(() => {
                          void persistClose({ direction: v });
                        }, 700);
                      }}
                    />
                    <p className="dirhint">
                      Edit in the meeting — the leave-behind uses what is
                      written here.
                    </p>
                  </div>
                  <div
                    className="swatches"
                    aria-hidden="true"
                    id="direction-swatches"
                  >
                    {(r.direction.swatches || []).map((s, i) => (
                      <div
                        key={i}
                        className={'swatch ' + s.tone}
                      >
                        {s.label}
                      </div>
                    ))}
                  </div>
                </article>

                <div className="foot-cta">
                  <button
                    className="btn btn-primary"
                    type="button"
                    data-go="close"
                    data-od-id="cta-present-pilot"
                    onClick={() => setView('close')}
                  >
                    Present 90-day plan
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          {/* close */}
          <section
            className={'view' + (view === 'close' ? ' is-on' : '')}
            data-view="close"
            data-od-id="view-close"
            hidden={view !== 'close'}
          >
            {r && audit ? (
              <div className="wrap-wide">
                <div className="dash-head">
                  <div>
                    <p className="kicker">Propose · 22–30 min</p>
                    <h1
                      className="page-title"
                      data-od-id="close-title"
                      style={{ margin: '8px 0 12px' }}
                    >
                      90 days. Enough to prove the engine.
                    </h1>
                    <p className="lede" id="close-lede">
                      Easier to approve than a year. Long enough to show
                      speed, quality and process. On this audit we recommend
                      the {r.tiers[r.recommended_tier]?.name}.
                    </p>
                  </div>
                </div>

                <div className="close-grid">
                  <div>
                    <div
                      className="plans"
                      data-od-id="retainer-tiers"
                      id="plans"
                    >
                      {Object.entries(r.tiers).map(([key, t]) => {
                        const tier =
                          audit.tier || r.recommended_tier;
                        const on = key === tier;
                        return (
                          <button
                            key={key}
                            className={
                              'plan tile' + (on ? ' is-rec' : '')
                            }
                            type="button"
                            data-tier={key}
                            aria-pressed={on ? 'true' : undefined}
                            data-od-id={'tier-' + key}
                            onClick={() => {
                              setAudit({ ...audit, tier: key });
                              void persistClose({ tier: key });
                            }}
                          >
                            {key === r.recommended_tier ? (
                              <p className="kicker">
                                Recommended for {r.company}
                              </p>
                            ) : null}
                            <h3>{t.name}</h3>
                            <p className="price">{t.price}</p>
                            <p className="muted">{t.blurb}</p>
                          </button>
                        );
                      })}
                    </div>
                    <article
                      className="tile panel lift"
                      data-od-id="retainer-range"
                      style={{ marginTop: 12 }}
                    >
                      <p className="kicker">Monthly range</p>
                      <h3>Pick the engine, not a package size.</h3>
                      <div className="range-list" id="range-list">
                        {Object.entries(r.tiers).map(([key, t]) => {
                          const tier =
                            audit.tier || r.recommended_tier;
                          return (
                            <div
                              key={key}
                              className={
                                'range-row' +
                                (key === tier ? ' is-on' : '')
                              }
                              data-range={key}
                            >
                              <span>{t.name.split(' ')[0]}</span>
                              <div className="range-bar">
                                <i data-w={String(t.width)} />
                              </div>
                              <b>{t.price}</b>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                    <p className="quote">
                      “Once I understand your monthly creative requirement, I
                      can recommend the right model instead of selling an
                      oversized package.”
                    </p>
                  </div>

                  <div id="close-panel">
                    <div id="close-form" hidden={!!audit.closed}>
                      <div
                        className="months"
                        data-od-id="pilot-months"
                        id="months"
                      >
                        {(() => {
                          const byMonth: Record<number, string[]> = {
                            1: [],
                            2: [],
                            3: [],
                          };
                          r.orders.forEach((o) =>
                            o.months.forEach((m) => {
                              if (byMonth[m])
                                byMonth[m].push(o.service);
                            }),
                          );
                          return [1, 2, 3].map((m) => {
                            const list = byMonth[m];
                            return (
                              <article
                                key={m}
                                className="tile month lift"
                                data-od-id={'month-' + m}
                              >
                                <p className="kicker">
                                  {MONTH_TITLES[m].kicker}
                                </p>
                                <h3>{MONTH_TITLES[m].head}</h3>
                                <p className="muted">
                                  {list.length
                                    ? list.join(' · ')
                                    : 'Capacity held for whatever the first two months surface.'}
                                </p>
                              </article>
                            );
                          });
                        })()}
                      </div>
                      <p
                        className="kicker"
                        style={{ margin: '16px 0 8px' }}
                      >
                        Would Tuesday or Wednesday work better?
                      </p>
                      <div
                        className="when"
                        data-od-id="followup-when"
                      >
                        {(['Tuesday', 'Wednesday'] as const).map(
                          (day) => (
                            <button
                              key={day}
                              type="button"
                              data-day={day}
                              aria-pressed={
                                (audit.day || 'Tuesday') === day
                                  ? 'true'
                                  : 'false'
                              }
                              data-od-id={
                                day === 'Tuesday'
                                  ? 'day-tue'
                                  : 'day-wed'
                              }
                              onClick={() => {
                                setAudit({ ...audit, day });
                                void persistClose({ day });
                              }}
                            >
                              {day} follow-up
                            </button>
                          ),
                        )}
                      </div>
                      <button
                        className="btn btn-primary btn-full"
                        type="button"
                        id="cta-recommend"
                        data-od-id="cta-recommend-pilot"
                        onClick={() => {
                          setAudit({ ...audit, closed: true });
                          void persistClose({ closed: 1 }).then(() =>
                            toast(
                              'Recommendation saved for this meeting',
                            ),
                          );
                        }}
                      >
                        Recommend{' '}
                        {(
                          r.tiers[audit.tier || r.recommended_tier]
                            ?.name || ''
                        ).split(' ')[0]}{' '}
                        pilot · {audit.day || 'Tuesday'}
                      </button>
                      <p className="hint" style={{ marginTop: 10 }}>
                        Recommendation for this meeting — not a signed
                        contract.
                      </p>
                    </div>
                    <div
                      className="tile done-box"
                      id="close-done"
                      hidden={!audit.closed}
                      data-od-id="close-confirmation"
                    >
                      <p className="kicker">
                        Meeting recommendation saved
                      </p>
                      <h2>DigiKraft can solve this.</h2>
                      <p
                        className="muted"
                        id="close-done-copy"
                        style={{ maxWidth: '46ch' }}
                      >
                        {r.company} · {r.type_name} audit scored{' '}
                        {r.score.overall}/100 ({r.score.grade.label}).{' '}
                        {
                          r.tiers[audit.tier || r.recommended_tier]
                            ?.name
                        }{' '}
                        · 90-day pilot. Follow-up {audit.day}.
                      </p>
                      <p className="quote">
                        <b>
                          I think DigiKraft can solve this for you. Let me
                          show you exactly how.
                        </b>
                      </p>
                      <div className="share-row">
                        <button
                          className="btn btn-line"
                          type="button"
                          id="btn-open-report"
                          onClick={() =>
                            window.open(
                              reportPath(id, token),
                              '_blank',
                              'noopener',
                            )
                          }
                        >
                          Open leave-behind
                        </button>
                        <button
                          className="btn btn-ghost"
                          type="button"
                          id="btn-copy-link"
                          onClick={() => {
                            const url =
                              location.origin + reportPath(id, token);
                            if (
                              navigator.clipboard &&
                              navigator.clipboard.writeText
                            ) {
                              navigator.clipboard
                                .writeText(url)
                                .then(
                                  () => toast('Share link copied'),
                                  () =>
                                    window.prompt(
                                      'Copy this link',
                                      url,
                                    ),
                                );
                            } else {
                              window.prompt('Copy this link', url);
                            }
                          }}
                        >
                          Copy share link
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </main>
      </div>

      {gateOpen ? (
        <div className="gate" id="gate" data-od-id="passcode-gate">
          <form
            className="tile gate-box"
            id="gate-form"
            onSubmit={onGateSubmit}
          >
            <p className="kicker">Restricted</p>
            <h2>Creative Growth Audit</h2>
            <p className="muted">
              Enter the team passcode to run an audit.
            </p>
            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="passcode">Passcode</label>
              <input
                id="passcode"
                type="password"
                autoComplete="current-password"
                required
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
              />
            </div>
            <p className="error" id="gate-error">
              {gateError}
            </p>
            <button className="btn btn-primary btn-full" type="submit">
              Unlock
            </button>
          </form>
        </div>
      ) : null}

      <div
        className={'toast' + (toastOn ? ' is-on' : '')}
        id="toast"
        role="status"
        aria-live="polite"
        hidden={toastHidden}
      >
        {toastMsg}
      </div>
    </>
  );
}
