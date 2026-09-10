// Smoke tests for dsh-lite-balance (no network, no real server).
// Run: node tests/smoke.test.mjs   (from the repo root)
import { readFileSync } from 'node:fs';
import { normalizeBalance } from '../packages/dsh-lite-balance/lib/index.js';

let failures = 0;
function assert(cond, label) {
  if (cond) console.log('  ok -', label);
  else { failures++; console.error('  FAIL -', label); }
}

console.log('== host: normalizeBalance ==');
const sample = {
  is_available: true,
  balance_infos: [
    { currency: 'CNY', total_balance: '110.52', granted_balance: '10.00', topped_up_balance: '100.52' },
  ],
};
const norm = normalizeBalance(sample);
assert(norm.currency === 'CNY' && norm.total === 110.52, 'picks CNY entry and parses numbers');
assert(norm.balanceInfos.length === 1 && norm.available === true, 'keeps balanceInfos + available');

console.log('== host: apply registers route + missing key => 503 ==');
const routes = [];
const effects = [];
const fakeWebServer = {
  register(route) { routes.push(route); return () => { const i = routes.indexOf(route); if (i >= 0) routes.splice(i, 1); }; },
};
const fakeCredentials = { resolve: async () => undefined };
const capturedEvents = {};
const fakeCtx = {
  on(name, fn) { capturedEvents[name] = fn; return () => {}; },
  inject(list, cb) {
    cb({
      webServer: fakeWebServer,
      credentials: fakeCredentials,
      get: (service) => (service === 'credentials' ? fakeCredentials : undefined),
      effect: (fn, label) => { const d = fn(); effects.push({ fn, label, d }); },
    });
  },
  get(service) {
    if (service === 'credentials') return fakeCredentials;
    return undefined;
  },
};
const mod = await import('../packages/dsh-lite-balance/lib/index.js');
mod.apply(fakeCtx, { warnThreshold: 5, criticalThreshold: 1 });
assert(routes.length === 1 && routes[0].path === '/dsh-lite-balance/balance' && routes[0].kind === 'exact', 'route registered at exact /dsh-lite-balance/balance');

delete process.env.DEEPSEEK_API_KEY;
const route = routes[0];
const call = (req) => {
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  return route.handler(req, res).then(() => ({ status: res.status, body: JSON.parse(res.body) }));
};
let out = await call({ method: 'GET', url: '/dsh-lite-balance/balance' });
assert(out.status === 503 && out.body.code === 'missing-api-key', 'unconfigured key -> 503 missing-api-key');

// Credentials service supplies the key -> the request proceeds to the
// network (no internet in this sandbox) -> 502 fetch-failed, NOT missing-key.
fakeCredentials.resolve = async () => ({ value: 'sk-test', source: 'file' });
out = await call({ method: 'GET', url: '/dsh-lite-balance/balance?refresh=1' });
assert(out.status === 502 && (out.body.code === 'api-error' || out.body.code === 'fetch-failed'), 'credentials-supplied key reaches the DeepSeek fetch (401 or offline)');

// Plain environment variable still works when no credentials service value.
fakeCredentials.resolve = async () => undefined;
process.env.DEEPSEEK_API_KEY = 'sk-env';
out = await call({ method: 'GET', url: '/dsh-lite-balance/balance?refresh=1' });
assert(out.status === 502 && (out.body.code === 'api-error' || out.body.code === 'fetch-failed'), 'env fallback key reaches the DeepSeek fetch (401 or offline)');
delete process.env.DEEPSEEK_API_KEY;

out = await call({ method: 'POST', url: '/dsh-lite-balance/balance' });
assert(out.status === 405, 'non-GET -> 405');

