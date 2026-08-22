/**
 * dsh-lite-balance client half (bundled for the dsh ModuleLoader).
 *
 * Modular stats line: one shared data context feeds a fixed registry of
 * self-contained display modules; a thin orchestrator filters, orders and
 * joins them. Each module owns its own visibility, rendering, click and
 * tooltip behavior.
 *
 *   context (useStatsContext)  ->  modules (STAT_MODULES)  ->  orchestrator
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

    // -----------------------------------------------------------------------
    // 1. locale dictionaries
    // -----------------------------------------------------------------------
    var zh = {
      label: "余额",
      updatedAt: "更新于 {time}",
      clickRechargeHint: "点击打开充值页",
      statsCounts: "{turns} 轮 · {steps} 步",
      statsCacheHit: "缓存命中 {percent}%",
      statsTokens: "输入 {input} tok · 输出 {output} tok",
      spent: "消耗 {amount}",
      balance: "余额 {amount}",
      peak: "高峰",
      idle: "空闲",
    };
    var en = {
      label: "Balance",
      updatedAt: "Updated {time}",
      clickRechargeHint: "Click to top up",
      statsCounts: "{turns} turns · {steps} steps",
      statsCacheHit: "Cache hit {percent}%",
      statsTokens: "In {input} tok · Out {output} tok",
      spent: "Spent {amount}",
      balance: "Balance {amount}",
      peak: "Peak",
      idle: "Off-peak",
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
    function deriveCounts(nodes) {
      var turns = new Set();
      var steps = 0;
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (!node || node.kind !== "assistant") continue;
        turns.add(node.turn);
        steps += 1;
      }
      return { turns: turns.size, steps: steps };
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
      if (bjDow === 0 || bjDow === 6) return false; // weekend: idle all day
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
    // 4. shared data context
    // -----------------------------------------------------------------------
    function useStatsContext(props) {
      var sessionId = props.sessionId;
      var useSession = props.useSession;
      var useProjection = props.useProjection;
      var t = props.t;
      var balance = useStore();
      var nodes = useSession(function (s) { return s.chat.legacy.nodes; });
      var usage = useProjection("tokenUsage");
      var counts = React.useMemo(function () { return deriveCounts(nodes || []); }, [nodes]);
      var sessionCostState = useState(null);
      var sessionCost = sessionCostState[0];
      var setSessionCost = sessionCostState[1];

      // auto-refresh balance + keep peak/idle fresh across time boundaries
      var tick = useState(0)[1];
      useEffect(function () {
        refreshBalance(true);
        var timer = setInterval(function () {
          refreshBalance(false);
          tick(function (x) { return x + 1; });
        }, refreshMsRef.current);
        return function () { clearInterval(timer); };
      }, [tick]);

      // per-session spend comes from the HOST (priced per request at arrival).
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
        counts: counts,
        usage: usage || null,
        billedInput: billedInput,
        cacheHit: cacheHit,
        sessionCost: sessionCost,
        balance: balance,
        peak: peak,
        // tools + actions available to every module
        fmt: fmt,
        fmtMoney: fmtMoney,
        formatTokens: formatTokens,
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
    // 5. module registry (each module owns its display logic)
    // -----------------------------------------------------------------------
    var STAT_MODULES = [
      {
        id: "counts",
        order: 10,
        enabled: function (ctx) { return ctx.counts.steps > 0; },
        render: function (ctx) {
          return h("span", null, ctx.t("statsCounts", { turns: ctx.counts.turns, steps: ctx.counts.steps }));
        },
      },
      {
        id: "cacheHit",
        order: 20,
        enabled: function (ctx) { return ctx.cacheHit !== null; },
        render: function (ctx) {
          return h("span", null, ctx.t("statsCacheHit", { percent: ctx.cacheHit }));
        },
      },
      {
        id: "tokens",
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
        order: 40,
        enabled: function (ctx) {
          return ctx.balance.phase === "ready" && ctx.balance.data && ctx.balance.data.total !== null;
        },
        render: function (ctx) {
          var d = ctx.balance.data;
          var st = ctx.statusOf(d.total, d.meta || {});
          var color = st === "danger" ? "var(--dsw-alias-state-error-primary)"
            : st === "warn" ? "var(--dsw-alias-state-warn-primary)"
            : "inherit";
          var sym = ctx.symbolOf(d.currency);
          // Spend is always shown (¥0.00 until the host reports usage).
          var cost = (ctx.sessionCost !== null && typeof ctx.sessionCost.cost === "number") ? ctx.sessionCost.cost : 0;
          var inner = [];
          inner.push(h("span", { style: { color: "inherit" } },
            ctx.t("spent", { amount: sym + ctx.fmtMoney(cost) })));
          inner.push(h("span", { style: { margin: "0 4px", opacity: 0.5 } }, "·"));
          inner.push(h("span", { style: { color: color, fontWeight: 500 } },
            ctx.t("balance", { amount: sym + ctx.fmt(d.total) })));
          return h("span", {
            style: { cursor: "pointer" },
            title: walletTooltip(ctx),
            onClick: function () { ctx.actions.openRecharge(); },
          }, inner);
        },
      },
      {
        id: "peakIdle",
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

    // wallet's own tooltip: updated-at + click-to-top-up
    function walletTooltip(ctx) {
      var d = ctx.balance.data;
      var lines = [];
      if (d.fetchedAt) lines.push(ctx.t("updatedAt").replace("{time}", new Date(d.fetchedAt).toLocaleTimeString()));
      lines.push(ctx.t("clickRechargeHint"));
      return lines.join("\n");
    }

    // -----------------------------------------------------------------------
    // 6. orchestrator
    // -----------------------------------------------------------------------
    function StatsLine(props) {
      var ctx = useStatsContext(props);
      var visible = STAT_MODULES
        .filter(function (m) { return m.enabled(ctx); })
        .sort(function (a, b) { return a.order - b.order; });
      if (visible.length === 0) return null;

      var children = [];
      for (var i = 0; i < visible.length; i++) {
        var seg = visible[i].render(ctx);
        if (seg === null || seg === undefined) continue;
        if (children.length > 0) {
          children.push(h("span", { className: "dsh-lb-stats-sep", "aria-hidden": true }, "|"), " ");
        }
        children.push(seg);
      }
      if (children.length === 0) return null;
      return h("div", { className: "dsh-lb-stats" }, children);
    }

    // -----------------------------------------------------------------------
    // 7. styles
    // -----------------------------------------------------------------------
    var STYLE_CSS = [
      ".dsh-lb-stats{display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.4;font-variant-numeric:tabular-nums;padding:2px 0 6px;user-select:none;}",
      ".dsh-lb-stats-sep{opacity:.45;margin:0 1px;}",
    ].join("");

    // -----------------------------------------------------------------------
    // 8. plugin definition
    // -----------------------------------------------------------------------
    var name = "dsh-lite-balance";
    var inject = ["slots", "locale"];

    function apply(ctx) {
      ctx.locale.register(NS, "zh", zh);
      ctx.locale.register(NS, "en", en);
      var t = ctx.locale.bind(NS);

      // id "stats" is the shipped StatsLine cell; priority -1 shadows it
      // (lowest renders per the slot registry's entriesOfSlot dedupe).
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
    // internal helpers exposed for the smoke tests (no runtime consumers)
    exports._test = { deriveCounts, formatTokens, cacheHitPercent, fmtMoney, isPeak, statusOf, fmt, symbolOf };
    return module.exports;
  }
});
