// Deterministyczne generowanie FIKCYJNYCH, ale poprawnych formalnie adresów do piaskownicy.
// Adresy pochodzą z sha256(nazwa) – nikt nie zna do nich kluczy prywatnych.
import { createHash } from 'node:crypto';
import { encodeSegwit, toChecksumAddress, base58CheckEncode } from '../src/extract/encoding.ts';
const h = (s: string) => createHash('sha256').update('olcys-synthetic:' + s).digest().subarray(0, 20);
const names = process.argv.slice(2);
for (const n of names) {
  const [kind, label] = n.split(':');
  const b = h(label);
  let a = '';
  if (kind === 'btc') a = encodeSegwit('bc', 0, b);
  if (kind === 'eth') a = toChecksumAddress('0x' + Buffer.from(b).toString('hex'));
  if (kind === 'trx') a = base58CheckEncode(Uint8Array.from([0x41, ...b]));
  console.log(`${n}\t${a}`);
}
