// Wskaźnik Pewności (Confidence Score) – prawdopodobieństwo, że adres należy do badanej osoby.
// Algorytm jest w pełni regułowy i wyjaśnialny: każda składowa wyniku to nazwana reguła
// z wartością i odnośnikiem do dowodu. Ten sam zestaw danych → zawsze ten sam wynik.
import { CONTEXT_INFO, type ContextResult } from './context.ts';
import { CATEGORY_LABELS, EXCLUDED_CATEGORIES, type AddressLabel, type Indicator } from '../chain/types.ts';
import type { DocKind } from '../sources/types.ts';
import { plural } from '../plural.ts';

export interface Evidence {
  docId: string;
  url: string;
  site: string;
  source: string;
  title: string;
  kind: DocKind;
  fetchedAt: string;
  publishedAt?: string;
  author?: string;
  /** subject = treść opublikował badany; other = inna osoba; unknown = brak autora */
  attribution: 'subject' | 'other' | 'unknown';
  attributionRule: string;
  linkStrength: 'exact' | 'normalized' | 'partial' | 'none';
  /** Liczba kroków pivotu od identyfikatora wejściowego (0 = identyfikator podany przez analityka). */
  depth: number;
  context: ContextResult;
  snippet: string;
  structured: boolean;
  verified: boolean;
  archived: boolean;
  /** Przypisanie opiera się wyłącznie na zgodności nicku (nie e-mail/Telegram/telefon). */
  viaNickOnly: boolean;
  /** Konto autora należy do potwierdzonej grupy kont badanego (patrz engine/identity.ts). */
  identityConfirmed: boolean;
  identityRule: string;
  /** Tożsamość wywnioskowana wyłącznie z publikacji adresu wejściowego (wyszukiwanie odwrotne). */
  weakIdentity: boolean;
}

export interface ScoreRule {
  code: string;
  label: string;
  value: number;
  kind: 'base' | 'bonus' | 'penalty' | 'override' | 'info';
  evidenceDocId?: string;
}

export interface ScoreResult {
  score: number;
  band: 'VERY_HIGH' | 'PROBABLE' | 'MEDIUM' | 'LOW' | 'NOT_ATTRIBUTED' | 'EXCLUDED';
  bandLabel: string;
  excluded: boolean;
  exclusionReason: string | null;
  rules: ScoreRule[];
  bestEvidenceDocId: string | null;
  independentSites: string[];
}

export const BANDS: Record<ScoreResult['band'], string> = {
  VERY_HIGH: '80–99% · BARDZO WYSOKIE PRAWDOPODOBIEŃSTWO',
  PROBABLE: '60–79% · PRAWDOPODOBNY',
  MEDIUM: '40–59% · ŚREDNI (wymaga potwierdzenia drugim śladem)',
  LOW: '10–39% · NISKI / SZUM',
  NOT_ATTRIBUTED: '<10% · BRAK PRZYPISANIA (adres opublikowany przez inną osobę)',
  EXCLUDED: '0% · WYKLUCZENIE (giełda/kontrakt/mikser/zbiórka)',
};

export const SCORING_PARAMS = {
  synergyBonus: 15,
  pivotPenaltyPerHop: 5,
  pivotPenaltyMax: 15,
  normalizedMatchPenalty: 5,
  partialMatchPenalty: 15,
  verifiedBonus: 5,
  archivedPenalty: 10,
  onChainLinkBonus: 5,
  highActivityPenalty: 20,
  notAttributedScore: 5,
  unconfirmedNickPenalty: 15,
  weakIdentityPenalty: 10,
  /** Wskaźnik to prawdopodobieństwo, nie pewność – nigdy 100%. */
  maxScore: 99,
};

/** Adres przypisany badanemu: niewykluczony i co najmniej przedział „średni” (40%). */
export const isAttributed = (s: ScoreResult) => !s.excluded && s.score >= 40;

function band(score: number): ScoreResult['band'] {
  if (score >= 80) return 'VERY_HIGH';
  if (score >= 60) return 'PROBABLE';
  if (score >= 40) return 'MEDIUM';
  if (score >= 10) return 'LOW';
  return 'NOT_ATTRIBUTED';
}

