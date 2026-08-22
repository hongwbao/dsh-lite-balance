# dsh-lite-balance

一个轻量、**可扩展**的 DeepSeek 余额显示器，运行在 DeepSeek Harness 网页端。它把输入框下方内置的统计条替换为一组**用户可配置的模块**（轮次/步数 · 耗时 · 速率 · 缓存命中 · Token 用量 · 消耗+余额 · 高峰/空闲），会话消耗逐笔计价并持久化，点击一键充值。零依赖、零构建。

> 设计原则：克制、原生、一眼看懂。无重型面板。

## 功能

- 替换内置统计条为模块化片段。
- **7 个内置模块**，每个都可通过齿轮（⚙）设置弹窗独立显示/隐藏、调整顺序。
- **用户配置**：勾选显示/隐藏 + 拖动排序（持久化到 `localStorage`）。
- **会话消耗**：host 端监听 `session/event`，**每笔请求按其到达时的价格计价**（高峰/空闲 + 历史费率时间线），按会话累加，并持久化到 `$DSH_HOME/storages/dsh-lite-balance.json`。
- 余额状态配色（>10 默认 / 3–10 警告 / <3 危险）；点击余额打开官方充值页。
- 高峰/空闲指示（北京时间，高峰 09:00–12:00、14:00–18:00；**周末全天按空闲价**）。
- 中英双语、跟随 DSH 主题（使用 `--dsw-alias-*` 设计变量）。
- **可扩展**：第三方插件可通过 `window.__DSH_LITE_BALANCE__.registerModule(...)` 注册自己的子模块。见 [docs/EXTENDING.zh-CN.md](docs/EXTENDING.zh-CN.md)。

## 安装

```bash
cd /home/hongwbao/repos/dsh-plugins
dsh plugin --profile web add ./packages/dsh-lite-balance
```

重启你的 `dsh web` 实例。

## 使用

- 统计条用 `|` 分隔已启用的模块，最右侧是齿轮 `⚙`。
- 点 `⚙` 打开模块设置弹窗：勾选/取消显示、拖 `⠿` 把手（或 ▲▼）调顺序，改动即时生效并持久化。
- 钱包模块显示 `消耗 ¥0.00 · 余额 ¥x.xx`；悬停显示更新时间+充值提示；点击打开充值页。
- 高峰/空闲与周末规则以彩色 `高峰/空闲` 片段呈现。

## 模块

| id | 内容 | 默认 |
| --- | --- | --- |
| `counts` | 轮次/步数 | 显示 |
| `duration` | LLM + 工具耗时 | 隐藏 |
| `speed` | 首 token 平均 + tok/s | 隐藏 |
| `cacheHit` | 缓存命中 % | 显示 |
| `tokens` | 输入/输出 Token | 显示 |
| `wallet` | 消耗 + 余额（可点击） | 显示 |
| `peakIdle` | 高峰/空闲指示 | 显示 |

## 配置

### API Key（自动复用 harness，无需配置）

插件通过 harness 的 `ctx.credentials` 服务解析 key（进程环境变量 → `$DSH_HOME/.credentials.yaml` → .env），与 harness 本身同一条链。harness 能调用模型，插件就有 key。

可选环境变量（优先级：patch 配置 > 环境变量 > 默认）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_BALANCE_WARN_THRESHOLD` | `10` | 低于此余额变警告色 |
| `DEEPSEEK_BALANCE_CRITICAL_THRESHOLD` | `3` | 低于此余额变危险色 |
| `DEEPSEEK_BALANCE_RECHARGE_URL` | `https://platform.deepseek.com/top_up` | 点击跳转的充值地址 |
| `DEEPSEEK_BALANCE_PEAK_WINDOWS` | `09:00-12:00,14:00-18:00` | 高峰时段（北京时间，逗号分隔） |

### profile 补丁配置

```yaml
- insert:
    - id: lite-balance
      name: 'dsh-lite-balance'
      config:
        warnThreshold: 10
        criticalThreshold: 3
        rechargeUrl: https://platform.deepseek.com/top_up
        peakWindows:
          - { start: '09:00', end: '12:00' }
          - { start: '14:00', end: '18:00' }
        # pricingModel: deepseek-v4-flash   # 或 deepseek-v4-pro / deepseek-v4-flash-vision-exp
```

## 会话消耗（如何计价）

host 端监听 `session/event`（`request/header` 取模型/provider，`assistant/message` 取 token 用量），**每笔请求按其到达时生效的价格计价**——含高峰/空闲、周末、历史费率时间线。`cacheWrite` 按输入（未命中）价计费。会话累计额持久化，重启不丢，跨高峰/空闲或官方调价不会回溯改变。

默认费率表为官方 `deepseek-v4-flash` 价格（高峰：输入未命中 ¥3/1M、命中 ¥0.1/1M、输出 ¥9/1M；空闲半价）。用 `config.pricingModel` 选择其他内置费率表。

## 开发

```bash
node tests/smoke.test.mjs
```

## License

MIT
