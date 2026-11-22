/** Polska odmiana po liczebniku: plural(1, 'transakcja', 'transakcje', 'transakcji') → "1 transakcja". */
export function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10, dd = n % 100;
  const w = n === 1 ? one : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
  return `${n} ${w}`;
}
