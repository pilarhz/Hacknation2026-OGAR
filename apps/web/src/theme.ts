import { useEffect, useState } from 'react';

// Motyw jasny (domyślny) lub ciemny, zapamiętany w localStorage. index.html ustawia data-theme przed Reactem (bez mignięcia).
export type Theme = 'light' | 'dark';

const KEY = 'ogar-theme';

function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light'; // brak dostępu do localStorage – motyw domyślny
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* nie da się zapisać – motyw działa do zamknięcia karty */
    }
  }, [theme]);

  return { theme, setTheme };
}
