// Wykrywanie i walidacja adresów krypto w tekście. Kandydaci z błędną sumą kontrolną trafiają do `rejected`.
import { base58CheckDecode, base58Decode, decodeSegwit, toChecksumAddress } from './encoding.ts';

export type Chain = 'BTC' | 'ETH' | 'TRX' | 'LTC' | 'DOGE' | 'SOL' | 'XMR';

/** Klucz deduplikacji adresu: chain:adres (ETH małymi literami). */
export const addressKey = (chain: string, address: string) => `${chain}:${chain === 'ETH' ? address.toLowerCase() : address}`;

export interface AddressMatch {
  chain: Chain;
  /** Postać kanoniczna (ETH: EIP-55, bech32: małe litery). */
  address: string;
  /** Klucz deduplikacji: chain:adres (ETH małymi literami). */
  key: string;
  format: string;
  checksum: 'valid' | 'not-applicable' | 'not-verified';
  /** Pewność samego rozpoznania formatu (nie atrybucji!). */
  formatConfidence: 'high' | 'medium' | 'low';
  start: number;
  end: number;
  context: string;
  notes: string[];
}

export interface RejectedCandidate {
  candidate: string;
  reason: string;
  start: number;
}

export interface ExtractionResult {
  matches: AddressMatch[];
  rejected: RejectedCandidate[];
}

const B58 = '1-9A-HJ-NP-Za-km-z';
const L = '(?<![0-9A-Za-z])';
const R = '(?![0-9A-Za-z])';

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'bech32', re: new RegExp(`${L}((?:bc|ltc|BC|LTC)1[02-9ac-hj-np-zAC-HJ-NP-Z]{6,87})${R}`, 'g') },
  { name: 'evm', re: new RegExp(`${L}(0x[0-9a-fA-F]{40})${R}`, 'g') },
  { name: 'xmr', re: new RegExp(`${L}([48][${B58}]{94}(?:[${B58}]{11})?)${R}`, 'g') },
  { name: 'base58', re: new RegExp(`${L}([${B58}]{25,44})${R}`, 'g') },
];

const SOLANA_HINT = /(solana|\bsol\b|phantom|solflare)/i;

function contextOf(text: string, start: number, end: number, radius = 160): string {
  const s = Math.max(0, start - radius);
  const e = Math.min(text.length, end + radius);
  return (s > 0 ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : '');
}

function classifyBech32(raw: string): Omit<AddressMatch, 'start' | 'end' | 'context'> | string {
  const lower = raw.toLowerCase();
  const hrp = lower.startsWith('ltc1') ? 'ltc' : 'bc';
  const seg = decodeSegwit(hrp, lower);
  if (!seg) return 'Błędna suma kontrolna Bech32/Bech32m lub niepoprawna długość programu';
  const chain: Chain = hrp === 'ltc' ? 'LTC' : 'BTC';
  const format =
    seg.version === 0 ? (seg.program.length === 20 ? 'P2WPKH (SegWit v0)' : 'P2WSH (SegWit v0)') : seg.version === 1 ? 'P2TR (Taproot)' : `SegWit v${seg.version}`;
  return { chain, address: lower, key: `${chain}:${lower}`, format, checksum: 'valid', formatConfidence: 'high', notes: [] };
}

function classifyEvm(raw: string): Omit<AddressMatch, 'start' | 'end' | 'context'> | string {
  const body = raw.slice(2);
  const checksummed = toChecksumAddress(raw);
  const notes: string[] = [];
  let checksum: AddressMatch['checksum'] = 'not-applicable';
  if (/^0x0{40}$/i.test(raw)) return 'Adres zerowy (burn/null) – nie jest portfelem';
  if (body !== body.toLowerCase() && body !== body.toUpperCase()) {
    if (checksummed !== raw) return 'Błędna suma kontrolna EIP-55 (mieszana wielkość liter niezgodna z keccak256)';
    checksum = 'valid';
  } else {
    notes.push('Adres zapisany jedną wielkością liter – brak sumy kontrolnej EIP-55 do weryfikacji literówek');
  }
  notes.push('Format EVM – ten sam adres może działać w Ethereum, BSC, Polygon, Arbitrum i innych sieciach EVM');
  return { chain: 'ETH', address: checksummed, key: `ETH:${raw.toLowerCase()}`, format: 'EVM (EOA lub kontrakt)', checksum, formatConfidence: checksum === 'valid' ? 'high' : 'medium', notes };
}

