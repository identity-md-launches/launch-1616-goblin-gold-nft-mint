import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { encodeFunctionData, type Hex } from 'viem';
import { abi, actionCall, client, CONTRACT, EXPLORER, ownedTokens, readMinted, readSnapshot, readToken, simulateAction, transactionError, verifyCode, type Action, type Snapshot, type Token, type Transaction } from './chain';
import { useWallet, validAccounts } from './wallet';
import { clampQuantity, formatEth, mintLimit, shortAddress } from './rules';

function Icon({ kind, size = 20 }: { kind: 'arrow' | 'copy' | 'close' | 'wallet' | 'refresh'; size?: number }) {
  const paths = { arrow: 'M5 12h14m-6-6 6 6-6 6', copy: 'M8 8h12v12H8zM4 16V4h12', close: 'm6 6 12 12M6 18 18 6', wallet: 'M3 6h17v14H3zM3 6l14-3v3M15 11h5v5h-5z', refresh: 'M20 11a8 8 0 1 0-2 6M20 4v7h-7' };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}
function Modal({ title, children, onClose, locked = false }: { title: string; children: ReactNode; onClose: () => void; locked?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); if (!locked) close.current(); }} aria-labelledby="dialog-title">
    <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={onClose} disabled={locked} aria-label="Close dialog"><Icon kind="close" /></button></div>
    {children}
  </dialog>;
}
const integer = (value?: bigint) => value === undefined ? '…' : value.toLocaleString();
const date = (value: bigint) => new Date(Number(value) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function App() {
  const wallet = useWallet();
  const [walletOpen, setWalletOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [minted, setMinted] = useState<bigint>();
  const [quantity, setQuantity] = useState(1);
  const [copyStatus, setCopyStatus] = useState('');
  const [tx, setTx] = useState<Transaction>();
  const [collectionIds, setCollectionIds] = useState<bigint[]>();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [collectionStatus, setCollectionStatus] = useState('');
  const [collectionError, setCollectionError] = useState('');
  const [collectionVersion, setCollectionVersion] = useState(0);
  const [pageSize, setPageSize] = useState(12);
  const [selectedIds, setSelectedIds] = useState<bigint[]>([]);
  const [now, setNow] = useState(Date.now());
  const refreshing = useRef(false);
  const sending = useRef(false);
  const walletCurrent = useRef(wallet); walletCurrent.current = wallet;
  const snapshotCurrent = useRef(snapshot); snapshotCurrent.current = snapshot;
  const txCurrent = useRef(tx); txCurrent.current = tx;

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true; setLoading(true);
    try { const next = await readSnapshot(); setSnapshot(next); setDataError(''); }
    catch (error) { setDataError(error instanceof Error && /verification|behind/.test(error.message) ? error.message : 'Ethereum data is unavailable. Check your connection and retry.'); }
    finally { refreshing.current = false; setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { setNow(Date.now()); if (document.visibilityState === 'visible') void refresh(); }, 20000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    setMinted(undefined);
    if (wallet.account && snapshot) readMinted(wallet.account, snapshot.blockNumber).then(value => { if (!cancelled) setMinted(value); }).catch(() => { if (!cancelled) setDataError('Could not load your mint allowance. Retry before minting.'); });
    return () => { cancelled = true; };
  }, [wallet.account, snapshot]);

  useEffect(() => {
    const controller = new AbortController();
    setCollectionIds(undefined); setTokens([]); setSelectedIds([]); setPageSize(12); setCollectionError('');
    const state = snapshotCurrent.current;
    if (!wallet.account || !state) return;
    setCollectionStatus('Reading your on-chain collection…');
    ownedTokens(wallet.account, state.blockNumber, controller.signal, value => { if (!controller.signal.aborted) setCollectionStatus(value); })
      .then(ids => { if (!controller.signal.aborted) { setCollectionIds(ids); setCollectionStatus(''); } })
      .catch(() => { if (!controller.signal.aborted) { setCollectionError('Could not read your full collection. Retry to load verified ownership.'); setCollectionStatus(''); } });
    return () => controller.abort();
  }, [wallet.account, collectionVersion, Boolean(snapshot)]);

  useEffect(() => {
    let cancelled = false;
    const state = snapshotCurrent.current;
    if (!collectionIds || !state) return;
    setCollectionError('');
    Promise.all(collectionIds.slice(0, pageSize).map(id => readToken(id, state.blockNumber)))
      .then(next => { if (!cancelled) setTokens(next); })
      .catch(() => { if (!cancelled) setCollectionError('Could not load goblin art or revenue. Retry your collection.'); });
    return () => { cancelled = true; };
  }, [collectionIds, pageSize]);

  // A reviewed action belongs to exactly one wallet/network session.
  useEffect(() => { if (txCurrent.current?.status === 'review') setTx(undefined); setSelectedIds([]); }, [wallet.account, wallet.chainId, wallet.selected]);

  const limit = snapshot ? mintLimit({ ...snapshot, minted: wallet.account ? minted ?? snapshot.maxPerWallet : 0n }) : 20;
  useEffect(() => { setQuantity(q => clampQuantity(q, limit)); }, [limit]);
  const stale = !snapshot || !!dataError || now - snapshot.fetchedAt > 90000;
  const inFlight = tx && ['preparing', 'wallet', 'pending', 'unknown'].includes(tx.status);
  const canAct = !!wallet.account && wallet.chainId === '0x1' && !stale && !inFlight;
  const selectedTotal = tokens.filter(token => selectedIds.includes(token.id)).reduce((sum, token) => sum + token.pending, 0n);

  const openWallet = () => { wallet.discover(); setWalletOpen(true); };
  function review(action: Action) { if (canAct) setTx({ action, status: 'review' }); }
  async function copyAddress() {
    try { await navigator.clipboard.writeText(CONTRACT); setCopyStatus('Address copied'); }
    catch { setCopyStatus('Copy unavailable. Select the full address below.'); }
  }

  async function receipt(hash: Hex, action: Action) {
    try {
      const result = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120000, pollingInterval: 4000,
        onReplaced: replacement => {
          hash = replacement.transaction.hash;
          setTx({ action, hash, status: 'pending', message: 'Wallet transaction replaced. Checking the mined result…' });
        },
      });
      // A cancellation/replacement must also match the intended destination, data and value.
      const mined = await client.getTransaction({ hash: result.transactionHash });
      const call = actionCall(action);
      const expectedData = encodeFunctionData({ abi, ...call });
      const matches = mined.to?.toLowerCase() === CONTRACT && mined.input === expectedData && mined.value === ('value' in call ? call.value : 0n);
      if (result.status === 'reverted') setTx({ action, hash: result.transactionHash, status: 'error', message: 'The transaction reverted on Ethereum. No action completed; gas may have been charged. Refresh before trying again.' });
      else if (!matches) setTx({ action, hash: result.transactionHash, status: 'error', message: 'The original action was replaced or cancelled in your wallet. Review the transaction on Etherscan.' });
      else setTx({ action, hash: result.transactionHash, status: 'success', message: 'Transaction confirmed on Ethereum.' });
      await refresh(); setCollectionVersion(v => v + 1);
    } catch {
      setTx({ action, hash, status: 'unknown', message: 'Confirmation is taking longer than expected. This transaction may still complete. Check its status before sending another.' });
    }
  }

  async function submit() {
    const current = txCurrent.current;
    const selectedWallet = walletCurrent.current;
    const account = selectedWallet.account;
    const provider = selectedWallet.selected?.provider;
    if (!current || !account || !provider || sending.current) return;
    sending.current = true;
    const version = selectedWallet.version.current;
    const action = current.action;
    setTx({ action, status: 'preparing' });
    try {
      const assertWallet = async () => {
        const [chain, accounts] = await Promise.all([provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' })]);
        if (chain !== '0x1' || validAccounts(accounts)[0]?.toLowerCase() !== account.toLowerCase() || walletCurrent.current.selected?.provider !== provider || walletCurrent.current.version.current !== version) throw Error('Wallet or network changed. Close this dialog and review the action again.');
      };
      await assertWallet(); await verifyCode();
      const call = actionCall(action);
      await simulateAction(account, action);
      const data = encodeFunctionData({ abi, ...call });
      await assertWallet();
      setTx({ action, status: 'wallet' });
      const result = await provider.request({ method: 'eth_sendTransaction', params: [{ from: account, to: CONTRACT, data, value: `0x${(action.kind === 'mint' ? action.value : 0n).toString(16)}` }] });
      if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw Error('Wallet returned no transaction hash');
      const hash = result as Hex;
      setTx({ action, hash, status: 'pending' });
      await receipt(hash, action);
    } catch (error) { setTx({ action, status: 'error', message: transactionError(error) }); }
    finally { sending.current = false; }
  }

  const actionTitle = tx?.action.kind === 'mint' ? `Mint ${tx.action.quantity} ${tx.action.quantity === 1 ? 'goblin' : 'goblins'}` : tx?.action.kind === 'refund' ? `Refund Goblin #${tx.action.id}` : tx?.action.kind === 'claimRevenue' ? 'Claim selected revenue' : tx?.action.kind === 'release' ? 'Release mint escrow' : 'Reveal the collection';
  const primaryLabel = snapshot?.soldOut ? 'Sold out' : !wallet.account ? 'Connect wallet to mint' : wallet.chainId !== '0x1' ? 'Switch to Ethereum' : minted === undefined ? 'Reading mint allowance…' : limit === 0 ? 'Wallet mint limit reached' : `Mint ${quantity === 1 ? 'a goblin' : `${quantity} goblins`}`;

  return <>
    <a href="#mint" className="skip-link">Skip to mint</a>
    <header className="site-header shell">
      <a className="brand" href="#mint"><img src="./favicon.svg" alt="" width="32" height="32" /><span>Goblin <span className="gold">Gold</span></span></a>
      <nav aria-label="Main navigation"><a href="#collection">My goblins</a><a href="#contract">The contract</a></nav>
      <button className="wallet-button" onClick={openWallet}><Icon kind="wallet" /><span>{wallet.account ? shortAddress(wallet.account) : 'Connect wallet'}</span></button>
    </header>
    <main className="shell">
      <section id="mint" className="mint-layout" aria-labelledby="mint-title">
        <div className="mint-content">
          <h1 id="mint-title">Mint your<br /> <span className="gold">goblin.</span></h1>
          <p className="intro">Pixel goblins. Fully on-chain. Yours on Ethereum.</p>
          <div className="mint-form">
            <div className="supply-label"><span>{snapshot ? `${integer(snapshot.liveSupply)} / ${integer(snapshot.maxSupply)} minted` : 'Reading live supply…'}</span><span className="muted">{snapshot?.soldOut ? 'Sold out' : snapshot ? 'Mint open' : 'Ethereum'}</span></div>
            <progress aria-label="Live mint supply" value={Number(snapshot?.liveSupply ?? 0)} max={Number(snapshot?.maxSupply ?? 10000)} />
            <div className="quantity-row"><div><label htmlFor="quantity">How many goblins?</label><span className="hint">{snapshot ? `${formatEth(snapshot.price)} ETH each` : 'Loading price…'}</span></div><div className="stepper">
              <button onClick={() => setQuantity(q => clampQuantity(q - 1, limit))} disabled={quantity <= 1 || !!inFlight} aria-label="Decrease quantity">−</button>
              <input id="quantity" aria-describedby="quantity-hint" type="number" inputMode="numeric" min="1" max={Math.max(1, limit)} value={quantity} disabled={!!inFlight || !!snapshot?.soldOut} onChange={e => setQuantity(clampQuantity(Number(e.target.value), limit))} />
              <button onClick={() => setQuantity(q => clampQuantity(q + 1, limit))} disabled={quantity >= limit || !!inFlight} aria-label="Increase quantity">+</button>
            </div></div>
            <p id="quantity-hint" className="hint">{wallet.account && minted !== undefined ? `${integer(minted)} of ${integer(snapshot?.maxPerWallet)} lifetime mints used` : snapshot ? `Up to ${integer(snapshot.maxPerWallet)} per wallet` : 'Reading the wallet mint limit…'}</p>
            <div className="total-row"><span>Total <span className="muted">+ gas</span></span><strong>{snapshot ? `${formatEth(snapshot.price * BigInt(quantity))} ETH` : 'Loading…'}</strong></div>
            <button className="primary mint-button" disabled={!!snapshot?.soldOut || !!inFlight || wallet.busy || (!!wallet.account && wallet.chainId === '0x1' && (stale || minted === undefined || limit === 0))} onClick={() => { if (!wallet.account) openWallet(); else if (wallet.chainId !== '0x1') void wallet.switchChain(); else if (snapshot) review({ kind: 'mint', quantity, value: snapshot.price * BigInt(quantity) }); }}>{primaryLabel}<Icon kind="arrow" /></button>
            <p className="mobile-hint">On mobile, open this page in your wallet's built-in browser.</p>
            {wallet.account && wallet.chainId !== '0x1' && <p className="notice">Your wallet is on another network. Switch to Ethereum to continue.</p>}
            {wallet.error && !walletOpen && <p role="alert" className="error">{wallet.error}</p>}
            <div className="data-message" aria-live="polite">{dataError ? <p className="error">{dataError} <button className="text-button" disabled={loading} onClick={() => void refresh()}>Retry</button></p> : snapshot ? <span className="hint"><span className="status-dot" />Read at block {integer(snapshot.blockNumber)}{loading ? ' · Updating…' : ''}</span> : <span className="hint">Connecting to Ethereum…</span>}</div>
          </div>
        </div>
        <figure className="goblin-scene">
          <div className="art-frame"><span className="corner top-left"/><span className="corner top-right"/><span className="corner bottom-left"/><span className="corner bottom-right"/><img src="./unrevealed.svg" width="320" height="320" alt="Unrevealed on-chain goblin: a dark pixel silhouette with gold eyes and a loot bag" /><span className="pixel-star star-one" aria-hidden="true">✦</span><span className="pixel-star star-two" aria-hidden="true">✦</span></div>
          <figcaption><span>Waiting in the shadows.</span><span className="hint">Contract artwork before reveal</span></figcaption>
        </figure>
      </section>
      <div className="principles"><span><span className="small-mark" aria-hidden="true">◇</span> Art stored on Ethereum</span><span><span className="small-mark" aria-hidden="true">◇</span> Refundable before sellout</span><span><span className="small-mark" aria-hidden="true">◇</span> Reveal after sellout</span></div>
      <section id="collection" className="section" aria-labelledby="collection-title">
        <div className="section-heading"><div><h2 id="collection-title">Your goblin hoard</h2><p className="muted">Your collection, art and revenue, read from Ethereum.</p></div>{wallet.account && <button className="secondary" disabled={!!collectionStatus || !!inFlight} onClick={async () => { await refresh(); setCollectionVersion(v => v + 1); }}><Icon kind="refresh" />Refresh collection</button>}</div>
        {!wallet.account ? <div className="empty-state"><img src="./favicon.svg" width="48" height="48" alt="" /><div><h3>A hoard of your own</h3><p>Connect your wallet to view your goblins and manage their revenue.</p><button className="text-button" onClick={openWallet}>Connect a wallet <Icon kind="arrow" /></button></div></div> : <>
          <div className="collection-tools"><span>{collectionIds ? `${collectionIds.length} ${collectionIds.length === 1 ? 'goblin' : 'goblins'} owned` : 'Loading ownership…'}</span><span className="hint">{snapshot?.released ? 'Revenue is claimable' : 'Revenue becomes claimable after escrow release'}</span></div>
          {collectionStatus && <p role="status" className="notice">{collectionStatus}</p>}
          {collectionError && <p role="alert" className="error">{collectionError} <button className="text-button" onClick={() => setCollectionVersion(v => v + 1)}>Retry collection</button></p>}
          {collectionIds?.length === 0 && <p className="empty-state">No goblins in this wallet yet. <a href="#mint">Mint your first goblin</a></p>}
          {!!collectionIds?.length && <>
            <div className="claim-toolbar"><label><input type="checkbox" checked={tokens.length > 0 && tokens.every(token => selectedIds.includes(token.id))} disabled={!canAct || !snapshot?.released || !tokens.length} onChange={e => setSelectedIds(e.target.checked ? tokens.map(token => token.id) : [])} />Select loaded goblins</label><button className="secondary" disabled={!canAct || !snapshot?.released || !selectedIds.length || selectedTotal === 0n} onClick={() => review({ kind: 'claimRevenue', ids: selectedIds })}>Claim {formatEth(selectedTotal)} ETH</button></div>
            <div className="token-grid">{tokens.map(token => <article className="token" key={token.id.toString()}><img className="token-art" src={token.image} alt={`${token.name}, ${token.attributes.map(a => `${a.trait_type}: ${a.value}`).join(', ')}`} width="256" height="256"/><div className="token-info"><h3>{token.name}</h3><span className="hint">{snapshot?.released ? 'Claimable' : 'Provisional share'}: {formatEth(token.pending)} ETH</span><div className="token-controls"><label><input type="checkbox" aria-label={`Select ${token.name}`} checked={selectedIds.includes(token.id)} disabled={!canAct || !snapshot?.released} onChange={e => setSelectedIds(ids => e.target.checked ? [...ids, token.id] : ids.filter(id => id !== token.id))}/>Select</label><button className="text-button" disabled={!canAct || !snapshot?.refundsOpen} onClick={() => review({ kind: 'refund', id: token.id })}>Refund</button></div><details><summary>View traits</summary><dl>{token.attributes.map((attribute, i) => <div key={i}><dt>{attribute.trait_type}</dt><dd>{attribute.value}</dd></div>)}</dl></details></div></article>)}</div>
            {tokens.length < Math.min(pageSize, collectionIds.length) && !collectionError && <p role="status">Loading on-chain artwork…</p>}
            {pageSize < collectionIds.length && <button className="secondary" onClick={() => setPageSize(n => n + 12)}>Load more goblins</button>}
          </>}
        </>}
      </section>
      <section id="contract" className="section" aria-labelledby="contract-title">
        <div className="section-heading"><div><h2 id="contract-title">Written into the contract</h2><p className="muted">The mint, the escrow and your right to exit.</p></div><button className="secondary" onClick={() => void refresh()} disabled={loading}><Icon kind="refresh" />{loading ? 'Refreshing…' : 'Refresh state'}</button></div>
        <div className="contract-grid">
          <div className="contract-summary"><h3>Goblin Gold on Ethereum</h3><p className="contract-address"><a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">{CONTRACT}<span className="sr-only"> on Etherscan (opens a new tab)</span></a><button className="icon-button" onClick={() => void copyAddress()} aria-label="Copy contract address"><Icon kind="copy" /></button></p><p className="hint" role="status">{copyStatus || 'Verified deployment · Ethereum mainnet'}</p><dl className="state-list"><div><dt>Mint escrow</dt><dd>{snapshot ? snapshot.released ? 'Released' : 'Held in contract' : 'Loading…'}</dd></div><div><dt>Refund window</dt><dd>{snapshot ? snapshot.refundsOpen ? 'Open' : 'Closed' : 'Loading…'}</dd></div><div><dt>Collection reveal</dt><dd>{snapshot ? snapshot.revealed ? 'Revealed' : 'Unrevealed' : 'Loading…'}</dd></div><div><dt>Revenue deposited</dt><dd>{snapshot ? `${formatEth(snapshot.totalRevenueDeposited)} ETH` : 'Loading…'}</dd></div><div><dt>Revenue claimed</dt><dd>{snapshot ? `${formatEth(snapshot.totalRevenueClaimed)} ETH` : 'Loading…'}</dd></div><div><dt>Revenue awaiting release</dt><dd>{snapshot ? `${formatEth(snapshot.deferredRevenue)} ETH` : 'Loading…'}</dd></div></dl></div>
          <div className="rules"><details open><summary>How refunds work</summary><p>Burn a goblin to recover its mint price while refunds are open. Gas is not refunded. Your lifetime mint allowance does not reset.</p><p>Refunds are open before sellout, during each seven-day target review, and from 90 days after sellout until escrow release. Release closes refunds permanently.</p></details><details><summary>How holder revenue works</summary><p>Before release, deposited revenue is pooled. Your displayed share is provisional and cannot be claimed. At release, the pool is shared among the goblins still live.</p><p>After release, deposits accrue to each live goblin. Unclaimed revenue follows the token when it is transferred. Revenue is not guaranteed.</p></details><details><summary>When goblins are revealed</summary><p>Traits stay hidden until sellout. Anyone can then call reveal after the designated block. If its hash has expired, the call schedules a new block and another call is needed.</p>{snapshot && <p className="hint">{snapshot.revealed ? 'The collection is revealed.' : snapshot.soldOut ? `Reveal block: ${integer(snapshot.revealBlock)}` : 'Waiting for sellout.'}</p>}<button className="secondary" disabled={!canAct || !snapshot?.soldOut || snapshot.revealed || snapshot.blockNumber <= snapshot.revealBlock} onClick={() => review({ kind: 'reveal' })}>Reveal collection</button></details><details><summary>Escrow targets and review</summary><p>The owner names the destinations. Every update starts a new seven-day refund window. Contract addresses alone do not establish destination safety.</p>{snapshot?.targetsSet ? <><dl className="target-list">{([['Liquidity · 50%', snapshot.polTarget], ['Reserve · 40%', snapshot.reserveTarget], ['Randomness · 10%', snapshot.vrfTarget]] as const).map(([label, target]) => <div key={label}><dt>{label}</dt><dd><a href={`${EXPLORER}/address/${target}`} target="_blank" rel="noreferrer">{target}</a></dd></div>)}</dl><p>Review ends: {date(snapshot.targetsSetAt + snapshot.reviewPeriod)}</p></> : <p>{snapshot ? 'Destinations have not been set.' : 'Loading destinations…'}</p>}<p>Anyone can release escrow after sellout and the target review. Remaining mint escrow is credited 50% to liquidity, 40% to reserve and 10% to randomness.</p><button className="secondary" disabled={!canAct || !snapshot?.soldOut || snapshot.released || !snapshot.targetsSet || snapshot.timestamp < snapshot.targetsSetAt + snapshot.reviewPeriod} onClick={() => review({ kind: 'release' })}>Release mint escrow</button></details></div>
        </div>
      </section>
    </main>
    <footer className="shell"><span className="brand"><img src="./favicon.svg" alt="" width="24" height="24" />Goblin Gold</span><span className="hint">On-chain art. No backend. No analytics.</span><a href="#mint">Back to mint ↑</a></footer>
    {walletOpen && <Modal title={wallet.account ? 'Your wallet' : 'Connect a wallet'} onClose={() => setWalletOpen(false)}>
      {wallet.account && <div className="connected-wallet"><p className="break-word">{wallet.account}</p><p className="hint">{wallet.selected?.name} · {wallet.chainId === '0x1' ? 'Ethereum mainnet' : 'Switch to Ethereum to transact'}</p><button className="secondary" disabled={!!inFlight || wallet.busy} onClick={() => { wallet.disconnect(); setWalletOpen(false); }}>Disconnect from this page</button></div>}
      <p className="muted">Choose a wallet installed in this browser.</p><div className="wallet-list">{wallet.wallets.map(found => <button className="wallet-option" key={found.id} disabled={wallet.busy || !!inFlight} onClick={async () => { if (await wallet.connect(found)) setWalletOpen(false); }}><Icon kind="wallet" /><span>{found.name}</span><Icon kind="arrow" /></button>)}</div>
      {!wallet.wallets.length && <p className="notice">No browser wallet detected. Use the MetaMask, Rabby or Coinbase Wallet extension, or a mobile wallet browser.</p>}
      <p className="mobile-hint">On mobile, open this page in your wallet's built-in browser.</p>
      <div role="status">{wallet.busy && <p>Check your wallet to approve the request…</p>}</div>{wallet.error && <p className="error" role="alert">{wallet.error}</p>}
      <button className="text-button" onClick={wallet.discover} disabled={wallet.busy}>Look for wallets again</button>
    </Modal>}
    {tx && <Modal title={actionTitle} onClose={() => setTx(undefined)} locked={['preparing', 'wallet', 'pending', 'unknown'].includes(tx.status)}>
      {tx.status === 'review' && <>
        {tx.action.kind === 'mint' && <p className="review-total">{formatEth(tx.action.value)} ETH <span className="hint">+ network gas</span></p>}
        {tx.action.kind === 'refund' && <p className="notice">This permanently burns Goblin #{tx.action.id.toString()} and returns {snapshot ? formatEth(snapshot.price) : 'the mint price'} ETH, less gas. It does not restore your mint allowance.</p>}
        {tx.action.kind === 'claimRevenue' && <p>Claim revenue for {tx.action.ids.length} selected goblins. The final amount depends on the contract state when the transaction executes.</p>}
        {tx.action.kind === 'release' && <p className="notice">This permanently closes mint refunds and credits the configured destinations. Review all three target addresses before continuing.</p>}
        {tx.action.kind === 'reveal' && <p>Reveal the collection, or schedule a new reveal block if the previous block hash expired. Network gas applies.</p>}
        <dl className="review-details"><div><dt>Network</dt><dd>Ethereum mainnet</dd></div><div><dt>From</dt><dd className="break-word">{wallet.account}</dd></div><div><dt>Contract</dt><dd className="break-word">{CONTRACT}</dd></div></dl>
        <button className={`primary${tx.action.kind === 'refund' ? ' danger' : ''}`} onClick={() => void submit()}>{tx.action.kind === 'refund' ? 'Burn and refund in wallet' : 'Confirm in wallet'}<Icon kind="arrow" /></button><button className="text-button" onClick={() => setTx(undefined)}>Cancel</button>
      </>}
      <div role="status">{tx.status === 'preparing' && <p>Checking Ethereum and simulating your transaction…</p>}{tx.status === 'wallet' && <p>Review the amount and gas in your wallet, then confirm.</p>}{tx.status === 'pending' && <p>{tx.message || 'Transaction sent. Waiting for Ethereum confirmation…'}</p>}{tx.status === 'success' && <p className="success">{tx.message}</p>}</div>
      {tx.status === 'error' && <p className="error" role="alert">{tx.message}</p>}
      {tx.status === 'unknown' && <><p className="notice">{tx.message}</p><button className="secondary" onClick={() => { if (tx.hash) { setTx({ ...tx, status: 'pending' }); void receipt(tx.hash, tx.action); } }}>Check confirmation again</button></>}
      {tx.hash && <p><a href={`${EXPLORER}/tx/${tx.hash}`} target="_blank" rel="noreferrer">View transaction on Etherscan ↗</a></p>}
      {['success', 'error'].includes(tx.status) && <button className="secondary" onClick={() => { setTx(undefined); void refresh(); }}>Close and refresh</button>}
    </Modal>}
  </>;
}
