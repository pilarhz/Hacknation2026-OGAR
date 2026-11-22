// Etykiety adresów: lista startowa (data/labels.json) + etykiety dodane przez analityka (DB).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { API_ROOT } from '../config.ts';
import { db, iso, now } from '../db/db.ts';
import type { AddressLabel, LabelCategory } from './types.ts';
import { addressKey as keyOf, type Chain } from '../extract/addresses.ts';

interface SeedLabel {
  chain: Chain;
  address: string;
  name: string;
  category: LabelCategory;
  synthetic?: boolean;
}

let seed: Map<string, AddressLabel> | null = null;
function seedLabels(): Map<string, AddressLabel> {
  if (seed) return seed;
  const file = JSON.parse(readFileSync(path.join(API_ROOT, 'data', 'labels.json'), 'utf8')) as { labels: SeedLabel[] };
  seed = new Map(file.labels.map((l) => [keyOf(l.chain, l.address), { name: l.name, category: l.category, origin: 'seed-list' as const, synthetic: l.synthetic }]));
  return seed;
}

// Etykiety analityków w pamięci (odświeżane na start przebiegu i po zmianie) – sprawdzane synchronicznie dla każdego kontrahenta.
let custom = new Map<string, AddressLabel>();

export async function refreshCustomLabels(): Promise<void> {
  const rows = await db().query<{ key: string; name: string; category: LabelCategory }>('SELECT key, name, category FROM custom_labels');
  custom = new Map(rows.map((r) => [r.key, { name: r.name, category: r.category, origin: 'analyst' as const }]));
}

export function lookupLabel(chain: string, address: string): AddressLabel | null {
  const key = keyOf(chain, address);
  return custom.get(key) ?? seedLabels().get(key) ?? null;
}

export async function addCustomLabel(chain: Chain, address: string, name: string, category: LabelCategory, note?: string) {
  await db().query(
    `INSERT INTO custom_labels (key, chain, address, name, category, note, added_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, note = EXCLUDED.note, added_at = EXCLUDED.added_at`,
    [keyOf(chain, address), chain, address, name, category, note ?? null, now()],
  );
  await refreshCustomLabels();
}

export async function listLabels() {
  const rows = await db().query('SELECT chain, address, name, category, note, added_at FROM custom_labels ORDER BY added_at DESC');
  const seeds = [...seedLabels().entries()].map(([k, v]) => ({ chain: k.split(':')[0], address: k.split(':').slice(1).join(':'), ...v }));
  return { custom: rows.map((r) => ({ ...r, added_at: iso(r.added_at) })), seed: seeds };
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
