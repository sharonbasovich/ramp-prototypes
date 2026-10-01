// tests/cost.test.mjs — True Cost oracle from ACCEPTANCE.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCostState,
  compareCosts,
  editCost,
  selectLowestComplete,
  resetCost,
} from '../src/engine/cost.mjs';

const fresh = () => createCostState();
const minor = (m) => m && m.minor.toString();
const row = (cmp, id) => cmp.rows.find((r) => r.id === id);

test('base fixture: Berlin 105000 vs Boston 102000; sticker Berlin, winner Boston by 3000', () => {
  const s = fresh();
  const c = compareCosts(s);
  assert.equal(minor(row(c, 'berlin').goodsConverted), '93500');
  assert.equal(minor(row(c, 'berlin').total), '105000');
  assert.equal(minor(row(c, 'boston').total), '102000');
  assert.equal(c.stickerWinner.id, 'berlin'); // cheapest converted goods
  assert.equal(c.completeWinner.id, 'boston'); // cheapest complete cost
  assert.equal(c.differenceMinor.toString(), '3000');
  assert.equal(c.selectionReady, true);
});

test('goods-only lens chooses wrong vendor (Berlin sticker 6500 cheaper)', () => {
  const s = fresh();
  const c = compareCosts(s);
  const goodsDiff =
    row(c, 'boston').goodsConverted.minor - row(c, 'berlin').goodsConverted.minor;
  assert.equal(goodsDiff.toString(), '6500'); // disclosure number, never "savings"
});

test('recompute: Berlin shipping USD 0 -> Berlin wins by 6000', () => {
  const s = fresh();
  editCost(s, { vendorId: 'berlin', component: 'shipping', minor: 0n, currency: 'USD' });
  const c = compareCosts(s);
  assert.equal(minor(row(c, 'berlin').total), '96000');
  assert.equal(c.completeWinner.id, 'berlin');
  assert.equal(c.differenceMinor.toString(), '6000');
});

test('recompute: rate 1.00 -> Berlin total 96500, wins by 5500', () => {
  const s = fresh();
  editCost(s, { vendorId: 'berlin', component: 'rate', rateText: '1.00' });
  const c = compareCosts(s);
  assert.equal(minor(row(c, 'berlin').total), '96500');
  assert.equal(c.completeWinner.id, 'berlin');
  assert.equal(c.differenceMinor.toString(), '5500');
});

test('unknown charge is not zero: Berlin fee unknown -> incomplete, selection blocked', () => {
  const s = fresh();
  editCost(s, { vendorId: 'berlin', component: 'fee', minor: null });
  const c = compareCosts(s);
  assert.equal(row(c, 'berlin').complete, false);
  assert.match(row(c, 'berlin').unknowns[0].reason, /not supplied/);
  assert.equal(row(c, 'berlin').total, null);
  assert.equal(c.selectionReady, false);
  const r = selectLowestComplete(s);
  assert.equal(r.ok, false);
  assert.match(r.reason, /incomplete/);
});

test('explicit zero IS known: Boston fee 0 keeps it complete', () => {
  const s = fresh();
  const c = compareCosts(s);
  assert.equal(row(c, 'boston').complete, true);
  assert.equal(row(c, 'boston').unknowns.length, 0);
});

test('unknown survives in export/reset boundary — reset restores fixture', () => {
  const s = fresh();
  editCost(s, { vendorId: 'berlin', component: 'fee', minor: null });
  assert.equal(compareCosts(s).rows.find((r) => r.id === 'berlin').complete, false);
  const s2 = resetCost(s);
  const c2 = compareCosts(s2);
  assert.equal(row(c2, 'berlin').complete, true);
  assert.notEqual(s2.epoch, s.epoch);
});

test('charge in goods currency converts at fixture rate, not mislabeled USD', () => {
  const s = fresh();
  // Berlin shipping supplied in EUR: EUR 90 @1.10 -> USD 99
  editCost(s, { vendorId: 'berlin', component: 'shipping', minor: 9000n, currency: 'EUR' });
  const c = compareCosts(s);
  const berlin = row(c, 'berlin');
  assert.equal(minor(berlin.shipping.money), '9900');
  assert.equal(minor(berlin.total), '105900'); // 93500+9900+2500+0
});

test('unavailable FX pair blocks completion — never invented assumptions', () => {
  const s = fresh();
  // KWD charge has no fixture rate -> vendor incomplete
  editCost(s, { vendorId: 'boston', component: 'fee', minor: 500n, currency: 'KWD' });
  const c = compareCosts(s);
  assert.equal(row(c, 'boston').complete, false);
  assert.match(row(c, 'boston').unknowns[0].reason, /no fixture rate/);
  assert.equal(c.selectionReady, false);
});

test('identical totals -> visible tie, no fabricated winner', () => {
  const s = fresh();
  editCost(s, { vendorId: 'berlin', component: 'shipping', minor: 7000n, currency: 'USD' });
  const c = compareCosts(s);
  // 93500 + 7000 + 2500 = 103000 vs Boston 102000… adjust to exact tie
  editCost(s, { vendorId: 'berlin', component: 'shipping', minor: 6000n, currency: 'USD' });
  const c2 = compareCosts(s);
  // 93500 + 6000 + 2500 + 0 = 102000 = Boston
  assert.equal(c2.tie, true);
  assert.equal(c2.completeWinner, null);
  assert.equal(selectLowestComplete(s).ok, false);
});

test('selection creates review snapshot; any edit revokes it permanently', () => {
  const s = fresh();
  const r = selectLowestComplete(s);
  assert.equal(r.ok, true);
  assert.equal(r.selection.vendorId, 'boston');
  assert.equal(r.selection.total.minor, '102000');
  assert.equal(compareCosts(s).selectionStatus, 'current');

  editCost(s, { vendorId: 'berlin', component: 'shipping', minor: 9001n, currency: 'USD' });
  assert.equal(compareCosts(s).selectionStatus, 'revoked');
  editCost(s, { vendorId: 'berlin', component: 'shipping', minor: 9000n, currency: 'USD' });
  // reverting does NOT restore
  assert.equal(compareCosts(s).selectionStatus, 'revoked');
});

test('selection fingerprint binds full input set incl. rate and epoch', () => {
  const s = fresh();
  selectLowestComplete(s);
  editCost(s, { vendorId: 'berlin', component: 'rate', rateText: '1.00' });
  assert.equal(compareCosts(s).selectionStatus, 'revoked');
});
