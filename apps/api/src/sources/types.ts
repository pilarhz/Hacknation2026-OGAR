// Kontrakt źródła OSINT. Dodanie nowego źródła = nowy plik implementujący `Source`
// + wpis w registry.ts. Silnik analizy nie zna szczegółów żadnego źródła.
import type { Identifier, IdentifierKind } from '../extract/identifiers.ts';
import type { RequestLogEntry } from '../http/fetcher.ts';

export type DocKind = 'profile' | 'website' | 'post' | 'listing' | 'comment' | 'channel' | 'archive' | 'search-result' | 'email';

export interface Segment {
  author?: string;
  text: string;
  kind?: DocKind;
  publishedAt?: string;
  /** np. "przypięty post", "stopka" – podpowiedź do klasyfikacji kontekstu */
  hint?: string;
}

export interface SourceDocument {
  source: string;
  url: string;
  title: string;
  kind: DocKind;
  /** Właściciel/autor całego dokumentu (np. właściciel profilu, autor ogłoszenia). */
  author?: string;
  publishedAt?: string;
  fetchedAt: string;
  /** Pełny tekst (bez HTML) – zapisywany w bazie do odtworzenia analizy. */
  content: string;
  /** Fragmenty z własnym autorem (posty w wątku, komentarze). Brak = cały dokument jako jeden fragment. */
  segments?: Segment[];
  /** Konto/zasób jest zweryfikowane (np. dowód kryptograficzny Keybase, znacznik weryfikacji). */
  verified?: boolean;
  /** Dla kopii archiwalnych – oryginalny URL. */
  archiveOf?: string;
  /** Dodatkowe identyfikatory ujawnione strukturalnie przez źródło (np. pole "blog" w GitHub). */
  linkedIdentifiers?: Identifier[];
  /** Adresy podane strukturalnie (np. pole "cryptocurrency_addresses" w Keybase). */
  structuredAddresses?: { address: string; label?: string }[];
  /** Ścieżka zapytania, które doprowadziło do dokumentu (dla raportu). */
  query?: string;
  /**
   * Jak dokument wiąże się z wyszukiwanym identyfikatorem:
   * - direct: zasób jednoznacznie należy do identyfikatora (np. profil /users/{nick}),
   * - search-candidate: wynik wyszukiwania pełnotekstowego – może dotyczyć innej osoby.
   */
  subjectMatch?: 'direct' | 'search-candidate';
}

export interface SourceContext {
  log: RequestLogEntry[];
  notes: string[];
  /** Skąd pochodzi wyszukiwany identyfikator: podany przez analityka czy odkryty w pivocie. */
  origin?: 'input' | 'pivot';
  /** URL dokumentu, w którym odkryto identyfikator (dla pivotu). */
  foundIn?: string;
  /** URL-e, których nie pobrano, bo host wymaga zatwierdzenia przez analityka. */
  skipped?: { url: string; host: string; foundIn: string }[];
}

export interface Source {
  id: string;
  label: string;
  description: string;
  /** Typy identyfikatorów, które źródło potrafi wyszukać. */
  accepts: IdentifierKind[];
  /** Domeny, z którymi łączy się źródło (dokumentacja + biała lista). */
  hosts: string[];
  /** Czy źródło jest syntetyczne (scenariusze testowe). */
  synthetic?: boolean;
  /** Znane ograniczenie dostępności (pokazywane analityście przy wyborze źródeł). */
  status?: () => { available: boolean; note?: string };
  search(identifier: Identifier, ctx: SourceContext): Promise<SourceDocument[]>;
}
