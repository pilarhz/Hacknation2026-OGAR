import { useEffect, useState } from 'react';

// Motyw interfejsu: wybór użytkownika (jasny / ciemny / systemowy) zapisany w localStorage.
// Atrybut data-theme na <html> ustawia też skrypt w index.html jeszcze przed załadowaniem Reacta,
// żeby przy starcie nie było mignięcia jasnego tła.
export type ThemeChoice = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

const KEY = 'ogar-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* brak dostępu do localStorage – zostaje motyw systemowy */
  }
  return 'system';
}

const resolve = (c: ThemeChoice): Theme => (c === 'system' ? (media().matches ? 'dark' : 'light') : c);

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  const [theme, setTheme] = useState<Theme>(() => resolve(readChoice()));

  useEffect(() => {
    const apply = () => {
      const t = resolve(choice);
      document.documentElement.dataset.theme = t;
      setTheme(t);
    };
    apply();
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* ignoruj */
    }
    if (choice !== 'system') return;
    const m = media();
    m.addEventListener('change', apply);
    return () => m.removeEventListener('change', apply);
  }, [choice]);

  return { choice, setChoice, theme };
}

/** Aktualny motyw dla komponentów, które rysują na canvasie (np. graf) i muszą się przerysować. */
export function useResolvedTheme(): Theme {
  const [t, setT] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
  useEffect(() => {
    const obs = new MutationObserver(() => setT(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return t;
}

/** Odczyt tokenu koloru z CSS (do bibliotek, które nie rozumieją var(--…)). */
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
