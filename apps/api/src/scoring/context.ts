// Klasyfikacja kontekstu publikacji adresu – podstawa Wskaźnika Pewności (KROK 2 załącznika).
// Reguły są jawne: każda klasyfikacja zwraca regułę, która zadziałała, i dopasowane słowa.
import type { DocKind } from '../sources/types.ts';

export type ContextCategory = 'OFFICIAL_PROFILE' | 'SALE_OFFER' | 'MESSENGER_SETTLEMENT' | 'EMAIL_SIGNATURE' | 'FORUM_DISCUSSION' | 'MASS_COMMENT';

export const CONTEXT_INFO: Record<ContextCategory, { label: string; base: number; band: string }> = {
  OFFICIAL_PROFILE: { label: 'Oficjalny, autorski profil / strona podmiotu', base: 90, band: '80–100%' },
  SALE_OFFER: { label: 'Ogłoszenie sprzedaży / oferta P2P', base: 70, band: '60–79%' },
  MESSENGER_SETTLEMENT: { label: 'Komunikator – kontekst rozliczenia', base: 70, band: '60–79%' },
  EMAIL_SIGNATURE: { label: 'Stopka e-mail', base: 65, band: '60–79%' },
  FORUM_DISCUSSION: { label: 'Dyskusja na forum / grupie tematycznej', base: 50, band: '40–59%' },
  MASS_COMMENT: { label: 'Masowe komentarze (giveaway, konkurs, promocja)', base: 25, band: '10–39%' },
};

export interface ContextResult {
  category: ContextCategory;
  rule: string;
  keywords: string[];
  aiSuggested?: boolean;
}

// Uwaga: \b w JS nie obsługuje polskich znaków – granice słów budujemy na \p{L} (flaga u).
const W = (alts: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'giu');
const KW = {
  mass: W('giveaway|airdrop|konkurs\\w*|rozdani\\w*|wygraj\\w*|free\\s?crypto|drop\\s?me|whitelist|zostaw(?:cie)? adres|oznacz(?:cie)? 3|tag(?:uj)? 3|follow\\s?&\\s?rt|wklejcie adres'),
  // Oferta: jednoznaczne wyrażenia sprzedaży/kupna/wymiany (same "cena", "kurs", "PLN" nie wystarczą).
  offer: W('sprzedam|sprzedaję|sprzedaje|kupię|kupie|odsprzedam|wymienię|oferta|ogłoszenie|escrow|wts|wtb|for sale|selling|sprzedawca'),
  payment: W('płatność|płatności|platnosc|zapłata|zaplata|przelew\\w*|przelej|wpłać|wplac|pln|zł|kurs|cena|price|payment|zapłać|zaplac|faktur\\w*'),
  settle: W('rozliczeni\\w*|rozliczmy|przelej|wyślij|wyslij|send|pay|płatność|zapłać|zaplac|reszt[ęa]|dopłat[aęy]|kwot[ęa]|na adres|na portfel'),
  profile: W('donate|donat\\w*|wesprzyj|wspieraj|tip\\s?jar|tips|napiwek|darowizn\\w*|support me|sponsor|buy me a coffee|mój portfel|moj portfel|portfel do'),
};

function hits(re: RegExp, text: string): string[] {
  re.lastIndex = 0;
  return [...new Set([...text.matchAll(re)].map((m) => m[0].toLowerCase().trim()))];
}

/**
 * @param docKind   typ dokumentu ze źródła (profil, ogłoszenie, kanał...)
 * @param ownDoc    dokument należy do badanego (jego profil/strona/kanał)
 * @param window    fragment tekstu wokół adresu (±160 znaków)
 * @param segmentHint podpowiedź strukturalna z dokumentu (np. "stopka")
 */
export function classifyContext(docKind: DocKind, ownDoc: boolean, window: string, segmentHint?: string, segmentKind?: DocKind, docTitle = ''): ContextResult {
  const kind = segmentKind ?? docKind;
  const mass = hits(KW.mass, window);
  if (mass.length >= 1 && (kind === 'comment' || kind === 'post' || kind === 'search-result'))
    return { category: 'MASS_COMMENT', rule: 'K1: słowa kluczowe akcji masowej (giveaway/konkurs) w komentarzu', keywords: mass };
  const massTitle = hits(KW.mass, docTitle);
  if (massTitle.length && kind === 'comment')
    return { category: 'MASS_COMMENT', rule: 'K1a: komentarz pod postem typu giveaway/konkurs (tytuł publikacji)', keywords: massTitle };
  // Stopka e-mail tylko dla dokumentów będących wiadomością e-mail (lub jawnie oznaczonej stopki) –
  // samo "Pozdrawiam" + "@" w poście na forum nie jest stopką.
  if (kind === 'email' || segmentHint === 'signature') return { category: 'EMAIL_SIGNATURE', rule: 'K2: adres w wiadomości e-mail / stopce', keywords: [] };
  if (kind === 'listing') return { category: 'SALE_OFFER', rule: 'K3: dokument typu ogłoszenie / oferta P2P', keywords: [...hits(KW.offer, window), ...hits(KW.payment, window)] };
  if (kind === 'channel') {
    const s = hits(KW.settle, window);
    return s.length
      ? { category: 'MESSENGER_SETTLEMENT', rule: 'K4: komunikator – wiadomość w kontekście rozliczenia', keywords: s }
      : { category: 'FORUM_DISCUSSION', rule: 'K5: komunikator/grupa bez kontekstu rozliczenia', keywords: [] };
  }
  if ((kind === 'profile' || kind === 'website' || kind === 'archive') && ownDoc)
    return { category: 'OFFICIAL_PROFILE', rule: 'K6: adres opublikowany na własnym profilu/stronie badanego', keywords: hits(KW.profile, window) };
  const offer = hits(KW.offer, window);
  const pay = hits(KW.payment, window);
  if (offer.length && pay.length) return { category: 'SALE_OFFER', rule: 'K7: wyrażenie oferty (sprzedam/kupię/oferta…) + słowo płatności w otoczeniu adresu', keywords: [...offer, ...pay] };
  if (mass.length) return { category: 'MASS_COMMENT', rule: 'K1b: słowa kluczowe akcji masowej', keywords: mass };
  return { category: 'FORUM_DISCUSSION', rule: 'K8: wypowiedź w dyskusji (domyślnie dla postów/komentarzy)', keywords: [] };
}
