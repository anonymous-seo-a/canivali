import { useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import type * as Plotly from 'plotly.js';

type Cell = {
  subtopic: string;
  v: string;
  subtopic_label: string;
  v_label: string;
  articles: number;
  clicks: number;
  impressions: number;
  canniba_pairs: number;
  canniba_rate: number;
  top_titles: Array<{ article_id: number; title: string }>;
};

type CellResp = { cells: Cell[] };

type CellDetail = {
  articles: Array<{
    article_id: number;
    url: string;
    title: string;
    business_relevance_score: number | null;
    internal_links_in: number;
    unique_brands_count: number;
    clicks: number | null;
    impressions: number | null;
    avg_position: number | null;
  }>;
  pairs: Array<{
    pair_id: number;
    article_a_id: number;
    article_b_id: number;
    cosine_similarity: number;
    kw_jaccard: number | null;
    kw_overlap_count: number | null;
    winner_article_id: number | null;
    action: string;
    confidence_score: number;
  }>;
};

export function HeatmapView() {
  const [cells, setCells] = useState<Cell[]>([]);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [detail, setDetail] = useState<CellDetail | null>(null);

  useEffect(() => {
    fetch('/api/stats/heatmap-cells')
      .then((r) => r.json())
      .then((d: CellResp) => setCells(d.cells));
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    fetch(`/api/stats/cell/${encodeURIComponent(selected.subtopic)}/${encodeURIComponent(selected.v)}`)
      .then((r) => r.json())
      .then(setDetail);
  }, [selected]);

  const { xLabels, yLabels, articleZ, hovers, customData } = useMemo(() => {
    const subs = Array.from(new Set(cells.map((c) => c.subtopic))).sort();
    const vs = Array.from(new Set(cells.map((c) => c.v))).sort((a, b) => {
      // V1, V2, ..., V5-1, V5-2, V6, ... 自然順
      const norm = (s: string) => s.replace(/V/, '').split('-').map((n) => Number.parseInt(n, 10));
      const ap = norm(a);
      const bp = norm(b);
      const a1 = ap[0] ?? 0;
      const b1 = bp[0] ?? 0;
      if (a1 !== b1) return a1 - b1;
      return (ap[1] ?? 0) - (bp[1] ?? 0);
    });

    const subIdx = new Map(subs.map((s, i) => [s, i]));
    const vIdx = new Map(vs.map((v, i) => [v, i]));

    const z: (number | null)[][] = subs.map(() => vs.map(() => null));
    const hov: (string | null)[][] = subs.map(() => vs.map(() => null));
    const cd: (Cell | null)[][] = subs.map(() => vs.map(() => null));

    for (const c of cells) {
      const i = subIdx.get(c.subtopic);
      const j = vIdx.get(c.v);
      if (i === undefined || j === undefined) continue;
      z[i]![j] = c.articles;
      const titles = c.top_titles.map((t) => `  ・[${t.article_id}] ${t.title}`).join('<br>');
      hov[i]![j] =
        `<b>${c.subtopic} (${c.subtopic_label}) × ${c.v} (${c.v_label})</b><br>` +
        `記事数: ${c.articles}<br>` +
        `90日クリック: ${c.clicks.toLocaleString()}<br>` +
        `カニバリ率: ${(c.canniba_rate * 100).toFixed(0)}% (${c.canniba_pairs}ペア)<br>` +
        (titles ? `<br>上位:<br>${titles}` : '');
      cd[i]![j] = c;
    }

    return {
      xLabels: vs,
      yLabels: subs,
      articleZ: z,
      hovers: hov,
      customData: cd,
    };
  }, [cells]);

  return (
    <div style={{ display: 'grid', gap: '0.8rem' }}>
      <section style={card()}>
        <h2 style={{ margin: '0 0 0.4rem 0', fontSize: '1rem' }}>
          🗺️ subtopic × 商品軸 ヒートマップ
        </h2>
        <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.78rem', opacity: 0.7 }}>
          色 = 記事数 (赤いほど多い)。カニバリ率が高いセル (枠の色) ほど統合候補が多い。
          クリックでセル詳細。
        </p>
        {cells.length === 0 ? (
          <p style={{ opacity: 0.6 }}>読み込み中...</p>
        ) : (
          <Plot
            data={[
              ({
                x: xLabels,
                y: yLabels,
                z: articleZ,
                type: 'heatmap',
                colorscale: [
                  [0, '#ffffff'],
                  [0.05, '#fef3c7'],
                  [0.2, '#fbbf24'],
                  [0.5, '#dc2626'],
                  [1, '#7c2d12'],
                ],
                hoverinfo: 'text',
                text: hovers,
                customdata: customData,
                colorbar: { title: { text: '記事数', font: { size: 10 } } },
                xgap: 1,
                ygap: 1,
              } as unknown as Plotly.Data),
            ]}
            layout={{
              autosize: true,
              height: Math.max(700, yLabels.length * 18),
              margin: { l: 60, r: 40, t: 20, b: 100 },
              xaxis: { side: 'top', tickangle: -45, tickfont: { size: 9 } },
              yaxis: { autorange: 'reversed', tickfont: { size: 10 } },
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
            onClick={(e: Readonly<Plotly.PlotMouseEvent>) => {
              const point = e.points?.[0] as { customdata?: Cell } | undefined;
              if (point?.customdata) setSelected(point.customdata);
            }}
          />
        )}
      </section>

      {selected && (
        <CellDrilldown
          cell={selected}
          detail={detail}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function CellDrilldown({
  cell,
  detail,
  onClose,
}: {
  cell: Cell;
  detail: CellDetail | null;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        right: '1rem',
        top: '1rem',
        bottom: '1rem',
        width: '36rem',
        background: 'var(--bg, #fff)',
        border: '1px solid #8884',
        borderRadius: '0.5rem',
        padding: '0.8rem',
        overflowY: 'auto',
        boxShadow: '0 8px 32px #0006',
        zIndex: 100,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ flex: 1, margin: 0 }}>
          {cell.subtopic} × {cell.v}
          <span style={{ fontSize: '0.85rem', opacity: 0.7, marginLeft: '0.4rem' }}>
            ({cell.subtopic_label} / {cell.v_label})
          </span>
        </h3>
        <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>
          ✕
        </button>
      </header>

      <div style={{ display: 'flex', gap: '0.7rem', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
        <Stat label="記事" v={cell.articles} />
        <Stat label="90日 clicks" v={cell.clicks} />
        <Stat label="カニバリ率" v={`${(cell.canniba_rate * 100).toFixed(0)}%`} />
        <Stat label="ペア数" v={cell.canniba_pairs} />
      </div>

      {detail === null ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <h4 style={{ margin: '0.5rem 0 0.3rem 0', fontSize: '0.9rem' }}>📄 記事 ({detail.articles.length})</h4>
          <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th()}>title</th>
                <th style={th()}>clicks</th>
                <th style={th()}>imp</th>
                <th style={th()}>pos</th>
                <th style={th()}>in_links</th>
              </tr>
            </thead>
            <tbody>
              {detail.articles.map((a) => (
                <tr key={a.article_id}>
                  <td style={td()}>
                    <a href={a.url} target="_blank" rel="noreferrer">[{a.article_id}] {a.title.slice(0, 35)}</a>
                  </td>
                  <td style={tdR()}>{a.clicks ?? 0}</td>
                  <td style={tdR()}>{a.impressions?.toLocaleString() ?? 0}</td>
                  <td style={tdR()}>{a.avg_position?.toFixed(1) ?? '—'}</td>
                  <td style={tdR()}>{a.internal_links_in}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {detail.pairs.length > 0 && (
            <>
              <h4 style={{ margin: '0.7rem 0 0.3rem 0', fontSize: '0.9rem' }}>
                🔗 セル内ペア ({detail.pairs.length})
              </h4>
              <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th()}>action</th>
                    <th style={th()}>cos</th>
                    <th style={th()}>kw_jc</th>
                    <th style={th()}>winner</th>
                    <th style={th()}>conf</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.pairs.map((p) => (
                    <tr key={p.pair_id}>
                      <td style={td()}>{p.action}</td>
                      <td style={tdR()}>{p.cosine_similarity.toFixed(3)}</td>
                      <td style={tdR()}>{p.kw_jaccard?.toFixed(2) ?? '—'}</td>
                      <td style={tdR()}>{p.winner_article_id ?? '—'}</td>
                      <td style={tdR()}>{p.confidence_score.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number | string }) {
  return (
    <div style={{ background: '#8881', padding: '0.3rem 0.5rem', borderRadius: '0.3rem' }}>
      <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{typeof v === 'number' ? v.toLocaleString() : v}</div>
    </div>
  );
}

function card(): React.CSSProperties {
  return {
    border: '1px solid #8884',
    borderRadius: '0.5rem',
    padding: '0.7rem 0.9rem',
  };
}
function th(): React.CSSProperties {
  return { textAlign: 'left', padding: '0.2rem 0.3rem', borderBottom: '1px solid #8884', fontSize: '0.7rem', opacity: 0.7 };
}
function td(): React.CSSProperties {
  return { padding: '0.2rem 0.3rem', borderBottom: '1px solid #8882' };
}
function tdR(): React.CSSProperties {
  return { ...td(), textAlign: 'right' };
}
