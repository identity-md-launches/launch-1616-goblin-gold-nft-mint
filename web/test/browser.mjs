// All wallet and transaction interactions below are simulated. No signing keys or live writes.
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics } from 'viem';
const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = resolve(root, 'dist');
const output = resolve(root, 'test/scratch/browser');
await mkdir(output, { recursive: true });
const abi = JSON.parse(readFileSync(resolve(root, 'web/src/generated/GoblinNFT.ts'), 'utf8').split('export const abi = ')[1].replace(/ as const;\s*$/, ''));
const code = execFileSync('forge', ['inspect', '--offline', 'GoblinNFT', 'deployedBytecode'], { cwd: root, encoding: 'utf8' }).trim();
const contract = '0xc5d5f314da6d4a433f9bf897a2cc24a537576cb1';
const account = '0x1234567890123456789012345678901234567890';
const other = '0x2234567890123456789012345678901234567890';
const hash = '0x' + 'a1'.repeat(32);
const blockHash = '0x' + 'b1'.repeat(32);
const number = 26185700n;
const h = value => '0x' + BigInt(value).toString(16);
const server = createServer(async (request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/preview\//, '');
  const file = resolve(dist, name || 'index.html');
  if (!file.startsWith(dist + '/') && file !== dist) { response.writeHead(403).end(); return; }
  try {
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const results = [];
let lastPage;
const record = (name, detail = '') => { results.push({ name, passed: true, detail }); console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`); };
const text = async (locator, expected) => { await locator.filter({ hasText: expected }).first().waitFor(); };
const wait = async (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000 });

function installWallets({ mode, account, other, hash }) {
  window.__mock = { chain: '0x1', account, other, mode, rejectConnect: false, rejectSend: false, rejectSwitch: false, requests: [], lastTx: null, receipt: 'success', wallets: [] };
  const create = (name, id) => {
    const listeners = {};
    const provider = {
      request: async request => {
        const state = window.__mock;
        state.requests.push({ wallet: name, ...request });
        if (request.method === 'eth_requestAccounts') { if (state.rejectConnect) throw { code: state.rejectConnect }; return [state.account]; }
        if (request.method === 'eth_accounts') return state.account ? [state.account] : [];
        if (request.method === 'eth_chainId') return state.chain;
        if (request.method === 'wallet_switchEthereumChain') { if (state.rejectSwitch) throw { code: 4001 }; state.chain = '0x1'; provider.emit('chainChanged', '0x1'); return null; }
        if (request.method === 'eth_sendTransaction') { if (state.rejectSend) throw { code: 4001, message: 'User rejected request' }; state.lastTx = request.params[0]; return hash; }
        throw Error(`Unexpected provider method: ${request.method}`);
      },
      on: (event, fn) => (listeners[event] ??= new Set()).add(fn),
      removeListener: (event, fn) => listeners[event]?.delete(fn),
      emit: (event, value) => listeners[event]?.forEach(fn => fn(value)),
    };
    const detail = { info: { uuid: id, name, rdns: 'test.local', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }, provider };
    return { ...detail, announce: () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail })) };
  };
  window.__mock.add = (name, id) => { const wallet = create(name, id); window.__mock.wallets.push(wallet); wallet.announce(); return wallet; };
  if (mode === 'multi') {
    window.__mock.wallets = [create('MetaMask', 'a'), create('Rabby', 'b'), create('Coinbase Wallet', 'c')];
    window.ethereum = window.__mock.wallets[0].provider;
  } else if (mode === 'legacy') {
    window.__mock.wallets = [create('Mobile wallet', 'mobile')];
    window.ethereum = window.__mock.wallets[0].provider;
  }
  if (mode !== 'legacy') window.addEventListener('eip6963:requestProvider', () => window.__mock.wallets.forEach(w => w.announce()));
}

async function scenario(browser, mode = 'multi', overrides = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(15000);
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  const state = { head: number, minted: 18n, liveSupply: 123n, balance: 1n, released: false, soldOut: false, refundsOpen: true, badCode: false, rpcFail: false, ...overrides };
  await page.addInitScript(installWallets, { mode, account, other, hash });
  const block = { number: h(number), hash: blockHash, parentHash: blockHash, timestamp: h(1791920000n), nonce: '0x0000000000000000', difficulty: '0x0', totalDifficulty: '0x0', gasLimit: '0x1c9c380', gasUsed: '0x5208', miner: account, extraData: '0x', baseFeePerGas: '0x1', size: '0x1', transactions: [], uncles: [], logsBloom: '0x' + '00'.repeat(256), receiptsRoot: blockHash, stateRoot: blockHash, transactionsRoot: blockHash, mixHash: blockHash };
  const tokenUri = 'data:application/json;base64,' + Buffer.from(JSON.stringify({ name: 'Goblin #1', image: 'data:image/svg+xml;base64,' + Buffer.from(await readFile(resolve(root, 'web/public/unrevealed.svg'))).toString('base64'), attributes: [{ trait_type: 'Status', value: 'Unrevealed' }] })).toString('base64');
  async function rpc(request) {
    const { method, params = [], id } = request;
    let result;
    if (state.rpcFail) return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Simulated RPC unavailable' } };
    if (method === 'eth_chainId') result = '0x1';
    else if (method === 'eth_getCode') result = state.badCode ? '0x1234' : code;
    else if (method === 'eth_blockNumber') result = h(state.head);
    else if (method === 'eth_getBlockByNumber') result = block;
    else if (method === 'eth_call') {
      const decoded = decodeFunctionData({ abi, data: params[0].data });
      const values = { PRICE: 1000000000000000n, MAX_SUPPLY: 10000n, MAX_PER_WALLET: 20n, liveSupply: state.liveSupply, soldOut: state.soldOut, soldOutAt: state.soldOut ? 1700000000n : 0n, revealed: false, revealBlock: 26185640n, refundsOpen: state.refundsOpen, released: state.released, targetsSet: false, targetsSetAt: 0n, TARGET_REVIEW_PERIOD: 604800n, REFUND_REOPEN_DELAY: 7776000n, polTarget: '0x' + '0'.repeat(40), reserveTarget: '0x' + '0'.repeat(40), vrfTarget: '0x' + '0'.repeat(40), totalRevenueDeposited: 1000000000000000n, totalRevenueClaimed: 0n, deferredRevenue: state.released ? 0n : 1000000000000000n, mintedBy: String(decoded.args?.[0]).toLowerCase() === other ? 20n : state.minted, balanceOf: state.balance, ownerOf: account, pendingRevenue: 1000000000000000n, tokenURI: tokenUri };
      if (decoded.functionName in values) result = encodeFunctionResult({ abi, functionName: decoded.functionName, result: values[decoded.functionName] });
      else if (decoded.functionName === 'claimRevenue') result = encodeFunctionResult({ abi, functionName: 'claimRevenue', result: 1000000000000000n });
      else result = '0x';
    } else if (method === 'eth_getLogs') {
      result = state.balance > 0n ? [{ address: contract, blockHash, blockNumber: h(number), data: '0x', logIndex: '0x0', transactionHash: hash, transactionIndex: '0x0', removed: false, topics: encodeEventTopics({ abi, eventName: 'Transfer', args: { from: '0x' + '0'.repeat(40), to: account, tokenId: 1n } }) }] : [];
    } else if (method === 'eth_getTransactionReceipt') {
      const status = await page.evaluate(() => window.__mock.receipt);
      result = status === 'pending' ? null : { transactionHash: hash, transactionIndex: '0x0', blockHash, blockNumber: h(number), from: account, to: contract, cumulativeGasUsed: '0x186a0', gasUsed: '0x186a0', contractAddress: null, logs: [], logsBloom: '0x' + '0'.repeat(512), status: status === 'reverted' ? '0x0' : '0x1', type: '0x2', effectiveGasPrice: '0x1' };
    } else if (method === 'eth_getTransactionByHash') {
      const tx = await page.evaluate(() => window.__mock.lastTx);
      result = { hash, blockHash, blockNumber: h(number), transactionIndex: '0x0', from: account, to: tx.to, input: tx.data, value: tx.value, nonce: '0x0', gas: '0x186a0', gasPrice: '0x1', maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1', type: '0x2', chainId: '0x1', v: '0x1', r: blockHash, s: blockHash, accessList: [] };
    } else throw Error(`Unexpected RPC: ${method}`);
    return { jsonrpc: '2.0', id, result };
  }
  await page.route(/https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org)\/?/, async route => {
    try {
      const request = route.request().postDataJSON();
      const body = Array.isArray(request) ? await Promise.all(request.map(rpc)) : await rpc(request);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    } catch (error) { failures.push(error.message); console.error('Mock RPC failure:', error.message); await route.abort(); }
  });
  await page.goto(url);
  if (!state.badCode && !state.rpcFail) await text(page.locator('.supply-label'), `${state.liveSupply.toLocaleString()} / 10,000`);
  return { context, page, state, failures };
}
async function connect(page, name = 'Rabby') {
  await page.getByRole('button', { name: 'Connect wallet to mint', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await wait(page, () => document.querySelector('.wallet-button').textContent.includes('0x1234'));
}
let browser;
try {
  browser = await chromium.launch({ headless: true });
  {
    const s = await scenario(browser, 'none'); const { page } = s;
    const box = await page.locator('.mint-button').boundingBox(); assert.ok(box.y + box.height <= 844);
    assert.ok(await page.locator('h1').isVisible());
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    assert.equal(await page.locator('#quantity').inputValue(), '2');
    await text(page.locator('.total-row'), '0.002 ETH');
    await page.getByRole('button', { name: 'Connect wallet to mint', exact: true }).click();
    await text(page.getByRole('dialog'), 'No browser wallet detected');
    await text(page.getByRole('dialog'), "open this page in your wallet's built-in browser");
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('mint-button')), true);
    record('No-wallet state, quantity/total, mobile action visibility, Escape and focus return');
    await s.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy contract address' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), contract);
    assert.equal(await page.locator('.contract-address a').getAttribute('href'), `https://etherscan.io/address/${contract}`);
    record('Contract copy action and pinned Etherscan destination');
    await page.evaluate(() => window.__mock.add('Late wallet', 'late'));
    await page.getByRole('button', { name: 'Connect wallet to mint', exact: true }).click();
    await page.getByRole('button', { name: 'Late wallet', exact: true }).waitFor();
    record('Late EIP-6963 discovery after page load');
    await s.context.close();
  }
  {
    const s = await scenario(browser); const { page } = s;
    await page.getByRole('button', { name: 'Connect wallet to mint', exact: true }).click();
    assert.equal(await page.locator('.wallet-option').count(), 3);
    await page.getByRole('button', { name: 'Look for wallets again' }).click(); assert.equal(await page.locator('.wallet-option').count(), 3);
    await page.evaluate(() => { window.__mock.rejectConnect = 4001; });
    await page.getByRole('button', { name: 'Rabby', exact: true }).click(); await text(page.getByRole('alert'), 'Request declined');
    await page.evaluate(() => { window.__mock.rejectConnect = -32002; });
    await page.getByRole('button', { name: 'Rabby', exact: true }).click(); await text(page.getByRole('alert'), 'already open');
    await page.evaluate(() => { window.__mock.rejectConnect = false; window.__mock.chain = '0x89'; });
    await page.getByRole('button', { name: 'Rabby', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Switch to Ethereum', exact: true }).waitFor();
    await page.evaluate(() => { window.__mock.rejectSwitch = true; });
    await page.getByRole('button', { name: 'Switch to Ethereum', exact: true }).click(); await text(page.getByRole('alert'), 'Request declined');
    await page.evaluate(() => { window.__mock.rejectSwitch = false; });
    await page.getByRole('button', { name: 'Switch to Ethereum', exact: true }).click(); await page.getByRole('button', { name: 'Mint a goblin', exact: true }).waitFor();
    const requests = await page.evaluate(() => window.__mock.requests); assert.ok(requests.every(request => request.wallet === 'Rabby'));
    record('Three-wallet discovery, deduplication, selected-provider isolation, rejected connection/switch and retry');
    await page.locator('#quantity').fill('20'); assert.equal(await page.locator('#quantity').inputValue(), '2');
    await text(page.locator('.total-row'), '0.002 ETH');
    await page.getByRole('button', { name: 'Mint 2 goblins', exact: true }).click();
    await text(page.getByRole('dialog'), '0.002 ETH');
    await page.evaluate(() => { window.__mock.rejectSend = true; });
    await page.getByRole('button', { name: 'Confirm in wallet' }).click(); await text(page.getByRole('alert'), 'Request declined');
    await page.getByRole('button', { name: 'Close and refresh' }).click();
    await wait(page, () => !document.querySelector('.mint-button').disabled);
    await page.getByRole('button', { name: 'Mint 2 goblins', exact: true }).click();
    await page.evaluate(() => { window.__mock.rejectSend = false; window.__mock.receipt = 'pending'; });
    await page.getByRole('button', { name: 'Confirm in wallet' }).click(); await text(page.getByRole('dialog'), 'Transaction sent');
    assert.equal(await page.getByRole('button', { name: 'Close dialog' }).isDisabled(), true);
    await page.screenshot({ path: resolve(output, 'pending-390.png') });
    const sent = await page.evaluate(() => window.__mock.lastTx);
    assert.equal(sent.to, contract); assert.equal(sent.from, account); assert.equal(BigInt(sent.value), 2000000000000000n);
    assert.deepEqual(decodeFunctionData({ abi, data: sent.data }), { functionName: 'mint', args: [2n] });
    await page.evaluate(() => { window.__mock.receipt = 'success'; }); s.state.head++;
    await text(page.getByRole('dialog'), 'Transaction confirmed on Ethereum');
    record('Mint cap, exact payment/calldata, review, rejection, pending and confirmed receipt');
    await page.getByRole('button', { name: 'Close and refresh' }).click();
    await page.getByRole('heading', { name: 'Goblin #1', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Claim 0 ETH', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Refund', exact: true }).click(); await text(page.getByRole('dialog'), 'permanently burns');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    record('Event-based ownership, on-chain metadata, pre-release claim guard and destructive refund review');
    await page.evaluate(() => { window.__mock.account = window.__mock.other; window.__mock.wallets[1].provider.emit('accountsChanged', [window.__mock.other]); });
    await page.getByRole('button', { name: 'Wallet mint limit reached', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Wallet mint limit reached' }).isDisabled(), true);
    await page.evaluate(() => window.__mock.wallets[1].provider.emit('disconnect', { code: 4900 }));
    await page.getByRole('button', { name: 'Connect wallet to mint', exact: true }).waitFor();
    record('Account-change cap refresh and provider disconnect');
    assert.deepEqual(s.failures, []); await s.context.close();
  }
  {
    const s = await scenario(browser); const { page } = s; await connect(page);
    await page.getByRole('button', { name: 'Mint a goblin', exact: true }).click();
    await page.evaluate(() => { window.__mock.chain = '0x89'; window.__mock.wallets[1].provider.emit('chainChanged', '0x89'); });
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Switch to Ethereum', exact: true }).click();
    await page.getByRole('button', { name: 'Mint a goblin', exact: true }).click();
    await page.evaluate(() => { window.__mock.account = window.__mock.other; });
    await page.getByRole('button', { name: 'Confirm in wallet' }).click();
    await text(page.getByRole('alert'), 'Wallet or network changed');
    assert.equal(await page.evaluate(() => window.__mock.requests.filter(x => x.method === 'eth_sendTransaction').length), 0);
    record('Network events cancel stale review; silent account changes are caught before sending'); await s.context.close();
  }
  {
    const s = await scenario(browser); const { page } = s; await connect(page);
    s.state.rpcFail = true;
    await page.getByRole('button', { name: 'Refresh state', exact: true }).click();
    await text(page.locator('.data-message'), 'Ethereum data is unavailable');
    assert.equal(await page.locator('.mint-button').isDisabled(), true);
    s.state.rpcFail = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await wait(page, () => !document.querySelector('.mint-button').disabled);
    record('RPC outage disables stale writes and retry restores current data'); await s.context.close();
  }
  {
    const s = await scenario(browser, 'legacy', { balance: 0n, minted: 0n }); const { page } = s;
    await connect(page, 'Browser wallet');
    await text(page.locator('#collection'), 'No goblins in this wallet yet');
    await page.locator('.wallet-button').click(); await page.getByRole('button', { name: 'Disconnect from this page' }).click();
    await page.getByRole('button', { name: 'Connect wallet to mint', exact: true }).waitFor();
    assert.deepEqual(s.failures, []); record('Legacy window.ethereum mobile provider, empty collection and local disconnect'); await s.context.close();
  }
  {
    const s = await scenario(browser, 'multi', { released: true, refundsOpen: false }); const { page } = s;
    await connect(page); await page.getByRole('heading', { name: 'Goblin #1', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Refund', exact: true }).isDisabled(), true);
    await page.getByLabel('Select loaded goblins', { exact: true }).check();
    await page.getByRole('button', { name: 'Claim 0.001 ETH', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm in wallet' }).click(); await text(page.getByRole('dialog'), 'Transaction confirmed on Ethereum');
    const sent = await page.evaluate(() => window.__mock.lastTx);
    assert.equal(BigInt(sent.value), 0n); assert.deepEqual(decodeFunctionData({ abi, data: sent.data }), { functionName: 'claimRevenue', args: [[1n]] });
    assert.deepEqual(s.failures, []); record('Post-release claim exact token IDs and closed-refund guard'); await s.context.close();
  }
  {
    const s = await scenario(browser); const { page } = s; await connect(page);
    await page.getByRole('button', { name: 'Mint a goblin', exact: true }).click();
    await page.evaluate(() => { window.__mock.receipt = 'reverted'; });
    await page.getByRole('button', { name: 'Confirm in wallet' }).click(); await text(page.getByRole('alert'), 'transaction reverted');
    assert.deepEqual(s.failures, []); record('Reverted receipt is failure, never success'); await s.context.close();
  }
  {
    const s = await scenario(browser); const { page } = s; await connect(page);
    await page.getByRole('heading', { name: 'Goblin #1', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Refund', exact: true }).click();
    await page.getByRole('button', { name: 'Burn and refund in wallet' }).click();
    await text(page.getByRole('dialog'), 'Transaction confirmed on Ethereum');
    const sent = await page.evaluate(() => window.__mock.lastTx);
    assert.equal(BigInt(sent.value), 0n);
    assert.deepEqual(decodeFunctionData({ abi, data: sent.data }), { functionName: 'refund', args: [1n] });
    assert.deepEqual(s.failures, []); record('Confirmed refund uses the reviewed token ID and sends no ETH'); await s.context.close();
  }
  {
    const s = await scenario(browser); const { page } = s; await connect(page);
    await page.clock.install();
    await page.getByRole('button', { name: 'Mint a goblin', exact: true }).click();
    await page.evaluate(() => { window.__mock.receipt = 'pending'; });
    await page.getByRole('button', { name: 'Confirm in wallet' }).click();
    await text(page.getByRole('dialog'), 'Transaction sent');
    await page.clock.fastForward(120001);
    await text(page.getByRole('dialog'), 'Confirmation is taking longer than expected');
    await page.evaluate(() => { window.__mock.receipt = 'success'; }); s.state.head++;
    await page.getByRole('button', { name: 'Check confirmation again' }).click();
    await text(page.getByRole('dialog'), 'Transaction confirmed on Ethereum');
    assert.equal(await page.evaluate(() => window.__mock.requests.filter(x => x.method === 'eth_sendTransaction').length), 1);
    record('Delayed confirmation retry checks the original hash without resending'); await s.context.close();
  }
  {
    const s = await scenario(browser, 'multi', { soldOut: true, liveSupply: 9998n });
    assert.equal(await s.page.getByRole('button', { name: 'Sold out', exact: true }).isDisabled(), true);
    record('Permanent sold-out flag survives lower live supply after refunds'); await s.context.close();
  }
  {
    const s = await scenario(browser, 'multi', { badCode: true }); const { page } = s;
    await text(page.locator('.data-message'), 'Contract verification failed');
    await connect(page); assert.equal(await page.locator('.mint-button').isDisabled(), true);
    s.state.badCode = false; await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await wait(page, () => !document.querySelector('.mint-button').disabled);
    record('Runtime mismatch disables transactions; explicit retry recovers'); await s.context.close();
  }
  {
    const s = await scenario(browser, 'none'); const { page } = s;
    for (const width of [320, 390, 720, 960, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: resolve(output, `layout-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addScriptTag({ path: resolve(root, 'web/node_modules/axe-core/axe.min.js') });
    let audit = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
    assert.deepEqual(audit.violations.map(v => v.id), []);
    await page.getByRole('button', { name: 'Connect wallet to mint', exact: true }).click();
    audit = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
    assert.deepEqual(audit.violations.map(v => v.id), []);
    await page.keyboard.press('Tab'); await page.screenshot({ path: resolve(output, 'wallet-keyboard-390.png') });
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(output, 'text-200-percent.png'), fullPage: true });
    assert.deepEqual(s.failures, []); record('Five widths, reduced motion, modal keyboard containment, 200% text reflow and axe scans'); await s.context.close();
  }
  await browser.close(); browser = undefined;
  try {
    browser = await webkit.launch({ headless: true });
    const s = await scenario(browser, 'legacy', { balance: 0n, minted: 0n });
    await connect(s.page, 'Browser wallet'); await s.page.getByRole('button', { name: 'Mint a goblin', exact: true }).click();
    await s.page.getByRole('button', { name: 'Confirm in wallet' }).click(); await text(s.page.getByRole('dialog'), 'Transaction confirmed on Ethereum');
    assert.deepEqual(s.failures, []); record('WebKit mobile injected-wallet connect and complete simulated mint'); await s.context.close();
  } catch (error) {
    if (/Host system is missing|error while loading shared libraries|Executable doesn't exist/.test(error.message)) { results.push({ name: 'WebKit', passed: null, limitation: error.message.slice(0, 3000) }); console.log('LIMITATION WebKit runtime unavailable'); }
    else throw error;
  }
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: resolve(output, 'failure.png'), fullPage: true });
    await writeFile(resolve(output, 'failure.txt'), await lastPage.locator('body').innerText());
  }
  results.push({ name: 'Failure', passed: false, error: error.stack }); console.error(error); process.exitCode = 1;
} finally {
  await browser?.close(); server.close();
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
}
