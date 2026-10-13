import { createPublicClient, fallback, http, keccak256, parseAbiItem, type Address, type Hex, BaseError, ContractFunctionRevertedError } from 'viem';
import { abi } from './generated/GoblinNFT';

export const CONTRACT = '0xc5d5f314da6d4a433f9bf897a2cc24a537576cb1' as const;
export const DEPLOYMENT_BLOCK = 26185634n;
export const RUNTIME_HASH = '0x270daf73d98f9a0aab6b102e725ad745edb2412306782d222e1cf495c6951f85';
export const EXPLORER = 'https://etherscan.io';
export const RPC_URLS = ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'];
// Only the network facts supplied with this deployment; no unrelated protocol addresses.
const ethereum = { id: 1, name: 'Ethereum', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: RPC_URLS } }, blockExplorers: { default: { name: 'Etherscan', url: EXPLORER } } } as const;
export const client = createPublicClient({ chain: ethereum, transport: fallback(RPC_URLS.map(url => http(url, { batch: { wait: 15 }, timeout: 10000, retryCount: 1 })), { retryCount: 0 }), batch: { multicall: false } });
export { abi };

export type Snapshot = {
  liveSupply: bigint; maxSupply: bigint; price: bigint; maxPerWallet: bigint;
  soldOut: boolean; soldOutAt: bigint; revealed: boolean; revealBlock: bigint;
  refundsOpen: boolean; released: boolean; targetsSet: boolean; targetsSetAt: bigint;
  reviewPeriod: bigint; refundDelay: bigint; polTarget: Address; reserveTarget: Address; vrfTarget: Address;
  totalRevenueDeposited: bigint; totalRevenueClaimed: bigint; deferredRevenue: bigint;
  blockNumber: bigint; timestamp: bigint; fetchedAt: number;
};

export async function verifyCode(blockNumber?: bigint) {
  const [chainId, code] = await Promise.all([client.getChainId(), client.getCode({ address: CONTRACT, blockNumber })]);
  if (chainId !== 1 || !code || code === '0x' || keccak256(code) !== RUNTIME_HASH) throw Error('Contract verification failed. Transactions are disabled. Retry to verify Ethereum data.');
}

export async function readSnapshot(): Promise<Snapshot> {
  const block = await client.getBlock();
  if (block.number === null || block.number < DEPLOYMENT_BLOCK) throw Error('Ethereum data is behind the deployment. Retry shortly.');
  await verifyCode(block.number);
  const fields = {
    liveSupply: 'liveSupply', maxSupply: 'MAX_SUPPLY', price: 'PRICE', maxPerWallet: 'MAX_PER_WALLET',
    soldOut: 'soldOut', soldOutAt: 'soldOutAt', revealed: 'revealed', revealBlock: 'revealBlock',
    refundsOpen: 'refundsOpen', released: 'released', targetsSet: 'targetsSet', targetsSetAt: 'targetsSetAt',
    reviewPeriod: 'TARGET_REVIEW_PERIOD', refundDelay: 'REFUND_REOPEN_DELAY', polTarget: 'polTarget', reserveTarget: 'reserveTarget', vrfTarget: 'vrfTarget',
    totalRevenueDeposited: 'totalRevenueDeposited', totalRevenueClaimed: 'totalRevenueClaimed', deferredRevenue: 'deferredRevenue',
  } as const;
  const values = await Promise.all(Object.entries(fields).map(async ([key, functionName]) => [key, await client.readContract({ address: CONTRACT, abi, functionName, blockNumber: block.number! })]));
  return { ...Object.fromEntries(values), blockNumber: block.number, timestamp: block.timestamp, fetchedAt: Date.now() } as Snapshot;
}

export async function readMinted(account: Address, blockNumber: bigint) {
  return client.readContract({ address: CONTRACT, abi, functionName: 'mintedBy', args: [account], blockNumber });
}
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');

// RPC range limits vary. Split only failed ranges, and never return a partial scan as a complete collection.
async function transferRange(account: Address, start: bigint, end: bigint, signal: AbortSignal): Promise<bigint[]> {
  signal.throwIfAborted();
  try {
    const logs = await client.getLogs({ address: CONTRACT, event: transferEvent, args: { to: account }, fromBlock: start, toBlock: end, strict: true });
    signal.throwIfAborted();
    return logs.map(log => log.args.tokenId);
  } catch (error) {
    signal.throwIfAborted();
    if (end - start < 100n) throw error;
    const middle = (start + end) / 2n;
    return [...await transferRange(account, start, middle, signal), ...await transferRange(account, middle + 1n, end, signal)];
  }
}

