// Dostawcy danych blockchain (publiczne eksploratory, bez kluczy API):
//  - Ethereum: Blockscout API v2 (etykiety, flaga kontraktu, transakcje, transfery ERC-20)
//  - Bitcoin: Esplora (Blockstream) – statystyki adresu i ostatnie transakcje
//  - TRON: Tronscan – konto i transfery TRC-20 (USDT)
//  - Fixture: dane syntetyczne dla adresów z piaskownicy testowej
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { API_ROOT, config } from '../config.ts';
import { db, json, now } from '../db/db.ts';
import { currentCacheSince, fetchJson, type RequestLogEntry } from '../http/fetcher.ts';
import { categorizeExplorerTag, lookupLabel } from './labels.ts';
import type { AddressLabel, ChainSummary, ChainTx } from './types.ts';
import type { Chain } from '../extract/addresses.ts';

const STABLES = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDE', 'FDUSD', 'PYUSD', 'EURC']);
export const isStable = (symbol: string) => STABLES.has(symbol.toUpperCase());

function emptySummary(chain: Chain, address: string, provider: string, nativeAsset: string): ChainSummary {
  return {
    chain, address, provider, synthetic: false, fetchedAt: now(), explorerUrl: null, isContract: null, label: null, nativeAsset,
    txCount: null, firstSeen: null, lastSeen: null, received: null, sent: null, balance: null, tokenFlows: [], txs: [], sampled: false, volumeScope: 'sample', indicators: [],
  };
}

function addFlow(flows: ChainSummary['tokenFlows'], asset: string, dir: 'in' | 'out' | 'self', amount: number) {
  let f = flows.find((x) => x.asset === asset);
  if (!f) flows.push((f = { asset, in: 0, out: 0 }));
  if (dir === 'in') f.in += amount;
  if (dir === 'out') f.out += amount;
}

// ---------------- Ethereum / Blockscout ----------------
interface BsAddr {
  hash: string;
  is_contract?: boolean;
  name?: string | null;
  metadata?: { tags?: { name: string; tagType?: string }[] } | null;
  public_tags?: { display_name?: string; label?: string }[];
}

function bsLabel(a: BsAddr | null | undefined): AddressLabel | null {
  if (!a?.hash) return null;
  const seed = lookupLabel('ETH', a.hash);
  if (seed) return seed;
  const tagNames = [...(a.metadata?.tags ?? []).map((t) => t.name), ...(a.public_tags ?? []).map((t) => t.display_name ?? t.label ?? '')].filter(Boolean);
  for (const n of tagNames) {
    const cat = categorizeExplorerTag(n);
    if (cat) return { name: n, category: cat, origin: 'explorer-api' };
  }
  if (a.is_contract) {
    const cat = a.name ? categorizeExplorerTag(a.name) : null;
    return { name: a.name || tagNames[0] || 'Smart kontrakt (bez nazwy)', category: cat ?? 'CONTRACT', origin: 'explorer-api' };
  }
  if (tagNames.length) return { name: tagNames[0], category: 'OTHER', origin: 'explorer-api' };
  return null;
}

