import { useMemo, useState } from 'react';
import type { Meta, RunResult } from '../api.ts';
import { BAND_SHORT } from './Score.tsx';

// Mapa powiązań (koncepcja „B"): graf z wyniku przebiegu (r.graph) rozłożony w kolumny
// Wejście → Pivot → Źródła → Adresy · wynik → Usługi.
// Najechanie na węzeł pokazuje jego powiązania, kliknięcie je przypina. Przyciski +/− zmieniają powiększenie.

type GNode = RunResult['graph']['nodes'][number];
type GEdge = RunResult['graph']['edges'][number];

const W = 228; // szerokość węzła
const H = 60; // wysokość węzła
const GAP_X = 96; // odstęp między kolumnami (miejsce na krzywe krawędzi)
const GAP_Y = 18; // odstęp między węzłami w kolumnie
const COL = W + GAP_X;
const ROW = H + GAP_Y;
const LANE_PAD = 14; // margines pasa kolumny wokół węzłów
const HEAD = 52; // wysokość nagłówka kolumny wewnątrz pasa

const COLUMNS = [
  { name: 'Wejście', hint: 'identyfikatory podane przez analityka' },
  { name: 'Pivot', hint: 'identyfikatory odkryte w trakcie' },
  { name: 'Źródła', hint: 'dokumenty z trafieniami' },
  { name: 'Adresy', hint: 'Wskaźnik Pewności' },
  { name: 'Usługi', hint: 'giełdy, kantory, miksery' },
];

const EDGE_LABEL: Record<GEdge['type'], string> = {
  found: 'znaleziono w źródle',
  pivot: 'pivot po identyfikatorze',
  mentions: 'publikuje badany',
  'mentions-other': 'publikuje inna osoba',
  onchain: 'transakcja on-chain',
  service: 'przepływ do usługi',
};

const ZOOMS = [0.7, 0.85, 1, 1.15, 1.3];

const ICON: Record<string, string> = {
  identifier: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  document: 'M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8l-5-5zM14 3v5h5M9 13h6M9 17h6',
  service: 'M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18',
};

function columnOf(n: GNode): number {
  if (n.type === 'identifier') return Number(n.meta?.depth ?? 0) > 0 ? 1 : 0;
  if (n.type === 'document') return 2;
  if (n.type === 'address') return 3;
  return 4;
}

