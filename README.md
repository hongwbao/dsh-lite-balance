# dsh-plugins

自研 DSH（DeepSeek Harness）插件仓库。 / A collection of self-built DSH (DeepSeek Harness) plugins.

## 插件列表 / Plugins

- [dsh-lite-balance](packages/dsh-lite-balance/) — 轻量、可扩展的 DeepSeek 余额/消耗显示器；替换输入框下方统计条为用户可配置模块，逐笔计价、一键充值。 Lightweight, extensible DeepSeek balance & spend display; user-configurable stats-line modules, per-request pricing, click-to-top-up.

## 通用安装 / Install

```bash
dsh plugin --profile <profile> add <package-path-or-name>
```

## 测试 / Tests

```bash
node tests/smoke.test.mjs
```

## 目录 / Layout

```text
packages/dsh-lite-balance/   # the plugin package
tests/                      # smoke tests
```
