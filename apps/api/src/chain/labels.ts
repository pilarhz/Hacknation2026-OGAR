// Etykiety adresów: lista startowa (data/labels.json) + etykiety dodane przez analityka (DB).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { API_ROOT } from '../config.ts';
import { db, iso, now } from '../db/db.ts';
import type { AddressLabel, LabelCategory } from './types.ts';
import { addressKey as keyOf, extractAddresses, type Chain } from '../extract/addresses.ts';

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

/**
 * Walidacja i postać kanoniczna adresu etykiety (bech32 małymi literami, EVM z sumą EIP-55).
 * Bez tego etykieta zapisana np. jako "BC1Q…" nie pasowałaby do adresu wykrytego w tekście
 * (klucze bech32 są małymi literami) i wykluczenie E1 po cichu by nie zadziałało.
 */
export function canonicalLabelAddress(chain: Chain, input: string): { address: string } | { error: string } {
  const raw = input.trim();
  // Solana nie ma sumy kontrolnej i ekstraktor wymaga słowa kluczowego w otoczeniu – podajemy je jawnie.
  const prefix = chain === 'SOL' ? 'solana ' : '';
  const m = extractAddresses(prefix + raw).matches.find((x) => x.start === prefix.length && x.end === prefix.length + raw.length);
  if (!m) return { error: 'Niepoprawny adres (format lub suma kontrolna)' };
  // Adres P2SH zaczynający się od „3” jest wspólny dla BTC i LTC (ten sam bajt wersji) – dopuszczamy oba.
  const ok = m.chain === chain || (m.chain === 'BTC' && chain === 'LTC' && m.format === 'P2SH');
  if (!ok) return { error: `Adres ma format sieci ${m.chain}, a wybrano sieć ${chain}` };
  return { address: m.address };
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
// Kolejność ma znaczenie: najpierw nazwy konkretnych usług, dopiero potem ogólne słowa („exchange”,
// „deposit”), bo np. tag „Uniswap V1: … Exchange” to DEX, a nie giełda scentralizowana.
// Krótkie słowa z granicami \b – inaczej „dex” pasowałoby do „index”, a „hack” do „hackathon”.
const TAG_RULES: [RegExp, LabelCategory][] = [
  [/tornado|mixer|blender|sinbad|wasabi|coinjoin/, 'MIXER'],
  [/uniswap|sushiswap|1inch|0x protocol|\bcurve\b|balancer|pancakeswap|\bpancake|\bdex\b|aggregator|swap router|\brouter\b/, 'DEX'],
  [/\bbridge\b|wormhole|stargate|hop protocol|across protocol/, 'BRIDGE'],
  [/moonpay|\bramp\b|transak|banxa|wirex|crypto card|\bcard\b|mercuryo|simplex/, 'OFFRAMP'],
  [/binance|coinbase|kraken|\bokx\b|bitfinex|kucoin|bybit|huobi|\bhtx\b|gate\.io|bitstamp|gemini|crypto\.com|zonda|bitbay|exchange|hot wallet|cold wallet|deposit/, 'CEX'],
  [/tether|\busdt\b|\busdc\b|usd coin|dai stablecoin|\bbusd\b/, 'STABLECOIN'],
  [/donation|charity|fundraising|ukraine/, 'CHARITY'],
  [/phish|scam|\bhack(?:er|ed)?\b|exploit/, 'SCAM'],
];

export function categorizeExplorerTag(text: string): LabelCategory | null {
  const t = text.toLowerCase();
  return TAG_RULES.find(([re]) => re.test(t))?.[1] ?? null;
}
