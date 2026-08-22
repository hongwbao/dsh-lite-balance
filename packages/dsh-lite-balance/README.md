# dsh-lite-balance

DSH Web 的轻量余额显示器：在侧边栏底部（设置按钮旁）常驻一个紧凑余额 chip，
自动/手动刷新 DeepSeek 官方账户余额，余额不足时变色提醒并弹出轻量 toast，
点击一键跳转官方充值页。跟随 DSH 主题与语言（中文/English），不引入任何重型面板。

> 设计原则：克制、原生、一眼看懂。无信息过载，无额外控制中心。

## 功能

- 侧边栏底部紧凑 chip：显示总额，余额明细放 tooltip（总额 / 赠金 / 充值 / 更新时间）
- 自动刷新（默认 60s，可配），chip 内一键手动刷新（宽模式），双击 chip 强制刷新
- 状态变色：正常（绿点）/ 低于 `warnThreshold`（警告色）/ 低于 `criticalThreshold`（危险色 + 脉冲 + toast 提醒）
- 点击 chip 跳转 DeepSeek 官方充值页
- 中英双语（跟随 DSH 语言设置）、深浅主题（使用 DSH 的 `--dsw-alias-*` 设计变量）
- host 端读取 `DEEPSEEK_API_KEY`，API Key 永不进入浏览器

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
| `DEEPSEEK_BALANCE_CRITICAL_THRESHOLD` | `3` | 低于此值 chip 变危险色并 toast 提醒 |
| `DEEPSEEK_BALANCE_RECHARGE_URL` | `https://platform.deepseek.com/top_up` | 点击 chip 跳转的充值地址 |

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
```

## 使用

- 余额 chip 常驻侧边栏底部；鼠标悬停查看明细（tooltip）
- 点击 chip：打开充值页；双击 chip：强制刷新
- 宽模式下 chip 右侧有刷新按钮（↻）
- 余额低于危险阈值时，右下弹出 8 秒 toast，可一键跳转充值
- 未配置 Key 或获取失败时，chip 显示 ⚠，悬停可查看原因，点击重试

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
└── client/client.js    # client 端：ModuleLoader bundle（chip + toast + i18n）
```

冒烟测试（无需网络）：

```bash
node tests/smoke.test.mjs
```

## 实现说明

- host 端注册 `GET /dsh-lite-balance/balance`（`?refresh=1` 强制绕过缓存），30s 内存 TTL，10s 请求超时
- DeepSeek 余额接口：`GET https://api.deepseek.com/user/balance`，`Authorization: Bearer $DEEPSEEK_API_KEY`
- client 端通过 `slots.register` 挂到 `sidebar.footer.action`（owner 只传 `wide`，56px rail 时自动紧凑），toast 挂 `shell.overlay`
- 样式只用 DSH 主题变量（`--dsw-alias-*`），深浅主题自动适配