async function ethBlockscout(address: string, log: RequestLogEntry[]): Promise<ChainSummary> {
  const base = config.blockscoutUrl.replace(/\/$/, '');
  const s = emptySummary('ETH', address, 'Blockscout API v2', 'ETH');
  s.explorerUrl = `${base}/address/${address}`;
  const info = await fetchJson<BsAddr & { coin_balance?: string | null }>(`${base}/api/v2/addresses/${address}`, { log });
  if (info.res.status === 404) {
    s.txCount = 0;
    s.isContract = false;
    return s;
  }
  if (!info.data) throw new Error(`Blockscout HTTP ${info.res.status}`);
  s.isContract = !!info.data.is_contract;
  s.label = bsLabel(info.data);
  s.balance = info.data.coin_balance ? Number(info.data.coin_balance) / 1e18 : 0;
  const counters = await fetchJson<{ transactions_count?: string }>(`${base}/api/v2/addresses/${address}/counters`, { log });
  s.txCount = counters.data?.transactions_count ? Number(counters.data.transactions_count) : null;

  const lc = address.toLowerCase();
  const txs = await fetchJson<{ items: { hash: string; timestamp: string; from: BsAddr; to: BsAddr | null; value: string; method?: string | null }[] }>(
    `${base}/api/v2/addresses/${address}/transactions`,
    { log },
  );
  let received = 0;
  let sent = 0;
  for (const t of txs.data?.items ?? []) {
    const fromMe = t.from?.hash?.toLowerCase() === lc;
    const toMe = t.to?.hash?.toLowerCase() === lc;
    const direction: ChainTx['direction'] = fromMe && toMe ? 'self' : fromMe ? 'out' : 'in';
    const cp = direction === 'out' ? t.to : t.from;
    const amount = Number(t.value) / 1e18;
    if (direction === 'in') received += amount;
    if (direction === 'out') sent += amount;
    s.txs.push({ hash: t.hash, time: t.timestamp, direction, counterparty: cp?.hash ?? null, counterpartyLabel: bsLabel(cp), asset: 'ETH', amount, method: t.method ?? undefined });
  }
  addFlow(s.tokenFlows, 'ETH', 'in', received);
  addFlow(s.tokenFlows, 'ETH', 'out', sent);

  const tt = await fetchJson<{
    items: { from: BsAddr; to: BsAddr; token: { symbol?: string; decimals?: string }; total: { value?: string; decimals?: string }; timestamp: string; tx_hash?: string; transaction_hash?: string; method?: string }[];
  }>(`${base}/api/v2/addresses/${address}/token-transfers?type=ERC-20`, { log });
  for (const t of tt.data?.items ?? []) {
    const fromMe = t.from?.hash?.toLowerCase() === lc;
    const direction: ChainTx['direction'] = fromMe ? 'out' : 'in';
    const cp = fromMe ? t.to : t.from;
    const dec = Number(t.total?.decimals ?? t.token?.decimals ?? 18);
    const amount = Number(t.total?.value ?? 0) / 10 ** dec;
    const asset = (t.token?.symbol ?? '?').toUpperCase();
    addFlow(s.tokenFlows, asset, direction, amount);
    s.txs.push({ hash: t.tx_hash ?? t.transaction_hash ?? '', time: t.timestamp, direction, counterparty: cp?.hash ?? null, counterpartyLabel: bsLabel(cp), asset, amount, method: t.method });
  }
  finalizeTimes(s);
  s.received = received;
  s.sent = sent;
  s.sampled = (s.txCount ?? 0) > (txs.data?.items?.length ?? 0);
  return s;
}

// ---------------- Bitcoin / Esplora ----------------
interface EsTx {
  txid: string;
  status: { block_time?: number };
  vin: { prevout?: { scriptpubkey_address?: string; value: number } }[];
  vout: { scriptpubkey_address?: string; value: number }[];
}

async function btcEsplora(address: string, log: RequestLogEntry[]): Promise<ChainSummary> {
  const base = config.esploraUrl.replace(/\/$/, '');
  const s = emptySummary('BTC', address, 'Esplora (Blockstream)', 'BTC');
  s.explorerUrl = `https://blockstream.info/address/${address}`;
  s.isContract = false;
  s.label = lookupLabel('BTC', address);
  const info = await fetchJson<{ chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number } }>(`${base}/address/${address}`, { log });
  if (!info.data) throw new Error(`Esplora HTTP ${info.res.status}`);
  const cs = info.data.chain_stats;
  s.txCount = cs.tx_count;
  s.received = cs.funded_txo_sum / 1e8;
  s.sent = cs.spent_txo_sum / 1e8;
  s.balance = (cs.funded_txo_sum - cs.spent_txo_sum) / 1e8;
  s.volumeScope = 'full'; // sumy z chain_stats Esplory obejmują całą historię adresu
  addFlow(s.tokenFlows, 'BTC', 'in', s.received);
  addFlow(s.tokenFlows, 'BTC', 'out', s.sent);
  const txs = await fetchJson<EsTx[]>(`${base}/address/${address}/txs`, { log });
  for (const t of txs.data ?? []) {
    const inFromMe = t.vin.filter((v) => v.prevout?.scriptpubkey_address === address).reduce((a, v) => a + (v.prevout?.value ?? 0), 0);
    const outToMe = t.vout.filter((v) => v.scriptpubkey_address === address).reduce((a, v) => a + v.value, 0);
    const direction: ChainTx['direction'] = inFromMe > 0 ? (outToMe >= inFromMe ? 'self' : 'out') : 'in';
    const cpAddr =
      direction === 'out'
        ? t.vout.find((v) => v.scriptpubkey_address && v.scriptpubkey_address !== address)?.scriptpubkey_address
        : t.vin.find((v) => v.prevout?.scriptpubkey_address && v.prevout.scriptpubkey_address !== address)?.prevout?.scriptpubkey_address;
    s.txs.push({
      hash: t.txid,
      time: t.status.block_time ? new Date(t.status.block_time * 1000).toISOString() : null,
      direction,
      counterparty: cpAddr ?? null,
      counterpartyLabel: cpAddr ? lookupLabel('BTC', cpAddr) : null,
      asset: 'BTC',
      amount: Math.abs(direction === 'out' ? inFromMe - outToMe : outToMe) / 1e8,
    });
  }
  finalizeTimes(s);
  s.sampled = cs.tx_count > s.txs.length;
  if (s.sampled) s.firstSeen = null; // najstarsza transakcja spoza próbki – nie zgadujemy
  return s;
}

