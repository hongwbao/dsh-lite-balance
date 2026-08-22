/**
 * dsh-lite-balance client half (bundled for the dsh ModuleLoader).
 *
 * Three surfaces, one shared balance store:
 *   1. sidebar.footer.action — compact balance chip beside Settings
 *   2. conversation.composer.dock (id "stats") — replaces the built-in stats
 *      line with: turns · steps | session token usage | balance (status
 *      colored) | peak/off-peak indicator (Beijing time)
 *   3. shell.overlay — low-balance toast
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
      statsTokens: "输入 {input} tok · 输出 {output} tok",
      peak: "高峰",
      offPeak: "低谷",
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
      statsTokens: "In {input} tok · Out {output} tok",
      peak: "Peak",
      offPeak: "Off-peak",
    };

    // ---------- tiny shared store (chip / stats line / toast stay in sync) ----------
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
    function fmtShort(n) {
      if (n === null || n === undefined || !Number.isFinite(n)) return "—";
      var abs = Math.abs(n);
      var one = function (v) { return String(v).replace(/\.0$/, ""); };
      if (abs >= 1000000) return one((n / 1000000).toFixed(1)) + "M";
      if (abs >= 1000) return one((n / 1000).toFixed(1)) + "k";
      if (abs >= 100) return String(Math.round(n));
      if (abs >= 10) return one(n.toFixed(1));
      return n.toFixed(2);
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

    // ---------- stats-line helpers (turns / steps / tokens / peak) ----------
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
    function isOffPeak(meta, date) {
      var start = parseHHMM(meta && meta.offPeakStart);
      var end = parseHHMM(meta && meta.offPeakEnd);
      if (start === null || end === null) { start = 30; end = 510; } // 00:30–08:30 Beijing
      var now = beijingMinutes(date || new Date());
      if (start <= end) return now >= start && now < end;
      return now >= start || now < end; // window crosses midnight
    }

    // ---------- shared styles (theme tokens from the host app) ----------
    var STYLE_CSS = [
      ".dsh-lb-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;height:22px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:11px;line-height:1;font-variant-numeric:tabular-nums;cursor:pointer;user-select:none;white-space:nowrap;box-sizing:border-box;}",
      ".dsh-lb-chip:hover{border-color:var(--dsw-alias-border-l2);}",
      ".dsh-lb-chip--rail{height:24px;padding:0 6px;justify-content:center;gap:2px;}",
      ".dsh-lb-dot{width:6px;height:6px;border-radius:50%;flex:none;}",
      ".dsh-lb-ok .dsh-lb-dot{background:var(--dsw-alias-state-success-primary);}",
      ".dsh-lb-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary);}",
      ".dsh-lb-warn .dsh-lb-dot{background:var(--dsw-alias-state-warn-primary);}",
      ".dsh-lb-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}",
      ".dsh-lb-danger .dsh-lb-dot{background:var(--dsw-alias-state-error-primary);}",
      ".dsh-lb-danger.dsh-lb-pulse{animation:dshLbPulse 1.6s ease-in-out infinite;}",
      "@keyframes dshLbPulse{0%,100%{opacity:1}50%{opacity:.55}}",
      ".dsh-lb-refresh{border:0;background:transparent;color:inherit;opacity:.55;font-size:12px;line-height:1;padding:2px 3px;cursor:pointer;border-radius:4px;}",
      ".dsh-lb-refresh:hover{opacity:1;background:var(--dsw-alias-bg-layer-2);}",
      ".dsh-lb-stats{display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.4;font-variant-numeric:tabular-nums;padding:2px 0 6px;user-select:none;}",
      ".dsh-lb-stats-sep{opacity:.45;margin:0 1px;}",
      ".dsh-lb-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 8px 24px rgba(0,0,0,.18);font-size:12px;pointer-events:auto;}",
      ".dsh-lb-toast-btn{border:0;border-radius:6px;padding:5px 12px;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-base);cursor:pointer;font-size:12px;font-weight:600;}",
      "@media (prefers-reduced-motion:reduce){.dsh-lb-danger.dsh-lb-pulse{animation:none;}}",
    ].join("");

    // ---------- BalanceChip (sidebar footer) ----------
    function BalanceChip(props) {
      var wide = props.wide !== false;
      var t = props.t;
      var state = useStore();

      useEffect(function () {
        refreshBalance(true);
        var timer = setInterval(function () { refreshBalance(false); }, refreshMsRef.current);
        return function () { clearInterval(timer); };
      }, []);

      var phase = state.phase;
      var data = state.data;
      var status = "ok";
      var sym = "";
      var total = null;
      if (data) {
        status = statusOf(data.total, data.meta || {});
        sym = symbolOf(data.currency);
        total = data.total;
      } else if (phase === "error") {
        status = "error";
      }

      var title = tooltipOf(t, state);
      var cls = "dsh-lb-chip";
      if (!wide) cls += " dsh-lb-chip--rail";
      if (status === "warn") cls += " dsh-lb-warn";
      if (status === "danger") cls += " dsh-lb-danger dsh-lb-pulse";
      if (status === "ok" && phase === "ready") cls += " dsh-lb-ok";
      if (status === "error") cls += " dsh-lb-warn";

      var onClick = function (e) {
        if (e.detail >= 2) { refreshBalance(true); return; }
        if (phase === "error") { refreshBalance(true); return; }
        var url = data && data.meta && data.meta.rechargeUrl;
        if (url) window.open(url, "_blank", "noopener");
      };
      var onRefresh = function (e) {
        e.stopPropagation();
        refreshBalance(true);
      };

      var label;
      if (phase === "error") {
        label = h("span", null, "⚠");
      } else if (phase === "loading" && !data) {
        label = h("span", null, "…");
      } else if (wide) {
        label = h("span", null,
          h("span", { className: "dsh-lb-dot" }),
          h("span", { style: { marginLeft: 4 } }, sym + fmt(total))
        );
      } else {
        label = h("span", { style: { fontSize: 10 } }, fmtShort(total));
      }

      var children = [label];
      if (wide && phase !== "loading" && phase !== "error") {
        children.push(
          h("span", {
            className: "dsh-lb-refresh",
            role: "button",
            title: t("refresh"),
            onClick: onRefresh,
          }, "↻")
        );
      }

      return h("div", { className: cls, title: title, onClick: onClick }, children);
    }

    // ---------- StatsLine (replaces the built-in composer-dock stats) ----------
    function StatsLine(props) {
      var useSession = props.useSession;
      var useProjection = props.useProjection;
      var t = props.t;
      var state = useStore();
      var nodes = useSession(function (s) { return s.chat.legacy.nodes; });
      var usage = useProjection("tokenUsage");
      var counts = React.useMemo(function () { return deriveCounts(nodes || []); }, [nodes]);

      // keep the peak/off-peak indicator fresh across time boundaries
      var tick = useState(0)[1];
      useEffect(function () {
        var timer = setInterval(function () { tick(function (x) { return x + 1; }); }, 60000);
        return function () { clearInterval(timer); };
      }, [tick]);
      // make sure the shared balance store is warm even if the sidebar chip never mounted
      useEffect(function () {
        if (!store.data) refreshBalance(true);
      }, []);

      var groups = [];
      if (counts.steps > 0) {
        groups.push(t("statsCounts", { turns: counts.turns, steps: counts.steps }));
      }
      if (usage && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
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
        balanceSeg = h("span", {
          style: { color: color, cursor: "pointer" },
          title: tooltipOf(t, state),
          onClick: function (e) {
            if (e.detail >= 2) { refreshBalance(true); return; }
            var url = d.meta && d.meta.rechargeUrl;
            if (url) window.open(url, "_blank", "noopener");
          },
        }, symbolOf(d.currency) + fmt(d.total));
      }

      var peakSeg = null;
      if (state.data && state.data.meta) {
        var off = isOffPeak(state.data.meta);
        peakSeg = h("span", {
          style: { color: off ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)" },
          title: t("peak") + "/" + t("offPeak"),
        }, off ? t("offPeak") : t("peak"));
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

      ctx.slots.inject("sidebar.footer.action", function () {
        return ctx.slots.register(
          {
            name: "sidebar.footer.action",
            id: "dsh-lite-balance",
            order: -10,
            label: function () { return t("label"); },
            locale: NS,
            inject: function () { return { t: ctx.locale.bind(NS) }; },
          },
          BalanceChip
        );
      });

      // id "stats" is the shipped StatsLine cell — reusing it REPLACES the
      // built-in stats line (replaceRisk: none per the slot contract).
      ctx.slots.inject("conversation.composer.dock", function () {
        return ctx.slots.register(
          {
            name: "conversation.composer.dock",
            id: "stats",
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
    exports._test = { deriveCounts, formatTokens, isOffPeak, statusOf, fmt, fmtShort, symbolOf };
    return module.exports;
  }
});
