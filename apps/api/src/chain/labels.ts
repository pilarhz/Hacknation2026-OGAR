// Etykiety adresów: lista startowa (data/labels.json) + etykiety dodane przez analityka (DB).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { API_ROOT } from '../config.ts';
import { db, now } from '../db/db.ts';
import type { AddressLabel, LabelCategory } from './types.ts';
import type { Chain } from '../extract/addresses.ts';

interface SeedLabel {
  chain: Chain;
  address: string;
  name: string;
  category: LabelCategory;
  synthetic?: boolean;
}

const keyOf = (chain: string, address: string) => `${chain}:${chain === 'ETH' ? address.toLowerCase() : address}`;

let seed: Map<string, AddressLabel> | null = null;
function seedLabels(): Map<string, AddressLabel> {
  if (seed) return seed;
  const file = JSON.parse(readFileSync(path.join(API_ROOT, 'data', 'labels.json'), 'utf8')) as { labels: SeedLabel[] };
  seed = new Map(file.labels.map((l) => [keyOf(l.chain, l.address), { name: l.name, category: l.category, origin: 'seed-list' as const, synthetic: l.synthetic }]));
  return seed;
}

export function lookupLabel(chain: string, address: string): AddressLabel | null {
  const key = keyOf(chain, address);
  const custom = db().prepare('SELECT name, category FROM custom_labels WHERE key = ?').get(key) as { name: string; category: LabelCategory } | undefined;
  if (custom) return { name: custom.name, category: custom.category, origin: 'analyst' };
  return seedLabels().get(key) ?? null;
}

export function addCustomLabel(chain: Chain, address: string, name: string, category: LabelCategory, note?: string) {
  db()
    .prepare('INSERT OR REPLACE INTO custom_labels (key, chain, address, name, category, note, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(keyOf(chain, address), chain, address, name, category, note ?? null, now());
}

export function listLabels() {
  const custom = db().prepare('SELECT chain, address, name, category, note, added_at FROM custom_labels ORDER BY added_at DESC').all();
  const seeds = [...seedLabels().entries()].map(([k, v]) => ({ chain: k.split(':')[0], address: k.split(':').slice(1).join(':'), ...v }));
  return { custom, seed: seeds };
}

/** Mapowanie tagów zwracanych przez eksploratory na nasze kategorie. */
export function categorizeExplorerTag(text: string): LabelCategory | null {
  const t = text.toLowerCase();
  if (/tornado|mixer|blender|sinbad|wasabi|coinjoin/.test(t)) return 'MIXER';
  if (/binance|coinbase|kraken|okx|bitfinex|kucoin|bybit|huobi|htx|gate\.io|bitstamp|gemini|crypto\.com|zonda|bitbay|exchange|hot wallet|cold wallet|deposit/.test(t)) return 'CEX';
  if (/uniswap|sushiswap|1inch|0x protocol|curve|balancer|pancake|router|dex/.test(t)) return 'DEX';
  if (/bridge|wormhole|stargate|hop protocol|across/.test(t)) return 'BRIDGE';
  if (/tether|usdt|usdc|usd coin|dai stablecoin|busd/.test(t)) return 'STABLECOIN';
  if (/donation|charity|fundraising|ukraine/.test(t)) return 'CHARITY';
  if (/moonpay|\bramp\b|transak|banxa|wirex|\bcrypto card\b|\bcard\b|mercuryo|simplex/.test(t)) return 'OFFRAMP';
  if (/phish|scam|hack|exploit/.test(t)) return 'SCAM';
  return null;
}