function evidenceScore(e: Evidence): { score: number; rules: ScoreRule[] } {
  const P = SCORING_PARAMS;
  const info = CONTEXT_INFO[e.context.category];
  const rules: ScoreRule[] = [{ code: 'R1', label: `Kontekst: ${info.label} (${e.context.rule}) – przedział ${info.band}`, value: info.base, kind: 'base', evidenceDocId: e.docId }];
  if (e.depth > 0) {
    const pen = Math.min(P.pivotPenaltyMax, e.depth * P.pivotPenaltyPerHop);
    rules.push({ code: 'R2', label: `Identyfikator autora uzyskany pośrednio (pivot, ${plural(e.depth, 'krok', 'kroki', 'kroków')} od danych wejściowych)`, value: -pen, kind: 'penalty', evidenceDocId: e.docId });
  }
  if (e.linkStrength === 'normalized') rules.push({ code: 'R3a', label: 'Nick autora zgodny po normalizacji (wielkość liter/separatory)', value: -P.normalizedMatchPenalty, kind: 'penalty', evidenceDocId: e.docId });
  if (e.linkStrength === 'partial') rules.push({ code: 'R3b', label: 'Nick autora zgodny tylko częściowo – możliwa inna osoba', value: -P.partialMatchPenalty, kind: 'penalty', evidenceDocId: e.docId });
  if (e.verified || e.structured) rules.push({ code: 'R4', label: e.structured ? 'Adres podany w polu strukturalnym profilu (np. podpisany w Keybase / portfel w Gravatar)' : 'Konto zweryfikowane w serwisie', value: P.verifiedBonus, kind: 'bonus', evidenceDocId: e.docId });
  if (e.archived) rules.push({ code: 'R5', label: 'Adres występuje tylko w archiwalnej wersji strony (nieaktualny)', value: -P.archivedPenalty, kind: 'penalty', evidenceDocId: e.docId });
  if (e.viaNickOnly && !e.identityConfirmed)
    rules.push({ code: 'R9', label: `Konto powiązane z badanym tylko zgodnością nicku – brak odnośnika lub wspólnego kontaktu z innymi kontami badanego (${e.identityRule})`, value: -P.unconfirmedNickPenalty, kind: 'penalty', evidenceDocId: e.docId });
  if (e.weakIdentity) rules.push({ code: 'R10', label: 'Tożsamość autora wywnioskowana wyłącznie z publikacji adresu wejściowego', value: -P.weakIdentityPenalty, kind: 'penalty', evidenceDocId: e.docId });
  const score = Math.max(0, rules.reduce((a, r) => a + r.value, 0)); // limit 99 nakłada scoreAddress (jawny wiersz MAX)
  return { score, rules };
}

export interface ScoreInput {
  evidence: Evidence[];
  label: AddressLabel | null;
  isContract: boolean | null;
  indicators: Indicator[];
  /** Czy adres ma transakcje z innym adresem przypisanym badanemu z wynikiem ≥ 60. */
  linkedToStrongAddress: boolean;
}

