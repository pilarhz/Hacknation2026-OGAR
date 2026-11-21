// Wskaźniki aktywności on-chain, w tym potencjalne wyjście do walut tradycyjnych (Fiat Cash-Out).
// Każdy wskaźnik wskazuje konkretne transakcje (hash), aby analityk mógł go zweryfikować.
import { isStable } from './providers.ts';
import type { ChainSummary, Indicator } from './types.ts';

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

  const cexOut = byCat('CEX', 'out');
  if (cexOut.length)
    out.push({ code: 'CEX_OUTFLOW', severity: 'high', title: 'Wpłaty na giełdę scentralizowaną (CEX)', detail: `${cexOut.length} transakcji do: ${names(cexOut)}; łącznie ${sum(cexOut)}. Wpłata na giełdę zwykle poprzedza sprzedaż za walutę fiat – wymaga weryfikacji u giełdy (KYC).`, cashOut: true, txs: cexOut.map((t) => t.hash) });
  const off = [...byCat('OFFRAMP'), ...byCat('P2P')];
  if (off.length)
    out.push({ code: 'OFFRAMP', severity: 'high', title: 'Interakcja z kantorem / bramką krypto-fiat / P2P', detail: `${off.length} transakcji z: ${names(off)}; łącznie ${sum(off)}.`, cashOut: true, txs: off.map((t) => t.hash) });

  // Wymiana na stablecoiny: przychód stablecoina w tej samej transakcji co wypływ do DEX.
  const dexTx = new Set(byCat('DEX').map((t) => t.hash));
  const swaps = s.txs.filter((t) => dexTx.has(t.hash) && t.direction === 'in' && isStable(t.asset));
  const swapValue = swaps.reduce((a, t) => a + t.amount, 0);
  if (swaps.length)
    out.push({ code: 'STABLECOIN_SWAP', severity: swapValue >= opts.stableThreshold ? 'high' : 'medium', title: 'Wymiana kryptowaluty na stablecoin (DEX)', detail: `Otrzymano ${sum(swaps)} w wyniku swapu na DEX (${names(byCat('DEX'))}).`, cashOut: swapValue >= opts.stableThreshold, txs: swaps.map((t) => t.hash) });
  else if (dexTx.size)
    out.push({ code: 'DEX_SWAP', severity: 'info', title: 'Interakcje z DEX', detail: `${dexTx.size} transakcji z: ${names(byCat('DEX'))}.`, cashOut: false, txs: [...dexTx] });

  const stableFlows = s.tokenFlows.filter((f) => isStable(f.asset));
  const stableTotal = stableFlows.reduce((a, f) => a + f.in + f.out, 0);
  if (stableTotal >= opts.stableThreshold)
    out.push({ code: 'STABLECOIN_FLOW', severity: 'medium', title: 'Znaczne przepływy stablecoinów', detail: stableFlows.map((f) => `${f.asset}: wpływy ${fmt(f.in, '')}, wypływy ${fmt(f.out, '')}`).join('; '), cashOut: false, txs: s.txs.filter((t) => isStable(t.asset)).map((t) => t.hash) });

  const mix = byCat('MIXER');
  if (mix.length)
    out.push({ code: 'MIXER', severity: 'high', title: 'Interakcja z mikserem', detail: `${mix.length} transakcji z: ${names(mix)}; łącznie ${sum(mix)}. Możliwe zacieranie pochodzenia środków.`, cashOut: false, txs: mix.map((t) => t.hash) });

  const cexIn = byCat('CEX', 'in');
  if (cexIn.length)
    out.push({ code: 'CEX_INFLOW', severity: 'info', title: 'Wypłaty z giełdy na ten adres', detail: `${cexIn.length} transakcji z: ${names(cexIn)}; łącznie ${sum(cexIn)} (możliwy zakup kryptowaluty na giełdzie).`, cashOut: false, txs: cexIn.map((t) => t.hash) });

  const linked = s.txs.filter((t) => t.counterparty && opts.linkedKeys.has(`${s.chain}:${s.chain === 'ETH' ? t.counterparty.toLowerCase() : t.counterparty}`));
  if (linked.length)
    out.push({ code: 'LINKED_ADDRESS', severity: 'medium', title: 'Transakcje z innym adresem przypisanym badanemu', detail: `Bezpośrednie przepływy z/do: ${[...new Set(linked.map((t) => t.counterparty))].join(', ')} – potwierdza wspólną kontrolę lub powiązanie.`, cashOut: false, txs: linked.map((t) => t.hash) });

  if (s.txCount === 0) out.push({ code: 'NO_ACTIVITY', severity: 'info', title: 'Brak aktywności on-chain', detail: 'Adres nie ma żadnych transakcji – może być nieużywany, nowy lub opublikowany jako przynęta.', cashOut: false, txs: [] });
  if ((s.txCount ?? 0) >= opts.highActivityTx)
    out.push({ code: 'HIGH_ACTIVITY', severity: 'medium', title: 'Bardzo duża liczba transakcji', detail: `${s.txCount} transakcji – profil typowy dla usługi (giełda, płatności), a nie prywatnego portfela. Wymaga weryfikacji etykiety.`, cashOut: false, txs: [] });
  if (s.sampled)
    out.push({
      code: 'DATA_LIMIT',
      severity: 'info',
      title: 'Analiza na próbce transakcji',
      detail: `Przeanalizowano ${s.txs.length}${s.txCount ? ` z ${s.txCount}` : ''} transakcji (najnowsze). ${s.volumeScope === 'full' ? 'Sumy wolumenu pochodzą z pełnych statystyk eksploratora' : 'Sumy wolumenu obejmują WYŁĄCZNIE próbkę – rzeczywisty wolumen może być wyższy'}; wskaźniki liczone z próbki.`,
      cashOut: false,
      txs: [],
    });
  return out;
}
