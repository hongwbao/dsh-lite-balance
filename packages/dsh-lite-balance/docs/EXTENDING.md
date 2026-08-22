# Extending dsh-lite-balance

You can add your own **sub-module** to the stats line without touching this package. The plugin exposes a small public API on the window: `window.__DSH_LITE_BALANCE__`.

## The module contract

A module is a plain object:

```js
api.registerModule({
  id: 'my-weather',          // required, unique
  label: (ctx) => 'Weather', // row name in the settings popup (or labelKey)
  order: 45,                 // display position (lower = earlier)
  enabled: (ctx) => true,    // return false to hide it
  render: (ctx) => React.createElement('span', null, '☀ 25°C'),
  clickable: true,           // optional — wrap with click + tooltip
  onClick: (ctx) => window.open('https://weather.com'),
  tooltip: (ctx) => 'Click for weather',
});
```

### Fields

| field | type | required | description |
| --- | --- | --- | --- |
| `id` | string | yes | unique module id |
| `render` | `(ctx) => ReactElement | string | null` | yes | what to draw |
| `label` | `(ctx) => string` | no | name shown in the settings popup |
| `labelKey` | string | no | a locale key (your plugin must register it) — alternative to `label` |
| `order` | number | no | default display order (default 1000) |
| `enabled` | `(ctx) => boolean` | no | whether to show given context (default always) |
| `clickable` | boolean | no | whether the segment is clickable (default false) |
| `onClick` | `(ctx) => void` | no | click effect (requires `clickable`) |
| `tooltip` | `(ctx) => string` | no | hover tooltip (requires `clickable`) |
| `style` | object | no | inline style for the clickable wrapper |

## The context (ctx)

Your `render` / `enabled` / `onClick` / `tooltip` receive a shared context:

- `t` — the plugin's translation function (registered namespaces only)
- `stats` — derived session stats: `{ turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }`
- `usage` / `billedInput` / `cacheHit` — token usage + cache-hit %
- `sessionCost` — `{ cost, priced }` from the host (durable per-session spend)
- `balance` — `{ phase, data }`; data has `total, currency, granted, toppedUp, meta`
- `peak` — boolean (is it a peak hour, weekday) or null
- formatters: `fmt, fmtMoney, formatTokens, formatDuration, formatTokensPerSecond, symbolOf, statusOf`
- `actions.openRecharge()` and `actions.refreshBalance()`

## Rendering notes

- **Use the shared React.** The DSH module loader maps `react` to one shared instance, so `React.createElement` (or JSX compiled against it) produces elements our orchestrator can render. A plain **string** return is also fine.
- The orchestrator wraps clickable modules with `cursor:pointer`, `onClick` and `title`; your `render` only returns the inner content.
- Modules are user-toggleable/reorderable automatically once registered: they appear in the ⚙ settings popup and their visibility/order is persisted.

## Registering from another DSH plugin

In your plugin's client bundle (which runs in the same page), register in your `apply`:

```js
// your client bundle
window.__ModuleLoader__.load({
  id: 'my-plugin',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    function apply(ctx) {
      const api = window.__DSH_LITE_BALANCE__;
      if (api) api.registerModule({
        id: 'my-stats',
        label: () => 'My stats',
        order: 55,
        render: () => h('span', null, '★ 5/5'),
      });
    }
    module.exports = { name: 'my-plugin', inject: ['slots'], apply };
  },
});
```

The module appears in the stats line and in the settings popup. `registerModule` returns a disposer to remove it later.

## Notes & limitations

- `window.__DSH_LITE_BALANCE__` exists once dsh-lite-balance's client bundle has loaded, and the orchestrator re-reads the registry on every render, so late registration is fine.
- Keep `id` stable and unique; re-registering the same id replaces the previous definition.
- Module ids are stored in the user's `localStorage` config; unregistering keeps the (harmless) config entry.