// ---------------- TRON / Tronscan ----------------
async function tronscan(address: string, log: RequestLogEntry[]): Promise<ChainSummary> {
  const base = config.tronscanUrl.replace(/\/$/, '');
  const s = emptySummary('TRX', address, 'Tronscan API', 'TRX');
  s.explorerUrl = `https://tronscan.org/#/address/${address}`;
  s.label = lookupLabel('TRX', address);
  const headers = { 'TRON-PRO-API-KEY': config.tronscanApiKey };
  const acc = await fetchJson<{ balance?: number; totalTransactionCount?: number; date_created?: number; addressTag?: string; accountType?: number }>(
    `${base}/api/accountv2?address=${address}`,
    { log, headers },
  );
  if (!acc.data) throw new Error(`Tronscan HTTP ${acc.res.status}`);
  s.balance = (acc.data.balance ?? 0) / 1e6;
  s.txCount = acc.data.totalTransactionCount ?? null;
  s.isContract = acc.data.accountType === 2 ? true : acc.data.accountType === undefined ? null : false;
  if (!s.label && acc.data.addressTag) s.label = { name: acc.data.addressTag, category: categorizeExplorerTag(acc.data.addressTag) ?? 'OTHER', origin: 'explorer-api' };
  const tr = await fetchJson<{ token_transfers?: { transaction_id: string; block_ts: number; from_address: string; to_address: string; quant: string; tokenInfo?: { tokenAbbr?: string; tokenDecimal?: number }; to_address_tag?: { to_address_tag?: string }; from_address_tag?: { from_address_tag?: string } }[] }>(
    `${base}/api/token_trc20/transfers?limit=50&start=0&relatedAddress=${address}`,
    { log, headers },
  );
  for (const t of tr.data?.token_transfers ?? []) {
    const direction: ChainTx['direction'] = t.from_address === address ? 'out' : 'in';
    const cp = direction === 'out' ? t.to_address : t.from_address;
    const tag = direction === 'out' ? t.to_address_tag?.to_address_tag : t.from_address_tag?.from_address_tag;
    const asset = (t.tokenInfo?.tokenAbbr ?? 'TRC20').toUpperCase();
    const amount = Number(t.quant) / 10 ** (t.tokenInfo?.tokenDecimal ?? 6);
    addFlow(s.tokenFlows, asset, direction, amount);
    const label = lookupLabel('TRX', cp) ?? (tag ? { name: tag, category: categorizeExplorerTag(tag) ?? 'OTHER', origin: 'explorer-api' as const } : null);
    s.txs.push({ hash: t.transaction_id, time: new Date(t.block_ts).toISOString(), direction, counterparty: cp, counterpartyLabel: label, asset, amount });
  }
  finalizeTimes(s);
  s.sampled = (s.txCount ?? 0) > s.txs.length;
  return s;
}

// ---------------- TRON / TronGrid (bez klucza API) ----------------
async function trongrid(address: string, log: RequestLogEntry[]): Promise<ChainSummary> {
  const base = config.trongridUrl.replace(/\/$/, '');
  const s = emptySummary('TRX', address, 'TronGrid API', 'TRX');
  s.explorerUrl = `https://tronscan.org/#/address/${address}`;
  s.label = lookupLabel('TRX', address);
  const acc = await fetchJson<{ data?: { balance?: number; create_time?: number; type?: string }[] }>(`${base}/v1/accounts/${address}`, { log });
  if (!acc.data) throw new Error(`TronGrid HTTP ${acc.res.status}`);
  const a = acc.data.data?.[0];
  s.balance = (a?.balance ?? 0) / 1e6;
  s.isContract = a?.type === 'Contract' ? true : a ? false : null;
  const tr = await fetchJson<{ data?: { transaction_id: string; block_timestamp: number; from: string; to: string; value: string; token_info?: { symbol?: string; decimals?: number } }[] }>(
    `${base}/v1/accounts/${address}/transactions/trc20?limit=50`,
    { log },
  );
  for (const t of tr.data?.data ?? []) {
    const direction: ChainTx['direction'] = t.from === address ? 'out' : 'in';
    const cp = direction === 'out' ? t.to : t.from;
    const asset = (t.token_info?.symbol ?? 'TRC20').toUpperCase();
    const amount = Number(t.value) / 10 ** (t.token_info?.decimals ?? 6);
    addFlow(s.tokenFlows, asset, direction, amount);
    s.txs.push({ hash: t.transaction_id, time: new Date(t.block_timestamp).toISOString(), direction, counterparty: cp, counterpartyLabel: lookupLabel('TRX', cp), asset, amount });
  }
  s.txCount = s.txs.length ? null : 0; // TronGrid nie podaje łącznej liczby – pokazujemy próbkę
  finalizeTimes(s);
  s.sampled = s.txs.length >= 50;
  return s;
}

