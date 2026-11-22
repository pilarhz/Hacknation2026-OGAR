// Wskaźniki on-chain, w tym wyjście do fiat (cash-out). Każdy wskazuje transakcje (hash) do weryfikacji.
import { addressKey } from '../extract/addresses.ts';
import { isStable } from './providers.ts';
import type { ChainSummary, Indicator } from './types.ts';
import { plural } from '../plural.ts';

const fmt = (n: number, asset: string) => `${n.toLocaleString('pl-PL', { maximumFractionDigits: 6 })} ${asset}`;

export interface IndicatorOptions {
  /** Klucze (chain:adres) innych adresów przypisanych badanemu – do wykrywania powiązań on-chain. */
  linkedKeys: Map<string, string>;
  stableThreshold: number;
  highActivityTx: number;
}

export function computeIndicators(s: ChainSummary, opts: IndicatorOptions): Indicator[] {
  const out: Indicator[] = [];
  if (s.error) {
    out.push({ code: 'DATA_LIMIT', severity: 'info', title: 'Brak danych on-chain', detail: s.error, cashOut: false, txs: [] });
    return out;
  }
  const byCat = (cat: string, dir?: 'in' | 'out') => s.txs.filter((t) => t.counterpartyLabel?.category === cat && (!dir || t.direction === dir));
  const sum = (txs: typeof s.txs) => {
    const m = new Map<string, number>();
    for (const t of txs) m.set(t.asset, (m.get(t.asset) ?? 0) + t.amount);
    return [...m.entries()].map(([a, v]) => fmt(v, a)).join(', ');
  };
  const names = (txs: typeof s.txs) => [...new Set(txs.map((t) => t.counterpartyLabel?.name))].join(', ');
  const txN = (n: number) => plural(n, 'transakcja', 'transakcje', 'transakcji');
  // Przyimek zgodny z kierunkiem: wypływ → „do”, wpływ → „z”, oba → „z/do”.
  const dir = (txs: typeof s.txs) => (txs.every((t) => t.direction === 'out') ? 'do' : txs.every((t) => t.direction === 'in') ? 'z' : 'z/do');
  const withWho = (txs: typeof s.txs) => `${txN(txs.length)} ${dir(txs)}: ${names(txs)}; łącznie ${sum(txs)}`;

  const cexOut = byCat('CEX', 'out');
  if (cexOut.length)
    out.push({ code: 'CEX_OUTFLOW', severity: 'high', title: 'Wpłaty na giełdę scentralizowaną (CEX)', detail: `${withWho(cexOut)}. Wpłata na giełdę zwykle poprzedza sprzedaż za walutę fiat – wymaga weryfikacji u giełdy (KYC).`, cashOut: true, txs: cexOut.map((t) => t.hash) });
  const off = [...byCat('OFFRAMP'), ...byCat('P2P')];
  if (off.length)
    out.push({ code: 'OFFRAMP', severity: 'high', title: 'Interakcja z kantorem / bramką krypto-fiat / P2P', detail: `${withWho(off)}.`, cashOut: true, txs: off.map((t) => t.hash) });

  // Wymiana na stablecoiny: przychód stablecoina w tej samej transakcji co wypływ do DEX.
  const dexTx = new Set(byCat('DEX').map((t) => t.hash));
  const swaps = s.txs.filter((t) => dexTx.has(t.hash) && t.direction === 'in' && isStable(t.asset));
  const swapValue = swaps.reduce((a, t) => a + t.amount, 0);
  if (swaps.length)
    // Wymiana krypto→krypto, a nie wyjście do fiat (to samo saldo liczyłoby się podwójnie z późniejszą wpłatą na giełdę).
    out.push({ code: 'STABLECOIN_SWAP', severity: swapValue >= opts.stableThreshold ? 'medium' : 'info', title: 'Wymiana kryptowaluty na stablecoin (DEX)', detail: `Otrzymano ${sum(swaps)} w wyniku swapu na DEX (${names(byCat('DEX'))}). Wymiana krypto–krypto, nie wyjście do fiat.`, cashOut: false, txs: swaps.map((t) => t.hash) });
  else if (dexTx.size)
    out.push({ code: 'DEX_SWAP', severity: 'info', title: 'Interakcje z DEX', detail: `${withWho(byCat('DEX'))}.`, cashOut: false, txs: [...dexTx] });

  const stableFlows = s.tokenFlows.filter((f) => isStable(f.asset));
  const stableTotal = stableFlows.reduce((a, f) => a + f.in + f.out, 0);
  if (stableTotal >= opts.stableThreshold)
    out.push({ code: 'STABLECOIN_FLOW', severity: 'medium', title: 'Znaczne przepływy stablecoinów', detail: stableFlows.map((f) => `${f.asset}: wpływy ${fmt(f.in, '')}, wypływy ${fmt(f.out, '')}`).join('; '), cashOut: false, txs: s.txs.filter((t) => isStable(t.asset)).map((t) => t.hash) });

  const mix = byCat('MIXER');
  if (mix.length)
    out.push({ code: 'MIXER', severity: 'high', title: 'Interakcja z mikserem', detail: `${withWho(mix)}. Możliwe zacieranie pochodzenia środków.`, cashOut: false, txs: mix.map((t) => t.hash) });

  const cexIn = byCat('CEX', 'in');
  if (cexIn.length)
    out.push({ code: 'CEX_INFLOW', severity: 'info', title: 'Wypłaty z giełdy na ten adres', detail: `${withWho(cexIn)} (możliwy zakup kryptowaluty na giełdzie).`, cashOut: false, txs: cexIn.map((t) => t.hash) });

  const linked = s.txs.filter((t) => t.counterparty && opts.linkedKeys.has(addressKey(s.chain, t.counterparty)));
  if (linked.length)
    out.push({ code: 'LINKED_ADDRESS', severity: 'medium', title: 'Transakcje z innym adresem przypisanym badanemu', detail: `Bezpośrednie przepływy z/do: ${[...new Set(linked.map((t) => t.counterparty))].join(', ')} – potwierdza wspólną kontrolę lub powiązanie.`, cashOut: false, txs: linked.map((t) => t.hash) });

  if (s.txCount === 0) out.push({ code: 'NO_ACTIVITY', severity: 'info', title: 'Brak aktywności on-chain', detail: 'Adres nie ma żadnych transakcji – może być nieużywany, nowy lub opublikowany jako przynęta.', cashOut: false, txs: [] });
  if ((s.txCount ?? 0) >= opts.highActivityTx)
    out.push({ code: 'HIGH_ACTIVITY', severity: 'medium', title: 'Bardzo duża liczba transakcji', detail: `${txN(s.txCount ?? 0)} – profil typowy dla usługi (giełda, płatności), a nie prywatnego portfela. Wymaga weryfikacji etykiety.`, cashOut: false, txs: [] });
  if (s.sampled)
    out.push({
      code: 'DATA_LIMIT',
      severity: 'info',
      title: 'Analiza na próbce transakcji',
      detail: `Przeanalizowano ${s.txCount ? `${s.txs.length} z ${txN(s.txCount)}` : txN(s.txs.length)} (najnowsze). ${s.volumeScope === 'full' ? 'Sumy wolumenu pochodzą z pełnych statystyk eksploratora' : 'Sumy wolumenu obejmują WYŁĄCZNIE próbkę – rzeczywisty wolumen może być wyższy'}; wskaźniki liczone z próbki.`,
      cashOut: false,
      txs: [],
    });
  return out;
}
