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
const fakeCtx = {
  inject(list, cb) {
    cb({ webServer: fakeWebServer, effect: (fn, label) => { const d = fn(); effects.push({ fn, label, d }); } });
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
assert(out.status === 503 && out.body.code === 'missing-api-key', 'missing key -> 503 missing-api-key');

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
assert(Object.keys(injections).sort().join(',') === 'shell.overlay,sidebar.footer.action', 'injects into sidebar.footer.action + shell.overlay');
for (const cb of Object.values(injections)) cb();
const chip = registrations.find((r) => r.opts.id === 'dsh-lite-balance');
const toast = registrations.find((r) => r.opts.id === 'dsh-lite-balance-toast');
assert(chip && chip.opts.name === 'sidebar.footer.action' && chip.opts.order === -10, 'chip registered in sidebar.footer.action (order -10)');
assert(toast && toast.opts.name === 'shell.overlay', 'toast registered in shell.overlay');
assert(typeof chip.opts.label === 'function' && chip.opts.label() === 'label', 'chip label thunk resolves through locale');
assert(typeof chip.opts.inject().t === 'function', 'chip receives bound t');

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