console.log('== host: session/event -> accumulated session cost over the route ==');
const emit = capturedEvents['session/event'];
assert(typeof emit === 'function', 'host registered a session/event listener');
const sid = 'smoke-cost-' + Date.now();
// Monday 2026-08-24 10:00 Beijing = peak hour.
emit({ id: sid }, { type: 'request/header', data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } } });
emit({ id: sid }, { type: 'assistant/message', data: { usage: { inputTokens: 1000, cacheReadTokens: 1000, cacheWriteTokens: 0, outputTokens: 500 } }, createdAt: Date.UTC(2026, 7, 24, 2, 0, 0) });
// Restore a resolvable key, then mock the DeepSeek balance fetch so the
// route reaches the sessionCost branch.
fakeCredentials.resolve = async () => ({ value: 'sk-test', source: 'file' });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).includes('api.deepseek.com/user/balance')) {
    return new Response(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '5.00', granted_balance: '0', topped_up_balance: '5.00' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url);
};
const out2 = await call({ method: 'GET', url: '/dsh-lite-balance/balance?session=' + sid + '&refresh=1' });
globalThis.fetch = realFetch;
assert(out2.status === 200 && out2.body.ok === true && out2.body.total === 5, 'route returns 200 with mocked balance');
assert(out2.body.sessionCost !== null && Math.abs(out2.body.sessionCost.cost - 0.0076) < 1e-9, 'session/event accumulation served as sessionCost over the route');

for (const e of effects) { if (typeof e.d === 'function') e.d(); }
assert(routes.length === 0, 'effect disposer removes the route');

console.log('== client: bundle shape + slot registration ==');
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props: props || null, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useRef: (init) => ({ current: init }),
  useCallback: (fn) => fn,
};
globalThis.window = { __ModuleLoader__: { load: (def) => { globalThis.__bundle = def; } } };
globalThis.document = {
  createElement: () => ({ textContent: '', remove() {} }),
  head: { appendChild() {} },
};
(0, eval)(readFileSync(new URL('../packages/dsh-lite-balance/client/client.js', import.meta.url), 'utf8'));
const def = globalThis.__bundle;
assert(def && def.id === 'dsh-lite-balance', 'bundle captured with correct id');
const clientMod = def.factory((id) => {
  if (id === 'react') return reactStub;
  throw new Error('unexpected require: ' + id);
});
assert(clientMod.name === 'dsh-lite-balance', 'client exports name');
assert(Array.isArray(clientMod.inject) && clientMod.inject.includes('slots') && clientMod.inject.includes('locale'), 'client injects slots + locale');
assert(typeof clientMod.apply === 'function', 'client exports apply');

const registrations = [];
const injections = {};
const fakeClientCtx = {
  locale: {
    register() {},
    bind: (ns) => (key) => key,
  },
  slots: {
    inject(name, cb) { injections[name] = cb; },
    register(opts, comp) { registrations.push({ opts, comp }); return () => {}; },
  },
  effect(fn) { const d = fn(); if (typeof d === 'function') d(); },
};
clientMod.apply(fakeClientCtx);
assert(Object.keys(injections).sort().join(',') === 'conversation.composer.dock', 'injects only into composer dock (toast/overlay removed)');
for (const cb of Object.values(injections)) cb();
const chip = registrations.find((r) => r.opts.id === 'dsh-lite-balance');
assert(chip === undefined, 'sidebar footer chip registration removed');

const stats = registrations.find((r) => r.opts.id === 'stats');
assert(stats && stats.opts.name === 'conversation.composer.dock' && stats.opts.priority === -1 && typeof stats.comp === 'function', 'shadows built-in stats: composer.dock id "stats" at priority -1');

