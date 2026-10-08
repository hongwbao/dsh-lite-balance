/**
 * dsh-lite-balance host half.
 *
 * Two jobs:
 *   1. Balance — register GET /dsh-lite-balance/balance (host TTL cache,
 *      ?refresh=1 bypass). The API key resolves through the harness
 *      credentials service (env -> $DSH_HOME/.credentials.yaml -> .env).
 *   2. Per-session spend — tap the global `llm/stream` event and price
 *      EVERY request at the rate in effect when its usage event arrives
 *      (peak/off-peak aware, price-timeline aware), accumulating a durable
 *      per-session cost persisted to $DSH_HOME/storages/dsh-lite-balance.json.
 *      GET /dsh-lite-balance/balance?session=<id> also returns that cost.
 *
 * Optional env overrides: DEEPSEEK_BALANCE_WARN_THRESHOLD,
 * DEEPSEEK_BALANCE_CRITICAL_THRESHOLD, DEEPSEEK_BALANCE_RECHARGE_URL,
 * DEEPSEEK_BALANCE_PEAK_WINDOWS. Plugin `config` wins over env, env over defaults.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance';
const DEFAULT_RECHARGE_URL = 'https://platform.deepseek.com/top_up';
const OFFICIAL_PROVIDER = 'deepseek-official';
const HOST_CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;
const BEIJING_OFFSET_MS = 8 * 3600_000;
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const STORE_PATH = join(DSH_HOME, 'storages', 'dsh-lite-balance.json');
const MAX_SESSIONS = 500;

export const name = 'dsh-lite-balance';

/** Finite number or 0. */
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Finite number or a fallback. */
function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

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

// ---------------------------------------------------------------------------
// Pricing timeline (CNY per 1M tokens; peak/off-peak since 2026-08-17).
// Later policies win per model; ratesFor picks the policy active at `atMs`.
// ---------------------------------------------------------------------------
const PRICE_POLICIES = [
  {
    since: Date.UTC(2025, 1, 9),
    models: { 'deepseek-chat': { cacheHit: 0.5, input: 2, output: 8 }, 'deepseek-reasoner': { cacheHit: 1, input: 4, output: 16 } },
  },
  {
    since: Date.UTC(2026, 3, 24),
    models: { 'deepseek-v4-flash': { cacheHit: 0.02, input: 1, output: 2 }, 'deepseek-v4-pro': { cacheHit: 0.025, input: 3, output: 6 } },
  },
  {
    // 2026-08-17 00:00 Beijing = 2026-08-16T16:00Z; idle = half of peak.
    since: Date.UTC(2026, 7, 16, 16),
    peakOffPeak: true,
    models: {
      'deepseek-v4-flash': { cacheHit: [0.05, 0.1], input: [1.5, 3], output: [4.5, 9] },
      'deepseek-v4-pro': { cacheHit: [0.15, 0.3], input: [4.5, 9], output: [13.5, 27] },
      'deepseek-v4-flash-vision-exp': { cacheHit: [0.05, 0.1], input: [1.5, 3], output: [4.5, 9] },
    },
  },
  {
    // 2026-09-10 12:00 Beijing = 2026-09-10T04:00Z. Flash series repriced:
    // idle cache-hit 0.02, cache-miss 1, output 4 (CNY/1M); peak = 2x idle.
    // Only the flash series is listed — deepseek-v4-pro keeps the previous
    // policy (ratesFor takes the latest policy that names the model).
    since: Date.UTC(2026, 8, 10, 4),
    peakOffPeak: true,
    models: {
      'deepseek-v4-flash': { cacheHit: [0.02, 0.04], input: [1, 2], output: [4, 8] },
      'deepseek-v4-flash-vision-exp': { cacheHit: [0.02, 0.04], input: [1, 2], output: [4, 8] },
    },
  },
  {
    // Current official naming. The Flash model is served as DeepSeek-V4.1-Flash
    // and the provider (and the harness's model catalog) call it `deepseek-flash`;
    // `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` are retired aliases
    // that still route to the same model at the same price. Same rates as the
    // 2026-09-10 policy — this entry exists so the *current* model id resolves,
    // not to change any number. Without it every live request is unpriced.
    since: Date.UTC(2026, 8, 10, 4),
    peakOffPeak: true,
    models: {
      'deepseek-flash': { cacheHit: [0.02, 0.04], input: [1, 2], output: [4, 8] },
    },
  },
];