// ---------------- Fixture (dane syntetyczne) ----------------
interface FixtureTx {
  hash: string;
  time: string;
  direction: ChainTx['direction'];
  counterparty: string;
  asset: string;
  amount: number;
  method?: string;
}
interface Fixture {
  isContract?: boolean;
  balance?: number;
  txs: FixtureTx[];
}
let fixtures: Record<string, Fixture> | null = null;
function loadFixtures(): Record<string, Fixture> {
  if (!fixtures) fixtures = JSON.parse(readFileSync(path.join(API_ROOT, 'data', 'chain-fixtures.json'), 'utf8')).addresses;
  return fixtures!;
}
const fixtureKey = (chain: Chain, address: string) => `${chain}:${chain === 'ETH' ? address.toLowerCase() : address}`;

function fromFixture(chain: Chain, address: string, f: Fixture): ChainSummary {
  const native = chain === 'ETH' ? 'ETH' : chain === 'BTC' ? 'BTC' : chain === 'TRX' ? 'TRX' : chain;
  const s = emptySummary(chain, address, 'Dane syntetyczne (piaskownica)', native);
  s.synthetic = true;
  s.volumeScope = 'full';
  s.isContract = f.isContract ?? false;
  s.label = lookupLabel(chain, address);
  s.balance = f.balance ?? 0;
  let received = 0;
  let sent = 0;
  const hashes = new Set<string>();
  for (const t of f.txs) {
    hashes.add(t.hash);
    s.txs.push({ ...t, counterpartyLabel: lookupLabel(chain, t.counterparty) });
    addFlow(s.tokenFlows, t.asset, t.direction, t.amount);
    if (t.asset === native) {
      if (t.direction === 'in') received += t.amount;
      if (t.direction === 'out') sent += t.amount;
    }
  }
  s.txCount = hashes.size;
  s.received = received;
  s.sent = sent;
  finalizeTimes(s);
  return s;
}

function finalizeTimes(s: ChainSummary) {
  const times = s.txs.map((t) => t.time).filter((t): t is string => !!t).sort();
  s.firstSeen = times[0] ?? null;
  s.lastSeen = times[times.length - 1] ?? null;
  s.txs.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
}

// ---------------- Fasada z cache ----------------
export async function getChainSummary(chain: Chain, address: string, log: RequestLogEntry[]): Promise<ChainSummary> {
  const fx = loadFixtures()[fixtureKey(chain, address)];
  if (fx) return fromFixture(chain, address, fx);

  const key = fixtureKey(chain, address);
  const cached = db().prepare('SELECT fetched_at, data_json FROM chain_cache WHERE key = ?').get(key) as { fetched_at: string; data_json: string } | undefined;
  if (cached && Date.now() - Date.parse(cached.fetched_at) < config.cacheTtlMinutes * 60_000 && Date.parse(cached.fetched_at) >= currentCacheSince()) {
    return json<ChainSummary>(cached.data_json, emptySummary(chain, address, 'cache', chain));
  }
  const native = chain === 'LTC' ? 'LTC' : chain === 'DOGE' ? 'DOGE' : chain === 'SOL' ? 'SOL' : chain === 'XMR' ? 'XMR' : chain;
  if (!config.chainLive) {
    const s = emptySummary(chain, address, 'brak (CHAIN_LIVE=false)', native);
    s.error = 'Pobieranie danych on-chain wyłączone w konfiguracji (CHAIN_LIVE=false).';
    s.label = lookupLabel(chain, address);
    return s;
  }
  let s: ChainSummary;
  try {
    if (chain === 'ETH') s = await ethBlockscout(address, log);
    else if (chain === 'BTC') s = await btcEsplora(address, log);
    else if (chain === 'TRX') s = config.tronscanApiKey ? await tronscan(address, log) : await trongrid(address, log);
    else {
      s = emptySummary(chain, address, 'brak dostawcy', native);
      s.label = lookupLabel(chain, address);
      s.error = chain === 'XMR' ? 'Monero jest siecią prywatną – historia transakcji nie jest publicznie dostępna.' : `Brak skonfigurowanego dostawcy danych dla sieci ${chain} (rozszerzalne w chain/providers.ts).`;
      return s;
    }
  } catch (e) {
    s = emptySummary(chain, address, 'błąd', native);
    s.label = lookupLabel(chain, address);
    s.error = `Nie udało się pobrać danych on-chain: ${e instanceof Error ? e.message : String(e)}`;
    return s;
  }
  db().prepare('INSERT OR REPLACE INTO chain_cache (key, fetched_at, data_json) VALUES (?, ?, ?)').run(key, s.fetchedAt, JSON.stringify(s));
  return s;
}