function classifyBase58(raw: string, text: string, start: number): Omit<AddressMatch, 'start' | 'end' | 'context'> | string | null {
  const payload = base58CheckDecode(raw);
  if (payload && payload.length === 21) {
    const v = payload[0];
    const map: Record<number, [Chain, string]> = {
      0x00: ['BTC', 'P2PKH (legacy)'],
      0x05: ['BTC', 'P2SH'],
      0x30: ['LTC', 'P2PKH'],
      0x32: ['LTC', 'P2SH'],
      0x1e: ['DOGE', 'P2PKH'],
      0x16: ['DOGE', 'P2SH'],
      0x41: ['TRX', 'TRON (base58check, prefiks 0x41)'],
    };
    const hit = map[v];
    if (hit) {
      const [chain, format] = hit;
      const prefixOk =
        (chain === 'BTC' && /^[13]/.test(raw)) ||
        (chain === 'LTC' && /^[LM3]/.test(raw)) ||
        (chain === 'DOGE' && /^[D9A]/.test(raw)) ||
        (chain === 'TRX' && raw.startsWith('T'));
      if (prefixOk) return { chain, address: raw, key: `${chain}:${raw}`, format, checksum: 'valid', formatConfidence: 'high', notes: [] };
    }
  }
  // Solana: 32 bajty klucza publicznego bez sumy kontrolnej – akceptujemy wyłącznie z podpowiedzią w kontekście.
  const decoded = base58Decode(raw);
  if (decoded && decoded.length === 32 && raw.length >= 32) {
    const window = text.slice(Math.max(0, start - 80), start + raw.length + 80);
    if (SOLANA_HINT.test(window)) {
      return {
        chain: 'SOL',
        address: raw,
        key: `SOL:${raw}`,
        format: 'Solana (ed25519, bez sumy kontrolnej)',
        checksum: 'not-applicable',
        formatConfidence: 'medium',
        notes: ['Solana nie ma sumy kontrolnej – rozpoznanie oparte na długości klucza i słowie kluczowym w kontekście'],
      };
    }
    return null; // zbyt niespecyficzne bez kontekstu – nie zgłaszamy nawet jako odrzucone
  }
  if (/^[13LMDT]/.test(raw) && raw.length >= 26 && raw.length <= 35) {
    return 'Ciąg wygląda jak adres Base58Check, ale suma kontrolna jest błędna (możliwa literówka lub fałszywy adres)';
  }
  return null;
}

export function extractAddresses(text: string): ExtractionResult {
  const matches: AddressMatch[] = [];
  const rejected: RejectedCandidate[] = [];
  const taken: [number, number][] = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);

  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const raw = m[1];
      const start = m.index + m[0].indexOf(raw);
      const end = start + raw.length;
      if (overlaps(start, end)) continue;
      let res: ReturnType<typeof classifyBase58>;
      if (name === 'bech32') res = classifyBech32(raw);
      else if (name === 'evm') res = classifyEvm(raw);
      else if (name === 'xmr') {
        res = {
          chain: 'XMR',
          address: raw,
          key: `XMR:${raw}`,
          format: raw.length === 106 ? 'Monero (integrated)' : 'Monero (standard/subaddress)',
          checksum: 'not-verified',
          formatConfidence: 'medium',
          notes: ['Monero: sieć prywatna – historia transakcji nie jest publiczna; rozpoznanie po formacie'],
        };
      } else res = classifyBase58(raw, text, start);

      if (res === null) continue;
      taken.push([start, end]);
      if (typeof res === 'string') {
        rejected.push({ candidate: raw, reason: res, start });
        continue;
      }
      matches.push({ ...res, start, end, context: contextOf(text, start, end) });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  return { matches, rejected };
}