console.log('== client: extension API ==');
assert(typeof clientMod.registerModule === 'function' && typeof clientMod.getModules === 'function', 'registerModule/getModules exported');
assert(globalThis.window.__DSH_LITE_BALANCE__ && typeof globalThis.window.__DSH_LITE_BALANCE__.registerModule === 'function', 'global window.__DSH_LITE_BALANCE__ exposed');
assert(clientMod.getModules().length === 7, '7 built-in modules by default');
const extId = 'ext-' + Date.now();
const disposer = clientMod.registerModule({
  id: extId,
  labelKey: 'moduleTokens',
  order: 5,
  enabled: (ctx) => true,
  render: (ctx) => ctx.t('statsTokens'),
  clickable: true,
  onClick: () => {},
  tooltip: (ctx) => 'tip',
});
assert(clientMod.getModules().some((m) => m.id === extId), 'registered module appears in registry');
const ext = clientMod.getModules().find((m) => m.id === extId);
assert(ext.order === 5 && ext.clickable === true && typeof ext.onClick === 'function', 'module normalized fields');
assert(clientMod._test.moduleEnabled({ [extId]: { enabled: false } }, ext) === false, 'moduleEnabled respects config');
assert(clientMod._test.moduleOrder({ [extId]: { order: 9 } }, ext) === 9, 'moduleOrder respects config');
disposer();
assert(!clientMod.getModules().some((m) => m.id === extId), 'disposer unregisters the module');

console.log('== client: shadow registration against runtime semantics ==');
// Replicates the shipped SlotCore.register conflict check + entriesOfSlot
// dedupe (extracted from dsh-web-frontend): same id at the same priority
// throws; the lowest-priority entry with a given id renders.
function miniSlotRegistry() {
  const entries = [];
  return {
    register(opts) {
      const priority = opts.priority ?? 0;
      const conflict = entries.find((e) => e.options.id === opts.id && (e.options.priority ?? 0) === priority);
      if (conflict) throw new Error('list slot already has an entry with id ' + opts.id + ' at priority ' + priority);
      entries.push({ options: opts });
      entries.sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0) || (a.options.order ?? 0) - (b.options.order ?? 0));
      return () => {};
    },
    entriesOfSlot() {
      const seen = new Set();
      const out = [];
      for (const e of entries) {
        if (seen.has(e.options.id)) continue;
        seen.add(e.options.id);
        out.push(e);
      }
      return out;
    },
  };
}
const reg = miniSlotRegistry();
reg.register({ name: 'conversation.composer.dock', id: 'stats', order: 0 }); // built-in at priority 0
let threw = false;
try { reg.register({ name: 'conversation.composer.dock', id: 'stats', order: 0 }); } catch { threw = true; }
assert(threw, 'same id + same priority throws (the user-visible crash)');
reg.register({ name: 'conversation.composer.dock', id: 'stats', priority: -1, order: 0 });
const rendered = reg.entriesOfSlot();
assert(rendered.length === 1 && rendered[0].options.priority === -1, 'priority -1 shadows built-in (lowest renders)');

console.log('== client: stats-line helpers ==');
const T = clientMod._test;
assert(T.deriveCounts([
  { kind: 'user', turn: 0 },
  { kind: 'assistant', turn: 0 },
  { kind: 'tool-result', turn: 0 },
  { kind: 'assistant', turn: 0 },
  { kind: 'assistant', turn: 1 },
]).steps === 3, 'deriveCounts counts assistant steps');
const turns = T.deriveCounts([{ kind: 'assistant', turn: 0 }, { kind: 'assistant', turn: 1 }, { kind: 'assistant', turn: 1 }]).turns;
assert(turns === 2, 'deriveCounts counts distinct turns');
assert(T.formatTokens(517) === '517' && T.formatTokens(12200) === '12.2K' && T.formatTokens(8200000) === '8.2M', 'formatTokens K/M compaction');
assert(T.cacheHitPercent({ uncachedInputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 0 }) === '90', 'cacheHitPercent computes 90%');
assert(T.cacheHitPercent({ uncachedInputTokens: 0, cacheReadTokens: 500, cacheWriteTokens: 0, outputTokens: 10 }) === '100', 'cacheHitPercent full hit -> 100');
assert(T.cacheHitPercent({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }) === null, 'cacheHitPercent null when no billed input');
assert(T.statusOf(10.01, { warnThreshold: 10, criticalThreshold: 3 }) === 'ok', '>10 default color');
assert(T.statusOf(10, { warnThreshold: 10, criticalThreshold: 3 }) === 'warn', '10 is warn (yellow)');
assert(T.statusOf(3, { warnThreshold: 10, criticalThreshold: 3 }) === 'warn', '3 is warn (yellow)');
assert(T.statusOf(2.99, { warnThreshold: 10, criticalThreshold: 3 }) === 'danger', '<3 danger (red)');
const peakMeta = { peakWindows: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] };
assert(T.isPeak(peakMeta, new Date('2026-08-24T10:00:00+08:00')) === true, 'Mon 10:00 Beijing is peak (09:00-12:00)');
assert(T.isPeak(peakMeta, new Date('2026-08-24T15:00:00+08:00')) === true, 'Mon 15:00 Beijing is peak (14:00-18:00)');
assert(T.isPeak(peakMeta, new Date('2026-08-24T13:00:00+08:00')) === false, 'Mon 13:00 Beijing is idle');
assert(T.isPeak(peakMeta, new Date('2026-08-24T08:59:00+08:00')) === false, 'Mon 08:59 Beijing is idle');
assert(T.isPeak(peakMeta, new Date('2026-08-24T18:00:00+08:00')) === false, 'Mon 18:00 Beijing is idle (window end exclusive)');
assert(T.isPeak(peakMeta, new Date('2026-08-22T10:00:00+08:00')) === false, 'Sat 10:00 Beijing is idle all day (weekend)');
assert(T.isPeak(peakMeta, new Date('2026-08-23T15:00:00+08:00')) === false, 'Sun 15:00 Beijing is idle all day (weekend)');
assert(T.isPeak({}, new Date('2026-08-24T10:00:00+08:00')) === true, 'defaults to 09:00-12:00/14:00-18:00 when meta absent');

