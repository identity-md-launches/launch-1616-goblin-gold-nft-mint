import test from 'node:test';
import assert from 'node:assert/strict';
import { clampQuantity, formatEth, mintLimit } from '../src/rules.ts';
import { validAccounts, walletError } from '../src/wallet.ts';
const base = { soldOut: false, maxSupply: 10000n, liveSupply: 500n, maxPerWallet: 20n, minted: 0n };
test('mint cap uses both lifetime allowance and remaining supply, including sellout after refunds', () => {
  assert.equal(mintLimit(base), 20);
  assert.equal(mintLimit({ ...base, minted: 19n }), 1);
  assert.equal(mintLimit({ ...base, liveSupply: 9997n }), 3);
  assert.equal(mintLimit({ ...base, minted: 20n }), 0);
  assert.equal(mintLimit({ ...base, soldOut: true, liveSupply: 9990n }), 0);
  assert.equal(mintLimit({ ...base, minted: 21n }), 0);
});
test('quantity always resolves to a whole number in the permitted range', () => {
  for (let cap = 0; cap <= 20; cap++) for (let value = -50; value < 60; value += .25) {
    const result = clampQuantity(value, cap);
    assert.ok(Number.isInteger(result) && result >= 1 && result <= Math.max(1, cap));
  }
  assert.equal(clampQuantity(NaN, 20), 1);
  assert.equal(clampQuantity(Infinity, 20), 20);
});
test('ETH totals preserve wei exactly without floating point rounding', () => {
  assert.equal(formatEth(0n), '0');
  assert.equal(formatEth(1000000000000000n), '0.001');
  assert.equal(formatEth(20n * 1000000000000000n), '0.02');
  assert.equal(formatEth(1n), '0.000000000000000001');
  assert.equal(formatEth(1000000000000000001n), '1.000000000000000001');
});
test('provider accounts and error responses are validated', () => {
  assert.deepEqual(validAccounts(undefined), []);
  assert.deepEqual(validAccounts(['wrong', 42, null]), []);
  assert.equal(validAccounts(['0x1234567890123456789012345678901234567890']).length, 1);
  assert.match(walletError({ code: 4001 }), /declined/);
  assert.match(walletError({ code: -32002 }), /already open/);
  assert.match(walletError({ code: 4900 }), /offline/);
});
