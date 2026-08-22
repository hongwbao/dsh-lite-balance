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
const fakeCtx = {
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
assert(Object.keys(injections).sort().join(',') === 'conversation.composer.dock,shell.overlay,sidebar.footer.action', 'injects into sidebar footer + composer dock + overlay');
for (const cb of Object.values(injections)) cb();
const chip = registrations.find((r) => r.opts.id === 'dsh-lite-balance');
const toast = registrations.find((r) => r.opts.id === 'dsh-lite-balance-toast');
assert(chip && chip.opts.name === 'sidebar.footer.action' && chip.opts.order === -10, 'chip registered in sidebar.footer.action (order -10)');
assert(toast && toast.opts.name === 'shell.overlay', 'toast registered in shell.overlay');
assert(typeof chip.opts.label === 'function' && chip.opts.label() === 'label', 'chip label thunk resolves through locale');
assert(typeof chip.opts.inject().t === 'function', 'chip receives bound t');

const stats = registrations.find((r) => r.opts.id === 'stats');
assert(stats && stats.opts.name === 'conversation.composer.dock' && stats.opts.priority === -1 && typeof stats.comp === 'function', 'shadows built-in stats: composer.dock id "stats" at priority -1');

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
assert(T.statusOf(10.01, { warnThreshold: 10, criticalThreshold: 3 }) === 'ok', '>10 default color');
assert(T.statusOf(10, { warnThreshold: 10, criticalThreshold: 3 }) === 'warn', '10 is warn (yellow)');
assert(T.statusOf(3, { warnThreshold: 10, criticalThreshold: 3 }) === 'warn', '3 is warn (yellow)');
assert(T.statusOf(2.99, { warnThreshold: 10, criticalThreshold: 3 }) === 'danger', '<3 danger (red)');
const offPeakMeta = { offPeakStart: '00:30', offPeakEnd: '08:30' };
assert(T.isOffPeak(offPeakMeta, new Date('2026-08-22T01:00:00+08:00')) === true, '01:00 Beijing is off-peak');
assert(T.isOffPeak(offPeakMeta, new Date('2026-08-22T12:00:00+08:00')) === false, '12:00 Beijing is peak');
assert(T.isOffPeak({}, new Date('2026-08-22T12:00:00+08:00')) === false, 'defaults window when meta absent');

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
