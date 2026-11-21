import type { Chain } from '../extract/addresses.ts';

export type LabelCategory =
  | 'CEX' // giełda scentralizowana / portfel powierniczy
  | 'DEX' // giełda zdecentralizowana / router
  | 'MIXER'
  | 'CHARITY'
  | 'P2P' // platforma P2P / escrow
  | 'OFFRAMP' // kantor, bramka płatnicza, karta krypto-fiat
  | 'BRIDGE'
  | 'STABLECOIN'
  | 'CONTRACT'
  | 'SCAM'
  | 'OTHER';

/** Kategorie, których nie wolno przypisywać osobie jako prywatnego portfela (0%). */
export const EXCLUDED_CATEGORIES: LabelCategory[] = ['CEX', 'DEX', 'MIXER', 'CHARITY', 'P2P', 'OFFRAMP', 'BRIDGE', 'STABLECOIN', 'CONTRACT'];

export const CATEGORY_LABELS: Record<LabelCategory, string> = {
  CEX: 'Giełda scentralizowana (CEX) / portfel powierniczy',
  DEX: 'Giełda zdecentralizowana (DEX) / router',
  MIXER: 'Mikser',
  CHARITY: 'Zbiórka charytatywna',
  P2P: 'Platforma P2P / escrow',
  OFFRAMP: 'Kantor / bramka krypto-fiat / karta',
  BRIDGE: 'Most międzyłańcuchowy',
  STABLECOIN: 'Kontrakt stablecoina',
  CONTRACT: 'Smart kontrakt',
  SCAM: 'Oznaczony jako oszustwo',
  OTHER: 'Inne',
};

export interface AddressLabel {
  name: string;
  category: LabelCategory;
  /** Skąd pochodzi etykieta: lista startowa, etykieta analityka, API eksploratora. */
  origin: 'seed-list' | 'analyst' | 'explorer-api' | 'heuristic';
  synthetic?: boolean;
}

export interface ChainTx {
  hash: string;
  time: string | null;
  direction: 'in' | 'out' | 'self';
  counterparty: string | null;
  counterpartyLabel: AddressLabel | null;
  asset: string;
  amount: number;
  method?: string;
}

export interface Indicator {
  code: 'CEX_OUTFLOW' | 'CEX_INFLOW' | 'OFFRAMP' | 'STABLECOIN_SWAP' | 'STABLECOIN_FLOW' | 'DEX_SWAP' | 'MIXER' | 'LINKED_ADDRESS' | 'NO_ACTIVITY' | 'HIGH_ACTIVITY' | 'DATA_LIMIT';
  severity: 'info' | 'medium' | 'high';
  title: string;
  detail: string;
  /** czy wskaźnik dotyczy potencjalnego wyjścia do walut tradycyjnych (Fiat Cash-Out) */
  cashOut: boolean;
  txs: string[];
}

export interface ChainSummary {
  chain: Chain;
  address: string;
  provider: string;
  synthetic: boolean;
  fetchedAt: string;
  explorerUrl: string | null;
  isContract: boolean | null;
  label: AddressLabel | null;
  nativeAsset: string;
  txCount: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  received: number | null;
  sent: number | null;
  balance: number | null;
  tokenFlows: { asset: string; in: number; out: number }[];
  txs: ChainTx[];
  /** Liczba transakcji pobranych do analizy (próbka) vs. łączna. */
  sampled: boolean;
  /** Skąd pochodzą sumy wolumenu: pełne statystyki eksploratora czy tylko pobrana próbka. */
  volumeScope: 'full' | 'sample';
  indicators: Indicator[];
  error?: string;
}
