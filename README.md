# dsh-plugins

自研 DSH（DeepSeek Harness）插件仓库。

## 插件列表

- [dsh-lite-balance](packages/dsh-lite-balance/) — 轻量余额显示器：侧边栏底部余额 chip、自动/手动刷新、低余额提醒、一键充值、中英双语、跟随主题

## 通用安装方式

```bash
dsh plugin --profile <profile> add <包路径或 npm 包名>
```

## 测试

```bash
node tests/smoke.test.mjs
```
