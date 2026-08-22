/**
 * dsh-lite-balance host half.
 *
 * Registers one read-only HTTP route on the web profile's webServer service:
 *
 *   GET /dsh-lite-balance/balance            => cached balance (host TTL)
 *   GET /dsh-lite-balance/balance?refresh=1  => bypass cache, fetch fresh
 *
 * The API key is resolved through the harness's own credentials service
 * (`ctx.credentials`), i.e. the same chain the harness uses: process
 * environment -> $DSH_HOME/.credentials.yaml (refs.DEEPSEEK_API_KEY) -> .env
 * files. The value never reaches the browser. Optional overrides:
 *   DEEPSEEK_BALANCE_WARN_THRESHOLD     (number, default 10)
 *   DEEPSEEK_BALANCE_CRITICAL_THRESHOLD (number, default 3)
 *   DEEPSEEK_BALANCE_RECHARGE_URL       (string, default DeepSeek platform)
 *   DEEPSEEK_BALANCE_PEAK_WINDOWS       ("09:00-12:00,14:00-18:00", Beijing time)
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

/**
 * Normalize one peak-window entry into { start, end } (HH:MM strings), or null.
 * Accepts { start, end } objects and "09:00-12:00" strings.
 */
function normalizePeakWindow(item) {
  if (item && typeof item.start === 'string' && typeof item.end === 'string') {
    return { start: item.start, end: item.end };
  }
  if (typeof item === 'string') {
    const m = /^\s*(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s*$/.exec(item.trim());
    if (m) return { start: m[1], end: m[2] };
  }
  return null;
}

/** Effective peak windows (Beijing time): config > env > default. */
function resolvePeakWindows(config) {
  if (Array.isArray(config?.peakWindows)) {
    const fromConfig = config.peakWindows.map(normalizePeakWindow).filter(Boolean);
    if (fromConfig.length > 0) return fromConfig;
  }
  const env = process.env.DEEPSEEK_BALANCE_PEAK_WINDOWS;
  if (env) {
    const fromEnv = env.split(',').map(normalizePeakWindow).filter(Boolean);
    if (fromEnv.length > 0) return fromEnv;
  }
  return [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }];
}

/**
 * Peak-hour prices per 1M tokens (CNY), from the official DeepSeek pricing
 * page (Aug 2026). Idle prices are peak * idleFactor (the scheme prices the
 * idle window at half of peak). deepseek-v4-flash is the harness default.
 */
const PRICING_BY_MODEL = {
  'deepseek-v4-flash': { inputMissPeakPerM: 3.0, inputHitPeakPerM: 0.10, outputPeakPerM: 9.0 },
  'deepseek-v4-pro': { inputMissPeakPerM: 9.0, inputHitPeakPerM: 0.30, outputPeakPerM: 27.0 },
  'deepseek-v4-flash-vision-exp': { inputMissPeakPerM: 3.0, inputHitPeakPerM: 0.10, outputPeakPerM: 9.0 },
};

/** Finite number or a fallback. */
function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Resolve the pricing table the client uses to estimate session spend. */
function resolvePricing(config) {
  const model = (config?.pricing?.model) ?? config?.pricingModel ?? 'deepseek-v4-flash';
  const base = PRICING_BY_MODEL[model] ?? PRICING_BY_MODEL['deepseek-v4-flash'];
  const over = (config?.pricing && typeof config.pricing === 'object') ? config.pricing : {};
  return {
    model,
    inputMissPeakPerM: numberOr(over.inputMissPeakPerM, base.inputMissPeakPerM),
    inputHitPeakPerM: numberOr(over.inputHitPeakPerM, base.inputHitPeakPerM),
    outputPeakPerM: numberOr(over.outputPeakPerM, base.outputPeakPerM),
    idleFactor: numberOr(over.idleFactor, 0.5),
  };
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
    // DeepSeek peak windows, Beijing time — the client colors the peak/idle
    // indicator from these; everything outside is idle. Default 09:00–12:00
    // and 14:00–18:00.
    peakWindows: resolvePeakWindows(config),
    pricing: resolvePricing(config),
  };
}

/**
 * Resolve the DeepSeek API key exactly the way the harness itself does.
 *
 * The web profile mounts a credentials provider (dsh-credentials-local) as
 * `ctx.credentials`; `resolve('DEEPSEEK_API_KEY')` layers the process
 * environment, then `$DSH_HOME/.credentials.yaml` (refs:), then .env files —
 * the same chain the harness's own LLM providers use. No service mounted
 * (foreign profile / tests): fall back to the plain environment variable.
 *
 * @param credentials - the optional `ctx.credentials` service.
 * @returns the key, or undefined when nowhere configured.
 */
async function resolveApiKey(credentials) {
  if (credentials && typeof credentials.resolve === 'function') {
    try {
      const resolved = await credentials.resolve('DEEPSEEK_API_KEY');
      if (resolved && typeof resolved.value === 'string' && resolved.value !== '') return resolved.value;
    } catch {
      // credentials service error: degrade to the plain environment variable
    }
  }
  const env = process.env.DEEPSEEK_API_KEY;
  return env && env.trim() !== '' ? env.trim() : undefined;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

/** One DeepSeek /user/balance call. Throws on missing key / HTTP / timeout. */
async function fetchBalanceOnce(key) {
  if (!key || key.trim() === '') {
    const error = new Error('DEEPSEEK_API_KEY is not configured — set it in ~/.dsh/.credentials.yaml (refs.DEEPSEEK_API_KEY) or as an environment variable on the host');
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
          const key = await resolveApiKey(hostCtx.get('credentials'));
          const payload = await fetchBalanceOnce(key);
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
