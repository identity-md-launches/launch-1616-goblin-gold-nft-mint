export type MintRules = { soldOut: boolean; maxSupply: bigint; liveSupply: bigint; maxPerWallet: bigint; minted: bigint };
export function mintLimit(rules: MintRules): number {
  if (rules.soldOut) return 0;
  const cap = [20n, rules.maxSupply - rules.liveSupply, rules.maxPerWallet - rules.minted].reduce((a, b) => a < b ? a : b);
  return Number(cap < 0n ? 0n : cap);
}
export function clampQuantity(value: number, limit: number) { return Math.max(1, Math.min(Math.floor(value) || 1, Math.max(1, limit))); }
export function formatEth(value: bigint): string {
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
}
export function shortAddress(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
