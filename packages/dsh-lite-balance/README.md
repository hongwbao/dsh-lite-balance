# dsh-lite-balance

A lightweight, **extensible** DeepSeek balance display for the DeepSeek Harness web GUI. It replaces the built-in composer stats line with a set of **user-configurable modules** (turns/steps · duration · speed · cache hit · tokens · spend+balance · peak/idle), tracks per-session spend (priced per request at arrival, persisted), and offers click-to-top-up. Zero dependencies, zero build.

> Principle: minimal, native-looking, glanceable. No heavy dashboards.

## Features

- Replaces the built-in stats line under the composer with modular segments.
- **7 built-in modules**, each independently showable/hideable and reorderable via a gear (⚙) settings popup.
- **User configuration**: toggle visibility + drag to reorder (persisted to `localStorage`).
- **Session spend**: host taps `session/event`, prices every request at the rate in effect when it arrives (peak/off-peak + price timeline), accumulates per session, and persists to `$DSH_HOME/storages/dsh-lite-balance.json`.
- Balance status colors (>10 default, 3–10 warning, <3 danger); click balance to open the official top-up page.
- Peak/idle indicator (Beijing time, peak 09:00–12:00 & 14:00–18:00; **weekends are always idle-priced**).
- Bilingual (Chinese/English), follows the DSH theme (uses `--dsw-alias-*` tokens).
- **Extensible**: third-party plugins can register their own sub-modules via `window.__DSH_LITE_BALANCE__.registerModule(...)`. See [docs/EXTENDING.md](docs/EXTENDING.md).

## Install

### Prerequisites

| requirement | why |
| --- | --- |
| **DSH** (`dsh` on your PATH) | hosts the plugin |
| **pnpm** | `dsh plugin` forwards package operations to pnpm |
| **Node.js >= 20** | host half runtime |
| **A DeepSeek API key** | balance lookup; without it the wallet shows ⚠ |

The API key is read through the harness credentials seam, so if your harness can already call models there is nothing extra to configure. Otherwise set it once:

```bash
# either export it in the shell that starts dsh web
export DEEPSEEK_API_KEY=sk-xxxxxxxx

# or store it for the harness (shared by every dsh profile)
# create ~/.dsh/.credentials.yaml with:
#   version: 1
#   refs:
#     DEEPSEEK_API_KEY: sk-xxxxxxxx
```

### Option 1 — install from the Git repository (recommended)

```bash
# 1. clone
git clone git@github.com:hongwbao/dsh-lite-balance.git ~/repos/dsh-lite-balance
# (HTTPS alternative: git clone https://github.com/hongwbao/dsh-lite-balance.git ~/repos/dsh-lite-balance)

# 2. install the plugin into your web profile
dsh plugin --profile web add ~/repos/dsh-lite-balance/packages/dsh-lite-balance

# 3. restart the web UI
dsh web
```

Use `--profile <name>` with another profile (e.g. `tui`) to install it there instead.

### Option 2 — install from a packed tarball (no git, no network)

Useful for air-gapped machines or handing the plugin to someone else:

```bash
# on a machine that has the repo
cd packages/dsh-lite-balance && npm pack        # -> dsh-lite-balance-0.3.0.tgz

# copy the .tgz to the other machine, then
dsh plugin --profile web add ./dsh-lite-balance-0.3.0.tgz
dsh web
```

### Option 3 — install from npm (once published)

```bash
dsh plugin --profile web add dsh-lite-balance
dsh web
```

### Verify the install

```bash
# the plugin row should appear in the composed profile
dsh --profile web --dump-config | grep -A1 dsh-lite-balance

# and the host route answers (503 = no key configured, which is expected without one)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/dsh-lite-balance/balance
```

Then restart your `dsh web` instance — the plugin only loads on a fresh boot. The stats line under the composer should now show the balance modules.

### Upgrade

```bash
cd ~/repos/dsh-lite-balance && git pull
dsh plugin --profile web update dsh-lite-balance   # or re-run the add command
```

### Uninstall

```bash
dsh plugin --profile web remove dsh-lite-balance
```

## Usage

- The stats line shows the enabled modules separated by `|`, with a gear `⚙` at the far right.
- Click `⚙` to open the module settings popup: check/uncheck to show/hide, drag the `⠿` handle (or use ▲▼) to reorder. Changes apply instantly and persist.
- The wallet module shows `Spent ¥0.00 · Balance ¥x.xx`; hover shows update time + top-up hint; click opens the top-up page.
- Peak/idle and weekend rules are shown as a colored `高峰/空闲` / `Peak/Off-peak` segment.

## Modules

| id | content | default |
| --- | --- | --- |
| `counts` | turns · steps | shown |
| `duration` | LLM + tool-call time | hidden |
| `speed` | TTFT avg + tok/s | hidden |
| `cacheHit` | cache-hit % | shown |
| `tokens` | input/output tokens | shown |
| `wallet` | spent + balance (clickable) | shown |
| `peakIdle` | peak/off-peak indicator | shown |

## Configuration

### API key (automatic — nothing to configure)

The plugin resolves the key through the harness `ctx.credentials` service (process env → `$DSH_HOME/.credentials.yaml` → .env), the same chain the harness itself uses. If the harness can call models, the plugin has a key.

Optional environment variables (patch config > env > default):

| variable | default | meaning |
| --- | --- | --- |
| `DEEPSEEK_BALANCE_WARN_THRESHOLD` | `10` | below this the balance turns warning color |
| `DEEPSEEK_BALANCE_CRITICAL_THRESHOLD` | `3` | below this the balance turns danger color |
| `DEEPSEEK_BALANCE_RECHARGE_URL` | `https://platform.deepseek.com/top_up` | click-to-top-up target |
| `DEEPSEEK_BALANCE_PEAK_WINDOWS` | `09:00-12:00,14:00-18:00` | peak windows (Beijing time, comma-separated) |

### Profile patch config

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
        # pricingModel: deepseek-v4-flash   # or deepseek-v4-pro / deepseek-v4-flash-vision-exp
```

## Session spend (how it's priced)

The host listens to `session/event` (`request/header` for the model/provider, `assistant/message` for token usage) and prices **each request at the rate in effect when its usage arrives** — peak/off-peak, weekends, and a historical price timeline. `cacheWrite` is billed at the input (cache-miss) price. The per-session total is durable, so it survives restarts and never changes retroactively when the peak/off-peak period or prices change.

Pricing follows a timeline, so historical sessions are priced with the rates in effect at the time. Current `deepseek-v4-flash` (since 2026-09-10 12:00 Beijing): **idle** cache-hit ¥0.02/1M, cache-miss ¥1/1M, output ¥4/1M; **peak = 2× idle**. The earlier 2026-08-17 rates (idle ¥0.05/¥1.5/¥4.5) still apply to requests made before that switch. Use `config.pricingModel` to pick another built-in table.

## Development

```bash
node tests/smoke.test.mjs
```

## License

MIT
