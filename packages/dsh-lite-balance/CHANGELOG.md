# Changelog

## 0.3.4

- **Fix: session spend was frozen / far too low.** Three defects stacked up:
  1. **Resumed history was never counted.** A resumed Session loads its stored log as *seed* events, and seed events never publish on `session/event` (DSH documents this on `firstLiveSeq`: consumers needing full history must start at seq 0). Listening live alone meant every restart began from a blank slate — only events appended after that moment were priced. The host now backfills a session's canonical log on the first event it sees for that session, once per session id, and only when no spend is recorded yet (so a restart can never double-count).
  2. **Wrong timestamp field.** Events carry `event.time`, not `event.createdAt`, so peak/off-peak was decided against `Date.now()` instead of the moment the request actually happened. Historical events are now priced at the rate genuinely in effect when they occurred.
  3. **A sticky unpriced flag.** One unpriced request set `priced: false` permanently, greying out the wallet and freezing the displayed total forever. The flag is now recoverable (a later priced model clears it) and records *which* model was unpriced so the UI can say so.

  Measured on a real session: the old code recorded ¥0.0861 with `priced:false`; the fixed code prices all 295 usage events to ¥1.8676 with `priced:true` — a 21.7× undercount corrected. / 修复：会话消耗被冻结/严重偏低。三个缺陷叠加：(1) **恢复的历史从未计数** —— 恢复的 Session 会把已存日志作为 *seed* 事件载入，而 seed 事件不会发布到 `session/event`（DSH 在 `firstLiveSeq` 上有说明：需要完整历史的消费者须从 seq 0 开始），因此每次重启都从零开始，只计价重启后追加的事件；现在 host 会在首次收到某会话事件时回填其完整日志，每个会话只做一次，且仅在该会话尚无消耗记录时执行（重启不会重复计数）。(2) **时间戳字段用错** —— 事件带的是 `event.time` 而非 `event.createdAt`，导致高峰/空闲按 `Date.now()` 判断而非请求实际发生的时刻；现在历史事件按当时真正生效的费率计价。(3) **未计价标记是粘性的** —— 一次未计价请求会永久置 `priced: false`，使钱包长期灰显、总额冻结；现在该标记可恢复（后续计价模型会清除），并记录**是哪个**模型未计价以便 UI 说明。实测真实会话：旧代码记录 ¥0.0861 且 `priced:false`，修复后 295 条用量事件全部计价为 ¥1.8676 且 `priced:true`，修正了 21.7 倍的少算。

- **Client: partial spend is now shown honestly.** An unpriced session renders `消耗 ≥¥x.xx` and its tooltip names the unpriced model, instead of displaying a silently incomplete number as if it were the real total. / 客户端：未计价会话显示 `消耗 ≥¥x.xx`，悬停提示会指明未计价的模型，不再把一个静默不完整的数字当作真实总额展示。

## 0.3.3

- **Fix: the reported/active model id was the retired name.** The Flash model's *id* is `deepseek-flash` (it is served as DeepSeek-V4.1-Flash; `DeepSeek-V41-Flash` is only its display name). `PRICING_BY_MODEL` and the `resolvePricing` default still listed `deepseek-v4-flash`, so `/dsh-lite-balance/balance` reported `meta.pricing.model: "deepseek-v4-flash"` — a name that no longer exists — and the "current rate" table fell back to a stale entry. The active/default id is now `deepseek-flash`; the retired aliases stay as keys so an older config keeps reporting identical numbers. Rates are unchanged. Pricing keys on the model **id**, never the display name; tests now assert exactly that. / 修复：上报/默认的模型 id 用了已下线的名字。Flash 模型的 **id** 是 `deepseek-flash`（实际服务为 DeepSeek-V4.1-Flash，`DeepSeek-V41-Flash` 只是展示名）。`PRICING_BY_MODEL` 与 `resolvePricing` 默认值仍写着 `deepseek-v4-flash`，导致 `/dsh-lite-balance/balance` 上报 `meta.pricing.model: "deepseek-v4-flash"` —— 一个已不存在的名字 —— 且「当前费率」表回退到陈旧条目。现在默认/上报的 id 为 `deepseek-flash`；旧别名仍保留为键，老配置上报的数值完全不变。费率无任何改动。计价只以模型 **id** 为键，绝不使用展示名；测试已断言这一点。

## 0.3.2

- **Fix: spend was never priced for the live Flash model id.** The price timeline only listed `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`, but the provider (and the harness's DeepSeek model catalog) now call the Flash model `deepseek-flash` (DeepSeek-V4.1-Flash). `ratesFor('deepseek-flash', …)` returned `null`, so every real request marked its session bucket `priced: false` and the wallet showed no spend. Added `deepseek-flash` at the same rates as the 2026-09-10 policy (idle cache-hit ¥0.02 / cache-miss ¥1 / output ¥4 per 1M; peak = 2× idle). No number changed — the retired `deepseek-v4-flash*` aliases still resolve identically, so historical sessions keep their recorded cost. Regression tests now assert the current id is priced and accumulates. / 修复：实际使用的 Flash 模型名未计价，导致消耗显示不出来。价格时间线里只有 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`，但官方（以及 harness 的 DeepSeek 模型目录）现在把 Flash 模型称作 `deepseek-flash`（DeepSeek-V4.1-Flash）。`ratesFor('deepseek-flash', …)` 返回 `null`，于是每个真实请求都会把会话桶标记为 `priced: false`，钱包自然显示不出消耗。已按 2026-09-10 政策的同一费率补上 `deepseek-flash`（空闲 缓存命中 ¥0.02 / 未命中 ¥1 / 输出 ¥4 每 1M；高峰 = 空闲 ×2）。数值没有任何变化——已下线的 `deepseek-v4-flash*` 别名解析结果完全一致，历史会话记录不受影响。回归测试现已断言当前模型名可计价并可累加。

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