console.log('== client: duration/speed helpers (native modules) ==');
const dNodes = [
  { kind: 'tool-result', callTime: 1000, time: 4000 },
  { kind: 'assistant', turn: 0, timing: { stepStartTime: 0, firstTokenTime: 1000, completedTime: 5000 }, usage: { outputTokens: 200 } },
  { kind: 'assistant', turn: 1, timing: { stepStartTime: 100, firstTokenTime: 200, completedTime: 1200 }, usage: { outputTokens: 100 } },
];
const ds = T.deriveStats(dNodes);
assert(ds.steps === 2 && ds.turns === 2, 'deriveStats counts steps/turns');
assert(ds.llmMs === 6100 && ds.toolMs === 3000, 'deriveStats sums llm/tool durations');
assert(ds.ttftSteps === 2 && ds.ttftMs === 1100, 'deriveStats sums ttft readings');
assert(ds.decodeMs === 5000 && ds.decodeTokens === 300, 'deriveStats sums decode time/tokens');
assert(T.formatDuration(6100) === '6.1s' && T.formatDuration(709000) === '11m49s', 'formatDuration compact');
assert(T.formatTokensPerSecond(141) === '141' && T.formatTokensPerSecond(7.5) === '7.5', 'formatTokensPerSecond');

console.log('== host: per-event pricing (peak/off-peak, timeline) ==');
const PEAK_MS = Date.UTC(2026, 7, 24, 2, 0, 0); // Mon 10:00 Beijing -> peak
const IDLE_MS = Date.UTC(2026, 7, 24, 5, 0, 0); // Mon 13:00 Beijing -> idle
const SAT_PEAK = Date.UTC(2026, 7, 22, 2, 0, 0); // Sat 10:00 Beijing -> weekend idle
assert(mod.isBeijingPeak(PEAK_MS) === true, 'Mon 10:00 Beijing is peak');
assert(mod.isBeijingPeak(IDLE_MS) === false, 'Mon 13:00 Beijing is idle');
assert(mod.isBeijingPeak(SAT_PEAK) === false, 'Sat 10:00 Beijing is idle all day (weekend)');
const rPeak = mod.ratesFor('deepseek-v4-flash', PEAK_MS);
assert(rPeak && rPeak.input === 3 && rPeak.cacheHit === 0.1 && rPeak.output === 9, 'flash peak rates {3, 0.1, 9}');
const rIdle = mod.ratesFor('deepseek-v4-flash', IDLE_MS);
assert(rIdle && rIdle.input === 1.5 && rIdle.cacheHit === 0.05 && rIdle.output === 4.5, 'flash idle rates {1.5, 0.05, 4.5}');
const usage = { inputTokens: 1000, cacheReadTokens: 1000, cacheWriteTokens: 0, outputTokens: 500 };
assert(Math.abs(mod.costOf('deepseek-v4-flash', usage, PEAK_MS) - 0.0076) < 1e-9, 'weekday peak spend = 0.0076 (¥)');
assert(Math.abs(mod.costOf('deepseek-v4-flash', usage, IDLE_MS) - 0.0038) < 1e-9, 'idle spend = half (0.0038)');
assert(Math.abs(mod.costOf('deepseek-v4-flash', usage, SAT_PEAK) - 0.0038) < 1e-9, 'weekend uses idle price even at peak hours');
assert(mod.costOf('deepseek-v4-flash', { ...usage, cacheWriteTokens: 500 }, PEAK_MS) === 0.0091, 'cacheWrite billed at input price');
assert(mod.costOf('unknown-model', usage, PEAK_MS) === null, 'unpriced model -> null');
const s = { sessions: {} };
mod.accumulateSessionCost(s, { sessionId: 's1', provider: 'deepseek-official', model: 'deepseek-v4-flash' }, usage, PEAK_MS);
assert(s.sessions.s1.cost === 0.0076 && s.sessions.s1.priced === true, 'official usage accumulated per event');
const s2 = { sessions: {} };
mod.accumulateSessionCost(s2, { sessionId: 's1', provider: 'third-party-x', model: 'deepseek-v4-flash' }, usage, PEAK_MS);
assert(s2.sessions.s1 === undefined, 'non-official provider not priced');
assert(T.fmtMoney(0.0076) === '0.01' && T.fmtMoney(1.2) === '1.20' && T.fmtMoney(0) === '0.00', 'fmtMoney always 2 decimals');

