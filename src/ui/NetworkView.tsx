import { useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import type * as Plotly from 'plotly.js';

type Node = {
  id: number;
  title: string;
  url: string;
  subtopic: string;
  v: string;
  clicks: number;
  action: string;
  community: number;
};

type Edge = { a: number; b: number; cosine: number };

type NetworkData = { nodes: Node[]; edges: Edge[]; stale?: boolean };

const ACTION_COLOR: Record<string, string> = {
  CONSOLIDATE: '#e74c3c',
  MANUAL_REVIEW: '#16a085',
  DIFFERENTIATE: '#f39c12',
  KEEP: '#2ecc71',
  REASSIGN: '#3498db',
  SPLIT: '#9b59b6',
  DELETE: '#7f8c8d',
};

// 簡易 force-directed レイアウト (全クライアントで実行)
function forceLayout(
  nodes: Node[],
  edges: Edge[],
  iters = 200,
): Map<number, { x: number; y: number }> {
  const positions = new Map<number, { x: number; y: number; vx: number; vy: number }>();
  for (const n of nodes) {
    positions.set(n.id, {
      x: Math.cos((n.id * 137) % 360) * 50,
      y: Math.sin((n.id * 139) % 360) * 50,
      vx: 0,
      vy: 0,
    });
  }

  const k = 5; // ideal edge length
  const repulsion = 200;
  const damping = 0.85;

  for (let iter = 0; iter < iters; iter++) {
    // repulsion (between all node pairs)
    const ids = [...positions.keys()];
    for (let i = 0; i < ids.length; i++) {
      const a = positions.get(ids[i]!)!;
      for (let j = i + 1; j < ids.length; j++) {
        const b = positions.get(ids[j]!)!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 0.01;
        const f = repulsion / d2;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
    }
    // attraction (edges)
    for (const e of edges) {
      const a = positions.get(e.a);
      const b = positions.get(e.b);
      if (!a || !b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.sqrt(dx * dx + dy * dy + 0.01);
      const f = (d - k) * e.cosine; // strength scaled by cosine
      a.vx -= (dx / d) * f;
      a.vy -= (dy / d) * f;
      b.vx += (dx / d) * f;
      b.vy += (dy / d) * f;
    }
    // apply
    for (const p of positions.values()) {
      p.vx *= damping;
      p.vy *= damping;
      p.x += p.vx * 0.05;
      p.y += p.vy * 0.05;
    }
  }
  const out = new Map<number, { x: number; y: number }>();
  for (const [id, p] of positions) out.set(id, { x: p.x, y: p.y });
  return out;
}

export function NetworkView() {
  const [data, setData] = useState<NetworkData | null>(null);
  const [colorBy, setColorBy] = useState<'community' | 'action' | 'subtopic'>('community');
  const [computing, setComputing] = useState(true);

  useEffect(() => {
    fetch('/api/stats/network').then((r) => r.json()).then((d: NetworkData) => {
      setData(d);
    });
  }, []);

  const positions = useMemo(() => {
    if (!data || data.nodes.length === 0) return new Map<number, { x: number; y: number }>();
    setComputing(true);
    // 計算は同期だが UI ブロックを最小化するため iters を減らす
    const iters = data.nodes.length > 200 ? 80 : data.nodes.length > 100 ? 150 : 200;
    const p = forceLayout(data.nodes, data.edges, iters);
    setComputing(false);
    return p;
  }, [data]);

  if (!data) return <p style={{ padding: '1rem' }}>読み込み中...</p>;
  if (data.stale || data.nodes.length === 0) {
    return (
      <p style={{ padding: '1rem', opacity: 0.6 }}>
        ネットワークデータが未生成です。`npm run decide:network` を実行してください。
      </p>
    );
  }

  const colorOf = (n: Node): string => {
    if (colorBy === 'action') return ACTION_COLOR[n.action] ?? '#888';
    if (colorBy === 'subtopic') {
      const i = (n.subtopic ?? '').charCodeAt(0) - 65;
      const palette = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0'];
      return palette[i] ?? '#888';
    }
    // community
    const palette = ['#3478f6', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#16a085', '#e67e22', '#1abc9c', '#c0392b', '#2980b9'];
    return palette[n.community % palette.length] ?? '#888';
  };

  // edge trace
  const edgeXs: (number | null)[] = [];
  const edgeYs: (number | null)[] = [];
  for (const e of data.edges) {
    const a = positions.get(e.a);
    const b = positions.get(e.b);
    if (!a || !b) continue;
    edgeXs.push(a.x, b.x, null);
    edgeYs.push(a.y, b.y, null);
  }

  // node trace per group
  const groups = new Map<string, Node[]>();
  for (const n of data.nodes) {
    const key = colorBy === 'community' ? `C${n.community}` : colorBy === 'action' ? n.action : n.subtopic;
    const arr = groups.get(key);
    if (arr) arr.push(n);
    else groups.set(key, [n]);
  }

  const traces: Plotly.Data[] = [
    {
      x: edgeXs,
      y: edgeYs,
      mode: 'lines',
      type: 'scatter',
      line: { color: 'rgba(120,120,120,0.2)', width: 0.5 },
      hoverinfo: 'skip',
      showlegend: false,
    },
    ...Array.from(groups.entries()).map(([key, nodes]) => ({
      x: nodes.map((n) => positions.get(n.id)?.x ?? 0),
      y: nodes.map((n) => positions.get(n.id)?.y ?? 0),
      mode: 'markers',
      type: 'scatter',
      name: key,
      marker: {
        color: colorOf(nodes[0]!),
        size: nodes.map((n) => Math.max(6, Math.min(24, 6 + Math.log(1 + n.clicks) * 2))),
        opacity: 0.85,
        line: { width: 0.5, color: '#333' },
      },
      text: nodes.map(
        (n) =>
          `<b>[${n.id}] ${n.title.slice(0, 50)}</b><br>` +
          `${n.subtopic} × ${n.v}<br>` +
          `clicks: ${n.clicks} / community: ${n.community}<br>` +
          `action: ${n.action}`,
      ),
      hoverinfo: 'text',
      customdata: nodes.map((n) => ({ id: n.id, url: n.url })) as unknown as Plotly.Datum[],
    } satisfies Plotly.Data)),
  ];

  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <section style={card()}>
        <h2 style={{ margin: '0 0 0.4rem 0', fontSize: '1rem' }}>
          🕸️ Network (cosine ≥ 0.9 ペアのカニバリ網)
        </h2>
        <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.78rem', opacity: 0.7 }}>
          {data.nodes.length} ノード / {data.edges.length} エッジ。
          Louvain でコミュニティ抽出。点をクリックで記事を開く。
          {computing && ' (force-layout 計算中...)'}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.4rem', fontSize: '0.85rem' }}>
          <label>
            色分け{' '}
            <select value={colorBy} onChange={(e) => setColorBy(e.target.value as 'community' | 'action' | 'subtopic')}>
              <option value="community">コミュニティ (Louvain)</option>
              <option value="action">action 判定</option>
              <option value="subtopic">subtopic 軸</option>
            </select>
          </label>
          <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
            communities: {new Set(data.nodes.map((n) => n.community)).size}
          </span>
        </div>
        <Plot
          data={traces}
          layout={{
            autosize: true,
            height: 800,
            margin: { l: 20, r: 20, t: 10, b: 20 },
            xaxis: { showgrid: false, zeroline: false, showticklabels: false },
            yaxis: { showgrid: false, zeroline: false, showticklabels: false },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            hovermode: 'closest',
            legend: { itemwidth: 30, font: { size: 10 } },
          }}
          config={{ displayModeBar: true, responsive: true }}
          style={{ width: '100%' }}
          onClick={(e: Readonly<Plotly.PlotMouseEvent>) => {
            const point = e.points?.[0] as { customdata?: { id: number; url: string } } | undefined;
            if (point?.customdata?.url) window.open(point.customdata.url, '_blank');
          }}
        />
      </section>
    </div>
  );
}

function card(): React.CSSProperties {
  return { border: '1px solid #8884', borderRadius: '0.5rem', padding: '0.7rem 0.9rem' };
}
