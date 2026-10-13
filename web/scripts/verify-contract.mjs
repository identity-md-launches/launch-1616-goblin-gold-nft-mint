import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { keccak256, stringToHex } from 'viem';
const root = fileURLToPath(new URL('../../', import.meta.url));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const abi = JSON.parse(execFileSync('forge', ['inspect', '--offline', 'GoblinNFT', 'abi', '--json'], { cwd: root, encoding: 'utf8' }));
const expected = '0xaf84d2d588bf03ccf014727bd109abbef4df473f33466faa090b7df6d44b9de7';
const hash = keccak256(stringToHex(JSON.stringify(canonical(abi))));
if (hash !== expected) throw Error(`ABI mismatch: ${hash}`);
const source = '// Generated from the pinned src/GoblinNFT.sol; verify with npm run verify:contract.\nexport const abi = ' + JSON.stringify(abi, null, 2) + ' as const;\n';
if (process.argv.includes('--generate')) writeFileSync(root + 'web/src/generated/GoblinNFT.ts', source);
if (readFileSync(root + 'web/src/generated/GoblinNFT.ts', 'utf8') !== source) throw Error('Bundled ABI differs from compiled source');
const code = execFileSync('forge', ['inspect', '--offline', 'GoblinNFT', 'deployedBytecode'], { cwd: root, encoding: 'utf8' }).trim();
console.log(JSON.stringify({ abiHash: hash, runtimeCodeHash: keccak256(code), runtimeBytes: (code.length - 2) / 2 }));
const rpcIndex = process.argv.indexOf('--rpc');
if (rpcIndex !== -1) {
  const rpc = process.argv[rpcIndex + 1];
  const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]},{jsonrpc:'2.0',id:2,method:'eth_getCode',params:['0xc5d5f314da6d4a433f9bf897a2cc24a537576cb1','latest']}]), signal: AbortSignal.timeout(30000) });
  const results = await response.json();
  if (results.find(x => x.id === 1)?.result !== '0x1') throw Error('Wrong chain');
  if (results.find(x => x.id === 2)?.result?.toLowerCase() !== code.toLowerCase()) throw Error('Deployed runtime differs from compiled source');
  console.log('Ethereum chain id and deployed runtime match. No transactions sent.');
}