export async function ownedTokens(account: Address, blockNumber: bigint, signal: AbortSignal, progress: (value: string) => void) {
  const balance = await client.readContract({ address: CONTRACT, abi, functionName: 'balanceOf', args: [account], blockNumber });
  if (balance === 0n) return [];
  const ids = new Set<bigint>();
  for (let start = DEPLOYMENT_BLOCK; start <= blockNumber; start += 50000n) {
    signal.throwIfAborted();
    const end = start + 49999n < blockNumber ? start + 49999n : blockNumber;
    progress(`Reading transfers through block ${end.toLocaleString()}…`);
    for (const id of await transferRange(account, start, end, signal)) ids.add(id);
  }
  const owned: bigint[] = [];
  const candidates = [...ids];
  for (let i = 0; i < candidates.length; i += 12) {
    signal.throwIfAborted();
    const results = await Promise.all(candidates.slice(i, i + 12).map(async id => {
      try {
        const owner = await client.readContract({ address: CONTRACT, abi, functionName: 'ownerOf', args: [id], blockNumber });
        return owner.toLowerCase() === account.toLowerCase() ? id : undefined;
      } catch (error) {
        if (error instanceof BaseError) {
          const reverted = error.walk(e => e instanceof ContractFunctionRevertedError);
          if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === 'ERC721NonexistentToken') return undefined;
        }
        throw error;
      }
    }));
    results.forEach(id => { if (id !== undefined) owned.push(id); });
  }
  if (BigInt(owned.length) !== balance) throw Error('Transfer history is incomplete. Retry loading your collection.');
  return owned.sort((a, b) => a < b ? -1 : 1);
}

export type Token = { id: bigint; name: string; image: string; attributes: { trait_type: string; value: string | number }[]; pending: bigint };
export async function readToken(id: bigint, blockNumber: bigint): Promise<Token> {
  const [uri, pending] = await Promise.all([
    client.readContract({ address: CONTRACT, abi, functionName: 'tokenURI', args: [id], blockNumber }),
    client.readContract({ address: CONTRACT, abi, functionName: 'pendingRevenue', args: [id], blockNumber }),
  ]);
  if (!uri.startsWith('data:application/json;base64,')) throw Error('Unsupported on-chain metadata');
  const metadata = JSON.parse(atob(uri.slice('data:application/json;base64,'.length)));
  if (typeof metadata.image !== 'string' || !metadata.image.startsWith('data:image/svg+xml;base64,')) throw Error('Unsupported on-chain image');
  return { id, pending, name: String(metadata.name), image: metadata.image, attributes: Array.isArray(metadata.attributes) ? metadata.attributes : [] };
}

export type Action = { kind: 'mint'; quantity: number; value: bigint } | { kind: 'refund'; id: bigint } | { kind: 'claimRevenue'; ids: bigint[] } | { kind: 'reveal' | 'release' };
export function actionCall(action: Action) {
  switch (action.kind) {
    case 'mint': return { functionName: 'mint', args: [BigInt(action.quantity)], value: action.value } as const;
    case 'refund': return { functionName: 'refund', args: [action.id] } as const;
    case 'claimRevenue': return { functionName: 'claimRevenue', args: [action.ids] } as const;
    case 'reveal': return { functionName: 'reveal' } as const;
    case 'release': return { functionName: 'release' } as const;
  }
}
export async function simulateAction(account: Address, action: Action) {
  const base = { address: CONTRACT, abi, account };
  switch (action.kind) {
    case 'mint': return client.simulateContract({ ...base, functionName: 'mint', args: [BigInt(action.quantity)], value: action.value });
    case 'refund': return client.simulateContract({ ...base, functionName: 'refund', args: [action.id] });
    case 'claimRevenue': return client.simulateContract({ ...base, functionName: 'claimRevenue', args: [action.ids] });
    case 'reveal': return client.simulateContract({ ...base, functionName: 'reveal' });
    case 'release': return client.simulateContract({ ...base, functionName: 'release' });
  }
}
export function transactionError(error: unknown): string {
  const serialized = String(error);
  const code = (error as { code?: number })?.code;
  if (code === 4001 || /User rejected|User denied|4001/i.test(serialized)) return 'Request declined in your wallet. No transaction was sent. Try again when you are ready.';
  if (code === -32002) return 'A request is already open in your wallet. Check wallet activity before trying again.';
  if (/insufficient funds/i.test(serialized)) return 'Not enough ETH for this transaction and gas. Add ETH to your wallet and try again.';
  const errors: Record<string, string> = {
    MintClosed: 'Minting has closed. Refresh the collection state.', WalletLimit: 'This wallet has reached its lifetime mint limit. Refresh your allowance.',
    ExceedsSupply: 'Fewer goblins remain. Refresh and reduce the quantity.', NotHolder: 'You no longer own this goblin. Refresh your collection.',
    RefundsClosed: 'The refund window has closed. Refresh the contract state.', NothingOwed: 'There is no revenue to claim. Refresh your collection.',
    ReviewPending: 'The target review is still open. Wait for it to end.', RevealNotReady: 'Reveal is not ready yet. Wait for the next blocks.',
  };
  for (const [key, message] of Object.entries(errors)) if (serialized.includes(key)) return message;
  return error instanceof Error && /changed|verification|disabled/.test(error.message) ? error.message : 'Could not prepare this transaction. Refresh the data, check your wallet and try again.';
}
export type Transaction = { status: 'review' | 'preparing' | 'wallet' | 'pending' | 'success' | 'error' | 'unknown'; action: Action; hash?: Hex; message?: string };
