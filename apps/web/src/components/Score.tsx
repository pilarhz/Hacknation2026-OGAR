const COLORS: Record<string, string> = {
  VERY_HIGH: 'var(--vh)',
  PROBABLE: 'var(--pr)',
  MEDIUM: 'var(--md)',
  LOW: 'var(--lo)',
  NOT_ATTRIBUTED: '#cbd5e1',
  EXCLUDED: 'var(--ex)',
};

export function ScoreBadge({ score, band }: { score: number; band: string }) {
  return (
    <span className={`score b-${band}`} title={band}>
      {band === 'EXCLUDED' ? '0%' : `${score}%`}
    </span>
  );
}

export function ScoreBar({ score, band }: { score: number; band: string }) {
  return (
    <div className="bar">
      <span style={{ width: `${score}%`, background: COLORS[band] }} />
    </div>
  );
}

export const BAND_SHORT: Record<string, string> = {
  VERY_HIGH: 'bardzo wysokie',
  PROBABLE: 'prawdopodobne',
  MEDIUM: 'średnie',
  LOW: 'niskie / szum',
  NOT_ATTRIBUTED: 'brak przypisania',
  EXCLUDED: 'wykluczenie',
};
