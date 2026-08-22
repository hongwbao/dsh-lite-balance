/**
 * dsh-lite-balance client half (bundled for the dsh ModuleLoader).
 *
 * Two surfaces, one shared balance store:
 *   1. conversation.composer.dock (id "stats") — replaces the built-in stats
 *      line with: turns · steps | cache hit | session tokens | balance
 *      (status colored) | peak/idle indicator (Beijing time)
 *   2. shell.overlay — low-balance toast
 * Talks to the host route /dsh-lite-balance/balance only; the API key never
 * reaches the browser.
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
    var useRef = React.useRef;

    var NS = "dsh-lite-balance";
    var API_PATH = "/dsh-lite-balance/balance";
    var DEFAULT_REFRESH_MS = 60000;

    // ---------- locale dictionaries (zh / en) ----------
    var zh = {
      label: "余额",
      loading: "加载中…",
      refresh: "刷新",
      recharge: "充值",
      title: "DeepSeek 账户余额：",
      granted: "赠金",
      toppedUp: "充值",
      updatedAt: "更新于 {time}",
      clickRechargeHint: "点击打开充值页 · 双击强制刷新",
      retryHint: "点击重试",
      missingKey: "未配置 DEEPSEEK_API_KEY（在 host 环境变量或 ~/.dsh/.credentials.yaml 中设置）",
      fetchFailed: "余额获取失败",
      lowBalance: "余额不足 {threshold}",
      toastTitle: "余额不足",
      toastBody: "当前余额 {amount}，请及时充值",
      toastRecharge: "去充值",
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
      loading: "Loading…",
      refresh: "Refresh",
      recharge: "Top up",
      title: "DeepSeek account balance: ",
      granted: "Granted",
      toppedUp: "Topped up",
      updatedAt: "Updated {time}",
      clickRechargeHint: "Click to top up · double-click to refresh",
      retryHint: "Click to retry",
      missingKey: "DEEPSEEK_API_KEY not configured (set it in ~/.dsh/.credentials.yaml or host env)",
      fetchFailed: "Failed to fetch balance",
      lowBalance: "Low balance: under {threshold}",
      toastTitle: "Low balance",
      toastBody: "Current balance {amount} — please top up soon",
      toastRecharge: "Top up now",
      statsCounts: "{turns} turns · {steps} steps",
      statsCacheHit: "Cache hit {percent}%",
      statsTokens: "In {input} tok · Out {output} tok",
      spent: "Spent {amount}",
      balance: "Balance {amount}",
      peak: "Peak",
      idle: "Off-peak",
    };

    // ---------- tiny shared store (stats line / toast stay in sync) ----------
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

    // ---------- fetch (module-level so every surface shares one flight) ----------
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

    // ---------- formatting helpers ----------
    function symbolOf(currency) {
      if (currency === "CNY") return "¥";
      if (currency === "USD") return "$";
      return currency ? currency + " " : "";
    }
    function fmt(n) {
      if (n === null || n === undefined || !Number.isFinite(n)) return "—";
      return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    /** > warnThreshold 默认色；[criticalThreshold, warnThreshold] 警告色；< criticalThreshold 危险色。 */
    function statusOf(total, meta) {
      var warn = (meta && meta.warnThreshold != null) ? meta.warnThreshold : 10;
      var crit = (meta && meta.criticalThreshold != null) ? meta.criticalThreshold : 3;
      if (total === null || total === undefined) return "error";
      if (total < crit) return "danger";
      if (total <= warn) return "warn";
      return "ok";
    }
    function tooltipOf(t, state) {
      if (state.phase === "error") {
        var text = state.code === "missing-api-key" ? t("missingKey")
          : state.code === "fetch-failed" ? t("fetchFailed")
          : (state.error || t("fetchFailed"));
        return text + " · " + t("retryHint");
      }
      if (!state.data) return t("loading");
      var d = state.data;
      var sym = symbolOf(d.currency);
      var lines = [t("title") + sym + fmt(d.total)];
      if (d.granted !== null || d.toppedUp !== null) {
        lines.push(t("granted") + " " + sym + fmt(d.granted) + " · " + t("toppedUp") + " " + sym + fmt(d.toppedUp));
      }
      if (d.fetchedAt) lines.push(t("updatedAt").replace("{time}", new Date(d.fetchedAt).toLocaleTimeString()));
      lines.push(t("clickRechargeHint"));
      return lines.join("\n");
    }

    // ---------- stats-line helpers (turns / steps / tokens / cache / peak) ----------
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
    /** Money formatting: 2 decimals at/above ¥1, up to 4 below (trim trailing zeros). */
    function fmtMoney(n) {
      if (n === null || n === undefined || !isFinite(n)) return "—";
      if (n >= 1) return n.toFixed(2);
      if (n <= 0) return "0.00";
      var s = n.toFixed(4).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
      if (s.indexOf(".") === -1) return s + ".00";
      if (s.indexOf(".") !== -1 && s.length - s.indexOf(".") - 1 < 2) s = s.toFixed(2);
      return s;
    }
    /** Round a cache-read ratio to an integer percentage, with positive ties rounded up. */
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
    /** Display-ready cache-hit share of prompt-side input over the whole durable log. */
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
    /** True while Beijing time falls inside any configured peak window. */
    function isPeak(meta, date) {
      var windows = (meta && Array.isArray(meta.peakWindows) && meta.peakWindows.length > 0)
        ? meta.peakWindows
        : [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }];
      var now = beijingMinutes(date || new Date());
      for (var i = 0; i < windows.length; i++) {
        var start = parseHHMM(windows[i] && windows[i].start);
        var end = parseHHMM(windows[i] && windows[i].end);
        if (start === null || end === null) continue;
        if (start <= end) { if (now >= start && now < end) return true; }
        else { if (now >= start || now < end) return true; } // window crosses midnight
      }
      return false;
    }

    // ---------- shared styles (theme tokens from the host app) ----------
    var STYLE_CSS = [
      ".dsh-lb-stats{display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.4;font-variant-numeric:tabular-nums;padding:2px 0 6px;user-select:none;}",
      ".dsh-lb-stats-sep{opacity:.45;margin:0 1px;}",
      ".dsh-lb-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 8px 24px rgba(0,0,0,.18);font-size:12px;pointer-events:auto;}",
      ".dsh-lb-toast-btn{border:0;border-radius:6px;padding:5px 12px;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-base);cursor:pointer;font-size:12px;font-weight:600;}",
    ].join("");

    // ---------- StatsLine (replaces the built-in composer-dock stats) ----------
    function StatsLine(props) {
      var sessionId = props.sessionId;
      var useSession = props.useSession;
      var useProjection = props.useProjection;
      var t = props.t;
      var state = useStore();
      var nodes = useSession(function (s) { return s.chat.legacy.nodes; });
      var usage = useProjection("tokenUsage");
      var counts = React.useMemo(function () { return deriveCounts(nodes || []); }, [nodes]);
      var sessionCostState = useState(null); // { cost, priced } | null
      var sessionCost = sessionCostState[0];
      var setSessionCost = sessionCostState[1];

      // auto-refresh balance + keep the peak/idle indicator fresh across time boundaries
      var tick = useState(0)[1];
      useEffect(function () {
        refreshBalance(true);
        var timer = setInterval(function () {
          refreshBalance(false);
          tick(function (x) { return x + 1; });
        }, refreshMsRef.current);
        return function () { clearInterval(timer); };
      }, [tick]);

      // per-session spend comes from the HOST (priced per request at arrival
      // time). Poll it so live generation and peak/off-peak switches show up.
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

      var groups = [];
      if (counts.steps > 0) {
        groups.push(t("statsCounts", { turns: counts.turns, steps: counts.steps }));
      }
      if (usage && billedInputTokens(usage) > 0) {
        var cacheHit = cacheHitPercent(usage);
        if (cacheHit !== null) groups.push(t("statsCacheHit", { percent: cacheHit }));
        groups.push(t("statsTokens", {
          input: formatTokens(billedInputTokens(usage)),
          output: formatTokens(usage.outputTokens),
        }));
      }

      var balanceSeg = null;
      if (state.phase === "ready" && state.data && state.data.total !== null) {
        var d = state.data;
        var st = statusOf(d.total, d.meta || {});
        var color = st === "danger" ? "var(--dsw-alias-state-error-primary)"
          : st === "warn" ? "var(--dsw-alias-state-warn-primary)"
          : "inherit";
        var sym = symbolOf(d.currency);
        var cost = (sessionCost !== null && typeof sessionCost.cost === "number") ? sessionCost.cost : null;
        var inner = [];
        if (cost !== null) {
          inner.push(h("span", { style: { color: "inherit" } },
            t("spent", { amount: sym + fmtMoney(cost) })));
          inner.push(h("span", { style: { margin: "0 4px", opacity: 0.5 } }, "·"));
        }
        inner.push(h("span", { style: { color: color, fontWeight: 500 } },
          t("balance", { amount: sym + fmt(d.total) })));
        balanceSeg = h("span", {
          style: { cursor: "pointer" },
          title: tooltipOf(t, state),
          onClick: function (e) {
            if (e.detail >= 2) { refreshBalance(true); return; }
            var url = d.meta && d.meta.rechargeUrl;
            if (url) window.open(url, "_blank", "noopener");
          },
        }, inner);
      }

      var peakSeg = null;
      if (state.data && state.data.meta) {
        var peak = isPeak(state.data.meta);
        peakSeg = h("span", {
          style: { color: peak ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-state-success-primary)" },
          title: t("peak") + "/" + t("idle"),
        }, peak ? t("peak") : t("idle"));
      }

      if (groups.length === 0 && !balanceSeg && !peakSeg) return null;

      var children = [];
      var pushGroup = function (seg) {
        if (children.length > 0) {
          children.push(h("span", { className: "dsh-lb-stats-sep", "aria-hidden": true }, "|"), " ");
        }
        children.push(seg);
      };
      for (var i = 0; i < groups.length; i++) pushGroup(h("span", null, groups[i]));
      if (balanceSeg) pushGroup(balanceSeg);
      if (peakSeg) pushGroup(peakSeg);
      return h("div", { className: "dsh-lb-stats" }, children);
    }

    // ---------- LowBalanceToast (frame overlay, danger crossing only) ----------
    function LowBalanceToast(props) {
      var t = props.t;
      var state = useStore();
      var prevDanger = useRef(false);
      var visibleState = useState(false);
      var visible = visibleState[0];
      var setVisible = visibleState[1];
      var timerRef = useRef(null);

      var danger = state.phase === "ready" && state.data &&
        statusOf(state.data.total, state.data.meta || {}) === "danger";

      useEffect(function () {
        if (danger && !prevDanger.current) {
          setVisible(true);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(function () { setVisible(false); }, 8000);
        }
        prevDanger.current = danger;
        return function () { clearTimeout(timerRef.current); };
      }, [danger, setVisible]);

      if (!visible || !state.data) return null;
      var d = state.data;
      var sym = symbolOf(d.currency);
      var openRecharge = function () {
        var url = d.meta && d.meta.rechargeUrl;
        if (url) window.open(url, "_blank", "noopener");
      };
      return h("div", { className: "dsh-lb-toast", role: "alert" },
        h("div", null,
          h("div", { style: { fontWeight: 600, color: "var(--dsw-alias-state-error-primary)" } }, t("toastTitle")),
          h("div", { style: { marginTop: 3 } },
            t("toastBody").replace("{amount}", sym + fmt(d.total)))
        ),
        h("button", { className: "dsh-lb-toast-btn", onClick: openRecharge }, t("toastRecharge"))
      );
    }

    // ---------- plugin definition ----------
    var name = "dsh-lite-balance";
    var inject = ["slots", "locale"];

    function apply(ctx) {
      ctx.locale.register(NS, "zh", zh);
      ctx.locale.register(NS, "en", en);
      var t = ctx.locale.bind(NS);

      // id "stats" is the shipped StatsLine cell. Same-id entries may coexist
      // at DIFFERENT priorities, and the slot registry renders the LOWEST
      // priority one (entriesOfSlot dedupes by id after ascending sort) — so
      // priority -1 shadows the built-in (which sits at the default 0).
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

      ctx.slots.inject("shell.overlay", function () {
        return ctx.slots.register(
          {
            name: "shell.overlay",
            id: "dsh-lite-balance-toast",
            order: 100,
            locale: NS,
            inject: function () { return { t: ctx.locale.bind(NS) }; },
          },
          LowBalanceToast
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
