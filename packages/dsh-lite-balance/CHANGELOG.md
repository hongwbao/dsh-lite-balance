# Changelog

## 0.3.1

- **Fix: stats line no longer blanks out on DSH 0.2.0-rc.2.** The composer stats line read chat nodes from the `session` hook snapshot (`useSession(s => s.chat.legacy.nodes)`). The session snapshot is the Session controller face (projections, identity) and has no `chat` field, so the selector threw `TypeError: Cannot read properties of undefined (reading 'legacy')` during render and the whole dock entry crashed. Chat nodes live on the `chat` hook snapshot (`useChat(s => s.legacy.nodes)`), which `ui-chat` publishes as `hooks: ["chat"]` on the session scope. Switched to `useChat`, and made the hook lookups defensive so a host that stops delivering `useChat`/`useProjection` degrades to empty data instead of crashing the stats line. / 修复：DSH 0.2.0-rc.2 上统计条空白。原实现从 `session` 钩子快照读取聊天节点（`useSession(s => s.chat.legacy.nodes)`），但 session 快照是 Session 控制器门面（projections、身份信息），没有 `chat` 字段，选择器在渲染时抛 `TypeError: Cannot read properties of undefined (reading 'legacy')`，导致整个 dock 条目崩溃。聊天节点位于 `chat` 钩子快照（`useChat(s => s.legacy.nodes)`），由 `ui-chat` 以 `hooks: ["chat"]` 发布到 session 作用域。改用 `useChat`，并对钩子查找做了防御处理：宿主不再提供 `useChat`/`useProjection` 时降级为空数据，而非崩溃。

- Pricing update: deepseek-v4-flash repriced from 2026-09-10 12:00 Beijing — idle cache-hit ¥0.02/1M, cache-miss ¥1/1M, output ¥4/1M; peak = 2× idle. Added as a new entry in the price timeline, so earlier requests keep the 2026-08-17 rates. / 价格更新：flash 系列自 2026-09-10 12:00 起，空闲 ¥0.02/¥1/¥4，高峰为空闲 ×2；作为时间线新条目，早前请求仍按旧价。

## 0.3.0

- **Extensible**: public module-registration API (`window.__DSH_LITE_BALANCE__.registerModule`) for third-party plugins; config tolerates arbitrary module ids. / 可扩展：公开模块注册 API，配置兼容任意模块 id。
- Live drag-reorder with smooth row-shift animation, constrained to the settings area; order commits during the drag. / 实时拖动排序动画，限定在设置区域内，拖动过程中即提交顺序。
- Release docs: bilingual README + extension guide. / 发布文档：中英 README + 扩展指南。

## 0.2.0

- User-configurable modules (7 built-in), gear settings popup (toggle + reorder). / 用户可配置模块（7 个内置）、齿轮设置弹窗。
- Per-request priced session spend via `session/event` + durable store; weekend always idle-priced. / 基于 `session/event` 的逐笔计价会话消耗 + 持久化；周末全天空闲价。
- Removed sidebar chip & low-balance toast; simplified tooltip. / 移除侧边栏 chip 与低余额弹窗；精简 tooltip。

## 0.1.0

- Initial release: composer stats-line replacement with turns/steps · cache hit · tokens · spend+balance · peak/idle. / 首个版本：替换输入框下方统计条。