const DEFAULT_PEAK_WINDOWS = [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }];

/** Parse "HH:MM" into minutes since midnight, or null. */
function parseHHMM(text) {
  if (typeof text !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** True when Beijing time at `atMs` falls inside a peak window. */
export function isBeijingPeak(atMs, peakWindows = DEFAULT_PEAK_WINDOWS) {
  // Weekends (Sat/Sun) are priced at the idle rate all day — no peak/off-peak.
  const bjDow = new Date(atMs + BEIJING_OFFSET_MS).getUTCDay();
  if (bjDow === 0 || bjDow === 6) return false;
  const dayMs = (atMs + BEIJING_OFFSET_MS) % 86_400_000;
  const now = Math.floor(dayMs / 60_000);
  for (const w of peakWindows) {
    const start = parseHHMM(w?.start);
    const end = parseHHMM(w?.end);
    if (start === null || end === null) continue;
    if (start <= end) { if (now >= start && now < end) return true; }
    else { if (now >= start || now < end) return true; }
  }
  return false;
}

/** Effective rates ({ input, cacheHit, output }) for a model at `atMs`. */
export function ratesFor(model, atMs, peakWindows = DEFAULT_PEAK_WINDOWS) {
  let entry;
  for (const policy of PRICE_POLICIES) {
    if (atMs >= policy.since && policy.models[model] !== undefined) entry = policy;
  }
  if (entry === undefined) return null;
  const rates = entry.models[model];
  if (entry.peakOffPeak === true) {
    const peak = isBeijingPeak(atMs, peakWindows) ? 1 : 0;
    return { cacheHit: rates.cacheHit[peak], input: rates.input[peak], output: rates.output[peak] };
  }
  return rates;
}

/**
 * Cost of one usage event in CNY, at the price active when it arrived.
 * cacheWrite is billed at the input (cache-miss) price, matching DeepSeek.
 * Returns null for unpriced models.
 */
export function costOf(model, usage, atMs, peakWindows = DEFAULT_PEAK_WINDOWS) {
  const rates = ratesFor(model, atMs, peakWindows);
  if (rates === null) return null;
  usage = usage !== null && typeof usage === 'object' ? usage : {};
  const input = finite(usage.inputTokens) * rates.input;
  const cacheWrite = finite(usage.cacheWriteTokens) * rates.input;
  const cacheRead = finite(usage.cacheReadTokens) * rates.cacheHit;
  const output = finite(usage.outputTokens) * rates.output;
  return (input + cacheWrite + cacheRead + output) / 1e6;
}


// ---------------------------------------------------------------------------
// Durable per-session cost store (mirrors the reference wallet store).
// ---------------------------------------------------------------------------
function emptyStore() {
  return { version: 1, sessions: {} };
}

function normalizeStore(value) {
  const sessions = {};
  if (value && typeof value === 'object' && value.sessions && typeof value.sessions === 'object') {
    for (const [id, s] of Object.entries(value.sessions)) {
      if (id === '__proto__' || id === 'prototype') continue;
      sessions[id] = {
        cost: numberOr(s?.cost, 0),
        priced: s?.priced !== false,
        unpricedModels: Array.isArray(s?.unpricedModels) ? s.unpricedModels.filter((m) => typeof m === 'string') : [],
      };
    }
  }
  return { version: 1, sessions };
}

function loadStore() {
  try {
    return normalizeStore(JSON.parse(readFileSync(STORE_PATH, 'utf8')));
  } catch {
    return emptyStore();
  }
}

let store = loadStore();
let saveTimer = null;

function persistStore(logger) {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    const tmp = STORE_PATH + '.tmp';
    writeFileSync(tmp, JSON.stringify(store));
    renameSync(tmp, STORE_PATH);
  } catch (error) {
    if (logger && typeof logger.warn === 'function') logger.warn('dsh-lite-balance: persist failed: ' + String(error));
  }
}

function scheduleSave(logger) {
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => persistStore(logger), 500);
}

function capSessions() {
  const keys = Object.keys(store.sessions);
  if (keys.length <= MAX_SESSIONS) return;
  for (let i = 0; i < keys.length - MAX_SESSIONS; i += 1) delete store.sessions[keys[i]];
}

