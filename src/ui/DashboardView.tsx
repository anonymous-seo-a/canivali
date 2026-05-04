import { useEffect, useState } from 'react';

type Overview = {
  articles: { total: number; inScope: number; confirmed: number; consolidated: number; embedded: number };
  pairs: Array<{ severity: string; c: number }>;
  pairRelations: Array<{ pair_relation: string | null; c: number }>;
  decisions: Array<{ action: string; c: number; avg_conf: number }>;
};

type CosineRow = { bucket: number; c: number };
type RelevRow = { bucket: string; c: number };
type Cell = { subtopic: string | null; vocab: string | null; articles: number };
type TopArticle = {
  article_id: number;
  url: string;
  title: string;
  subtopic_topic_id: string | null;
  vocabulary_topic_id: string | null;
  business_relevance_score: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  avg_position: number | null;
};
type LiftItem = {
  execution_id: number;
  executed_at: number;
  observed_at: number | null;
  baseline_combined_clicks: number;
  baseline_combined_imps: number;
  observed_winner_clicks: number | null;
  lift_clicks_pct: number | null;
  lift_imps_pct: number | null;
  lift_status: string;
  winner_url: string;
  winner_title: string;
  loser_url: string;
  loser_title: string;
};
type LiftReport = {
  items: LiftItem[];
  summary: Array<{ lift_status: string; c: number; avg_clicks_lift: number | null; avg_imps_lift: number | null }>;
};

const ACTION_LABELS_JP: Record<string, string> = {
  CONSOLIDATE: '統合',
  DIFFERENTIATE: '差別化',
  REASSIGN: '分類変更',
  KEEP: 'そのまま',
  DELETE: '削除',
  SPLIT: '分割',
};