function hostOf(url: unknown): string {
  try {
    return new URL(String(url)).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function RelationMap({ r, meta, onOpenAddress }: { r: RunResult; meta: Meta; onOpenAddress: (key: string) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [zi, setZi] = useState(2);
  const zoom = ZOOMS[zi];

  const layout = useMemo(() => {
    const visible = r.graph.nodes.filter((n) => showExcluded || !(n.type === 'address' && n.meta?.excluded));
    const ids = new Set(visible.map((n) => n.id));
    const edges = r.graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));

    // kolumny; puste pomijamy (np. brak pivotów), żeby mapa nie miała dziur
    const cols: GNode[][] = [[], [], [], [], []];
    for (const n of visible) cols[columnOf(n)].push(n);
    const used = cols.map((c, i) => (c.length ? i : -1)).filter((i) => i >= 0);

    // kolejność w kolumnie: średnia pozycja sąsiadów z kolumn po lewej (mniej przecięć krawędzi)
    const pos = new Map<string, number>();
    const nbrs = new Map<string, string[]>();
    for (const e of edges) {
      nbrs.set(e.source, [...(nbrs.get(e.source) ?? []), e.target]);
      nbrs.set(e.target, [...(nbrs.get(e.target) ?? []), e.source]);
    }
    used.forEach((ci, k) => {
      const col = cols[ci];
      if (k > 0) {
        const bary = (n: GNode) => {
          const p = (nbrs.get(n.id) ?? []).map((m) => pos.get(m)).filter((v): v is number => v !== undefined);
          return p.length ? p.reduce((a, b) => a + b, 0) / p.length : Number.MAX_SAFE_INTEGER;
        };
        col.sort((a, b) => bary(a) - bary(b) || Number(b.meta?.score ?? 0) - Number(a.meta?.score ?? 0));
      } else if (ci === 3) col.sort((a, b) => Number(b.meta?.score ?? 0) - Number(a.meta?.score ?? 0));
      col.forEach((n, i) => pos.set(n.id, i));
    });

    const rows = Math.max(1, ...used.map((ci) => cols[ci].length));
    const body = rows * ROW - GAP_Y;
    const xy = new Map<string, { x: number; y: number; col: number }>();
    used.forEach((ci, k) => {
      const col = cols[ci];
      const top = HEAD + (body - (col.length * ROW - GAP_Y)) / 2; // kolumna wyśrodkowana w pionie
      col.forEach((n, i) => xy.set(n.id, { x: LANE_PAD + k * COL, y: top + i * ROW, col: k }));
    });

    return {
      visible,
      edges,
      used,
      cols,
      xy,
      nbrs,
      width: used.length * COL - GAP_X + LANE_PAD * 2,
      height: HEAD + body + LANE_PAD,
    };
  }, [r, showExcluded]);

  // aktywny węzeł: najechany (podgląd) albo przypięty kliknięciem
  const focus = hover ?? sel;
  const near = useMemo(() => (focus ? new Set([focus, ...(layout.nbrs.get(focus) ?? [])]) : null), [focus, layout]);

  const kindLabel = (k: unknown) => meta.identifierKinds.find((x) => x.id === k)?.label ?? String(k ?? '');
  const serviceLabel = new Map(layout.edges.filter((e) => e.type === 'service').map((e) => [e.target, e.label ?? '']));
  const excludedCount = r.graph.nodes.filter((n) => n.type === 'address' && n.meta?.excluded).length;

  const describe = (n: GNode) => {
    if (n.type === 'identifier') {
      const d = Number(n.meta?.depth ?? 0);
      return { label: n.label, sub: d > 0 ? `${kindLabel(n.meta?.kind)} · krok ${d}` : kindLabel(n.meta?.kind) };
    }
    if (n.type === 'document') return { label: String(n.meta?.site || hostOf(n.meta?.url) || n.label), sub: n.label };
    if (n.type === 'address') {
      const [chain, ...rest] = n.label.split(' ');
      return { label: rest.join(' '), sub: n.meta?.excluded ? `${chain} · wykluczony` : `${chain} · ${BAND_SHORT[String(n.meta?.band)] ?? ''}` };
    }
    return { label: n.label, sub: serviceLabel.get(n.id) || 'usługa' };
  };

  const path = (e: GEdge) => {
    const s = layout.xy.get(e.source)!;
    const t = layout.xy.get(e.target)!;
    if (s.col === t.col) {
      // krawędź w tej samej kolumnie (on-chain adres ↔ adres): łuk po prawej stronie
      const x = s.x + W, y1 = s.y + H / 2, y2 = t.y + H / 2;
      const bend = 30 + Math.min(36, Math.abs(y2 - y1) / 5);
      return `M${x} ${y1} C${x + bend} ${y1}, ${x + bend} ${y2}, ${x} ${y2}`;
    }
    const [a, b] = s.col < t.col ? [s, t] : [t, s];
    const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
    const c = Math.max(40, (x2 - x1) * 0.5);
    return `M${x1} ${y1} C${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`;
  };

  const selNode = sel ? layout.visible.find((n) => n.id === sel) : undefined;

  if (!r.graph.nodes.length) return <div className="panel empty"><b>Brak danych do mapy</b>Ten przebieg nie zawiera powiązań.</div>;

  return (
    <div className="map panel flush">
      <div className="map-bar">
        <div className="map-legend">
          <span><i className="lg found" />znaleziono / publikuje</span>
          <span><i className="lg pivot" />pivot</span>
          <span><i className="lg mentions-other" />inna osoba</span>
          <span><i className="lg onchain" />on-chain</span>
          <span><i className="lg service" />do usługi</span>
        </div>
        <div className="map-tools">
          {excludedCount > 0 && (
            <label className="check map-toggle">
              <input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} />
              Pokaż wykluczone ({excludedCount})
            </label>
          )}
          <div className="map-zoom" role="group" aria-label="Powiększenie mapy">
            <button type="button" aria-label="Pomniejsz" disabled={zi === 0} onClick={() => setZi(zi - 1)}>−</button>
            <span className="num">{Math.round(zoom * 100)}%</span>
            <button type="button" aria-label="Powiększ" disabled={zi === ZOOMS.length - 1} onClick={() => setZi(zi + 1)}>+</button>
          </div>
        </div>
      </div>

      <div className="map-scroll" onClick={() => setSel(null)}>
        <div className="map-stage" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <div className="map-canvas" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
            {/* pasy kolumn z nagłówkami */}
            {layout.used.map((ci, k) => (
              <div key={ci} className="map-lane" style={{ left: k * COL, width: W + LANE_PAD * 2, height: layout.height }}>
                <div className="map-lane-head">
                  <b>{COLUMNS[ci].name}</b>
                  <span className="num">{layout.cols[ci].length}</span>
                  <small>{COLUMNS[ci].hint}</small>
                </div>
              </div>
            ))}

            <svg className="map-edges" width={layout.width} height={layout.height} aria-hidden>
              {layout.edges.map((e, i) => {
                const on = !!focus && (e.source === focus || e.target === focus);
                return (
                  <path key={i} d={path(e)} className={`me ${e.type}${near && !on ? ' dim' : ''}${on ? ' on' : ''}`}>
                    <title>{EDGE_LABEL[e.type]}</title>
                  </path>
                );
              })}
            </svg>

            {layout.visible.map((n) => {
              const p = layout.xy.get(n.id)!;
              const d = describe(n);
              const isAddr = n.type === 'address';
              const degree = (layout.nbrs.get(n.id) ?? []).length;
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`mn ${n.type}${n.meta?.excluded ? ' excluded' : ''}${sel === n.id ? ' sel' : ''}${near && !near.has(n.id) ? ' dim' : ''}`}
                  style={{ left: p.x, top: p.y, width: W, height: H }}
                  aria-pressed={sel === n.id}
                  title={n.type === 'document' ? String(n.meta?.url ?? n.label) : n.label}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(n.id)}
                  onBlur={() => setHover(null)}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setSel(sel === n.id ? null : n.id);
                  }}
                >
                  {isAddr ? (
                    <span className={`mn-score b-${n.meta?.excluded ? 'EXCLUDED' : String(n.meta?.band)}`}>{Number(n.meta?.score ?? 0)}</span>
                  ) : (
                    <span className="mn-icon" aria-hidden>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d={ICON[n.type]} />
                      </svg>
                    </span>
                  )}
                  <span className="mn-text">
                    <span className="mn-label">{d.label}</span>
                    <span className="mn-sub">{d.sub}</span>
                  </span>
                  {degree > 1 && <span className="mn-deg num" title={`${degree} powiązań`}>{degree}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="map-foot">
        {selNode ? (
          <>
            <span className="muted">Wybrano</span>
            <b className="mono">{selNode.type === 'document' ? String(selNode.meta?.url ?? selNode.label) : selNode.label}</b>
            <span className="muted">· {(layout.nbrs.get(selNode.id) ?? []).length} powiązań</span>
            {selNode.type === 'address' && (
              <button className="sm" style={{ marginLeft: 'auto' }} onClick={() => onOpenAddress(selNode.id.replace(/^addr:/, ''))}>
                Zobacz dowody i wyliczenie →
              </button>
            )}
          </>
        ) : (
          <span className="muted">Najedź na węzeł, aby zobaczyć jego powiązania. Kliknij, aby je przypiąć, a kliknięciem w tło odepnij.</span>
        )}
      </div>
    </div>
  );
}
