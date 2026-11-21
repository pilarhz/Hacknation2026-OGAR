import { useState } from 'react';
import { api, type ExtractResult } from '../api.ts';

const SAMPLE = `Sprzedam 0.5 BTC, płatność na bc1qpgfd4zxrrenlgyxvvlvrqy84a8f2h408fmfakp albo ETH 0xCfE541F7a25C5cD54277D1Dc4A2Ca6E37626ff4A.
Literówka: 0xCfE541F7a25C5cD54277D1Dc4A2Ca6E37626ff4B, hash tx 0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060.
USDT TRC-20: TXLFKvqCJRzYQHsHMYNgtqHVq6VdNqgkSq, legacy 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa, taproot bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0
Kontakt: jan.testowy@example.com, t.me/janek_p2p, https://github.com/cryptojanek`;

export function ExtractorPage() {
  const [text, setText] = useState(SAMPLE);
  const [res, setRes] = useState<ExtractResult | null>(null);
  return (
    <>
      <h1>Ekstraktor adresów i identyfikatorów</h1>
      <div className="muted" style={{ marginBottom: 12 }}>
        Wklej dowolny tekst (post, ogłoszenie, wiadomość). Każdy kandydat przechodzi walidację sumy kontrolnej: Base58Check (BTC/LTC/DOGE/TRON), Bech32/Bech32m (SegWit/Taproot), EIP-55 (Ethereum).
      </div>
      <div className="panel">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} style={{ width: '100%' }} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" onClick={() => api.extract(text).then(setRes)}>
            Analizuj tekst
          </button>
        </div>
      </div>
      {res && (
        <div className="grid2">
          <div className="panel">
            <h3>Rozpoznane adresy ({res.matches.length})</h3>
            <table>
              <tbody>
                {res.matches.map((m, i) => (
                  <tr key={i}>
                    <td><span className="tag blue">{m.chain}</span></td>
                    <td>
                      <div className="mono">{m.address}</div>
                      <div className="small muted">
                        {m.format} · suma kontrolna: {m.checksum} · pewność formatu: {m.formatConfidence}
                      </div>
                      {m.notes.map((n) => <div key={n} className="small muted">ⓘ {n}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel">
            <h3>Odrzuceni kandydaci ({res.rejected.length})</h3>
            {res.rejected.map((r, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div className="mono">{r.candidate}</div>
                <div className="small err-text">{r.reason}</div>
              </div>
            ))}
            <h3>Identyfikatory Web2 ({res.identifiers.length})</h3>
            {res.identifiers.map((i, k) => (
              <span key={k} className="tag">{i.kind}: {i.value}</span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