export function DashboardView() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [cosine, setCosine] = useState<CosineRow[]>([]);
  const [relev, setRelev] = useState<RelevRow[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [topArticles, setTopArticles] = useState<TopArticle[]>([]);
  const [lift, setLift] = useState<LiftReport | null>(null);

  useEffect(() => {
    fetch('/api/stats/overview').then((r) => r.json()).then(setOverview);
    fetch('/api/stats/cosine-histogram').then((r) => r.json()).then(setCosine);
    fetch('/api/stats/relevance-histogram').then((r) => r.json()).then(setRelev);
    fetch('/api/stats/top-cells').then((r) => r.json()).then(setCells);
    fetch('/api/stats/top-articles?limit=20').then((r) => r.json()).then(setTopArticles);
    fetch('/api/stats/lift-report').then((r) => r.json()).then(setLift);
  }, []);

  if (!overview) return <p>読み込み中...</p>;

  const a = overview.articles;
  return (
    <div style={{ display: 'grid', gap: '0.8rem' }}>
      {/* 概要カード */}
      <section style={card()}>
        <h2 style={h2()}>📊 全体サマリ</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem' }}>
          <Stat label="記事数 (合計)" value={a.total} />
          <Stat label="範囲内" value={a.inScope} color="#2ecc71" />
          <Stat label="範囲外確定" value={a.confirmed} color="#7f8c8d" />
          <Stat label="統合済み" value={a.consolidated} color="#3478f6" />
          <Stat label="embedding付与" value={a.embedded} />
        </div>
      </section>

      <section style={card()}>
        <h2 style={h2()}>🤖 engine 判定 (action 別)</h2>
        <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
          {overview.decisions.map((d) => (
            <div key={d.action} style={pill(d.action)}>
              <div style={{ fontWeight: 600 }}>{ACTION_LABELS_JP[d.action] ?? d.action}</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{d.c.toLocaleString()}</div>
              <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>平均信頼度 {(d.avg_conf ?? 0).toFixed(2)}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={card()}>
        <h2 style={h2()}>🔗 カニバリペア分布</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <h3 style={h3()}>severity (cosine 帯別)</h3>
            <Bars rows={overview.pairs.map((p) => ({ label: p.severity, value: p.c }))} maxValue={Math.max(...overview.pairs.map((p) => p.c))} />
          </div>
          <div>
            <h3 style={h3()}>pair_relation (どの軸が一致)</h3>
            <Bars
              rows={overview.pairRelations.map((p) => ({ label: p.pair_relation ?? '(null)', value: p.c }))}
              maxValue={Math.max(...overview.pairRelations.map((p) => p.c))}
            />
          </div>
        </div>
      </section>

      <section style={card()}>
        <h2 style={h2()}>📈 ヒストグラム</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <h3 style={h3()}>ペア類似度 (cosine)</h3>
            <Bars
              rows={cosine.map((r) => ({ label: r.bucket.toFixed(2), value: r.c }))}
              maxValue={Math.max(...cosine.map((r) => r.c))}
            />
          </div>
          <div>
            <h3 style={h3()}>事業整合度 (北極星類似度)</h3>
            <Bars
              rows={relev.map((r) => ({ label: r.bucket, value: r.c }))}
              maxValue={Math.max(...relev.map((r) => r.c))}
            />
          </div>
        </div>
      </section>

      <section style={card()}>
        <h2 style={h2()}>📋 主要セル (記事数 多い順)</h2>
        <table style={tbl()}>
          <thead>
            <tr>
              <th style={th()}>subtopic</th>
              <th style={th()}>商品軸</th>
              <th style={th()}>記事数</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((c, i) => (
              <tr key={i}>
                <td style={td()}>{c.subtopic ?? '—'}</td>
                <td style={td()}>{c.vocab ?? '—'}</td>
                <td style={{ ...td(), textAlign: 'right' }}>{c.articles}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={card()}>
        <h2 style={h2()}>🏆 トップ記事 (90日 GSC クリック数 順)</h2>
        <table style={tbl()}>
          <thead>
            <tr>
              <th style={th()}>記事</th>
              <th style={th()}>cell</th>
              <th style={th()}>整合度</th>
              <th style={th()}>clicks</th>
              <th style={th()}>imp</th>
              <th style={th()}>位置</th>
            </tr>
          </thead>
          <tbody>
            {topArticles.map((a) => (
              <tr key={a.article_id}>
                <td style={td()}>
                  <a href={a.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem' }}>
                    [{a.article_id}] {a.title.slice(0, 50)}
                  </a>
                </td>
                <td style={td()}>{a.subtopic_topic_id}×{a.vocabulary_topic_id}</td>
                <td style={td()}>{a.business_relevance_score?.toFixed(2) ?? '—'}</td>
                <td style={{ ...td(), textAlign: 'right' }}>{a.clicks ?? 0}</td>
                <td style={{ ...td(), textAlign: 'right' }}>{a.impressions?.toLocaleString() ?? 0}</td>
                <td style={{ ...td(), textAlign: 'right' }}>{a.avg_position?.toFixed(1) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={card()}>
        <h2 style={h2()}>📉 統合実行 lift レポート</h2>
        {lift && lift.items.length === 0 ? (
          <p style={{ opacity: 0.6 }}>まだ統合実行はありません。「② 実行プレビュー」で実行すると、ここに 28日後の効果が出ます。</p>
        ) : (
          <>
            {lift && (
              <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                {lift.summary.map((s) => (
                  <div key={s.lift_status} style={summaryPill()}>
                    <div style={{ fontWeight: 600 }}>{s.lift_status}</div>
                    <div>件数: {s.c}</div>
                    {s.avg_clicks_lift !== null && (
                      <div style={{ color: s.avg_clicks_lift >= 0 ? '#2ecc71' : '#e74c3c' }}>
                        平均 clicks lift: {(s.avg_clicks_lift * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <table style={tbl()}>
              <thead>
                <tr>
                  <th style={th()}>実行日</th>
                  <th style={th()}>winner</th>
                  <th style={th()}>消えた loser</th>
                  <th style={th()}>baseline</th>
                  <th style={th()}>観測値</th>
                  <th style={th()}>lift</th>
                  <th style={th()}>状態</th>
                </tr>
              </thead>
              <tbody>
                {lift?.items.slice(0, 30).map((i) => (
                  <tr key={i.execution_id}>
                    <td style={td()}>{new Date(i.executed_at * 1000).toLocaleDateString('ja-JP')}</td>
                    <td style={td()}>
                      <a href={i.winner_url} target="_blank" rel="noreferrer">{i.winner_title.slice(0, 30)}</a>
                    </td>
                    <td style={td()}>{i.loser_title.slice(0, 30)}</td>
                    <td style={td()}>{i.baseline_combined_clicks} clk</td>
                    <td style={td()}>{i.observed_winner_clicks ?? '—'} clk</td>
                    <td style={{ ...td(), color: (i.lift_clicks_pct ?? 0) >= 0 ? '#2ecc71' : '#e74c3c' }}>
                      {i.lift_clicks_pct !== null ? `${(i.lift_clicks_pct * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td style={td()}>{i.lift_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color }}>{value.toLocaleString()}</div>
    </div>
  );
}

function Bars({ rows, maxValue }: { rows: Array<{ label: string; value: number }>; maxValue: number }) {
  return (
    <div style={{ display: 'grid', gap: '0.2rem' }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '6rem 1fr 4rem', gap: '0.3rem', alignItems: 'center', fontSize: '0.8rem' }}>
          <span>{r.label}</span>
          <div style={{ background: '#8884', height: '0.7rem', borderRadius: '0.2rem', overflow: 'hidden' }}>
            <div
              style={{
                width: `${(r.value / maxValue) * 100}%`,
                height: '100%',
                background: '#3478f6',
              }}
            />
          </div>
          <span style={{ textAlign: 'right' }}>{r.value.toLocaleString()}</span>
        </div>
      ))}
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
function h2(): React.CSSProperties {
  return { margin: '0 0 0.5rem 0', fontSize: '1rem' };
}
function h3(): React.CSSProperties {
  return { margin: '0 0 0.3rem 0', fontSize: '0.85rem', opacity: 0.8 };
}
function tbl(): React.CSSProperties {
  return { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' };
}
function th(): React.CSSProperties {
  return { textAlign: 'left', padding: '0.3rem', borderBottom: '1px solid #8884', fontSize: '0.78rem', opacity: 0.7 };
}
function td(): React.CSSProperties {
  return { padding: '0.3rem', borderBottom: '1px solid #8882' };
}
function pill(action: string): React.CSSProperties {
  const colors: Record<string, string> = {
    CONSOLIDATE: '#e74c3c',
    DIFFERENTIATE: '#f39c12',
    REASSIGN: '#3498db',
    KEEP: '#2ecc71',
    DELETE: '#7f8c8d',
    SPLIT: '#9b59b6',
  };
  const c = colors[action] ?? '#888';
  return {
    border: `1px solid ${c}55`,
    background: `${c}11`,
    borderRadius: '0.4rem',
    padding: '0.4rem 0.7rem',
    minWidth: '7rem',
  };
}
function summaryPill(): React.CSSProperties {
  return {
    border: '1px solid #8884',
    borderRadius: '0.4rem',
    padding: '0.4rem 0.7rem',
    fontSize: '0.85rem',
  };
}