/**
 * Price one usage event into a session bucket. Only official DeepSeek calls
 * are priced (we only show that account); unpriced models mark the bucket.
 * Exported for tests; mutates `target.sessions`.
 */
export function accumulateSessionCost(target, options, usage, atMs, peakWindows = DEFAULT_PEAK_WINDOWS) {
  const sessionId = options?.sessionId;
  const provider = options?.provider;
  const model = options?.model;
  if (typeof sessionId !== 'string' || sessionId === '') return;
  if (provider !== OFFICIAL_PROVIDER) return;
  const entry = target.sessions[sessionId] ?? (target.sessions[sessionId] = { cost: 0, priced: true, unpricedModels: [] });
  const cost = costOf(model, usage, atMs, peakWindows);
  if (cost === null) {
    // Sticky-but-recoverable: record the unpriced model so the UI can explain
    // WHICH model is unpriced, and so a later priced model clears the flag.
    // (A permanently sticky flag made a single unpriced request hide the whole
    // session's spend forever, even after the price table was fixed.)
    entry.priced = false;
    if (!Array.isArray(entry.unpricedModels)) entry.unpricedModels = [];
    if (typeof model === 'string' && model !== '' && !entry.unpricedModels.includes(model)) entry.unpricedModels.push(model);
    return;
  }
  entry.cost += cost;
  if (entry.priced === false) {
    // A priced model arrived: the session is being billed again, so clear the
    // flag and the stale model list rather than leaving the wallet greyed out.
    entry.priced = true;
    entry.unpricedModels = [];
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
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

/** Normalize one peak-window entry into { start, end }, or null. */
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
  return DEFAULT_PEAK_WINDOWS;
}

/**
 * Peak-hour prices (CNY/1M) for the ACTIVE model, for the meta/display. The
 * historical timeline above drives per-event costing; this reports the
 * current rate so a user can see/override it.
 */
const PRICING_BY_MODEL = {
  // Since 2026-09-10 12:00 Beijing the flash series is idle 1 / 0.02 / 4 with
  // peak = 2x idle, so the PEAK table is 2 / 0.04 / 8.
  //
  // `deepseek-flash` is the current official id (served as DeepSeek-V4.1-Flash);
  // `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` are retired aliases
  // kept so an older config keeps reporting the same numbers.
  'deepseek-flash': { inputMissPeakPerM: 2.0, inputHitPeakPerM: 0.04, outputPeakPerM: 8.0 },
  'deepseek-v4-flash': { inputMissPeakPerM: 2.0, inputHitPeakPerM: 0.04, outputPeakPerM: 8.0 },
  'deepseek-v4-pro': { inputMissPeakPerM: 9.0, inputHitPeakPerM: 0.30, outputPeakPerM: 27.0 },
  'deepseek-v4-flash-vision-exp': { inputMissPeakPerM: 2.0, inputHitPeakPerM: 0.04, outputPeakPerM: 8.0 },
};

function resolvePricing(config) {
  const model = (config?.pricing?.model) ?? config?.pricingModel ?? 'deepseek-flash';
  const base = PRICING_BY_MODEL[model] ?? PRICING_BY_MODEL['deepseek-flash'];
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
    refreshMs: typeof config?.refreshMs === 'number' && config.refreshMs > 0 ? Math.round(config.refreshMs) : 60_000,
    warnThreshold: thresholdOf(config?.warnThreshold, 'DEEPSEEK_BALANCE_WARN_THRESHOLD', 10),
    criticalThreshold: thresholdOf(config?.criticalThreshold, 'DEEPSEEK_BALANCE_CRITICAL_THRESHOLD', 3),
    rechargeUrl: config?.rechargeUrl ?? process.env.DEEPSEEK_BALANCE_RECHARGE_URL ?? DEFAULT_RECHARGE_URL,
    peakWindows: resolvePeakWindows(config),
    pricing: resolvePricing(config),
  };
}

/**
 * Resolve the DeepSeek API key exactly the way the harness itself does.
 */
