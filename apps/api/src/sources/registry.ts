// Rejestr źródeł – jedyne miejsce, które trzeba zmienić, aby dodać nowe źródło Web2.
import type { Source } from './types.ts';
import { sandboxSource } from './sandbox.ts';
import { githubSource } from './github.ts';
import { keybaseSource } from './keybase.ts';
import { gravatarSource } from './gravatar.ts';
import { redditSource, hackerNewsSource } from './social.ts';
import { webSource, waybackSource, searxngSource } from './web.ts';

export const SOURCES: Source[] = [sandboxSource, githubSource, keybaseSource, gravatarSource, redditSource, hackerNewsSource, webSource, waybackSource, searxngSource];

export function getSources(ids: string[]): Source[] {
  return SOURCES.filter((s) => ids.includes(s.id));
}

export function describeSources() {
  return SOURCES.map(({ id, label, description, accepts, hosts, synthetic, status }) => {
    const st = status?.() ?? { available: true };
    return { id, label, description, accepts, hosts, synthetic: !!synthetic, available: st.available, note: st.note ?? null };
  });
}