console.log('== host: 2026-09-10 flash repricing ==');
const NEW_IDLE = Date.UTC(2026, 8, 10, 5, 0, 0); // Thu 13:00 Beijing -> idle
const NEW_PEAK = Date.UTC(2026, 8, 10, 7, 0, 0); // Thu 15:00 Beijing -> peak
const BEFORE = Date.UTC(2026, 8, 10, 3, 0, 0);    // Thu 11:00 Beijing -> still old policy
assert(mod.isBeijingPeak(NEW_PEAK) === true && mod.isBeijingPeak(NEW_IDLE) === false, 'new-policy timestamps peak/idle as expected');
const oldRates = mod.ratesFor('deepseek-v4-flash', BEFORE);
assert(oldRates && oldRates.input === 3 && oldRates.cacheHit === 0.1 && oldRates.output === 9, 'before the switch: flash still {3, 0.1, 9}');
const newIdle = mod.ratesFor('deepseek-v4-flash', NEW_IDLE);
assert(newIdle && newIdle.input === 1 && newIdle.cacheHit === 0.02 && newIdle.output === 4, 'new idle: flash {1, 0.02, 4}');
const newPeak = mod.ratesFor('deepseek-v4-flash', NEW_PEAK);
assert(newPeak && newPeak.input === 2 && newPeak.cacheHit === 0.04 && newPeak.output === 8, 'new peak: flash = 2x idle {2, 0.04, 8}');
assert(Math.abs(mod.costOf('deepseek-v4-flash', usage, NEW_IDLE) - 0.00302) < 1e-9, 'new idle spend = 0.00302');
assert(Math.abs(mod.costOf('deepseek-v4-flash', usage, NEW_PEAK) - 0.00604) < 1e-9, 'new peak spend = 0.00604');
const proNew = mod.ratesFor('deepseek-v4-pro', NEW_IDLE);
assert(proNew && proNew.input === 4.5 && proNew.cacheHit === 0.15 && proNew.output === 13.5, 'pro keeps the previous policy (unlisted in the new one)');

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
