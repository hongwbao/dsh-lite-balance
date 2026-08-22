/**
 * dsh-lite-balance client half (bundled for the dsh ModuleLoader).
 *
 * Modular, user-configurable stats line:
 *   - 7 self-contained display modules (5 native + wallet + peak/idle)
 *   - a gear icon at the right opens a settings popup: toggle visibility and
 *     reorder modules (persisted to localStorage)
 *   - a thin orchestrator filters, orders and joins the enabled modules
 */
window.__ModuleLoader__.load({
  id: "dsh-lite-balance",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;

    var NS = "dsh-lite-balance";
    var API_PATH = "/dsh-lite-balance/balance";
    var DEFAULT_REFRESH_MS = 60000;
    var CONFIG_KEY = "dsh-lite-balance.modules.v1";

    // -----------------------------------------------------------------------
    // 1. locale dictionaries
    // -----------------------------------------------------------------------
    var zh = {
      label: "余额",
      updatedAt: "更新于 {time}",
      clickRechargeHint: "点击打开充值页",
      statsCounts: "{turns} 轮 · {steps} 步",
      toolCall: "工具调用",
      ttftAvg: "首 token 平均",
      statsCacheHit: "缓存命中 {percent}%",
      statsTokens: "输入 {input} tok · 输出 {output} tok",
      spent: "消耗 {amount}",
      balance: "余额 {amount}",
      peak: "高峰",
      idle: "空闲",
      settings: "模块设置",
      close: "关闭",
      moveUp: "上移",
      moveDown: "下移",
      drag: "拖动排序",
      moduleCounts: "轮次/步数",
      moduleDuration: "耗时",
      moduleSpeed: "速率",
      moduleCacheHit: "缓存命中",
      moduleTokens: "Token 用量",
      moduleWallet: "钱包（消耗+余额）",
      modulePeakIdle: "高峰/空闲",
    };
    var en = {
      label: "Balance",
      updatedAt: "Updated {time}",
      clickRechargeHint: "Click to top up",
      statsCounts: "{turns} turns · {steps} steps",
      toolCall: "Tools",
      ttftAvg: "TTFT avg",
      statsCacheHit: "Cache hit {percent}%",
      statsTokens: "In {input} tok · Out {output} tok",
      spent: "Spent {amount}",
      balance: "Balance {amount}",
      peak: "Peak",
      idle: "Off-peak",
      settings: "Module settings",
      close: "Close",
      moveUp: "Move up",
      moveDown: "Move down",
      drag: "Drag to reorder",
      moduleCounts: "Turns · Steps",
      moduleDuration: "Duration",
      moduleSpeed: "Speed",
      moduleCacheHit: "Cache hit",
      moduleTokens: "Tokens",
      moduleWallet: "Wallet (spend+balance)",
      modulePeakIdle: "Peak/Idle",
    };

    // -----------------------------------------------------------------------
    // 2. shared balance store + fetch
    // -----------------------------------------------------------------------
    var store = { phase: "loading", data: null, error: null, code: null };
    var listeners = new Set();
    function setStore(patch) {
      Object.assign(store, patch);
      listeners.forEach(function (fn) { fn(); });
    }
    function useStore() {
      var tick = useState(0)[1];
      useEffect(function () {
        var fn = function () { tick(function (x) { return x + 1; }); };
        listeners.add(fn);
        return function () { listeners.delete(fn); };
      }, [tick]);
      return store;
    }

    function getBalance(force) {
      return fetch(API_PATH + (force ? "?refresh=1" : ""), { cache: "no-store" })
        .then(function (r) { return r.json(); });
    }
    var refreshMsRef = { current: DEFAULT_REFRESH_MS };
    var inFlight = false;
    function refreshBalance(force) {
      if (inFlight) return;
      inFlight = true;
      if (!store.data) setStore({ phase: "loading" });
      getBalance(force).then(function (json) {
        if (json && json.ok) {
          if (json.meta && json.meta.refreshMs) refreshMsRef.current = json.meta.refreshMs;
          setStore({ phase: "ready", data: json, error: null, code: null });
        } else {
          setStore({ phase: "error", data: null, error: (json && json.message) || "unknown", code: json && json.code });
        }
      }).catch(function (err) {
        setStore({ phase: "error", data: null, error: String((err && err.message) || err), code: "fetch-failed" });
      }).finally(function () {
        inFlight = false;
      });
    }

    // -----------------------------------------------------------------------
    // 3. helpers
    // -----------------------------------------------------------------------
    function symbolOf(currency) {
      if (currency === "CNY") return "¥";
      if (currency === "USD") return "$";
      return currency ? currency + " " : "";
    }
    function fmt(n) {
      if (n === null || n === undefined || !Number.isFinite(n)) return "—";
      return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function fmtMoney(n) {
      if (n === null || n === undefined || !isFinite(n)) return "0.00";
      return n.toFixed(2);
    }
    function statusOf(total, meta) {
      var warn = (meta && meta.warnThreshold != null) ? meta.warnThreshold : 10;
      var crit = (meta && meta.criticalThreshold != null) ? meta.criticalThreshold : 3;
      if (total === null || total === undefined) return "error";
      if (total < crit) return "danger";
      if (total <= warn) return "warn";
      return "ok";
    }
    function usageOutputTokens(usage) {
      if (typeof usage !== "object" || usage === null) return null;
      var value = usage.outputTokens;
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
    }
    function assistantStepReading(node) {
      var timing = node.timing;
      return {
        ttftMs: timing !== undefined && timing.stepStartTime !== null && timing.firstTokenTime !== null
          ? Math.max(0, timing.firstTokenTime - timing.stepStartTime) : null,
        decodeMs: timing !== undefined && timing.firstTokenTime !== null
          ? Math.max(0, timing.completedTime - timing.firstTokenTime) : null,
        outputTokens: usageOutputTokens(node.usage),
      };
    }
    function deriveStats(nodes) {
      var turns = new Set();
      var steps = 0;
      var llmMs = 0;
      var toolMs = 0;
      var ttftMs = 0;
      var ttftSteps = 0;
      var decodeMs = 0;
      var decodeTokens = 0;
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.kind === "tool-result") {
          if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime);
          continue;
        }
        if (node.kind !== "assistant") continue;
        turns.add(node.turn);
        steps += 1;
        if (node.timing !== undefined && node.timing.stepStartTime !== null) {
          llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime);
        }
        var reading = assistantStepReading(node);
        if (reading.ttftMs !== null) { ttftMs += reading.ttftMs; ttftSteps += 1; }
        if (reading.decodeMs !== null && reading.outputTokens !== null) {
          decodeMs += reading.decodeMs;
          decodeTokens += reading.outputTokens;
        }
      }
      return { turns: turns.size, steps: steps, llmMs: llmMs, toolMs: toolMs, ttftMs: ttftMs, ttftSteps: ttftSteps, decodeMs: decodeMs, decodeTokens: decodeTokens };
    }
    function deriveCounts(nodes) {
      var s = deriveStats(nodes);
      return { turns: s.turns, steps: s.steps };
    }
    function billedInputTokens(usage) {
      return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
    }
    function formatTokens(n) {
      var scaled = function (v) { return v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); };
      if (n < 1e3) return String(n);
      if (n < 1e6) return scaled(n / 1e3) + "K";
      return scaled(n / 1e6) + "M";
    }
    function formatDuration(ms) {
      var s = ms / 1e3;
      if (s < 60) return String(Math.round(s * 10) / 10) + "s";
      var whole = Math.round(s);
      return Math.floor(whole / 60) + "m" + (whole % 60) + "s";
    }
    function formatTokensPerSecond(tps) {
      var clamped = Math.max(0, tps);
      return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
    }
    function roundedIntegerPercent(cacheReadTokens, denominator) {
      var denominatorQuotient = Math.floor(denominator / 200);
      var denominatorRemainder = denominator % 200;
      var lower = 0;
      var upper = 100;
      while (lower < upper) {
        var candidate = Math.floor((lower + upper + 1) / 2);
        var factor = candidate * 2 - 1;
        if (cacheReadTokens >= factor * denominatorQuotient + Math.ceil(factor * denominatorRemainder / 200)) lower = candidate;
        else upper = candidate - 1;
      }
      return lower;
    }
    function cacheHitPercent(usage) {
      var denominator = billedInputTokens(usage);
      if (denominator === 0) return null;
      var missedInputTokens = usage.uncachedInputTokens + usage.cacheWriteTokens;
      if (missedInputTokens === 0) return "100";
      var integerPercent = roundedIntegerPercent(usage.cacheReadTokens, denominator);
      if (integerPercent < 100) return String(integerPercent);
      var decimalPlaces = 1;
      var scaledDoubleGap = missedInputTokens * 200;
      var denominatorTens = Math.floor(denominator / 10);
      while (scaledDoubleGap <= denominatorTens) {
        scaledDoubleGap *= 10;
        decimalPlaces += 1;
      }
      var denominatorOnes = denominator % 10;
      var roundedLoss = 5;
      for (var loss = 1; loss < 5; loss += 1) {
        var factor = loss * 2 + 1;
        var threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10);
        if (scaledDoubleGap <= threshold) {
          roundedLoss = loss;
          break;
        }
      }
      return "99." + "9".repeat(decimalPlaces - 1) + String(10 - roundedLoss);
    }
    function parseHHMM(text) {
      if (typeof text !== "string") return null;
      var m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
      if (!m) return null;
      var hour = Number(m[1]);
      var minute = Number(m[2]);
      if (hour > 23 || minute > 59) return null;
      return hour * 60 + minute;
    }
    function beijingMinutes(date) {
      try {
        var parts = new Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Shanghai",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).formatToParts(date);
        var hour = 0;
        var minute = 0;
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].type === "hour") hour = Number(parts[i].value);
          if (parts[i].type === "minute") minute = Number(parts[i].value);
        }
        return hour * 60 + minute;
      } catch {
        return date.getHours() * 60 + date.getMinutes();
      }
    }
    function isPeak(meta, date) {
      var t = date || new Date();
      var bjDow = new Date(t.getTime() + 8 * 3600000).getUTCDay();
      if (bjDow === 0 || bjDow === 6) return false;
      var windows = (meta && Array.isArray(meta.peakWindows) && meta.peakWindows.length > 0)
        ? meta.peakWindows
        : [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }];
      var now = beijingMinutes(t);
      for (var i = 0; i < windows.length; i++) {
        var start = parseHHMM(windows[i] && windows[i].start);
        var end = parseHHMM(windows[i] && windows[i].end);
        if (start === null || end === null) continue;
        if (start <= end) { if (now >= start && now < end) return true; }
        else { if (now >= start || now < end) return true; }
      }
      return false;
    }

    // -----------------------------------------------------------------------
    // 4. user module config (persisted in localStorage)
    // -----------------------------------------------------------------------
    var DEFAULT_MODULE_CONFIG = {
      counts:   { enabled: true,  order: 10 },
      cacheHit: { enabled: true,  order: 20 },
      tokens:   { enabled: true,  order: 30 },
      wallet:   { enabled: true,  order: 40 },
      peakIdle: { enabled: true,  order: 50 },
      duration: { enabled: false, order: 60 },
      speed:    { enabled: false, order: 70 },
    };
    var configListeners = new Set();
    var moduleConfig = loadModuleConfig();

    function loadModuleConfig() {
      var base = {};
      for (var id in DEFAULT_MODULE_CONFIG) {
        base[id] = { enabled: DEFAULT_MODULE_CONFIG[id].enabled, order: DEFAULT_MODULE_CONFIG[id].order };
      }
      try {
        var raw = (typeof localStorage !== "undefined") ? localStorage.getItem(CONFIG_KEY) : null;
        if (raw) {
          var saved = JSON.parse(raw);
          for (var key in DEFAULT_MODULE_CONFIG) {
            var s = saved && saved[key];
            if (s && typeof s === "object") {
              if (typeof s.enabled === "boolean") base[key].enabled = s.enabled;
              if (typeof s.order === "number" && isFinite(s.order)) base[key].order = s.order;
            }
          }
        }
      } catch { /* corrupted config: fall back to defaults */ }
      return base;
    }
    function saveModuleConfig() {
      try {
        if (typeof localStorage !== "undefined") localStorage.setItem(CONFIG_KEY, JSON.stringify(moduleConfig));
      } catch { /* storage unavailable: keep in-memory only */ }
    }
    function notifyConfigChanged() {
      configListeners.forEach(function (fn) { fn(); });
    }
    function setModuleEnabled(id, enabled) {
      if (!moduleConfig[id]) return;
      moduleConfig[id].enabled = enabled;
      saveModuleConfig();
      notifyConfigChanged();
    }
    function moveModule(id, delta) {
      var ids = Object.keys(DEFAULT_MODULE_CONFIG).sort(function (a, b) { return moduleConfig[a].order - moduleConfig[b].order; });
      var i = ids.indexOf(id);
      var j = i + delta;
      if (i < 0 || j < 0 || j >= ids.length) return;
      var tmp = moduleConfig[ids[i]].order;
      moduleConfig[ids[i]].order = moduleConfig[ids[j]].order;
      moduleConfig[ids[j]].order = tmp;
      saveModuleConfig();
      notifyConfigChanged();
    }
    /** Move one module to an absolute index (live drag swap), renumbering order. */
    function moveModuleToIndex(id, toIndex) {
      var ids = Object.keys(DEFAULT_MODULE_CONFIG).sort(function (a, b) { return moduleConfig[a].order - moduleConfig[b].order; });
      var from = ids.indexOf(id);
      if (from < 0 || toIndex < 0 || toIndex >= ids.length || from === toIndex) return;
      ids.splice(from, 1);
      ids.splice(toIndex, 0, id);
      for (var i = 0; i < ids.length; i++) moduleConfig[ids[i]].order = (i + 1) * 10;
      saveModuleConfig();
      notifyConfigChanged();
    }

    // ---------------------------------------------------------------------
    // Extension API: third-party plugins register extra stat modules.
    // ---------------------------------------------------------------------
    var EXTRA_MODULES = [];
    function getAllModules() { return STAT_MODULES.concat(EXTRA_MODULES); }
    function moduleEnabled(cfg, m) { var c = cfg && cfg[m.id]; return c ? c.enabled !== false : true; }
    function moduleOrder(cfg, m) { var c = cfg && cfg[m.id]; return (c && typeof c.order === "number") ? c.order : (typeof m.order === "number" ? m.order : 1000); }
    function moduleName(ctx, m) {
      if (m.label && typeof m.label === "function") return m.label(ctx);
      if (m.labelKey && ctx && ctx.t) return ctx.t(m.labelKey);
      return m.id;
    }
    function normalizeModule(def) {
      return {
        id: String(def && def.id),
        labelKey: (def && def.labelKey) || null,
        label: (def && typeof def.label === "function") ? def.label : null,
        order: (def && typeof def.order === "number") ? def.order : 1000,
        enabled: (def && typeof def.enabled === "function") ? def.enabled : function () { return true; },
        render: (def && typeof def.render === "function") ? def.render : function () { return null; },
        clickable: !!(def && def.clickable),
        onClick: (def && typeof def.onClick === "function") ? def.onClick : null,
        tooltip: (def && typeof def.tooltip === "function") ? def.tooltip : null,
        style: (def && def.style) || null,
      };
    }
    /**
     * Public: register a stats sub-module. Requires { id, render }.
     * Returns a disposer that unregisters it.
     */
    function registerModule(def) {
      if (!def || typeof def.id !== "string" || def.id === "" || typeof def.render !== "function") {
        throw new Error("dsh-lite-balance: registerModule requires { id: string, render: fn }");
      }
      var normalized = normalizeModule(def);
      var i = EXTRA_MODULES.findIndex(function (m) { return m.id === normalized.id; });
      if (i >= 0) EXTRA_MODULES[i] = normalized;
      else {
        EXTRA_MODULES.push(normalized);
        if (!moduleConfig[normalized.id]) {
          moduleConfig[normalized.id] = { enabled: true, order: 100 + EXTRA_MODULES.length };
        }
      }
      saveModuleConfig();
      notifyConfigChanged();
      return function () { unregisterModule(normalized.id); };
    }
    function unregisterModule(id) {
      EXTRA_MODULES = EXTRA_MODULES.filter(function (m) { return m.id !== id; });
      notifyConfigChanged();
    }
    function useModuleConfig() {
      var tick = useState(0)[1];
      useEffect(function () {
        var fn = function () { tick(function (x) { return x + 1; }); };
        configListeners.add(fn);
        return function () { configListeners.delete(fn); };
      }, [tick]);
      return moduleConfig;
    }

    // -----------------------------------------------------------------------
    // 5. shared data context
    // -----------------------------------------------------------------------
    function useStatsContext(props) {
      var sessionId = props.sessionId;
      var useSession = props.useSession;
      var useProjection = props.useProjection;
      var t = props.t;
      var balance = useStore();
      var nodes = useSession(function (s) { return s.chat.legacy.nodes; });
      var usage = useProjection("tokenUsage");
      var projectedStats = useProjection("sessionStats");
      var stats = projectedStats || deriveStats(nodes || []);
      var sessionCostState = useState(null);
      var sessionCost = sessionCostState[0];
      var setSessionCost = sessionCostState[1];

      var tick = useState(0)[1];
      useEffect(function () {
        refreshBalance(true);
        var timer = setInterval(function () {
          refreshBalance(false);
          tick(function (x) { return x + 1; });
        }, refreshMsRef.current);
        return function () { clearInterval(timer); };
      }, [tick]);

      useEffect(function () {
        if (!sessionId) return;
        var cancelled = false;
        var fetchCost = function () {
          fetch(API_PATH + "?session=" + encodeURIComponent(sessionId), { cache: "no-store" })
            .then(function (r) { return r.json(); })
            .then(function (json) {
              if (cancelled) return;
              if (json && json.sessionCost && typeof json.sessionCost.cost === "number") setSessionCost(json.sessionCost);
              else setSessionCost(null);
            })
            .catch(function () { if (!cancelled) setSessionCost(null); });
        };
        fetchCost();
        var timer = setInterval(fetchCost, 10000);
        return function () { cancelled = true; clearInterval(timer); };
      }, [sessionId, setSessionCost]);

      var billedInput = usage ? billedInputTokens(usage) : 0;
      var cacheHit = (usage && billedInput > 0) ? cacheHitPercent(usage) : null;
      var peak = (balance.data && balance.data.meta) ? isPeak(balance.data.meta) : null;

      return {
        t: t,
        sessionId: sessionId,
        stats: stats,
        usage: usage || null,
        billedInput: billedInput,
        cacheHit: cacheHit,
        sessionCost: sessionCost,
        balance: balance,
        peak: peak,
        fmt: fmt,
        fmtMoney: fmtMoney,
        formatTokens: formatTokens,
        formatDuration: formatDuration,
        formatTokensPerSecond: formatTokensPerSecond,
        symbolOf: symbolOf,
        statusOf: statusOf,
        actions: {
          refreshBalance: refreshBalance,
          openRecharge: function () {
            var url = balance.data && balance.data.meta && balance.data.meta.rechargeUrl;
            if (url) window.open(url, "_blank", "noopener");
          },
        },
      };
    }

    // -----------------------------------------------------------------------
    // 6. module registry (each module owns its display logic)
    // -----------------------------------------------------------------------
    var STAT_MODULES = [
      {
        id: "counts",
        labelKey: "moduleCounts",
        order: 10,
        enabled: function (ctx) { return ctx.stats.steps > 0; },
        render: function (ctx) {
          return h("span", null, ctx.t("statsCounts", { turns: ctx.stats.turns, steps: ctx.stats.steps }));
        },
      },
      {
        id: "duration",
        labelKey: "moduleDuration",
        order: 60,
        enabled: function (ctx) { return ctx.stats.llmMs > 0 || ctx.stats.toolMs > 0; },
        render: function (ctx) {
          var parts = [];
          if (ctx.stats.llmMs > 0) parts.push("LLM " + ctx.formatDuration(ctx.stats.llmMs));
          if (ctx.stats.toolMs > 0) parts.push(ctx.t("toolCall") + " " + ctx.formatDuration(ctx.stats.toolMs));
          if (parts.length === 0) return null;
          return h("span", null, parts.join(" · "));
        },
      },
      {
        id: "speed",
        labelKey: "moduleSpeed",
        order: 70,
        enabled: function (ctx) { return ctx.stats.ttftSteps > 0 || ctx.stats.decodeMs > 0; },
        render: function (ctx) {
          var parts = [];
          if (ctx.stats.ttftSteps > 0) parts.push(ctx.t("ttftAvg") + " " + ctx.formatDuration(ctx.stats.ttftMs / ctx.stats.ttftSteps));
          if (ctx.stats.decodeMs > 0) parts.push(ctx.formatTokensPerSecond(ctx.stats.decodeTokens / (ctx.stats.decodeMs / 1e3)) + " tok/s");
          if (parts.length === 0) return null;
          return h("span", null, parts.join(" · "));
        },
      },
      {
        id: "cacheHit",
        labelKey: "moduleCacheHit",
        order: 20,
        enabled: function (ctx) { return ctx.cacheHit !== null; },
        render: function (ctx) {
          return h("span", null, ctx.t("statsCacheHit", { percent: ctx.cacheHit }));
        },
      },
      {
        id: "tokens",
        labelKey: "moduleTokens",
        order: 30,
        enabled: function (ctx) { return ctx.usage !== null && ctx.billedInput > 0; },
        render: function (ctx) {
          return h("span", null, ctx.t("statsTokens", {
            input: ctx.formatTokens(ctx.billedInput),
            output: ctx.formatTokens(ctx.usage.outputTokens),
          }));
        },
      },
      {
        id: "wallet",
        labelKey: "moduleWallet",
        order: 40,
        enabled: function (ctx) {
          return ctx.balance.phase === "ready" && ctx.balance.data && ctx.balance.data.total !== null;
        },
        clickable: true,
        onClick: function (ctx) { ctx.actions.openRecharge(); },
        tooltip: function (ctx) { return walletTooltip(ctx); },
        render: function (ctx) {
          var d = ctx.balance.data;
          var st = ctx.statusOf(d.total, d.meta || {});
          var color = st === "danger" ? "var(--dsw-alias-state-error-primary)"
            : st === "warn" ? "var(--dsw-alias-state-warn-primary)"
            : "inherit";
          var sym = ctx.symbolOf(d.currency);
          var cost = (ctx.sessionCost !== null && typeof ctx.sessionCost.cost === "number") ? ctx.sessionCost.cost : 0;
          var inner = [];
          inner.push(h("span", { style: { color: "inherit" } },
            ctx.t("spent", { amount: sym + ctx.fmtMoney(cost) })));
          inner.push(h("span", { style: { margin: "0 4px", opacity: 0.5 } }, "·"));
          inner.push(h("span", { style: { color: color, fontWeight: 500 } },
            ctx.t("balance", { amount: sym + ctx.fmt(d.total) })));
          return h("span", null, inner);
        },
      },
      {
        id: "peakIdle",
        labelKey: "modulePeakIdle",
        order: 50,
        enabled: function (ctx) { return ctx.peak !== null; },
        render: function (ctx) {
          var peak = ctx.peak;
          return h("span", {
            style: { color: peak ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-state-success-primary)" },
            title: ctx.t("peak") + "/" + ctx.t("idle"),
          }, peak ? ctx.t("peak") : ctx.t("idle"));
        },
      },
    ];

    function walletTooltip(ctx) {
      var d = ctx.balance.data;
      var lines = [];
      if (d.fetchedAt) lines.push(ctx.t("updatedAt").replace("{time}", new Date(d.fetchedAt).toLocaleTimeString()));
      lines.push(ctx.t("clickRechargeHint"));
      return lines.join("\n");
    }

    // -----------------------------------------------------------------------
    // 7. settings popup
    // -----------------------------------------------------------------------
    function SettingsPanel(props) {
      var ctx = props.ctx;
      var cfg = props.cfg;
      var onClose = props.onClose;
      var modules = getAllModules().slice().sort(function (a, b) { return moduleOrder(cfg, a) - moduleOrder(cfg, b); });
      var dragState = useState(null); // { id, index, startY, deltaY, step }
      var drag = dragState[0];
      var setDrag = dragState[1];
      // Ref mirror of the drag state so handlers always read the LATEST
      // drag (no stale-closure races) and can be cleared instantly.
      var dragRef = React.useRef(null);

      function measureStep(panel) {
        var rows = (panel || document).querySelectorAll(".dsh-lb-settings-row");
        if (rows.length > 1) {
          var step = rows[1].offsetTop - rows[0].offsetTop;
          if (step > 0) return step;
        }
        return 32;
      }
      function cleanupDragListeners() {
        document.removeEventListener("pointermove", onDocPointerMove);
        document.removeEventListener("pointerup", onDocPointerUp);
        document.removeEventListener("pointercancel", onDocPointerCancel);
        document.removeEventListener("mousemove", onDocMouseMove);
        document.removeEventListener("mouseup", onDocMouseUp);
      }
      function onDocPointerMove(e) { handleMove(e); }
      function onDocPointerUp() { cleanupDragListeners(); commitDrag(); }
      function onDocPointerCancel() { cleanupDragListeners(); cancelDrag(); }
      function onDocMouseMove(e) { handleMove(e); }
      function onDocMouseUp() { cleanupDragListeners(); commitDrag(); }
      // Order is committed LIVE during move (each swap writes moduleConfig),
      // so releasing only clears the visual drag state — nothing to commit.
      function commitDrag() {
        if (dragRef.current === null) return;
        dragRef.current = null;
        setDrag(null);
      }
      function cancelDrag() {
        if (dragRef.current === null) return;
        dragRef.current = null;
        cleanupDragListeners();
        setDrag(null);
      }
      // Window blur fallback: release outside the browser window.
      useEffect(function () {
        if (drag === null) return;
        var onBlur = function () { cancelDrag(); };
        window.addEventListener("blur", onBlur);
        return function () { window.removeEventListener("blur", onBlur); };
      }, [drag]);

      function handleDown(m, e) {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        var panel = (e.currentTarget && typeof e.currentTarget.closest === "function")
          ? e.currentTarget.closest(".dsh-lb-settings") : null;
        var index = modules.findIndex(function (x) { return x.id === m.id; });
        var next = { id: m.id, index: index, startY: e.clientY, deltaY: 0, step: measureStep(panel) };
        dragRef.current = next;
        setDrag(next);
        // Document-level listeners catch every move/release — no dependency
        // on pointer capture or effect timing.
        document.addEventListener("pointermove", onDocPointerMove);
        document.addEventListener("pointerup", onDocPointerUp);
        document.addEventListener("pointercancel", onDocPointerCancel);
        document.addEventListener("mousemove", onDocMouseMove);
        document.addEventListener("mouseup", onDocMouseUp);
      }
      function handleMove(e) {
        var d = dragRef.current;
        if (d === null) return;
        var deltaY = e.clientY - d.startY;
        // Constrain the dragged row to the settings list: never above the
        // first slot or below the last one (pointer may leave, the row stays).
        var minDelta = -(d.index) * d.step;
        var maxDelta = (modules.length - 1 - d.index) * d.step;
        deltaY = Math.max(minDelta, Math.min(maxDelta, deltaY));
        // Live commit: once the pointer crosses half a row, swap with the
        // neighbor and re-anchor so the dragged row stays under the cursor.
        while (deltaY > d.step / 2 && d.index < modules.length - 1) {
          moveModuleToIndex(d.id, d.index + 1);
          d.index += 1;
          d.startY += d.step;
          deltaY -= d.step;
        }
        while (deltaY < -d.step / 2 && d.index > 0) {
          moveModuleToIndex(d.id, d.index - 1);
          d.index -= 1;
          d.startY -= d.step;
          deltaY += d.step;
        }
        if (deltaY !== d.deltaY) {
          var next = Object.assign({}, d, { deltaY: deltaY });
          dragRef.current = next;
          setDrag(next);
        }
      }
      return h("div", { className: "dsh-lb-settings" },
        h("div", { className: "dsh-lb-settings-head" },
          h("span", { className: "dsh-lb-settings-title" }, ctx.t("settings")),
          h("button", { className: "dsh-lb-settings-close", title: ctx.t("close"), onClick: onClose }, "✕")
        ),
        modules.map(function (m, i) {
          var rowCls = "dsh-lb-settings-row";
          var rowStyle = null;
          if (drag !== null && drag.id === m.id) {
            rowCls += " dsh-lb-settings-row--dragging";
            rowStyle = { transform: "translateY(" + drag.deltaY + "px)" };
          }
          return h("div", { className: rowCls, key: m.id, style: rowStyle },
            h("input", {
              type: "checkbox",
              checked: moduleEnabled(cfg, m),
              onChange: function (e) { setModuleEnabled(m.id, e.target.checked); },
            }),
            h("span", { className: "dsh-lb-settings-name" }, moduleName(ctx, m)),
            h("span", {
              className: "dsh-lb-settings-drag",
              title: ctx.t("drag"),
              onPointerDown: function (e) { handleDown(m, e); },
            }, "⠿"),
            h("button", {
              className: "dsh-lb-settings-btn",
              title: ctx.t("moveUp"),
              onClick: function () { moveModule(m.id, -1); },
            }, "▲"),
            h("button", {
              className: "dsh-lb-settings-btn",
              title: ctx.t("moveDown"),
              onClick: function () { moveModule(m.id, 1); },
            }, "▼")
          );
        })
      );
    }

    /** Wrap a module's output with click + tooltip when the module declares them. */
    function wrapClickable(ctx, m, seg) {
      if (!m.clickable || !m.onClick) return seg;
      return h("span", {
        style: m.style || { cursor: "pointer" },
        title: m.tooltip ? m.tooltip(ctx) : null,
        onClick: function () { m.onClick(ctx); },
      }, seg);
    }

    // -----------------------------------------------------------------------
    // 8. orchestrator
    // -----------------------------------------------------------------------
    function StatsLine(props) {
      var ctx = useStatsContext(props);
      var cfg = useModuleConfig();
      var openState = useState(false);
      var open = openState[0];
      var setOpen = openState[1];

      var visible = getAllModules()
        .filter(function (m) { return m.enabled(ctx) && moduleEnabled(cfg, m); })
        .sort(function (a, b) { return moduleOrder(cfg, a) - moduleOrder(cfg, b); });

      var children = [];
      var pushSegment = function (seg) {
        if (children.length > 0) {
          children.push(h("span", { className: "dsh-lb-stats-sep", "aria-hidden": true }, "|"), " ");
        }
        children.push(seg);
      };
      for (var i = 0; i < visible.length; i++) {
        var mod = visible[i];
        var seg = mod.render(ctx);
        if (seg === null || seg === undefined) continue;
        pushSegment(wrapClickable(ctx, mod, seg));
      }
      pushSegment(h("span", {
        className: "dsh-lb-gear",
        title: ctx.t("settings"),
        onClick: function () { setOpen(!open); },
      }, "⚙"));

      if (open) {
        children.push(h("div", {
          className: "dsh-lb-settings-backdrop",
          onClick: function () { setOpen(false); },
        }));
        children.push(h(SettingsPanel, { ctx: ctx, cfg: cfg, onClose: function () { setOpen(false); } }));
      }
      return h("div", { className: "dsh-lb-stats" }, children);
    }

    // -----------------------------------------------------------------------
    // 9. styles
    // -----------------------------------------------------------------------
    var STYLE_CSS = [
      ".dsh-lb-stats{position:relative;display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.4;font-variant-numeric:tabular-nums;padding:2px 0 6px;user-select:none;}",
      ".dsh-lb-stats-sep{opacity:.45;margin:0 1px;}",
      ".dsh-lb-gear{cursor:pointer;opacity:.55;font-size:11px;line-height:1;padding:1px 3px;border-radius:4px;}",
      ".dsh-lb-gear:hover{opacity:1;background:var(--dsw-alias-bg-layer-2);}",
      ".dsh-lb-settings-backdrop{position:fixed;inset:0;z-index:998;}",
      ".dsh-lb-settings{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:999;min-width:260px;max-width:90vw;max-height:70vh;overflow:auto;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.28);padding:10px;font-size:12px;}",
      ".dsh-lb-settings-head{display:flex;align-items:center;justify-content:space-between;margin:2px 4px 6px;color:var(--dsw-alias-label-primary);}",
      ".dsh-lb-settings-title{font-weight:600;}",
      ".dsh-lb-settings-close{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:14px;line-height:1;padding:2px 6px;border-radius:6px;}",
      ".dsh-lb-settings-close:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);}",
      ".dsh-lb-settings-row{display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:6px;height:32px;box-sizing:border-box;margin:2px 0;transition:transform 120ms ease;}",
      ".dsh-lb-settings-row:hover{background:var(--dsw-alias-bg-layer-1);}",
      ".dsh-lb-settings-row--dragging{position:relative;z-index:10;transition:none;opacity:.9;box-shadow:0 4px 12px rgba(0,0,0,.25);}",
      ".dsh-lb-settings-name{flex:1;color:var(--dsw-alias-label-secondary);}",
      ".dsh-lb-settings-btn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:10px;padding:2px 4px;border-radius:4px;}",
      ".dsh-lb-settings-btn:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);}",
      ".dsh-lb-settings-drag{cursor:grab;color:inherit;opacity:.55;font-size:12px;line-height:1;padding:0 4px;user-select:none;touch-action:none;}",
      ".dsh-lb-settings-drag:hover{opacity:1;}",
      ".dsh-lb-settings-drag:active{cursor:grabbing;}",
      ".dsh-lb-settings-row--dragging{opacity:.5;}",
    ].join("");

    // -----------------------------------------------------------------------
    // 10. plugin definition
    // -----------------------------------------------------------------------
    var name = "dsh-lite-balance";
    var inject = ["slots", "locale"];

    function apply(ctx) {
      ctx.locale.register(NS, "zh", zh);
      ctx.locale.register(NS, "en", en);
      var t = ctx.locale.bind(NS);

      ctx.slots.inject("conversation.composer.dock", function () {
        return ctx.slots.register(
          {
            name: "conversation.composer.dock",
            id: "stats",
            priority: -1,
            order: 0,
            label: function () { return t("label"); },
            locale: NS,
            inject: function () { return { t: ctx.locale.bind(NS) }; },
          },
          StatsLine
        );
      });

      ctx.effect(function () {
        var tag = document.createElement("style");
        tag.textContent = STYLE_CSS;
        document.head.appendChild(tag);
        return function () { tag.remove(); };
      }, "dsh-lite-balance: styles");
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    // Public extension API (also exposed on window for cross-plugin use).
    exports.registerModule = registerModule;
    exports.getModules = getAllModules;
    exports._test = { deriveCounts, deriveStats, formatTokens, formatDuration, formatTokensPerSecond, cacheHitPercent, fmtMoney, isPeak, statusOf, fmt, symbolOf, moduleEnabled, moduleOrder };
    if (typeof window !== "undefined") {
      try {
        window.__DSH_LITE_BALANCE__ = {
          registerModule: registerModule,
          getModules: getAllModules,
        };
      } catch (err) { /* non-browser environment */ }
    }
    return module.exports;
  }
});
