// Exercise the real TypeScript adapter as a library, without opening a browser.
// The Node test suite gives it isolated storage and a deterministic clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/browserBackend.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { createBrowserBackend } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

const SEED = {
  wallet: { budgetMinor: 10000, approvalThresholdMinor: 10000, quoteTtlMs: 500 },
  catalog: [{ itemId: 'tool', name: 'Test tool', priceMinor: 6000, category: 'Test' }],
  agents: [{ agentId: 'test-agent', name: 'Test agent', lane: 'Test', items: ['tool'] }],
};

async function sandbox(fn) {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalNow = Date.now;
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  } });
  let clock = 1000;
  Date.now = () => clock;
  try {
    const backend = createBrowserBackend();
    const snap = await backend.reset(SEED);
    await fn(backend, snap.epoch, now => { clock = now; });
  } finally {
    Date.now = originalNow;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete globalThis.localStorage;
  }
}

test('browser adapter: expired holds release before a new placement without a state read', async () => {
  await sandbox(async (b, epoch, clock) => {
    const old = await b.placeRequest({ epoch, requestId: 'old', agentId: 'test-agent', itemId: 'tool', qty: 1 });
    assert.equal(old.result.status, 'reserved');
    clock(1501);
    const next = await b.placeRequest({ epoch, requestId: 'new', agentId: 'test-agent', itemId: 'tool', qty: 1 });
    assert.equal(next.result.status, 'reserved');
    assert.equal(next.result.totals.availableMinor, 4000);
    assert.equal((await b.state()).requests.find(r => r.requestId === 'old').status, 'expired');
  });
});

test('browser adapter: stale actions and duplicate placement cannot affect a reused ID', async () => {
  await sandbox(async (b, epoch) => {
    const request = { epoch, requestId: 'same-id', agentId: 'test-agent', itemId: 'tool', qty: 1 };
    await b.placeRequest(request);
    const reset = await b.reset(SEED);
    const fresh = await b.placeRequest({ ...request, epoch: reset.epoch });
    assert.equal(fresh.result.epoch, reset.epoch);
    for (const action of ['approve', 'reject', 'commit', 'cancel']) {
      const stale = await b.act(request.requestId, action, epoch);
      assert.equal(stale.ok, false);
      assert.equal(stale.error.code, 'stale_epoch');
      assert.match(stale.error.detail, /previous sandbox/);
    }
    const replay = await b.placeRequest(request);
    assert.equal(replay.error.code, 'stale_epoch');
    const snap = await b.state();
    assert.equal(snap.requests.length, 1);
    assert.equal(snap.requests[0].status, 'reserved');
    assert.equal(snap.totals.availableMinor, 4000);
    assert.equal((await b.act('same-id', 'commit', reset.epoch)).result.status, 'committed');
  });
});

test('browser adapter: validation errors use the same UI error contract as HTTP', async () => {
  await sandbox(async (b, epoch) => {
    const config = await b.configure({ budgetMinor: 1e30 });
    assert.equal(config.error.code, 'invalid_budget');
    assert.match(config.error.detail, /integer cents/);
    const price = await b.setCatalogPrice('tool', -1);
    assert.equal(price.error.code, 'invalid_price');
    const placement = await b.placeRequest({ epoch, requestId: 'bad', agentId: 'test-agent', itemId: 'tool', qty: 0 });
    assert.equal(placement.error.code, 'invalid_qty');
    const missingEpoch = await b.act('missing', 'cancel');
    assert.equal(missingEpoch.error.code, 'epoch_required');
    assert.equal((await b.state()).requests.length, 0);
  });
});
