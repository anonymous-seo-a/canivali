import { useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import type * as Plotly from 'plotly.js';

type Point = {
  article_id: number;
  url: string;
  title: string;
  subtopic: string | null;
  v: string | null;
  umap_x: number;
  umap_y: number;
  business_relevance_score: number | null;
  top_queries_json: string | null;
  clicks: number;
  impressions: number;
  avg_position: number;
};

type Edge = {
  article_a_id: number;
  article_b_id: number;
  cosine_similarity: number;
};

// 51 色のカテゴリカラーマップ (subtopic 用)
const SUBTOPIC_PALETTE = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6',
  '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3',
  '#808000', '#ffd8b1', '#000075', '#808080', '#ff0000', '#00ff00', '#0000ff', '#ffff00',
  '#ff00ff', '#00ffff', '#ff8000', '#8000ff', '#0080ff', '#ff0080', '#80ff00', '#008000',
  '#000080', '#800080', '#008080', '#808000', '#ff8080', '#80ff80', '#8080ff', '#ffff80',
  '#ff80ff', '#80ffff', '#a04000', '#1a5276', '#7b241c', '#117a65', '#9a7d0a', '#5b2c6f',
  '#943126', '#1f618d', '#196f3d',
];

export function UmapView() {
  const [points, setPoints] = useState<Point[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [showEdges, setShowEdges] = useState(false);
  const [edgeCosineMin, setEdgeCosineMin] = useState(0.9);
  const [filterSubtopic, setFilterSubtopic] = useState('');
  const [minClicks, setMinClicks] = useState(0);

  useEffect(() => {
    fetch('/api/stats/umap')
      .then((r) => r.json())
      .then((d: { points: Point[] }) => setPoints(d.points));
  }, []);

  useEffect(() => {
    if (!showEdges) return;
    fetch(`/api/stats/umap-edges?min=${edgeCosineMin}`)
      .then((r) => r.json())
      .then((d: { edges: Edge[] }) => setEdges(d.edges));
  }, [showEdges, edgeCosineMin]);

  const filtered = useMemo(() => {
    return points.filter((p) => {
      if (filterSubtopic && !p.subtopic?.startsWith(filterSubtopic)) return false;
      if (p.clicks < minClicks) return false;
      return true;
    });
  }, [points, filterSubtopic, minClicks]);

  const subtopics = useMemo(() => {
    const set = new Set<string>();
    for (const p of points) if (p.subtopic) set.add(p.subtopic);
    return Array.from(set).sort();
  }, [points]);

  const subtopicColor = useMemo(() => {
    const map = new Map<string, string>();
    subtopics.forEach((s, i) => {
      map.set(s, SUBTOPIC_PALETTE[i % SUBTOPIC_PALETTE.length] ?? '#888');
    });
    return map;
  }, [subtopics]);

  // Group points by subtopic for legend (one trace per subtopic)
  const traces: Plotly.Data[] = useMemo(() => {
    const grouped = new Map<string, Point[]>();
    for (const p of filtered) {
      const key = p.subtopic ?? '(none)';
      const arr = grouped.get(key);
      if (arr) arr.push(p);
      else grouped.set(key, [p]);
    }
    const arr: Plotly.Data[] = [];

    if (showEdges) {
      // ペア線: 1 trace で全エッジ (NaN セパレータ)
      const edgePosByArticle = new Map<number, [number, number]>();
      for (const p of points) edgePosByArticle.set(p.article_id, [p.umap_x, p.umap_y]);
      const xs: (number | null)[] = [];
      const ys: (number | null)[] = [];
      for (const e of edges) {
        const a = edgePosByArticle.get(e.article_a_id);
        const b = edgePosByArticle.get(e.article_b_id);
        if (!a || !b) continue;
        xs.push(a[0], b[0], null);
        ys.push(a[1], b[1], null);
      }
      arr.push({
        x: xs,
        y: ys,
        mode: 'lines',
        line: { color: 'rgba(150,150,150,0.15)', width: 0.5 },
        hoverinfo: 'skip',
        showlegend: false,
        type: 'scatter',
      });
    }

    for (const [sub, items] of grouped) {
      const color = subtopicColor.get(sub) ?? '#888';
      arr.push({
        x: items.map((p) => p.umap_x),
        y: items.map((p) => p.umap_y),
        mode: 'markers',
        type: 'scatter',
        name: sub,
        marker: {
          color,
          size: items.map((p) => Math.max(4, Math.min(20, 4 + Math.log(1 + p.clicks) * 2))),
          opacity: 0.75,
          line: { width: 0.5, color: '#333' },
        },
        text: items.map((p) => {
          const topKw = (() => {
            try {
              const tq = JSON.parse(p.top_queries_json ?? '[]') as Array<{ query: string; clicks: number }>;
              return tq.slice(0, 3).map((q) => `  ${q.clicks}clk: ${q.query}`).join('<br>');
            } catch {
              return '';
            }
          })();
          return (
            `<b>[${p.article_id}] ${p.title.slice(0, 50)}</b><br>` +
            `${p.subtopic} × ${p.v}<br>` +
            `clicks: ${p.clicks} / imp: ${p.impressions} / pos: ${p.avg_position?.toFixed(1)}<br>` +
            `relevance: ${p.business_relevance_score?.toFixed(2) ?? '—'}` +
            (topKw ? `<br><br>top KW:<br>${topKw}` : '')
          );
        }),
        hoverinfo: 'text',
        customdata: items.map((p) => ({
          id: p.article_id,
          url: p.url,
        })) as unknown as Plotly.Datum[],
      });
    }

    return arr;
  }, [filtered, edges, points, showEdges, subtopicColor]);

  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <section style={card()}>
        <h2 style={{ margin: '0 0 0.4rem 0', fontSize: '1rem' }}>🌌 Map (UMAP 2D)</h2>
        <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.78rem', opacity: 0.7 }}>
          記事 embedding (1024次元) を UMAP で 2D に圧縮。色 = subtopic、サイズ = log(clicks)。
          近い点ほど内容が似ている記事。
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.4rem', fontSize: '0.85rem' }}>
          <label>
            subtopic 絞り込み{' '}
            <input
              type="text"
              value={filterSubtopic}
              onChange={(e) => setFilterSubtopic(e.target.value)}
              placeholder="例: D1 / A"
              style={{ width: '6rem' }}
            />
          </label>
          <label>
            min_clicks{' '}
            <input
              type="number"
              value={minClicks}
              onChange={(e) => setMinClicks(Number(e.target.value))}
              min={0}
              style={{ width: '5rem' }}
            />
          </label>
          <label>
            <input type="checkbox" checked={showEdges} onChange={(e) => setShowEdges(e.target.checked)} />{' '}
            高 cosine ペアを線で表示
          </label>
          {showEdges && (
            <label>
              cosine 閾値{' '}
              <input
                type="number"
                step={0.01}
                min={0.85}
                max={1}
                value={edgeCosineMin}
                onChange={(e) => setEdgeCosineMin(Number(e.target.value))}
                style={{ width: '5rem' }}
              />{' '}
              ({edges.length} edges)
            </label>
          )}
          <span style={{ marginLeft: 'auto', opacity: 0.6 }}>{filtered.length} / {points.length} 点表示</span>
        </div>
        {points.length === 0 ? (
          <p style={{ opacity: 0.6 }}>UMAP 座標が未計算 (npm run decide:umap で計算)</p>
        ) : (
          <Plot
            data={traces}
            layout={{
              autosize: true,
              height: 700,
              margin: { l: 40, r: 200, t: 10, b: 40 },
              xaxis: { title: { text: 'UMAP-1' }, zeroline: false },
              yaxis: { title: { text: 'UMAP-2' }, zeroline: false },
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
              legend: { itemwidth: 30, font: { size: 9 } },
              hovermode: 'closest',
            }}
            config={{ displayModeBar: true, responsive: true }}
            style={{ width: '100%' }}
            onClick={(e: Readonly<Plotly.PlotMouseEvent>) => {
              const point = e.points?.[0] as { customdata?: { id: number; url: string } } | undefined;
              if (point?.customdata?.url) window.open(point.customdata.url, '_blank');
            }}
          />
        )}
      </section>
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
