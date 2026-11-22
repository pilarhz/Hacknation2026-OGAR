// Kodowania używane w adresach kryptowalutowych: Base58(Check), Bech32/Bech32m, EIP-55.
// Implementacje własne (bez zależności), zgodne z BIP-173, BIP-350 i EIP-55.
import { createHash } from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3';

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP = new Map<string, number>([...B58_ALPHABET].map((c, i) => [c, i]));

export function base58Decode(input: string): Uint8Array | null {
  if (input.length === 0) return null;
  const bytes: number[] = [0];
  for (const ch of input) {
    const value = B58_MAP.get(ch);
    if (value === undefined) return null;
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of input) {
    if (ch !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

function base58Encode(data: Uint8Array): string {
  const digits: number[] = [0];
  for (const byte of data) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const byte of data) {
    if (byte !== 0) break;
    out += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}

function sha256(data: Uint8Array): Uint8Array {
  return createHash('sha256').update(data).digest();
}

/** Base58Check: zwraca payload (z bajtem wersji) gdy suma kontrolna jest poprawna. */
export function base58CheckDecode(input: string): Uint8Array | null {
  const raw = base58Decode(input);
  if (!raw || raw.length < 5) return null;
  const payload = raw.subarray(0, raw.length - 4);
  const checksum = raw.subarray(raw.length - 4);
  const hash = sha256(sha256(payload));
  for (let i = 0; i < 4; i++) if (hash[i] !== checksum[i]) return null;
  return payload;
}

export function base58CheckEncode(payload: Uint8Array): string {
  const hash = sha256(sha256(payload));
  const full = new Uint8Array(payload.length + 4);
  full.set(payload);
  full.set(hash.subarray(0, 4), payload.length);
  return base58Encode(full);
}

// ---------------- Bech32 / Bech32m (BIP-173 / BIP-350) ----------------
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

interface Bech32Decoded {
  hrp: string;
  data: number[];
  variant: 'bech32' | 'bech32m';
}

function bech32Decode(input: string): Bech32Decoded | null {
  if (input.length > 90) return null;
  const lower = input.toLowerCase();
  if (input !== lower && input !== input.toUpperCase()) return null; // mieszana wielkość liter
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length) return null;
  const hrp = lower.slice(0, pos);
  const data: number[] = [];
  for (const c of lower.slice(pos + 1)) {
    const d = BECH32_CHARSET.indexOf(c);
    if (d === -1) return null;
    data.push(d);
  }
  const check = polymod([...hrpExpand(hrp), ...data]);
  const variant = check === BECH32_CONST ? 'bech32' : check === BECH32M_CONST ? 'bech32m' : null;
  if (!variant) return null;
  return { hrp, data: data.slice(0, -6), variant };
}

function bech32Encode(hrp: string, data: number[], variant: 'bech32' | 'bech32m'): string {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ (variant === 'bech32' ? BECH32_CONST : BECH32M_CONST);
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) checksum.push((mod >>> (5 * (5 - i))) & 31);
  return hrp + '1' + [...data, ...checksum].map((d) => BECH32_CHARSET[d]).join('');
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
    return null;
  }
  return out;
}

/** Walidacja adresu SegWit (BIP-173/350) dla danego HRP (bc, ltc, tb...). */
export function decodeSegwit(hrp: string, address: string): { version: number; program: Uint8Array } | null {
  const dec = bech32Decode(address);
  if (!dec || dec.hrp !== hrp || dec.data.length < 1) return null;
  const version = dec.data[0];
  if (version > 16) return null;
  const program = convertBits(dec.data.slice(1), 5, 8, false);
  if (!program || program.length < 2 || program.length > 40) return null;
  if (version === 0 && program.length !== 20 && program.length !== 32) return null;
  if (version === 0 && dec.variant !== 'bech32') return null;
  if (version !== 0 && dec.variant !== 'bech32m') return null;
  return { version, program: Uint8Array.from(program) };
}

export function encodeSegwit(hrp: string, version: number, program: Uint8Array): string {
  const data = [version, ...(convertBits([...program], 8, 5, true) ?? [])];
  return bech32Encode(hrp, data, version === 0 ? 'bech32' : 'bech32m');
}

// ---------------- EIP-55 ----------------
export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  const hash = Buffer.from(keccak_256(new TextEncoder().encode(lower))).toString('hex');
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
