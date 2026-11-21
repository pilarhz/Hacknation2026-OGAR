import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type { RunResult } from '../api.ts';

const BAND_COLOR: Record<string, string> = { VERY_HIGH: '#b91c1c', PROBABLE: '#c2410c', MEDIUM: '#a16207', LOW: '#475569', NOT_ATTRIBUTED: '#cbd5e1', EXCLUDED: '#94a3b8' };

export function Graph({ graph, onSelect }: { graph: RunResult['graph']; onSelect?: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const cy = cytoscape({
      container: ref.current,
      elements: [
        ...graph.nodes.map((n) => ({ data: { id: n.id, label: n.label, type: n.type, band: (n.meta?.band as string) ?? '', owned: n.meta?.owned ? 1 : 0, score: n.meta?.score ?? '' } })),
        ...graph.edges.filter((e) => graph.nodes.some((n) => n.id === e.source) && graph.nodes.some((n) => n.id === e.target)).map((e, i) => ({ data: { id: `e${i}`, source: e.source, target: e.target, type: e.type, label: e.label ?? '' } })),
      ],
      style: [
        { selector: 'node', style: { label: 'data(label)', 'font-size': 10, 'text-valign': 'bottom', 'text-margin-y': 4, 'text-wrap': 'wrap', 'text-max-width': '140px', color: '#0f172a' } },
        { selector: 'node[type="identifier"]', style: { shape: 'round-rectangle', 'background-color': '#1e3a8a', width: 26, height: 26 } },
        { selector: 'node[type="document"]', style: { shape: 'rectangle', 'background-color': '#e2e8f0', 'border-width': 1, 'border-color': '#94a3b8', width: 20, height: 24 } },
        { selector: 'node[type="document"][owned = 1]', style: { 'background-color': '#bfdbfe', 'border-color': '#1e40af' } },
        { selector: 'node[type="service"]', style: { shape: 'diamond', 'background-color': '#7c3aed', width: 26, height: 26 } },
        ...Object.entries(BAND_COLOR).map(([band, color]) => ({ selector: `node[type="address"][band="${band}"]`, style: { 'background-color': color, shape: 'ellipse' as const, width: 30, height: 30 } })),
        { selector: 'edge', style: { width: 1.4, 'line-color': '#94a3b8', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#94a3b8', 'curve-style': 'bezier', 'arrow-scale': 0.8 } },
        { selector: 'edge[type="pivot"]', style: { 'line-color': '#1e3a8a', 'target-arrow-color': '#1e3a8a', 'line-style': 'dashed' } },
        { selector: 'edge[type="mentions"]', style: { 'line-color': '#15803d', 'target-arrow-color': '#15803d', width: 2 } },
        { selector: 'edge[type="mentions-other"]', style: { 'line-color': '#cbd5e1', 'target-arrow-color': '#cbd5e1', 'line-style': 'dotted' } },
        { selector: 'edge[type="onchain"]', style: { 'line-color': '#c2410c', 'target-arrow-shape': 'none', width: 3, label: 'data(label)', 'font-size': 9 } },
        { selector: 'edge[type="service"]', style: { 'line-color': '#c4b5fd', 'target-arrow-color': '#c4b5fd', 'line-style': 'dashed' } },
        { selector: ':selected', style: { 'border-width': 3, 'border-color': '#0ea5e9' } },
      ],
      layout: { name: 'cose', animate: false, nodeRepulsion: () => 24000, idealEdgeLength: () => 120, nodeOverlap: 20, padding: 30, randomize: false },
      wheelSensitivity: 0.3,
    });
    cy.on('tap', 'node', (e) => onSelect?.(e.target.id()));
    return () => cy.destroy();
  }, [graph, onSelect]);
  return (
    <>
      <div ref={ref} className="graph" />
      <div className="legend">
        <span><i style={{ background: '#1e3a8a' }} />identyfikator</span>
        <span><i style={{ background: '#bfdbfe', border: '1px solid #1e40af' }} />dokument badanego</span>
        <span><i style={{ background: '#e2e8f0', border: '1px solid #94a3b8' }} />inny dokument</span>
        <span><i style={{ background: '#b91c1c', borderRadius: 6 }} />adres (kolor = przedział pewności)</span>
        <span><i style={{ background: '#7c3aed' }} />usługa (giełda, kantor, mikser…)</span>
        <span>— zielona: publikacja przez badanego · kropkowana: inna osoba · przerywana: pivot · pomarańczowa: transakcje między adresami</span>
      </div>
    </>
  );
}
