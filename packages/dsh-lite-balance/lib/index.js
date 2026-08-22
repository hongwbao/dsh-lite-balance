/**
 * dsh-lite-balance host half.
 *
 * Registers one read-only HTTP route on the web profile's webServer service:
 *
 *   GET /dsh-lite-balance/balance            => cached balance (host TTL)
 *   GET /dsh-lite-balance/balance?refresh=1  => bypass cache, fetch fresh
 *
 * The API key is read from the DEEPSEEK_API_KEY environment variable on the
 * HOST process (never sent to the browser). Optional overrides:
 *   DEEPSEEK_BALANCE_WARN_THRESHOLD     (number, default 10)
 *   DEEPSEEK_BALANCE_CRITICAL_THRESHOLD (number, default 3)
 *   DEEPSEEK_BALANCE_RECHARGE_URL       (string, default DeepSeek platform)
 * Plugin `config` from the profile patch row wins over env, env wins over
 * defaults.
 */
const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance';
const DEFAULT_RECHARGE_URL = 'https://platform.deepseek.com/top_up';
const HOST_CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;

export const name = 'dsh-lite-balance';

/** Parse one string field from the DeepSeek API into a finite number. */
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalize the DeepSeek /user/balance response into the shape the client
 * renders. Exported separately so it can be unit-tested without a network.
 */
export function normalizeBalance(json) {
  const infos = Array.isArray(json?.balance_infos) ? json.balance_infos : [];
  const pick = infos.find((i) => i?.currency === 'CNY') ?? infos[0] ?? null;
  const shape = (i) => ({
    currency: i?.currency ?? null,
    total: i ? toNumber(i.total_balance) : null,
    granted: i ? toNumber(i.granted_balance) : null,
    toppedUp: i ? toNumber(i.topped_up_balance) : null,
  });
  return {
    available: json?.is_available !== false,
    currency: pick?.currency ?? null,
    total: pick ? toNumber(pick.total_balance) : null,
    granted: pick ? toNumber(pick.granted_balance) : null,
    toppedUp: pick ? toNumber(pick.topped_up_balance) : null,
    balanceInfos: infos.map(shape),
  };
}

/** Effective numeric threshold: config > env > default. */
function thresholdOf(configValue, envName, fallback) {
  if (typeof configValue === 'number' && Number.isFinite(configValue)) return configValue;
  const env = process.env[envName];
  if (env !== undefined && env.trim() !== '') {
    const n = Number(env);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Resolve the runtime settings shared by the route and the client meta. */
function resolveSettings(config) {
  return {
    refreshMs: typeof config?.refreshMs === 'number' && config.refreshMs > 0
      ? Math.round(config.refreshMs)
      : 60_000,
    warnThreshold: thresholdOf(config?.warnThreshold, 'DEEPSEEK_BALANCE_WARN_THRESHOLD', 10),
    criticalThreshold: thresholdOf(config?.criticalThreshold, 'DEEPSEEK_BALANCE_CRITICAL_THRESHOLD', 3),
    rechargeUrl: config?.rechargeUrl ?? process.env.DEEPSEEK_BALANCE_RECHARGE_URL ?? DEFAULT_RECHARGE_URL,
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

/** One DeepSeek /user/balance call. Throws on missing key / HTTP / timeout. */
async function fetchBalanceOnce() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || key.trim() === '') {
    const error = new Error('DEEPSEEK_API_KEY environment variable is not set on the host process');
    error.code = 'missing-api-key';
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_BALANCE_URL, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + key.trim(),
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error('DeepSeek API responded ' + response.status + ' ' + response.statusText);
      error.code = 'api-error';
      throw error;
    }
    const json = await response.json();
    return normalizeBalance(json);
  } finally {
    clearTimeout(timer);
  }
}

/** Cordis plugin body: mount the balance route once webServer exists. */
export function apply(ctx, config) {
  ctx.inject(['webServer'], (hostCtx) => {
    const settings = resolveSettings(config);
    let cache = null; // { at: number, payload: object }

    const handler = async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, code: 'method-not-allowed', message: 'GET only' });
        return;
      }
      let url;
      try {
        url = new URL(req.url ?? '/', 'http://localhost');
      } catch {
        sendJson(res, 400, { ok: false, code: 'bad-request', message: 'invalid request url' });
        return;
      }
      const force = url.searchParams.get('refresh') === '1';
      const now = Date.now();
      if (force || cache === null || now - cache.at > HOST_CACHE_TTL_MS) {
        try {
          const payload = await fetchBalanceOnce();
          cache = { at: Date.now(), payload };
        } catch (error) {
          sendJson(res, error.code === 'missing-api-key' ? 503 : 502, {
            ok: false,
            code: error.code ?? 'fetch-failed',
            message: error.message,
          });
          return;
        }
      }
      sendJson(res, 200, {
        ok: true,
        fetchedAt: cache.at,
        meta: settings,
        ...cache.payload,
      });
    };

    hostCtx.effect(() => (
      hostCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-lite-balance/balance',
        handler,
      })
    ), 'dsh-lite-balance: balance route');
  });
}
