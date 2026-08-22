/**
 * dsh-lite-balance client half (bundled for the dsh ModuleLoader).
 *
 * Renders a compact balance chip beside Settings in the sidebar footer and a
 * low-balance toast in the frame overlay. Talks to the host route
 * /dsh-lite-balance/balance only; the API key never reaches the browser.
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
    var useCallback = React.useCallback;

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
    };

    // ---------- tiny shared store (chip and toast stay in sync) ----------
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

    // ---------- fetch ----------
    function getBalance(force) {
      return fetch(API_PATH + (force ? "?refresh=1" : ""), { cache: "no-store" })
        .then(function (r) { return r.json(); });
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
    function statusOf(total, meta) {
      var warn = (meta && meta.warnThreshold != null) ? meta.warnThreshold : 10;
      var crit = (meta && meta.criticalThreshold != null) ? meta.criticalThreshold : 3;
      if (total === null || total === undefined) return "error";
      if (total < crit) return "danger";
      if (total < warn) return "warn";
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
      ".dsh-lb-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 8px 24px rgba(0,0,0,.18);font-size:12px;pointer-events:auto;}",
      ".dsh-lb-toast-btn{border:0;border-radius:6px;padding:5px 12px;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-base);cursor:pointer;font-size:12px;font-weight:600;}",
      "@media (prefers-reduced-motion:reduce){.dsh-lb-danger.dsh-lb-pulse{animation:none;}}",
    ].join("");

    // ---------- BalanceChip ----------
    function BalanceChip(props) {
      var wide = props.wide !== false;
      var t = props.t;
      var state = useStore();
      var refreshMsRef = useRef(DEFAULT_REFRESH_MS);
      var inFlightRef = useRef(false);

      var refresh = useCallback(function (force) {
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        if (!store.data) setStore({ phase: "loading" });
        getBalance(force).then(function (json) {
          if (json && json.ok) {
            if (json.meta && json.meta.refreshMs) refreshMsRef.current = json.meta.refreshMs;
            setStore({ phase: "ready", data: json, error: null });
          } else {
            setStore({ phase: "error", data: null, error: (json && json.message) || "unknown", code: json && json.code });
          }
        }).catch(function (err) {
          setStore({ phase: "error", data: null, error: String((err && err.message) || err), code: "fetch-failed" });
        }).finally(function () {
          inFlightRef.current = false;
        });
      }, []);

      useEffect(function () {
        refresh(true);
        var timer = setInterval(function () { refresh(false); }, refreshMsRef.current);
        return function () { clearInterval(timer); };
      }, [refresh]);

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
        if (e.detail >= 2) { refresh(true); return; }
        if (phase === "error") { refresh(true); return; }
        var url = data && data.meta && data.meta.rechargeUrl;
        if (url) window.open(url, "_blank", "noopener");
      };
      var onRefresh = function (e) {
        e.stopPropagation();
        refresh(true);
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
    return module.exports;
  }
});
