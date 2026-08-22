# 扩展 dsh-lite-balance

无需改动本包，即可向统计条添加自己的**子模块**。插件在 window 上暴露了一个小型公开 API：`window.__DSH_LITE_BALANCE__`。

## 模块契约

模块是一个普通对象：

```js
api.registerModule({
  id: 'my-weather',          // 必填，唯一
  label: (ctx) => 'Weather', // 设置弹窗里显示的名字（或用 labelKey）
  order: 45,                 // 显示位置（越小越靠前）
  enabled: (ctx) => true,    // 返回 false 则隐藏
  render: (ctx) => React.createElement('span', null, '☀ 25°C'),
  clickable: true,           // 可选——点击 + 悬停提示由编排器统一包装
  onClick: (ctx) => window.open('https://weather.com'),
  tooltip: (ctx) => '点击查看天气',
});
```

### 字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 唯一模块 id |
| `render` | `(ctx) => ReactElement | string | null` | 是 | 显示内容 |
| `label` | `(ctx) => string` | 否 | 设置弹窗里的名字 |
| `labelKey` | string | 否 | 多语言 key（需你的插件注册），与 `label` 二选一 |
| `order` | number | 否 | 默认显示顺序（默认 1000） |
| `enabled` | `(ctx) => boolean` | 否 | 是否显示（默认始终显示） |
| `clickable` | boolean | 否 | 是否可点击（默认 false） |
| `onClick` | `(ctx) => void` | 否 | 点击效果（需 `clickable`） |
| `tooltip` | `(ctx) => string` | 否 | 悬停提示（需 `clickable`） |
| `style` | object | 否 | 可点击包装层的内联样式 |

## 上下文（ctx）

你的 `render` / `enabled` / `onClick` / `tooltip` 会收到一个共享上下文：

- `t` — 本插件的翻译函数（仅已注册的命名空间）
- `stats` — 会话统计：`{ turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }` 
- `usage` / `billedInput` / `cacheHit` — token 用量 + 缓存命中 %
- `sessionCost` — `{ cost, priced }`（host 持久化的每会话消耗）
- `balance` — `{ phase, data }`；data 含 `total, currency, granted, toppedUp, meta`
- `peak` — boolean（当前是否高峰）或 null
- 格式化工具：`fmt, fmtMoney, formatTokens, formatDuration, formatTokensPerSecond, symbolOf, statusOf`
- `actions.openRecharge()` 和 `actions.refreshBalance()`

## 渲染说明

- **使用共享的 React**。DSH 模块加载器把 `react` 映射为同一实例，因此 `React.createElement`（或基于它编译的 JSX）产出的元素编排器可直接渲染；直接返回**字符串**也可以。
- 可点击模块由编排器统一加 `cursor:pointer`、点击与悬停提示；你的 `render` 只需返回内部内容。
- 注册后模块会自动出现在 ⚙ 设置弹窗里，可被用户显示/隐藏、排序，且配置持久化。

## 从另一个 DSH 插件注册

在你的插件 client bundle（运行在同一个页面）的 `apply` 里注册：

```js
// 你的 client bundle
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

模块会出现在统计条和设置弹窗中。`registerModule` 返回一个移除器，可随时卸载该模块。

## 注意与限制

- `window.__DSH_LITE_BALANCE__` 在 dsh-lite-balance 的 client bundle 加载后即存在；编排器每次渲染都会重读注册表，因此晚注册也没问题。
- `id` 需稳定且唯一；重复注册同 id 会替换旧定义。
- 模块 id 会写入用户 `localStorage` 配置；卸载后残留的（无害）配置项会被保留。
