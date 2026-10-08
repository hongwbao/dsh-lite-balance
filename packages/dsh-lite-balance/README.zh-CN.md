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

### 前置条件

| 依赖 | 用途 |
| --- | --- |
| **DSH**（`dsh` 命令可用） | 承载插件 |
| **pnpm** | `dsh plugin` 会把包操作转发给 pnpm |
| **Node.js >= 20** | host 端运行时 |
| **DeepSeek API Key** | 查询余额；没有它钱包会显示 ⚠ |

API Key 走 harness 的 credentials 通道，因此**只要 harness 本身能调用模型，就无需额外配置**。否则配置一次即可：

```bash
# 方式一：在启动 dsh web 的终端里导出
export DEEPSEEK_API_KEY=sk-xxxxxxxx

# 方式二：写入 harness 凭据文件（所有 profile 共用）
# 创建 ~/.dsh/.credentials.yaml，内容：
#   version: 1
#   refs:
#     DEEPSEEK_API_KEY: sk-xxxxxxxx
```

### 方式一 —— 从 Git 仓库安装（推荐）

```bash
# 1. 克隆
git clone git@github.com:hongwbao/dsh-lite-balance.git ~/repos/dsh-lite-balance
# （无 SSH 时用 HTTPS：git clone https://github.com/hongwbao/dsh-lite-balance.git ~/repos/dsh-lite-balance）

# 2. 安装到 web profile
dsh plugin --profile web add ~/repos/dsh-lite-balance/packages/dsh-lite-balance

# 3. 重启网页端
dsh web
```

要装到其他 profile（如 `tui`）就把 `--profile web` 换成 `--profile tui`。

### 方式二 —— 用打包文件安装（无需 git / 离线可用）

适合内网机器，或把插件交给别人：

```bash
# 在有仓库的机器上
cd packages/dsh-lite-balance && npm pack        # 生成 dsh-lite-balance-0.3.0.tgz

# 把 .tgz 拷到目标机器，然后
dsh plugin --profile web add ./dsh-lite-balance-0.3.0.tgz
dsh web
```

### 方式三 —— 从 npm 安装（发布后可用）

```bash
dsh plugin --profile web add dsh-lite-balance
dsh web
```

### 验证安装

```bash
# 插件行应出现在合成后的 profile 里
dsh --profile web --dump-config | grep -A1 dsh-lite-balance

# host 路由应有响应（503 = 未配置 key，属预期）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/dsh-lite-balance/balance
```

然后**重启 `dsh web`**——插件只在全新启动时加载。输入框下方的统计条应显示余额相关模块。

### 升级

```bash
cd ~/repos/dsh-lite-balance && git pull
dsh plugin --profile web update dsh-lite-balance   # 或重新执行 add 命令
```

### 卸载

```bash
dsh plugin --profile web remove dsh-lite-balance
```

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

费率按时间线生效，历史会话按当时的价计价。当前 `deepseek-v4-flash`（2026-09-10 12:00 起）：**空闲** 缓存命中 ¥0.02/1M、未命中 ¥1/1M、输出 ¥4/1M；**高峰 = 空闲 ×2**。该切换之前的请求仍按 2026-08-17 的价（空闲 ¥0.05/¥1.5/¥4.5）。用 `config.pricingModel` 选择其他内置费率表。

## 开发

```bash
node tests/smoke.test.mjs
```

## License

MIT
