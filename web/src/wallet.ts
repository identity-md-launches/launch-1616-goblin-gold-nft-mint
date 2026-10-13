import { useEffect, useRef, useState } from 'react';
import { isAddress, type Address } from 'viem';

export type Provider = {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  providers?: Provider[];
  isMetaMask?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
};
export type Wallet = { id: string; name: string; provider: Provider };
declare global { interface Window { ethereum?: Provider } }

export function validAccounts(value: unknown): Address[] {
  return Array.isArray(value) ? value.filter((x): x is Address => typeof x === 'string' && isAddress(x)) : [];
}

export function walletError(error: unknown): string {
  const code = (error as { code?: number })?.code;
  if (code === 4001) return 'Request declined. You can try again when you are ready.';
  if (code === -32002) return 'A request is already open. Check your wallet to continue.';
  if (code === 4100) return 'Wallet access is unavailable. Reconnect and approve access.';
  if (code === 4900 || code === 4901) return 'Your wallet is offline. Reconnect it and try again.';
  return 'Could not connect to your wallet. Unlock it and try again.';
}

export function useWallet() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [selected, setSelected] = useState<Wallet>();
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const version = useRef(0);
  const active = useRef<Wallet | undefined>(undefined);
  const connecting = useRef(false);

  function discover() {
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const injected = window.ethereum;
    if (!injected) return;
    const providers = injected.providers?.length ? injected.providers : [injected];
    setWallets(previous => {
      const next = [...previous];
      providers.forEach((provider, i) => {
        if (typeof provider.request !== 'function' || next.some(x => x.provider === provider)) return;
        const name = provider.isRabby ? 'Rabby' : provider.isCoinbaseWallet ? 'Coinbase Wallet' : provider.isMetaMask ? 'MetaMask' : 'Browser wallet';
        next.push({ id: `injected-${i}`, name, provider });
      });
      return next;
    });
  }

  useEffect(() => {
    const announce = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || typeof detail.provider?.request !== 'function' || typeof detail.info?.uuid !== 'string' || typeof detail.info?.name !== 'string') return;
      const wallet = { id: detail.info.uuid.slice(0, 100), name: detail.info.name.slice(0, 80), provider: detail.provider as Provider };
      setWallets(previous => {
        const existing = previous.find(x => x.provider === wallet.provider || x.id === wallet.id);
        if (existing && !existing.id.startsWith('injected-')) return previous;
        return [...previous.filter(x => x.provider !== wallet.provider && x.id !== wallet.id), wallet];
      });
    };
    window.addEventListener('eip6963:announceProvider', announce);
    window.addEventListener('ethereum#initialized', discover);
    discover();
    return () => {
      window.removeEventListener('eip6963:announceProvider', announce);
      window.removeEventListener('ethereum#initialized', discover);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const provider = selected.provider;
    const accountsChanged = (accounts: unknown) => { version.current++; setAccount(validAccounts(accounts)[0]); setError(''); };
    const chainChanged = (chain: unknown) => { version.current++; setChainId(typeof chain === 'string' ? chain : undefined); setError(''); };
    const disconnected = () => { version.current++; active.current = undefined; setSelected(undefined); setAccount(undefined); setChainId(undefined); setError('Wallet disconnected. Connect again to continue.'); };
    provider.on?.('accountsChanged', accountsChanged);
    provider.on?.('chainChanged', chainChanged);
    provider.on?.('disconnect', disconnected);
    return () => {
      provider.removeListener?.('accountsChanged', accountsChanged);
      provider.removeListener?.('chainChanged', chainChanged);
      provider.removeListener?.('disconnect', disconnected);
    };
  }, [selected]);

  async function connect(wallet: Wallet) {
    if (connecting.current) return false;
    connecting.current = true; setBusy(true); setError('');
    const attempt = ++version.current;
    active.current = wallet; setSelected(wallet); setAccount(undefined); setChainId(undefined);
    try {
      const accounts = validAccounts(await wallet.provider.request({ method: 'eth_requestAccounts' }));
      const chain = await wallet.provider.request({ method: 'eth_chainId' });
      if (active.current !== wallet) return false;
      // Initial account/chain notifications can race eth_requestAccounts; its result is authoritative.
      if (!accounts[0]) throw new Error('No accounts');
      setAccount(accounts[0]); setChainId(String(chain)); return true;
    } catch (cause) {
      if (active.current === wallet || attempt === version.current) setError(walletError(cause));
      return false;
    } finally { connecting.current = false; setBusy(false); }
  }

  async function switchChain() {
    if (!selected || connecting.current) return;
    connecting.current = true; setBusy(true); setError('');
    const wallet = selected;
    try {
      await wallet.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] });
      const chain = await wallet.provider.request({ method: 'eth_chainId' });
      if (active.current === wallet) setChainId(String(chain));
    } catch (cause) { setError(walletError(cause)); }
    finally { connecting.current = false; setBusy(false); }
  }

  function disconnect() {
    version.current++; active.current = undefined;
    setSelected(undefined); setAccount(undefined); setChainId(undefined); setError('');
  }

  return { wallets, selected, account, chainId, busy, error, connect, disconnect, discover, switchChain, version };
}
