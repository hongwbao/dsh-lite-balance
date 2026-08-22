# Changelog

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
