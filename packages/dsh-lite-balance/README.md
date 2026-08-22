# dsh-lite-balance

DSH Web 的轻量余额显示器：在输入框下方统计条内常驻余额，
自动刷新 DeepSeek 官方账户余额，余额不足时变色提醒，
点击一键跳转官方充值页。跟随 DSH 主题与语言（中文/English），不引入任何重型面板。

> 设计原则：克制、原生、一眼看懂。无信息过载，无额外控制中心。

## 功能

- **输入框下方统计条**（替换内置统计）：`轮次/步数 | 缓存命中 | 输入/输出 Token | 消耗 + 余额 | 高峰/空闲`
- 余额状态配色：`> warnThreshold` 默认色 / `[criticalThreshold, warnThreshold]` 警告色（黄）/ `< criticalThreshold` 危险色（红）
- 余额段同时显示**当前会话消耗金额**（host 端监听 `session/event`，**每笔请求按其到达时的价格计价**，高峰/空闲与历史费率时间线感知；消耗逐笔累加、持久化）与**账户剩余余额**；消耗**常显**（无消耗显示 ¥0.00）且**只保留两位小数**；点击余额跳转充值页；余额悬停只显示**更新时间 + 点击打开充值页**
- 高峰/空闲指示（北京时间，默认高峰 09:00–12:00、14:00–18:00，其余空闲；**周末（周六/周日）全天按空闲价**；高峰红 / 空闲绿）
- 自动刷新（默认 60s，可配）
- 中英双语（跟随 DSH 语言设置）、深浅主题（使用 DSH 的 `--dsw-alias-*` 设计变量）
- API Key 通过 harness 自身 credentials 服务解析，永不进入浏览器

## 安装

```bash
cd /home/hongwbao/repos/dsh-plugins
dsh plugin --profile web add ./packages/dsh-lite-balance
```

安装后**重启你的 `dsh web`**（当前运行的 GUI 需重启才能加载新插件）。

## 配置

### API Key（自动复用 harness 的配置，无需额外设置）

插件通过 harness 自身的 credentials 服务（`ctx.credentials`）解析 key，
与 harness 完全同一条解析链：

1. 进程环境变量 `DEEPSEEK_API_KEY`
2. `~/.dsh/.credentials.yaml` 的 `refs.DEEPSEEK_API_KEY`（即 harness 里配好的 key）
3. `.env` 文件

所以**只要 harness 本身能正常调用模型，插件就自动有 key，不需要任何额外配置**。
仅当你想用另一个账号时，才需要显式设置环境变量来覆盖。

可选环境变量（优先级：patch 配置 > 环境变量 > 默认值）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_BALANCE_WARN_THRESHOLD` | `10` | 低于此值 chip 变警告色 |
| `DEEPSEEK_BALANCE_CRITICAL_THRESHOLD` | `3` | 低于此值余额变危险色（红） |
| `DEEPSEEK_BALANCE_RECHARGE_URL` | `https://platform.deepseek.com/top_up` | 点击余额跳转的充值地址 |
| `DEEPSEEK_BALANCE_PEAK_WINDOWS` | `09:00-12:00,14:00-18:00` | 高峰时段（北京时间，逗号分隔多个区间） |

### 消耗金额的费率（默认已按官方 deepseek-v4-flash 定价）

「当前会话消耗」= 本会话 Token 用量 × 官方单价（按高峰/空闲/周末自动计价），默认使用 `deepseek-v4-flash` 的官方价格（高峰：输入未命中 ¥3/1M、命中 ¥0.1/1M、输出 ¥9/1M；空闲为高峰一半；周末全天按空闲价）。可用 `config.pricingModel` 选择计价模型（内置 `deepseek-v4-flash` / `deepseek-v4-pro` / `deepseek-v4-flash-vision-exp`）。

### 可选：profile 补丁配置

在 `~/.dsh/profiles/web/cordis.patch.yml`（或插件自己的 `cordis.patch.yml`）中：

```yaml
- insert:
    - id: lite-balance
      name: 'dsh-lite-balance'
      config:
        refreshMs: 60000          # 客户端自动刷新间隔（毫秒）
        warnThreshold: 10         # 警告阈值
        criticalThreshold: 3      # 危险阈值
        rechargeUrl: https://platform.deepseek.com/top_up
        peakWindows:
          - start: '09:00'
            end: '12:00'
          - start: '14:00'
            end: '18:00'
        # 计价模型（默认 flash；或 deepseek-v4-pro / deepseek-v4-flash-vision-exp）
        # pricingModel: deepseek-v4-flash
```

## 使用

- 输入框下方统计条：`轮次/步数 | 缓存命中 | 输入/输出 Token | 余额 | 高峰/空闲`
- 余额悬停只显示**更新时间 + 点击打开充值页**；点击余额：打开充值页
- 未配置 Key 或获取失败时，余额显示 ⚠（悬停查看原因，点击重试）

## 卸载

```bash
dsh plugin --profile web remove dsh-lite-balance
```

## 开发

```text
packages/dsh-lite-balance/
├── package.json        # dsh.bundle.patch + dsh.client.inject 声明
├── cordis.patch.yml    # 插入 profile 层叠栈的补丁
├── lib/index.js        # host 端：/dsh-lite-balance/balance 路由 + 缓存 + 配置
└── client/client.js    # client 端：ModuleLoader bundle（统计条替换 + i18n）
```

冒烟测试（无需网络）：

```bash
node tests/smoke.test.mjs
```

## 实现说明

- host 端注册 `GET /dsh-lite-balance/balance`（`?refresh=1` 强制绕过缓存；`?session=<id>` 附带该会话累计消耗），30s 内存 TTL，10s 请求超时
- DeepSeek 余额接口：`GET https://api.deepseek.com/user/balance`，`Authorization: Bearer $DEEPSEEK_API_KEY`（key 来自 harness credentials 服务）
- **会话消耗**：host 端监听 `session/event`（`request/header` 记录 model/provider，`assistant/message` 携带每步 usage），**按当时生效的价格逐笔计价**（高峰/空闲 + 历史费率时间线 + 周末规则），`cacheWrite` 按输入（未命中）价计费；累计结果持久化到 `$DSH_HOME/storages/dsh-lite-balance.json`
- 高峰/空闲判定按北京时间（UTC+8）计算，高峰窗口默认 09:00–12:00、14:00–18:00（可配）；**周末（周六/周日）全天按空闲价**
- 统计条注册在 `conversation.composer.dock` 且 **id 复用内置的 `stats`、priority -1**（槽位契约 replaceRisk: none + lowest renders）——官方支持的同位替换
- 样式只用 DSH 主题变量（`--dsw-alias-*`），深浅主题自动适配
