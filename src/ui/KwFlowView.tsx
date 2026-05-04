import { useEffect, useState } from 'react';
import Plot from 'react-plotly.js';
import type * as Plotly from 'plotly.js';

type SankeyData = {
  nodes: Array<{ name: string; type: string }>;
  links: Array<{ source: number; target: number; value: number; color: string }>;
};

type KwGap = { query: string; imps: number; clicks: number; pages: number; best_pos: number };

const NODE_COLORS: Record<string, string> = {
  kw: '#3478f6',
  sub: '#9b59b6',
  article: '#2ecc71',
};

export function KwFlowView() {
  const [data, setData] = useState<SankeyData | null>(null);
  const [gaps, setGaps] = useState<KwGap[]>([]);
  const [minImp, setMinImp] = useState(100);
  const [topKw, setTopKw] = useState(50);
  const [topArt, setTopArt] = useState(30);
  const [distributedOnly, setDistributedOnly] = useState(true);

  useEffect(() => {
    const p = new URLSearchParams({
      min_imp: String(minImp),
      top_kw: String(topKw),
      top_art: String(topArt),
      distributed: distributedOnly ? '1' : '0',
    });
    fetch(`/api/stats/kw-sankey?${p.toString()}`).then((r) => r.json()).then(setData);
  }, [minImp, topKw, topArt, distributedOnly]);

  useEffect(() => {
    fetch('/api/stats/kw-gap').then((r) => r.json()).then((d: { items: KwGap[] }) => setGaps(d.items));
  }, []);

  return (
    <div style={{ display: 'grid', gap: '0.8rem' }}>
      <section style={card()}>
        <h2 style={{ margin: '0 0 0.4rem 0', fontSize: '1rem' }}>🔀 KW Flow (KW → subtopic → 記事)</h2>
        <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.78rem', opacity: 0.7 }}>
          GSC 90日窓のデータ。流れの太さ = clicks。色 = 平均順位 (緑=top10 / 黄=top20 / 赤=圏外)。
          分散KW (同一KWが複数記事にまたがる) を示すとカニバリ箇所が見える。
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
          <label>
            min_imp{' '}
            <input type="number" value={minImp} onChange={(e) => setMinImp(Number(e.target.value))} style={{ width: '5rem' }} />
          </label>
          <label>
            top_kw{' '}
            <input type="number" value={topKw} onChange={(e) => setTopKw(Number(e.target.value))} style={{ width: '5rem' }} />
          </label>
          <label>
            top_articles{' '}
            <input type="number" value={topArt} onChange={(e) => setTopArt(Number(e.target.value))} style={{ width: '5rem' }} />
          </label>
          <label>
            <input type="checkbox" checked={distributedOnly} onChange={(e) => setDistributedOnly(e.target.checked)} />{' '}
            分散KWのみ
          </label>
        </div>
        {!data ? (
          <p style={{ opacity: 0.6 }}>読み込み中...</p>
        ) : data.nodes.length === 0 ? (
          <p style={{ opacity: 0.6 }}>該当 KW なし。閾値を下げてください。</p>
        ) : (
          <Plot
            data={[
              ({
                type: 'sankey',
                arrangement: 'snap',
                node: {
                  label: data.nodes.map((n) => n.name),
                  color: data.nodes.map((n) => NODE_COLORS[n.type] ?? '#888'),
                  pad: 8,
                  thickness: 12,
                  line: { color: '#333', width: 0.3 },
                },
                link: {
                  source: data.links.map((l) => l.source),
                  target: data.links.map((l) => l.target),
                  value: data.links.map((l) => l.value),
                  color: data.links.map((l) => l.color),
                },
              } as unknown as Plotly.Data),
            ]}
            layout={{
              autosize: true,
              height: Math.max(700, data.nodes.length * 14),
              margin: { l: 10, r: 10, t: 20, b: 20 },
              font: { size: 9 },
              paper_bgcolor: 'transparent',
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        )}
      </section>

      <section style={card()}>
        <h2 style={{ margin: '0 0 0.4rem 0', fontSize: '1rem' }}>🕳️ KW 空白マップ (機会 KW)</h2>
        <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.78rem', opacity: 0.7 }}>
          GSC 90日窓で imp ≥50 だが clicks ≤1 の KW = 「上位表示されているがクリック獲得できていない」機会候補。
          記事の Title/H2/メタ改善で取りに行く。
        </p>
        <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th()}>KW</th>
              <th style={th()}>imp</th>
              <th style={th()}>clicks</th>
              <th style={th()}>pages</th>
              <th style={th()}>best_pos</th>
            </tr>
          </thead>
          <tbody>
            {gaps.slice(0, 30).map((g) => (
              <tr key={g.query}>
                <td style={td()}>{g.query}</td>
                <td style={tdR()}>{g.imps.toLocaleString()}</td>
                <td style={tdR()}>{g.clicks}</td>
                <td style={tdR()}>{g.pages}</td>
                <td style={tdR()}>{g.best_pos?.toFixed(1) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function card(): React.CSSProperties {
  return { border: '1px solid #8884', borderRadius: '0.5rem', padding: '0.7rem 0.9rem' };
}
function th(): React.CSSProperties {
  return { textAlign: 'left', padding: '0.3rem', borderBottom: '1px solid #8884', fontSize: '0.78rem', opacity: 0.7 };
}
function td(): React.CSSProperties {
  return { padding: '0.3rem', borderBottom: '1px solid #8882' };
}
function tdR(): React.CSSProperties {
  return { ...td(), textAlign: 'right' };
}
