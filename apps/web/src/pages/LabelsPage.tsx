import { useEffect, useState } from 'react';
import { api, fmtDate, type LabelRow, type Meta } from '../api.ts';

export function LabelsPage({ meta }: { meta: Meta }) {
  const [data, setData] = useState<{ custom: LabelRow[]; seed: LabelRow[] } | null>(null);
  const [form, setForm] = useState({ chain: 'ETH', address: '', name: '', category: 'CEX', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.labels().then(setData);
  useEffect(() => {
    load();
  }, []);
  const save = async () => {
    setErr(null);
    try {
      await api.addLabel(form);
      setForm({ ...form, address: '', name: '', note: '' });
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const rows = (list: LabelRow[], custom: boolean) => (
    <table>
      <thead>
        <tr><th>Sieć</th><th>Adres</th><th>Podmiot</th><th>Kategoria</th><th>{custom ? 'Dodano' : 'Źródło'}</th></tr>
      </thead>
      <tbody>
        {list.map((l, i) => (
          <tr key={i}>
            <td>{l.chain}</td>
            <td className="mono small">{l.address}</td>
            <td>{l.name} {l.synthetic && <span className="tag syn">fikcyjny</span>}</td>
            <td><span className="tag">{meta.categories[l.category] ?? l.category}</span></td>
            <td className="small muted">{custom ? `${fmtDate(l.added_at)} ${l.note ?? ''}` : 'lista startowa'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <>
      <h1>Etykiety adresów</h1>
      <div className="muted" style={{ marginBottom: 12 }}>
        Adresy giełd, kontraktów, mikserów, kantorów i zbiórek nie są przypisywane osobie (Wskaźnik Pewności 0%), ale interakcje z nimi są odnotowywane jako wskaźniki (np. wyjście do fiat). Oprócz listy startowej system korzysta z etykiet zwracanych przez eksploratory (Blockscout, Tronscan) i z flagi kontraktu (bytecode ≠ 0x).
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Dodaj etykietę analityka</h3>
        <div className="row">
          <select value={form.chain} onChange={(e) => setForm({ ...form, chain: e.target.value })}>
            {['ETH', 'BTC', 'TRX', 'LTC', 'DOGE', 'SOL', 'XMR'].map((c) => <option key={c}>{c}</option>)}
          </select>
          <input style={{ flex: 2 }} placeholder="adres" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <input placeholder="nazwa podmiotu" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {Object.entries(meta.categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input placeholder="notatka / źródło" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button className="primary" disabled={!form.address || !form.name} onClick={save}>Dodaj</button>
        </div>
        {err && <div className="callout red">{err}</div>}
      </div>
      {data && (
        <>
          <div className="panel" style={{ padding: 0 }}>
            <h3 style={{ margin: 14 }}>Etykiety analityków ({data.custom.length})</h3>
            {rows(data.custom, true)}
          </div>
          <div className="panel" style={{ padding: 0 }}>
            <h3 style={{ margin: 14 }}>Lista startowa ({data.seed.length})</h3>
            {rows(data.seed, false)}
          </div>
        </>
      )}
    </>
  );
}