export function scoreAddress(input: ScoreInput): ScoreResult {
  const P = SCORING_PARAMS;
  const subjectEv = input.evidence.filter((e) => e.attribution === 'subject');
  const sites = [...new Set(subjectEv.map((e) => e.site))];

  // E1/E2 – wykluczenia (ochrona przed False Positive), niezależnie od kontekstu publikacji.
  const exclusion =
    input.label && EXCLUDED_CATEGORIES.includes(input.label.category)
      ? `E1: Etykieta "${input.label.name}" – ${CATEGORY_LABELS[input.label.category]} (źródło etykiety: ${input.label.origin})`
      : input.isContract
        ? 'E2: Adres zawiera kod wykonywalny (bytecode ≠ 0x) – smart kontrakt, nie prywatne konto'
        : null;
  if (exclusion) {
    return {
      score: 0,
      band: 'EXCLUDED',
      bandLabel: BANDS.EXCLUDED,
      excluded: true,
      exclusionReason: exclusion,
      rules: [
        { code: exclusion.slice(0, 2), label: exclusion, value: 0, kind: 'override' },
        ...(subjectEv.length ? [{ code: 'I1', label: `Odnotowano fakt interakcji: badany opublikował/użył tego adresu (${plural(subjectEv.length, 'wystąpienie', 'wystąpienia', 'wystąpień')}; np. adres depozytowy giełdy) – nie jest to prywatny portfel`, value: 0, kind: 'info' as const }] : []),
      ],
      bestEvidenceDocId: subjectEv[0]?.docId ?? null,
      independentSites: sites,
    };
  }

  if (!subjectEv.length) {
    return {
      score: P.notAttributedScore,
      band: 'NOT_ATTRIBUTED',
      bandLabel: BANDS.NOT_ATTRIBUTED,
      excluded: false,
      exclusionReason: null,
      rules: [{ code: 'R0', label: 'Adres znaleziony w materiale dotyczącym badanego, ale opublikowany przez inną osobę lub bez ustalonego autora – brak podstaw do przypisania', value: P.notAttributedScore, kind: 'base' }],
      bestEvidenceDocId: input.evidence[0]?.docId ?? null,
      independentSites: [],
    };
  }

  const scored = subjectEv.map((e) => ({ e, ...evidenceScore(e) })).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const rules: ScoreRule[] = [...best.rules];
  let score = best.score;

  if (sites.length >= 2) {
    rules.push({ code: 'R6', label: `Synergia śladów: adres w ${sites.length} niezależnych źródłach (${sites.join(', ')})`, value: P.synergyBonus, kind: 'bonus' });
    score += P.synergyBonus;
  } else if (subjectEv.length > 1) {
    rules.push({ code: 'R6x', label: `Wielokrotne wystąpienie w ramach jednej usługi (${sites[0]}) – nie stanowi dodatkowego potwierdzenia`, value: 0, kind: 'info' });
  }
  if (input.linkedToStrongAddress) {
    rules.push({ code: 'R7', label: 'Bezpośrednie transakcje z innym adresem przypisanym badanemu (wynik ≥ 60%)', value: P.onChainLinkBonus, kind: 'bonus' });
    score += P.onChainLinkBonus;
    // Powiązanie on-chain to drugi, niezależny ślad – znosi karę R9 za „tylko zgodny nick”.
    const r9 = rules.findIndex((r) => r.code === 'R9' && r.value < 0);
    if (r9 >= 0) {
      score -= rules[r9].value;
      rules[r9] = { ...rules[r9], label: `${rules[r9].label} – kara zniesiona: powiązanie on-chain z adresem badanego (R7)`, value: 0, kind: 'info' };
    }
  }
  if (input.indicators.some((i) => i.code === 'HIGH_ACTIVITY')) {
    rules.push({ code: 'R8', label: 'Heurystyka: bardzo duża liczba transakcji – możliwy adres usługi, nie osoby', value: -P.highActivityPenalty, kind: 'penalty' });
    score -= P.highActivityPenalty;
  }
  // Jawny wiersz limitu, żeby składowe sumowały się do wyniku (np. 90 + 5 + 15 = 110 → 99).
  if (score > P.maxScore) {
    rules.push({ code: 'MAX', label: `Limit wskaźnika: maksymalnie ${P.maxScore}%`, value: P.maxScore - score, kind: 'override' });
    score = P.maxScore;
  }
  score = Math.max(0, score);
  const b = band(score);
  // Przedział średni wymaga drugiego śladu – powiązanie on-chain (R7) nim jest, więc etykieta tego nie żąda.
  const bandLabel = b === 'MEDIUM' && input.linkedToStrongAddress ? '40–59% · ŚREDNI (drugi ślad: powiązanie on-chain)' : BANDS[b];
  return { score, band: b, bandLabel, excluded: false, exclusionReason: null, rules, bestEvidenceDocId: best.e.docId, independentSites: sites };
}
