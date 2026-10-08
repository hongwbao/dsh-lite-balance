# dsh-plugins

自研 DSH（DeepSeek Harness）插件仓库。 / A collection of self-built DSH (DeepSeek Harness) plugins.

## 插件列表 / Plugins

- [dsh-lite-balance](packages/dsh-lite-balance/) — 轻量、可扩展的 DeepSeek 余额/消耗显示器；替换输入框下方统计条为用户可配置模块，逐笔计价、一键充值。 Lightweight, extensible DeepSeek balance & spend display; user-configurable stats-line modules, per-request pricing, click-to-top-up.

## 安装 / Install

前置：`dsh` 可用、`pnpm` 已安装、Node.js ≥ 20。 / Requires: `dsh` on PATH, `pnpm`, Node.js ≥ 20.

```bash
# 克隆仓库 / clone
git clone git@github.com:hongwbao/dsh-lite-balance.git ~/repos/dsh-lite-balance

# 安装插件到 web profile / install into the web profile
dsh plugin --profile web add ~/repos/dsh-lite-balance/packages/dsh-lite-balance

# 重启网页端 / restart the web UI
dsh web
```

API Key 会自动复用 harness 的凭据（`~/.dsh/.credentials.yaml` 或环境变量 `DEEPSEEK_API_KEY`），无需额外配置。 / The API key is reused from the harness credentials seam automatically.

完整安装说明（离线 tarball、npm、升级、卸载、验证）见插件文档： / Full install guide (tarball, npm, upgrade, uninstall, verify):
[packages/dsh-lite-balance/README.zh-CN.md](packages/dsh-lite-balance/README.zh-CN.md) · [English](packages/dsh-lite-balance/README.md)

## 测试 / Tests

```bash
node tests/smoke.test.mjs
```

## 目录 / Layout

```text
packages/dsh-lite-balance/   # the plugin package
tests/                      # smoke tests
```