async function resolveApiKey(credentials) {
  if (credentials && typeof credentials.resolve === 'function') {
    try {
      const resolved = await credentials.resolve('DEEPSEEK_API_KEY');
      if (resolved && typeof resolved.value === 'string' && resolved.value !== '') return resolved.value;
    } catch {
      // degrade to the plain environment variable
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

/** Cordis plugin body: watch session usage and mount the balance route. */
export function apply(ctx, config) {
  const settings = resolveSettings(config);

  // Price every official LLM request at the rate active when its usage
  // event arrives — historical spend stays stable across peak/off-peak.
  //
  // Source of truth is the session event log (the same assistant/message
  // usage the harness own token meter folds): request/header records the
  // provider/model route for a request; assistant/message carries the
  // step's final token usage.
  const sessionRoutes = new Map();

  /** Fold one event into the route map / spend store. Shared by the live
   * listener and the cold-start backfill so both price identically. */
  const foldEvent = (session, event) => {
    if (event.type === 'request/header' && event.data?.header?.config) {
      sessionRoutes.set(session.id, {
        provider: event.data.header.config.provider,
        model: event.data.header.config.model,
      });
      return;
    }
    if (event.type === 'assistant/message' && event.data?.usage !== undefined) {
      const route = sessionRoutes.get(session.id) ?? {};
      // `event.time` is the event's own timestamp; `createdAt` is not a field
      // on session events. Prefer `time` so historical events are priced at the
      // rate that was actually in effect when they happened.
      const atMs = typeof event.time === 'number' ? event.time
        : (typeof event.createdAt === 'number' ? event.createdAt : Date.now());
      accumulateSessionCost(store, {
        sessionId: session.id,
        provider: route.provider ?? 'deepseek-official',
        model: route.model ?? settings.pricing.model,
      }, event.data.usage, atMs, settings.peakWindows);
      capSessions();
      scheduleSave(ctx.logger);
    }
  };

  ctx.on('session/event', (session, event) => {
    try {
      // Backfill first: on the first event this process sees for a resumed
      // session, fold its stored log (seed events never publish), then apply
      // the live event. Both are idempotent per session id.
      backfillSession(session);
      foldEvent(session, event);
    } catch (error) {
      if (ctx.logger && typeof ctx.logger.warn === 'function') {
        ctx.logger.warn('dsh-lite-balance: session/event: ' + String(error));
      }
    }
  });

  // A resumed Session loads its stored log as SEED events, and seed events
  // never publish on `session/event`. Live listening alone therefore starts
  // from a blank slate on every restart: the session's earlier spend is never
  // counted and the wallet looks frozen at whatever the first live window
  // produced. Backfill from the canonical log (seq 0) so resumed history is
  // priced too — the store check keeps this idempotent across re-attaches.
  const backfilled = new Set();
  const backfillSession = (session) => {
    if (session === undefined || typeof session.id !== 'string') return;
    if (backfilled.has(session.id)) return;
    // Only ever backfill a session with no recorded spend, so a restart cannot
    // double-count a log the live listener already folded. A session recorded
    // by an older version (partial total) is left as-is: its stored cost came
    // from a subset of these same events, so replaying the log would double it.
    if (store.sessions[session.id] !== undefined) { backfilled.add(session.id); return; }
    if (typeof session.snapshotEvents !== 'function') return;
    let events;
    try {
      events = session.snapshotEvents(0, session.seq);
    } catch {
      return;
    }
    if (!Array.isArray(events) || events.length === 0) return;
    backfilled.add(session.id);
    for (const event of events) {
      try {
        foldEvent(session, event);
      } catch (error) {
        if (ctx.logger && typeof ctx.logger.warn === 'function') {
          ctx.logger.warn('dsh-lite-balance: backfill: ' + String(error));
        }
      }
    }
    scheduleSave(ctx.logger);
  };

  // Backfill runs lazily: the first `session/event` this process sees for a
  // session triggers it, and it is cheap for an already-backfilled id.
  ctx.inject(['webServer'], (hostCtx) => {
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
      const body = {
        ok: true,
        fetchedAt: cache.at,
        meta: settings,
        ...cache.payload,
      };
      const sessionId = url.searchParams.get('session');
      if (sessionId !== null && sessionId !== '') {
        const entry = store.sessions[sessionId];
        body.sessionCost = entry
          ? {
              cost: entry.cost,
              priced: entry.priced,
              ...(entry.priced === false && Array.isArray(entry.unpricedModels) && entry.unpricedModels.length > 0
                ? { unpricedModels: entry.unpricedModels }
                : {}),
            }
          : null;
      }
      sendJson(res, 200, body);
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
