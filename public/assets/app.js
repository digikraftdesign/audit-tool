/* DigiKraft · Creative Growth Audit
 * One scoped audit at a time: pick a surface, answer only what that audit needs,
 * watch it run, then work the parameter scores in the meeting.
 * No framework, no build step — the file that ships is the file that runs.
 */
(function () {
  "use strict";

  var BOOT    = window.DK_BOOT || { endpoint: "/api", report: "/report" };
  var TYPES   = window.DK_TYPES || {};
  var STORAGE = "dk-cga-session-v4";
  var VIEWS   = ["landing", "intake", "scan", "workspace", "report", "close"];
  var MONTH_TITLES = {
    1: { kicker: "Month 1 — Learn & build", head: "Immersion and the system." },
    2: { kicker: "Month 2 — Produce & test", head: "Variants in market." },
    3: { kicker: "Month 3 — Optimize & scale", head: "Launch kit and enablement." }
  };

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var state = {
    view: "landing",
    choice: "",
    id: "",
    token: "",
    audit: null,
    filter: "all",
    selected: "",
    running: false,
    upload: null,
    draft: {}
  };

  var toastTimer = null;
  var saveTimer  = null;

  // ----------------------------------------------------------------- plumbing

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function toast(msg) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("is-on");
      setTimeout(function () { el.hidden = true; }, 220);
    }, 2400);
  }

  function api(action, options) {
    options = options || {};
    var body = options.body || {};
    var path = "";
    var method = options.method || "GET";
    if (action === "login") { path = "/api/login"; method = "POST"; }
    else if (action === "create") { path = "/api/audits"; method = "POST"; }
    else if (action === "step") { path = "/api/audits/" + encodeURIComponent(body.id) + "/step"; method = "POST"; }
    else if (action === "get") {
      path = "/api/audits/" + encodeURIComponent((options.query && options.query.id) || body.id || "");
      path += "?token=" + encodeURIComponent((options.query && options.query.token) || body.token || "");
      method = "GET";
    }
    else if (action === "close") { path = "/api/audits/" + encodeURIComponent(body.id) + "/close"; method = "POST"; }
    else if (action === "score") { path = "/api/audits/" + encodeURIComponent(body.id) + "/score"; method = "POST"; }
    else if (action === "types") { path = "/api/types"; method = "GET"; }
    else if (action === "recent") { path = "/api/recent"; method = "GET"; }
    else if (action === "upload") { path = "/api/upload"; method = "POST"; }
    else if (action === "health") { path = "/api/health"; method = "GET"; }
    else { path = "/api/health"; }

    var init = { method: method, headers: { "Accept": "application/json" }, credentials: "same-origin" };
    if (options.form) {
      init.method = "POST";
      init.body = options.form;
    } else if (method === "POST" && !options.form) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () {
        throw new Error("The server returned an unexpected response (HTTP " + res.status + ").");
      }).then(function (data) {
        if (!res.ok || !data.ok) {
          var err = new Error(data && data.error ? data.error : "Request failed (HTTP " + res.status + ")");
          err.payload = data;
          throw err;
        }
        return data;
      });
    });
  }

  function save() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({
        id: state.id, token: state.token, view: state.view, choice: state.choice,
        filter: state.filter, selected: state.selected, draft: state.draft
      }));
    } catch (e) { /* private mode */ }
  }

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE) || "{}");
      state.id       = saved.id || "";
      state.token    = saved.token || "";
      state.choice   = TYPES[saved.choice] ? saved.choice : "";
      state.filter   = saved.filter || "all";
      state.selected = saved.selected || "";
      state.draft    = saved.draft || {};
      if (VIEWS.indexOf(saved.view) !== -1) state.view = saved.view;
    } catch (e) { /* ignore */ }

    var params = new URLSearchParams(location.search);
    if (params.get("id") && params.get("t")) {
      state.id    = params.get("id");
      state.token = params.get("t");
      state.view  = "workspace";
    }
    var hash = (location.hash || "").replace("#", "");
    if (VIEWS.indexOf(hash) !== -1) state.view = hash;
  }

  function hasResult() { return !!(state.audit && state.audit.result); }
  function result()    { return state.audit ? state.audit.result : null; }
  function typeDef()   { return TYPES[state.choice] || TYPES[(state.audit && state.audit.type) || ""] || null; }

  // -------------------------------------------------------------------- views

  function resetScroll() {
    var html = document.documentElement;
    var prev = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);
    html.style.scrollBehavior = prev;
  }

  function setView(id, push) {
    if (VIEWS.indexOf(id) === -1) id = "landing";
    if (id === "intake" && !state.choice) id = "landing";
    if ((id === "workspace" || id === "report" || id === "close") && !hasResult()) id = state.choice ? "intake" : "landing";
    if (id === "scan" && !state.running && hasResult()) id = "workspace";

    var changing = state.view !== id;
    state.view = id;

    $$("[data-view]").forEach(function (el) {
      el.classList.toggle("is-on", el.getAttribute("data-view") === id);
    });

    var phase = id === "workspace" ? "scan" : id;
    $$("[data-phase]").forEach(function (el) {
      var key = el.getAttribute("data-phase");
      var unlocked = (key === "intake" && state.choice) || hasResult() || (key === "scan" && id === "scan");
      el.disabled = !unlocked;
      el.setAttribute("aria-current", phase === "landing" ? "false" : (key === phase ? "step" : "false"));
    });

    var dl = $("#btn-download");
    if (dl) dl.disabled = !hasResult();

    save();
    if (push !== false) {
      try { history.pushState({ view: id }, "", "#" + id); } catch (e) { /* file:// */ }
    }
    if (changing) resetScroll();

    if (id === "intake")    renderIntake();
    if (id === "workspace") renderWorkspace();
    if (id === "report")    renderReport();
    if (id === "close")     renderClose();
    if (id === "landing")   loadRecents();
  }

  function revealCharts(root) {
    $$("[data-w]", root || document).forEach(function (el) {
      var w = el.getAttribute("data-w");
      el.style.setProperty("--w", "0");
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { el.style.setProperty("--w", w); });
      });
    });
  }

  function countTo(el, to) {
    if (!el) return;
    if (reduce) { el.textContent = String(to); return; }
    var start = performance.now();
    function tick(now) {
      var p = Math.min(1, (now - start) / 640);
      el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------ choose a type

  $$("[data-choice]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.choice = btn.getAttribute("data-choice");
      paintChoice();
      save();
    });
  });

  function paintChoice() {
    var def = TYPES[state.choice];
    $$("[data-choice]").forEach(function (b) {
      b.setAttribute("aria-checked", b.getAttribute("data-choice") === state.choice ? "true" : "false");
    });
    var cta = $("#cta-start");
    cta.disabled = !def;
    $("#cta-start-label").textContent = def ? "Start the " + def.name.toLowerCase() + " audit" : "Choose an audit above";
    $("#brand-sub").textContent = def ? def.name + " audit" : "Creative Growth Audit";
  }

  $("#cta-start").addEventListener("click", function () {
    if (!state.choice) return;
    setView("intake");
  });

  // ------------------------------------------------------------------ intake

  function renderIntake() {
    var def = TYPES[state.choice];
    if (!def) { setView("landing"); return; }

    $("#intake-title").textContent = def.intro;
    $("#intake-intro").textContent = def.headline;
    $("#begin-label").textContent  = "Begin " + def.name.toLowerCase() + " audit";

    var box = $("#intake-fields");
    box.innerHTML = "";
    var pending = [];

    def.fields.forEach(function (f) {
      if (f.half) { pending.push(f); return; }
      if (pending.length) { box.appendChild(pairRow(pending)); pending = []; }
      box.appendChild(fieldEl(f));
    });
    if (pending.length) box.appendChild(pairRow(pending));

    // Scope panel: exactly what this audit will score.
    $("#scope-copy").textContent = "This audit scores " + Object.keys(def.parameters).length +
      " parameters, weighted to 100. Nothing outside this list is measured.";
    $("#scope-list").innerHTML = Object.keys(def.parameters).map(function (id) {
      var p = def.parameters[id];
      return "<li><b>" + esc(p.label) + "</b><span>" + p.weight + "%</span><em>" + esc(p.blurb) + "</em></li>";
    }).join("");

    bindUpload();
  }

  function pairRow(fields) {
    var row = document.createElement("div");
    row.className = fields.length > 1 ? "pair" : "";
    fields.forEach(function (f) { row.appendChild(fieldEl(f)); });
    return row;
  }

  function fieldEl(f) {
    var wrap = document.createElement("div");
    wrap.className = "field";
    var id = "f-" + f.name;
    var val = state.draft[f.name] || "";

    var label = document.createElement("label");
    label.setAttribute("for", id);
    label.textContent = f.label + (f.required ? "" : "");
    wrap.appendChild(label);

    var input;
    if (f.kind === "textarea") {
      input = document.createElement("textarea");
      input.value = val;
    } else if (f.kind === "select") {
      input = document.createElement("select");
      (f.options || []).forEach(function (opt) {
        var o = document.createElement("option");
        o.textContent = opt;
        if (opt === val) o.selected = true;
        input.appendChild(o);
      });
    } else if (f.kind === "file") {
      input = document.createElement("input");
      input.type = "file";
      input.className = "filepick";
      if (f.accept) input.accept = f.accept;
    } else {
      input = document.createElement("input");
      input.type = "text";
      if (f.kind === "url") input.inputMode = "url";
      input.value = val;
      input.autocomplete = f.name === "company" ? "organization" : "off";
    }
    input.id = id;
    input.name = f.name;
    if (f.placeholder) input.placeholder = f.placeholder;
    if (f.required && f.kind !== "file") input.required = true;
    input.addEventListener("input", function () {
      if (f.kind !== "file") { state.draft[f.name] = input.value; save(); }
    });
    input.addEventListener("change", function () {
      if (f.kind !== "file") { state.draft[f.name] = input.value; save(); }
    });
    wrap.appendChild(input);

    if (f.kind === "file") {
      var status = document.createElement("p");
      status.className = "hint filestatus";
      status.id = "file-status";
      status.textContent = state.upload ? "Ready: " + state.upload.name : "";
      wrap.appendChild(status);
    }
    if (f.help) {
      var help = document.createElement("p");
      help.className = "hint";
      help.textContent = f.help;
      wrap.appendChild(help);
    }
    return wrap;
  }

  function bindUpload() {
    var picker = $(".filepick");
    if (!picker) return;
    picker.addEventListener("change", function () {
      var file = picker.files && picker.files[0];
      var status = $("#file-status");
      if (!file) { state.upload = null; status.textContent = ""; return; }
      if (BOOT.maxUpload && file.size > BOOT.maxUpload) {
        status.textContent = "That file is " + (file.size / 1048576).toFixed(1) + " MB — the limit is " +
          Math.round(BOOT.maxUpload / 1048576) + " MB.";
        picker.value = "";
        return;
      }
      status.textContent = "Uploading " + file.name + "…";
      var form = new FormData();
      form.append("file", file);
      api("upload", { form: form })
        .then(function (data) {
          state.upload = { id: data.upload_id, name: data.name, bytes: data.bytes };
          status.textContent = "Ready: " + data.name + " · " + bytes(data.bytes);
        })
        .catch(function (e) {
          state.upload = null;
          status.textContent = e.message;
        });
    });
  }

  $("#intake-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var def = TYPES[state.choice];
    if (!def) return;

    var err = $("#intake-error");
    var payload = { type: state.choice };
    def.fields.forEach(function (f) {
      if (f.kind === "file") return;
      var el = $("#f-" + f.name);
      payload[f.name] = el ? el.value.trim() : "";
    });
    if (state.upload) payload.upload_id = state.upload.id;

    err.textContent = "";
    var submit = $("#cta-begin-audit");
    submit.disabled = true;

    api("create", { body: payload })
      .then(function (data) {
        state.id    = data.id;
        state.token = data.token;
        state.audit = null;
        save();
        setView("scan");
        return runScan(data.steps);
      })
      .catch(function (e2) { err.textContent = e2.message; })
      .finally(function () { submit.disabled = false; });
  });

  // -------------------------------------------------------------------- scan

  function scanSteps() {
    var def = typeDef();
    return def ? def.steps : [];
  }

  function buildScanCards() {
    var def = typeDef();
    if (!def) return;
    $("#scan-title").textContent = def.headline;
    $("#scan-grid").innerHTML = def.steps.map(function (s) {
      return '<article class="tile scan-card lift" data-scan-card="' + esc(s.id) + '">' +
        '<div class="mini mini-' + esc(s.id) + '"><span>' + esc(s.label) + "</span></div>" +
        "<h3>" + esc(s.label) + "</h3>" +
        '<div class="track"><i id="bar-' + esc(s.id) + '"></i></div>' +
        '<p class="meta" id="meta-' + esc(s.id) + '">Queued</p></article>';
    }).join("");
  }

  function setBar(id, pct, meta, cls) {
    var bar = $("#bar-" + id), m = $("#meta-" + id), card = $('[data-scan-card="' + id + '"]');
    if (bar) bar.style.setProperty("--w", String(pct / 100));
    if (m) { m.textContent = meta; m.classList.toggle("is-error", cls === "error"); }
    if (card) {
      card.classList.toggle("is-live", pct > 0 && pct < 100);
      card.classList.toggle("is-fail", cls === "error");
    }
  }

  function logLine(text, strong) {
    var box = $("#scan-log");
    if (!box) return;
    var p = document.createElement("p");
    p.textContent = text;
    if (strong) p.className = "on";
    box.appendChild(p);
    while (box.children.length > 5) box.removeChild(box.firstChild);
  }

  function runScan(steps, from) {
    steps = steps || (scanSteps().map(function (s) { return s.id; }).concat(["finalize"]));
    var start = from ? steps.indexOf(from) : 0;
    if (start < 0) start = 0;

    state.running = true;
    buildScanCards();
    $("#scan-log").innerHTML = "";
    $("#scan-error").textContent = "";
    $("#btn-scan-back").hidden = true;
    scanSteps().forEach(function (s) { setBar(s.id, 0, "Queued"); });

    if (start > 0) {
      steps.slice(0, start).forEach(function (done) { setBar(done, 100, "Done"); });
      logLine("Resuming from where the scan stopped", true);
    }

    $('[data-view="scan"]').setAttribute("aria-busy", "true");
    $("#scan-status").textContent = "Working through " + (scanSteps().length) + " passes.";

    var chain = Promise.resolve();
    steps.slice(start).forEach(function (step) {
      chain = chain.then(function () { return runStep(step); });
    });

    return chain
      .then(function () {
        state.running = false;
        $('[data-view="scan"]').setAttribute("aria-busy", "false");
        $("#scan-status").textContent = "Scan complete. Scoring the parameters.";
        return refreshAudit();
      })
      .then(function () { setView("workspace"); })
      .catch(function (e) {
        state.running = false;
        $('[data-view="scan"]').setAttribute("aria-busy", "false");
        $("#scan-status").textContent = "The scan stopped.";
        $("#scan-error").textContent = e.message;
        $("#btn-scan-back").hidden = false;
        var live = $(".scan-card.is-live");
        if (live) setBar(live.getAttribute("data-scan-card"), 100, "Failed", "error");
      });
  }

  function runStep(step) {
    if (step !== "finalize") setBar(step, 55, "Reading");
    else $("#scan-status").textContent = "Scoring the parameters.";

    return api("step", { body: { id: state.id, token: state.token, step: step } })
      .then(function (data) {
        (data.log || []).forEach(function (l) { logLine(l.text, l.strong); });
        if (step !== "finalize") setBar(step, 100, "Done");
        return data;
      });
  }

  function refreshAudit() {
    if (!state.id || !state.token) return Promise.resolve(null);
    return api("get", { query: { id: state.id, token: state.token } }).then(function (data) {
      state.audit = data.audit;
      if (state.audit && state.audit.type) state.choice = state.audit.type;
      return state.audit;
    });
  }

  $("#btn-scan-back").addEventListener("click", function () { setView("intake"); });

  // --------------------------------------------------------------- workspace

  function findings() { return (hasResult() && result().findings) || []; }

  function renderWorkspace() {
    if (!hasResult()) return;
    var r = result();
    var def = TYPES[r.type] || {};
    var score = r.score;

    $("#workspace-kicker").textContent = def.name ? def.name + " audit · Diagnose" : "Diagnose";
    $("#workspace-title").textContent  = def.headline || "The system as it stands.";
    $("#workspace-lede").textContent   =
      subjectLabel(r) + " · " + r.findings.length + " finding" + (r.findings.length === 1 ? "" : "s") + " · " +
      r.orders.length + " work order" + (r.orders.length === 1 ? "" : "s") + " · read " +
      (r.method.crawled_at || "").slice(0, 10) + ".";

    var ring = $(".ring-value");
    if (ring) ring.style.setProperty("--ring-len", String(score.overall));
    countTo($("#score-num"), score.overall);
    $("#score-grade").textContent = score.grade.label + (score.provisional ? " · provisional" : "");
    $("#score-grade").className = "grade band-" + score.grade.band;
    $("#score-kicker").textContent = (def.name || "Audit") + " score";

    $("#kpi-grade-label").textContent = score.grade.label;
    $("#kpi-grade-label").className = "num grade-num band-" + score.grade.band;
    $("#kpi-grade-note").textContent = score.grade.note;
    countTo($("#kpi-findings-num"), r.findings.length);
    countTo($("#kpi-high-num"), score.counts.high || 0);
    countTo($("#kpi-orders-num"), r.orders.length);
    $("#kpi-findings-note").textContent = "Measured on " + subjectLabel(r) + ".";

    renderParameters(r);
    renderSeverity(r);
    renderFilters(r);
    renderMethod(r);
    renderFindings();
    revealCharts($('[data-view="workspace"]'));
  }

  function subjectLabel(r) {
    if (r.type === "document") return (r.metrics && r.metrics.name) || r.subject || "the document";
    if (r.type === "social") {
      var n = Object.keys((r.metrics && r.metrics.profiles) || {}).length;
      return n + " profile" + (n === 1 ? "" : "s");
    }
    return trimUrl(r.subject);
  }

  function renderParameters(r) {
    var rows = r.score.parameters;
    var html = Object.keys(rows).map(function (id) {
      var p = rows[id];
      var scored = p.score !== null && p.score !== undefined;
      var pct = scored ? (p.score / 10) : 0;
      var tone = !scored ? "unscored" : (p.score >= 8 ? "good" : (p.score >= 5 ? "mid" : "bad"));
      return '<div class="param-row ' + tone + '" data-param="' + esc(id) + '">' +
        '<div class="param-head"><span class="param-name">' + esc(p.label) + "</span>" +
        '<span class="param-weight">' + p.weight + "%</span></div>" +
        '<div class="track"><i data-w="' + pct.toFixed(2) + '"></i></div>' +
        '<div class="param-score">' +
          (scored
            ? '<b>' + p.score + '</b><small>/10</small>' + (p.source === "manual" ? '<span class="tag">set by you</span>' : "")
            : '<span class="tag warn">needs your score</span>') +
        "</div>" +
        '<div class="param-set">' + scoreSelect(id, p) + "</div>" +
        '<p class="param-blurb">' + esc(p.blurb) +
          (p.findings ? " · " + p.findings + " finding" + (p.findings === 1 ? "" : "s") : "") + "</p>" +
        "</div>";
    }).join("");
    $("#param-rows").innerHTML = html;

    var unscored = r.score.unscored.length;
    var hint = $("#param-hint");
    hint.hidden = unscored === 0;
    if (unscored) {
      hint.textContent = unscored + " parameter" + (unscored === 1 ? "" : "s") +
        " could not be measured from public data — set them here and the score stops being provisional. " +
        "Weights are renormalised over what is scored until then.";
    }
    $("#param-head").textContent = r.score.provisional
      ? "Scored out of " + r.score.scored_weight + "% so far."
      : "Each one out of 10, weighted into the total.";

    $$(".param-set select").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var param = sel.getAttribute("data-param-set");
        var value = sel.value === "" ? null : parseInt(sel.value, 10);
        api("score", { body: { id: state.id, token: state.token, parameter: param, score: value } })
          .then(function (data) {
            state.audit = data.audit;
            renderWorkspace();
            toast(value === null ? "Score cleared" : "Scored " + value + "/10");
          })
          .catch(function (e) { toast(e.message); });
      });
    });
  }

  function scoreSelect(id, p) {
    var current = p.source === "manual" && p.score !== null ? String(Math.round(p.score)) : "";
    var opts = ['<option value="">—</option>'];
    for (var i = 0; i <= 10; i++) {
      opts.push('<option value="' + i + '"' + (current === String(i) ? " selected" : "") + ">" + i + "</option>");
    }
    return '<label class="sr-label" for="set-' + esc(id) + '">Set ' + esc(p.label) + " score</label>" +
      '<select id="set-' + esc(id) + '" data-param-set="' + esc(id) + '">' + opts.join("") + "</select>";
  }

  function renderSeverity(r) {
    var c = r.score.counts;
    var high = c.high || 0, med = c.medium || 0, low = c.low || 0;
    $("#legend-high").textContent = high;
    $("#legend-med").textContent = med;
    $("#legend-low").textContent = low;
    $(".sev-track").style.gridTemplateColumns = high + "fr " + med + "fr " + low + "fr";
    $("#sev-hi").hidden = high === 0;
    $("#sev-md").hidden = med === 0;
    $("#sev-lo").hidden = low === 0;
    $("#severity-head").textContent = (high + med + low) === 0
      ? "Nothing raised on this surface."
      : (high >= med ? "Weighted toward high severity." : "Mostly medium, with " + high + " high.");

    var bands = [
      { key: "excellent", label: "80–100 Excellent", note: "Minor optimisations only" },
      { key: "improve",   label: "50–79 Needs improvement", note: "Focus on the high-weight parameters" },
      { key: "critical",  label: "0–49 Critical", note: "Redesign or rewrite" }
    ];
    $("#grade-scale").innerHTML = bands.map(function (b) {
      return '<div class="band-row' + (b.key === r.score.grade.band ? " is-on" : "") + '">' +
        '<span class="dot band-' + b.key + '"></span><b>' + esc(b.label) + "</b><em>" + esc(b.note) + "</em></div>";
    }).join("");
  }

  function renderFilters(r) {
    var params = r.score.parameters;
    var chips = ['<button class="chip" type="button" data-filter="all" aria-pressed="true">All</button>'];
    Object.keys(params).forEach(function (id) {
      if (!params[id].findings) return;
      chips.push('<button class="chip" type="button" data-filter="' + esc(id) + '">' +
        esc(params[id].label) + " <b>" + params[id].findings + "</b></button>");
    });
    if (r.score.counts.high) {
      chips.push('<button class="chip" type="button" data-filter="high">High only</button>');
    }
    $("#filters").innerHTML = chips.join("");
    $$("#filters [data-filter]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-filter") === state.filter ? "true" : "false");
      btn.addEventListener("click", function () {
        state.filter = btn.getAttribute("data-filter");
        $$("#filters [data-filter]").forEach(function (b) {
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        save();
        renderFindings();
      });
    });
  }

  function renderFindings() {
    if (!hasResult()) return;
    var r = result();
    var q = ($("#finding-search").value || "").toLowerCase();
    var list = $("#finding-list");
    var rows = findings().filter(function (f) {
      if (state.filter === "high" && f.severity !== "high") return false;
      if (state.filter !== "all" && state.filter !== "high" && f.parameter !== state.filter) return false;
      if (q && (f.title + " " + f.evidence + " " + f.service).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });

    list.innerHTML = "";
    if (!rows.length) {
      list.innerHTML = '<p class="empty">' + (findings().length
        ? "No findings in this filter."
        : "Nothing was raised on this surface — every parameter scored clean.") + "</p>";
      $("#finding-detail").innerHTML = '<p class="empty">Select a finding to see the work order.</p>';
      return;
    }
    if (!rows.some(function (f) { return f.id === state.selected; })) state.selected = rows[0].id;

    rows.forEach(function (f) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "finding";
      btn.setAttribute("data-od-id", "finding-card-" + f.id);
      btn.setAttribute("aria-selected", f.id === state.selected ? "true" : "false");
      btn.innerHTML = '<span class="sev sev-' + esc(f.severity) + '">' + esc(f.severity) + "</span>" +
        "<h3>" + esc(f.title) + "</h3>" +
        '<span class="surf">' + esc(paramLabel(r, f.parameter)) + "</span>";
      btn.addEventListener("click", function () {
        state.selected = f.id;
        save();
        renderFindings();
      });
      list.appendChild(btn);
    });
    renderDetail(r);
  }

  function paramLabel(r, id) {
    var p = r.score.parameters[id];
    return p ? p.label : id;
  }

  function renderDetail(r) {
    var f = findings().filter(function (x) { return x.id === state.selected; })[0];
    var box = $("#finding-detail");
    if (!f) { box.innerHTML = '<p class="empty">Select a finding to see the work order.</p>'; return; }

    var param = r.score.parameters[f.parameter];
    var proof = (f.proof || []).length
      ? '<ul class="proof">' + f.proof.map(function (p) {
          var v = p.url
            ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(p.value) + "</a>"
            : esc(p.value);
          return '<li><span class="p-label">' + esc(p.label) + '</span><span class="p-value">' + v + "</span></li>";
        }).join("") + "</ul>"
      : "";

    box.classList.remove("is-in");
    box.innerHTML =
      '<p class="kicker">' + esc(paramLabel(r, f.parameter)) +
        (param ? " · " + param.weight + "% weight" : "") + " · " + esc(f.severity) + "</p>" +
      "<h2>" + esc(f.title) + "</h2>" +
      "<p>" + esc(f.evidence) + "</p>" +
      (proof ? '<div class="work"><dt class="proof-head">Measured</dt>' + proof + "</div>" : "") +
      '<dl class="work" data-od-id="work-order-' + esc(f.id) + '">' +
        "<dt>Growth cost</dt><dd>" + esc(f.cost) + "</dd>" +
        "<dt>DigiKraft service</dt><dd>" + esc(f.service) + "</dd>" +
        "<dt>90-day slot</dt><dd>" + esc(f.month) + "</dd>" +
      "</dl>" +
      '<p class="hint">Work orders become the pilot scope. The client is not buying a design. They are buying capacity.</p>';
    void box.offsetWidth;
    box.classList.add("is-in");
  }

  function renderMethod(r) {
    var html = '<div class="method-group"><p class="kicker">Sources read</p>';
    html += (r.method.sources || []).map(function (s) {
      var ok = !s.status || (s.status >= 200 && s.status < 300);
      var state2 = s.state || (s.status ? String(s.status) : "read");
      var cls = s.state === "blocked" || s.state === "unverified" ? "warn" : (ok ? "ok" : "bad");
      var name = s.url
        ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(s.label + " · " + trimUrl(s.url)) + "</a>"
        : '<span class="m-name">' + esc(s.label) + "</span>";
      return '<div class="method-row">' + name +
        '<span class="badge ' + cls + '">' + esc(state2) + "</span>" +
        "<span>" + (s.ttfb ? s.ttfb.toFixed(2) + "s" : "—") + "</span>" +
        "<span>" + (s.bytes ? bytes(s.bytes) : (s.note ? esc(clip(s.note, 28)) : "—")) + "</span></div>";
    }).join("");
    html += "</div>";

    html += '<p class="hint">Read ' + esc(r.method.crawled_at) + " UTC as " + esc(r.method.user_agent) +
      ". Findings come only from these responses. Anything a platform blocked is marked, never assumed — those parameters " +
      "are left for you to score.</p>";
    $("#method-body").innerHTML = html;
  }

  function trimUrl(u) { return String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, ""); }
  function clip(t, max) {
    t = String(t || "").trim();
    if (!t) return "—";
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
  }
  function bytes(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    if (n >= 1024) return Math.round(n / 1024) + " KB";
    return n + " B";
  }

  $("#finding-search").addEventListener("input", renderFindings);
  $("#finding-list").addEventListener("keydown", function (e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    var items = $$(".finding");
    if (!items.length) return;
    var i = items.findIndex(function (el) { return el.getAttribute("aria-selected") === "true"; });
    i = e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
    items[i].click();
    items[i].focus();
    e.preventDefault();
  });

  // ------------------------------------------------------------------ report

  function renderReport() {
    if (!hasResult()) return;
    var r = result();

    $("#report-lede").textContent =
      r.fixes.length + " thing" + (r.fixes.length === 1 ? "" : "s") + " to fix now. " +
      r.bets.length + " bet" + (r.bets.length === 1 ? "" : "s") + " that turn creative into capacity. " +
      "One direction so " + r.company + " stops looking like the rest of the category.";

    $("#gantt-rows").innerHTML = r.orders.map(function (o) {
      var cells = [1, 2, 3].map(function (m) {
        return '<div class="g-cell' + (o.months.indexOf(m) !== -1 ? " on" : "") + '"></div>';
      }).join("");
      return '<div class="gantt-row"><span>' + esc(o.service) + "</span>" + cells + "</div>";
    }).join("") || '<p class="hint">No work orders — nothing on this file needs a slot.</p>';

    $("#fixes-row").innerHTML = r.fixes.map(function (f, i) {
      return '<article class="tile fix lift" data-od-id="fix-' + (i + 1) + '">' +
        '<span class="idx">0' + (i + 1) + "</span><h3>" + esc(f.title) + "</h3>" +
        "<p>" + esc(f.body) + "</p>" +
        '<p class="svc">' + esc(f.parameter || "") + " · " + esc(f.service) + " · " + esc(f.month) + "</p></article>";
    }).join("");

    $("#bets-row").innerHTML = r.bets.map(function (b, i) {
      return '<article class="tile fix lift" data-od-id="bet-' + (i + 1) + '">' +
        '<span class="idx">0' + (i + 1) + "</span><h3>" + esc(b.title) + "</h3>" +
        "<p>" + esc(b.body) + "</p>" +
        '<p class="svc">DigiKraft · ' + esc(b.service) + " · " + esc(b.month) + "</p></article>";
    }).join("");

    $("#direction-name").textContent = r.direction.name;
    var box = $("#direction-copy");
    if (document.activeElement !== box) box.value = state.audit.direction || r.direction.copy || "";
    $("#direction-swatches").innerHTML = (r.direction.swatches || []).map(function (s) {
      return '<div class="swatch ' + esc(s.tone) + '">' + esc(s.label) + "</div>";
    }).join("");

    revealCharts($('[data-view="report"]'));
  }

  $("#direction-copy").addEventListener("input", function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { persistClose({ direction: $("#direction-copy").value }); }, 700);
  });

  // ------------------------------------------------------------------- close

  function renderClose() {
    if (!hasResult()) return;
    var r = result(), tiers = r.tiers;
    var tier = state.audit.tier || r.recommended_tier;
    var day  = state.audit.day || "Tuesday";

    $("#close-lede").textContent = "Easier to approve than a year. Long enough to show speed, quality and process. " +
      "On this audit we recommend the " + tiers[r.recommended_tier].name + ".";

    $("#plans").innerHTML = Object.keys(tiers).map(function (key) {
      var t = tiers[key], on = key === tier;
      return '<button class="plan tile' + (on ? " is-rec" : "") + '" type="button" data-tier="' + key + '"' +
        (on ? ' aria-pressed="true"' : "") + ' data-od-id="tier-' + key + '">' +
        (key === r.recommended_tier ? '<p class="kicker">Recommended for ' + esc(r.company) + "</p>" : "") +
        "<h3>" + esc(t.name) + '</h3><p class="price">' + esc(t.price) + "</p>" +
        '<p class="muted">' + esc(t.blurb) + "</p></button>";
    }).join("");

    $("#range-list").innerHTML = Object.keys(tiers).map(function (key) {
      var t = tiers[key];
      return '<div class="range-row' + (key === tier ? " is-on" : "") + '" data-range="' + key + '">' +
        "<span>" + esc(t.name.split(" ")[0]) + '</span><div class="range-bar"><i data-w="' + t.width + '"></i></div>' +
        "<b>" + esc(t.price) + "</b></div>";
    }).join("");

    var byMonth = { 1: [], 2: [], 3: [] };
    r.orders.forEach(function (o) { o.months.forEach(function (m) { if (byMonth[m]) byMonth[m].push(o.service); }); });
    $("#months").innerHTML = [1, 2, 3].map(function (m) {
      var list = byMonth[m];
      return '<article class="tile month lift" data-od-id="month-' + m + '">' +
        '<p class="kicker">' + esc(MONTH_TITLES[m].kicker) + "</p><h3>" + esc(MONTH_TITLES[m].head) + "</h3>" +
        '<p class="muted">' + (list.length ? esc(list.join(" · ")) : "Capacity held for whatever the first two months surface.") +
        "</p></article>";
    }).join("");

    $$("[data-day]").forEach(function (el) {
      el.setAttribute("aria-pressed", el.getAttribute("data-day") === day ? "true" : "false");
    });
    $("#cta-recommend").textContent = "Recommend " + tiers[tier].name.split(" ")[0] + " pilot · " + day;

    bindCloseControls();
    if (state.audit.closed) showDone();
    else { $("#close-form").hidden = false; $("#close-done").hidden = true; }
    revealCharts($('[data-view="close"]'));
  }

  function bindCloseControls() {
    $$("[data-tier]").forEach(function (el) {
      el.onclick = function () {
        state.audit.tier = el.getAttribute("data-tier");
        renderClose();
        persistClose({ tier: state.audit.tier });
      };
    });
    $$("[data-day]").forEach(function (el) {
      el.onclick = function () {
        state.audit.day = el.getAttribute("data-day");
        renderClose();
        persistClose({ day: state.audit.day });
      };
    });
  }

  function persistClose(extra) {
    if (!state.id || !state.token) return Promise.resolve();
    var body = {
      id: state.id, token: state.token,
      tier: state.audit.tier, day: state.audit.day,
      direction: $("#direction-copy").value,
      closed: state.audit.closed ? 1 : 0
    };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
    return api("close", { body: body })
      .then(function (data) { if (data.audit) state.audit = data.audit; })
      .catch(function (e) { toast(e.message); });
  }

  function showDone() {
    var r = result();
    $("#close-form").hidden = true;
    $("#close-done").hidden = false;
    $("#close-done-copy").textContent =
      r.company + " · " + r.type_name + " audit scored " + r.score.overall + "/100 (" + r.score.grade.label + "). " +
      r.tiers[state.audit.tier].name + " · 90-day pilot. Follow-up " + state.audit.day + ".";
  }

  $("#cta-recommend").addEventListener("click", function () {
    state.audit.closed = true;
    showDone();
    persistClose({ closed: 1 }).then(function () { toast("Recommendation saved for this meeting"); });
  });

  $("#btn-open-report").addEventListener("click", function () { window.open(reportUrl(), "_blank", "noopener"); });
  $("#btn-copy-link").addEventListener("click", function () {
    var url = location.origin + location.pathname.replace(/[^/]*$/, "") + reportUrl();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast("Share link copied"); },
        function () { window.prompt("Copy this link", url); });
    } else { window.prompt("Copy this link", url); }
  });

  function reportUrl() {
    return "/report/" + encodeURIComponent(state.id) + "?t=" + encodeURIComponent(state.token);
  }

  $("#btn-download").addEventListener("click", function () {
    if (!hasResult()) return;
    window.open(reportUrl() + "&print=1", "_blank", "noopener");
  });

  // ----------------------------------------------------------------- recents

  function loadRecents() {
    api("recent")
      .then(function (data) {
        var box = $("#recents"), list = $("#recent-list");
        if (!data.audits.length) { box.hidden = true; return; }
        box.hidden = false;
        list.innerHTML = "";
        data.audits.forEach(function (a) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "recent";
          var typeName = (TYPES[a.type] && TYPES[a.type].name) || a.type;
          btn.innerHTML = "<span><b>" + esc(a.company) + "</b><small>" + esc(typeName) + " · " +
            esc(trimUrl(a.site) || "file") + " · " + esc(a.created.slice(0, 10)) + "</small></span>" +
            '<span class="r-score">' + a.findings + " findings</span>" +
            '<span class="r-score">' + a.score + "/100</span>";
          btn.addEventListener("click", function () {
            state.id = a.id; state.token = a.token; state.choice = a.type; state.selected = ""; state.filter = "all";
            save();
            refreshAudit().then(function () { setView("workspace"); }).catch(function (e) { toast(e.message); });
          });
          list.appendChild(btn);
        });
      })
      .catch(function () { /* recents are a convenience, never a blocker */ });
  }

  // ------------------------------------------------------------------- reset

  $("#btn-reset").addEventListener("click", function () {
    state.id = ""; state.token = ""; state.audit = null; state.choice = "";
    state.filter = "all"; state.selected = ""; state.upload = null; state.draft = {};
    try { localStorage.removeItem(STORAGE); } catch (e) { /* ignore */ }
    paintChoice();
    $("#intake-error").textContent = "";
    $("#finding-search").value = "";
    if (history.replaceState) history.replaceState({}, "", location.pathname);
    setView("landing");
    toast("Meeting reset");
  });

  // ---------------------------------------------------------------- passcode

  var gateForm = $("#gate-form");
  if (gateForm) {
    gateForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var err = $("#gate-error");
      err.textContent = "";
      api("login", { body: { passcode: $("#passcode").value } })
        .then(function () { $("#gate").remove(); loadRecents(); })
        .catch(function (e2) { err.textContent = e2.message; });
    });
  }

  // ----------------------------------------------------------------- routing

  $$("[data-go]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      if (el.tagName === "A") e.preventDefault();
      if (el.disabled) return;
      setView(el.getAttribute("data-go"));
    });
  });

  window.addEventListener("popstate", function (e) {
    var id = (e.state && e.state.view) || (location.hash || "").replace("#", "") || "landing";
    setView(id, false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && state.view === "workspace" && document.activeElement &&
        document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA" &&
        document.activeElement.tagName !== "SELECT") {
      e.preventDefault();
      $("#finding-search").focus();
    }
    if (e.key === "Escape" && state.view === "workspace") {
      var s = $("#finding-search");
      if (s.value) { s.value = ""; renderFindings(); }
    }
  });

  window.addEventListener("beforeunload", function (e) {
    if (state.running) { e.preventDefault(); e.returnValue = ""; }
  });

  // -------------------------------------------------------------------- boot

  load();
  paintChoice();

  if (!location.hash) {
    try { history.replaceState({ view: state.view }, "", "#" + state.view); } catch (e) { /* ignore */ }
  }

  if (BOOT.needPasscode) {
    setView("landing", false);
  } else if (state.id && state.token) {
    var wanted = state.view;
    refreshAudit()
      .then(function (audit) {
        if (audit && audit.result) {
          setView(wanted === "scan" ? "workspace" : wanted, false);
        } else if (audit && audit.status === "running" && audit.steps.indexOf(audit.step) > 0) {
          state.choice = audit.type;
          paintChoice();
          setView("scan", false);
          runScan(audit.steps, audit.step);
        } else {
          setView("landing", false);
        }
      })
      .catch(function () {
        state.id = ""; state.token = ""; save();
        setView("landing", false);
      });
  } else {
    setView(state.view, false);
  }
})();
