// Wyodrębnianie identyfikatorów Web2 z treści (do pivotowania na kolejne źródła).
export type IdentifierKind = 'name' | 'nick' | 'email' | 'telegram' | 'messenger' | 'social' | 'url' | 'phone' | 'address';

export interface Identifier {
  kind: IdentifierKind;
  value: string;
}

export const IDENTIFIER_LABELS: Record<IdentifierKind, string> = {
  name: 'Imię i nazwisko',
  nick: 'Nick / login',
  email: 'Adres e-mail',
  telegram: 'Telegram',
  messenger: 'Identyfikator komunikatora',
  social: 'Profil społecznościowy (URL)',
  url: 'Strona WWW',
  phone: 'Telefon',
  address: 'Adres kryptowalutowy',
};

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// Telegram: tylko jednoznaczne formy – link t.me/… albo "Telegram: @nick" (z @). Samo słowo po
// "telegram" (np. "Telegram support") NIE jest identyfikatorem.
const TELEGRAM = /(?:\bt\.me\/(?:s\/)?|\btelegram\.me\/)(?!joinchat\b|addstickers\b|share\b|proxy\b)([A-Za-z][A-Za-z0-9_]{4,31})\b|\b(?:telegram|tg)\s*[:\-–]?\s*@([A-Za-z][A-Za-z0-9_]{4,31})\b/gi;
// Telefon: wyłącznie z jawnym prefiksem (+48 lub słowo "tel/telefon/kom/whatsapp/sms") – inaczej
// każda 9-cyfrowa liczba (kwota w satoshi, nr zamówienia, fragment adresu) byłaby "telefonem".
const PHONE = /(?<![\p{L}\p{N}])(?:\+48[\s-]?|(?:tel(?:efon)?|phone|kom(?:órka)?|whatsapp|sms)\.?\s*[:\-–]?\s*(?:\+48[\s-]?)?)(\d{3}[\s-]?\d{3}[\s-]?\d{3})(?![\p{L}\p{N}])/giu;
const SOCIAL = /https?:\/\/(?:www\.)?(?:github\.com|x\.com|twitter\.com|reddit\.com\/(?:u|user)|instagram\.com|facebook\.com|tiktok\.com\/@|keybase\.io|news\.ycombinator\.com\/user\?id=)[^\s"'<>)]+/gi;

export function extractIdentifiers(text: string): Identifier[] {
  const out = new Map<string, Identifier>();
  const add = (kind: IdentifierKind, value: string) => {
    const v = value.trim().replace(/[.,;:]+$/, '');
    if (v.length < 3) return;
    out.set(`${kind}:${v.toLowerCase()}`, { kind, value: v });
  };
  for (const m of text.matchAll(EMAIL)) add('email', m[0].toLowerCase());
  for (const m of text.matchAll(TELEGRAM)) add('telegram', m[1] ?? m[2]);
  for (const m of text.matchAll(SOCIAL)) add('social', m[0]);
  for (const m of text.matchAll(PHONE)) add('phone', `+48${m[1].replace(/\D/g, '')}`);
  return [...out.values()];
}

/** Normalizacja nicka do porównań (wielkość liter, separatory, sufiksy liczbowe zostają). */
export function normalizeHandle(value: string): string {
  return value.toLowerCase().replace(/^@/, '').replace(/[\s._-]+/g, '');
}

/** Siła dopasowania autora dokumentu do identyfikatora badanego. */
export function handleMatch(a: string, b: string): 'exact' | 'normalized' | 'partial' | 'none' {
  if (!a || !b) return 'none';
  if (a.toLowerCase().replace(/^@/, '') === b.toLowerCase().replace(/^@/, '')) return 'exact';
  const na = normalizeHandle(a);
  const nb = normalizeHandle(b);
  if (na === nb) return 'normalized';
  if (na.length >= 5 && nb.length >= 5 && (na.includes(nb) || nb.includes(na))) return 'partial';
  return 'none';
}
