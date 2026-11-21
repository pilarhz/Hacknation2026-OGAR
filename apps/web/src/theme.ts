import { useEffect, useState } from 'react';

// Motyw interfejsu: jasny (domyślny) albo ciemny. Wybór jest zapamiętywany w localStorage tej przeglądarki.
// Atrybut data-theme na <html> ustawia też skrypt w index.html jeszcze przed załadowaniem Reacta,
// żeby przy starcie nie było mignięcia złego tła.
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
