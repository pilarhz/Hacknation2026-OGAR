import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type { RunResult } from '../api.ts';
import { cssVar, useResolvedTheme, type Theme } from '../theme.ts';

// Cytoscape rysuje na canvasie i nie rozumie var(--…), więc paleta grafu jest osobno dla każdego motywu.
const PALETTE: Record<Theme, Record<string, string>> = {
  light: {
    identifier: '#0b3a75', doc: '#e4e7eb', docBorder: '#9aa3ae', docOwned: '#c9dcf6', docOwnedBorder: '#0b3a75',
    service: '#6b3fa0', pivot: '#0b3a75', mentions: '#1a6b3c', other: '#c3c9d1', onchain: '#b5450b', serviceEdge: '#b9a4d8', selected: '#ffbf47',
    VERY_HIGH: '#b3261e', PROBABLE: '#b5450b', MEDIUM: '#8a5a00', LOW: '#4f5966', NOT_ATTRIBUTED: '#c3c9d1', EXCLUDED: '#9aa3ae',
  },
  dark: {
    identifier: '#7cb0ff', doc: '#2a313b', docBorder: '#5d6673', docOwned: '#16263d', docOwnedBorder: '#7cb0ff',
    service: '#b48cf0', pivot: '#7cb0ff', mentions: '#4cc27a', other: '#3a4350', onchain: '#e8743a', serviceEdge: '#6e5a96', selected: '#ffbf47',
    VERY_HIGH: '#e5484d', PROBABLE: '#e8743a', MEDIUM: '#c99a2e', LOW: '#6b7684', NOT_ATTRIBUTED: '#3a4350', EXCLUDED: '#5d6673',
  },
};
const BANDS = ['VERY_HIGH', 'PROBABLE', 'MEDIUM', 'LOW', 'NOT_ATTRIBUTED', 'EXCLUDED'];

export function Graph({ graph, onSelect }: { graph: RunResult['graph']; onSelect?: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useResolvedTheme();
  const p = PALETTE[theme];
  useEffect(() => {
    if (!ref.current) return;
    const ink = cssVar('--graph-ink') || (theme === 'dark' ? '#e7eaee' : '#1b1f24');
    const edge = cssVar('--graph-edge') || '#9aa3ae';
    const cy = cytoscape({
      container: ref.current,
      elements: [
        ...graph.nodes.map((n) => ({ data: { id: n.id, label: n.label, type: n.type, band: (n.meta?.band as string) ?? '', owned: n.meta?.owned ? 1 : 0, score: n.meta?.score ?? '' } })),
        ...graph.edges.filter((e) => graph.nodes.some((n) => n.id === e.source) && graph.nodes.some((n) => n.id === e.target)).map((e, i) => ({ data: { id: `e${i}`, source: e.source, target: e.target, type: e.type, label: e.label ?? '' } })),
      ],
      style: [
        { selector: 'node', style: { label: 'data(label)', 'font-size': 10, 'text-valign': 'bottom', 'text-margin-y': 4, 'text-wrap': 'wrap', 'text-max-width': '140px', color: ink } },
        { selector: 'node[type="identifier"]', style: { shape: 'round-rectangle', 'background-color': p.identifier, width: 26, height: 26 } },
        { selector: 'node[type="document"]', style: { shape: 'rectangle', 'background-color': p.doc, 'border-width': 1, 'border-color': p.docBorder, width: 20, height: 24 } },
        { selector: 'node[type="document"][owned = 1]', style: { 'background-color': p.docOwned, 'border-color': p.docOwnedBorder } },
        { selector: 'node[type="service"]', style: { shape: 'diamond', 'background-color': p.service, width: 26, height: 26 } },
        ...BANDS.map((band) => ({ selector: `node[type="address"][band="${band}"]`, style: { 'background-color': p[band], shape: 'ellipse' as const, width: 30, height: 30 } })),
        { selector: 'edge', style: { width: 1.4, 'line-color': edge, 'target-arrow-shape': 'triangle', 'target-arrow-color': edge, 'curve-style': 'bezier', 'arrow-scale': 0.8, color: ink } },
        { selector: 'edge[type="pivot"]', style: { 'line-color': p.pivot, 'target-arrow-color': p.pivot, 'line-style': 'dashed' } },
        { selector: 'edge[type="mentions"]', style: { 'line-color': p.mentions, 'target-arrow-color': p.mentions, width: 2 } },
        { selector: 'edge[type="mentions-other"]', style: { 'line-color': p.other, 'target-arrow-color': p.other, 'line-style': 'dotted' } },
        { selector: 'edge[type="onchain"]', style: { 'line-color': p.onchain, 'target-arrow-shape': 'none', width: 3, label: 'data(label)', 'font-size': 9 } },
        { selector: 'edge[type="service"]', style: { 'line-color': p.serviceEdge, 'target-arrow-color': p.serviceEdge, 'line-style': 'dashed' } },
        { selector: ':selected', style: { 'border-width': 3, 'border-color': p.selected } },
      ],
      layout: { name: 'cose', animate: false, nodeRepulsion: () => 24000, idealEdgeLength: () => 120, nodeOverlap: 20, padding: 30, randomize: false },
      wheelSensitivity: 0.3,
    });
    cy.on('tap', 'node', (e) => onSelect?.(e.target.id()));
    return () => cy.destroy();
  }, [graph, onSelect, theme, p]);
  return (
    <>
      <div ref={ref} className="graph" />
      <div className="legend">
        <span><i style={{ background: p.identifier }} />identyfikator</span>
        <span><i style={{ background: p.docOwned, border: `1px solid ${p.docOwnedBorder}` }} />dokument badanego</span>
        <span><i style={{ background: p.doc, border: `1px solid ${p.docBorder}` }} />inny dokument</span>
        <span><i style={{ background: p.VERY_HIGH, borderRadius: 6 }} />adres (kolor = przedział pewności)</span>
        <span><i style={{ background: p.service }} />usługa (giełda, kantor, mikser…)</span>
        <span>— zielona: publikacja przez badanego · kropkowana: inna osoba · przerywana: pivot · pomarańczowa: transakcje między adresami</span>
      </div>
    </>
  );
}
