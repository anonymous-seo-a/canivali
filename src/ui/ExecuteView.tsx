import React, { useEffect, useState } from 'react';

type PreviewItem = {
  decision_id: number;
  confidence_score: number;
  rationale_json: string;
  cosine_similarity: number;
  serp_overlap_pct: number | null;
  pair_relation: string | null;

  winner_id: number;
  winner_url: string;
  winner_title: string;
  winner_sub: string | null;
  winner_v: string | null;
  winner_clicks: number | null;
  winner_impressions: number | null;
  winner_pos: number | null;

  loser_id: number;
  loser_url: string;
  loser_title: string;
  loser_sub: string | null;
  loser_v: string | null;
  loser_clicks: number | null;
  loser_impressions: number | null;
  loser_pos: number | null;
};

type Preview = {
  mode: 'approved' | 'auto' | 'all';
  plan_count: number;
  raw_count: number;
  final_article_count: number;
  items: PreviewItem[];
};

type ChainResolution = {
  mode: string;
  raw_count: number;
  resolved_count: number;
  chains: Array<{ from: number; via: number[]; to: number }>;
  cycles: number[][];
};

const RATIONALE_JP: Record<string, string> = {
  same_cell: '同じカテゴリ × 同じ商品軸 = 完全に同じ枠',
  same_subtopic_diff_v: '同じカテゴリだが商品軸が違う',
  diff_subtopic_same_v: '同じ商品軸だがカテゴリが違う',
  fully_different: 'カテゴリも商品軸も違う',
  unclassified: '分類未確定',
  'cosine>=0.95': '本文の類似度が95%以上',
  'cosine>=0.9': '本文の類似度が90%以上',
  'cosine_in_0.85-0.9': '本文の類似度が85-90%',
  'serp_overlap>=0.5': 'Google 検索でも両方が同じクエリで上位表示',
  product_comparison: '商品ごとの比較記事として両立可能',
  normal_v_axis: '同じ商品の異なるテーマ = 通常関係',
};

function jpRationale(factors: string[]): string {
  return factors.map((f) => RATIONALE_JP[f] ?? f).join(' / ');
}

export function ExecuteView() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [chainRes, setChainRes] = useState<ChainResolution | null>(null);
  const [mode, setMode] = useState<'approved' | 'auto' | 'all'>('auto');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null);

  function refresh() {
    setResult(null);
    fetch(`/api/decisions/_/preview?mode=${mode}`).then((r) => r.json()).then(setPreview);
    fetch(`/api/decisions/_/chain-resolution?mode=${mode}`).then((r) => r.json()).then(setChainRes);
  }
  useEffect(refresh, [mode]);

  function deployRedirects(m: 'approved' | 'auto' | 'all') {
    if (!preview || preview.plan_count === 0) return;
    if (
      !window.confirm(
        `${preview.plan_count} 件分の 301 リダイレクトを /no1/.htaccess に反映します。\n\n* バックアップは自動で取られます\n* WP の draft 化と組み合わせて使ってください\n\n続行?`,
      )
    ) {
      return;
    }
    setExecuting(true);
    fetch('/api/decisions/_/deploy-redirects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: m }),
    })
      .then((r) => r.json())
      .then((d) => {
        setResult(d.ok ? { ok: true, message: `${d.deployed} 件の 301 を反映 (backup: ${d.backup})` } : d);
        setExecuting(false);
      });
  }

  function execute(dryRun: boolean) {
    if (!preview || preview.plan_count === 0) return;
    if (
      !window.confirm(
        dryRun
          ? `${preview.plan_count} 件の統合計画を生成します (DB のみ・実際の記事操作なし)。続行?`
          : `${preview.plan_count} 件の統合を【本実行】します。\n\n削除対象: ${preview.plan_count} 記事\n統合先: 各ペアの "残す" 記事\n\n本当に実行しますか?`,
      )
    ) {
      return;
    }
    setExecuting(true);
    fetch('/api/decisions/_/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, dry_run: dryRun }),
    })
      .then((r) => r.json())
      .then((d) => {
        setResult(d);
        setExecuting(false);
        refresh();
      });
  }

  function downloadCsv() {
    if (!preview) return;
    const header = ['loser_id', 'loser_url', 'winner_id', 'winner_url', 'reason', 'confidence', 'cosine'];
    const rows = preview.items.map((i) => {
      const r = (() => {
        try {
          return JSON.parse(i.rationale_json) as { factors: string[] };
        } catch {
          return { factors: [] };
        }
      })();
      return [
        i.loser_id,
        i.loser_url,
        i.winner_id,
        i.winner_url,
        `"${jpRationale(r.factors).replace(/"/g, '""')}"`,
        i.confidence_score.toFixed(2),
        i.cosine_similarity.toFixed(3),
      ].join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `consolidation_plan_${mode}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  if (!preview) return <p>読み込み中...</p>;

  return (
    <>
      <div
        style={{
          background: '#3478f622',
          border: '1px solid #3478f6',
          borderRadius: '0.5rem',
          padding: '0.7rem 0.9rem',
          marginBottom: '0.75rem',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: '0.4rem' }}>📋 統合実行プラン</div>
        <ModeSelector mode={mode} setMode={setMode} />
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          <Stat label="統合する組" value={preview.plan_count} />
          <Stat label="削除される記事" value={preview.plan_count} color="#e74c3c" />
          <Stat label="実行後の記事数" value={preview.final_article_count} color="#2ecc71" />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => execute(true)}
            disabled={executing || preview.plan_count === 0}
            style={btnStyle('#3478f6')}
          >
            🧪 dry-run (計画ログのみ生成)
          </button>
          <button
            type="button"
            onClick={() => execute(false)}
            disabled={executing || preview.plan_count === 0}
            style={btnStyle('#e74c3c')}
          >
            🚀 すべて本実行 (記事を削除/転送)
          </button>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={preview.plan_count === 0}
            style={btnStyle('#7f8c8d', true)}
          >
            ⬇ 計画を CSV ダウンロード
          </button>
          <button
            type="button"
            onClick={() => deployRedirects(mode)}
            disabled={preview.plan_count === 0 || executing}
            style={btnStyle('#9b59b6')}
          >
            🛡️ 301 リダイレクトを Xserver に反映
          </button>
        </div>
        {result && (
          <div
            style={{
              marginTop: '0.6rem',
              padding: '0.4rem',
              background: result.ok ? '#2ecc7122' : '#e74c3c22',
              borderRadius: '0.3rem',
              fontSize: '0.85rem',
            }}
          >
            {result.ok ? `✅ ${result.message}` : `❌ ${result.error}`}
          </div>
        )}
        {chainRes && (chainRes.chains.length > 0 || chainRes.cycles.length > 0) && (
          <div
            style={{
              marginTop: '0.6rem',
              padding: '0.4rem 0.5rem',
              background: '#f39c1233',
              borderRadius: '0.3rem',
              fontSize: '0.82rem',
            }}
          >
            <strong>🔗 チェーン/循環の検出:</strong>{' '}
            {chainRes.chains.length} 件のチェーン (例: A→B→C を A→C に短縮)、
            {chainRes.cycles.length} 件の循環 (例: A→B→A を traffic 多い側に統一) を**自動で解決**して 301 を出力します。
            <details style={{ marginTop: '0.3rem' }}>
              <summary style={{ cursor: 'pointer' }}>詳細を見る</summary>
              {chainRes.chains.slice(0, 5).map((c, i) => (
                <div key={i} style={{ fontSize: '0.75rem' }}>
                  {c.from} → {c.via.join(' → ')} → {c.to} (短縮)
                </div>
              ))}
              {chainRes.cycles.slice(0, 5).map((c, i) => (
                <div key={i} style={{ fontSize: '0.75rem', color: '#e74c3c' }}>
                  ⚠️ 循環: {c.join(' → ')} → {c[0]}
                </div>
              ))}
            </details>
          </div>
        )}
      </div>

      {preview.plan_count === 0 && (
        <p style={{ opacity: 0.6, textAlign: 'center', padding: '2rem' }}>
          {mode === 'approved'
            ? '承認済の統合候補がありません。「① 候補をレビュー」タブで承認してください。'
            : '対象の統合候補がありません。'}
        </p>
      )}

      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {preview.items.map((it, idx) => (
          <PlanCard key={it.decision_id} item={it} idx={idx + 1} />
        ))}
      </div>
    </>
  );
}

function ModeSelector({
  mode,
  setMode,
}: {
  mode: 'approved' | 'auto' | 'all';
  setMode: (m: 'approved' | 'auto' | 'all') => void;
}) {
  const options: Array<{ key: 'approved' | 'auto' | 'all'; label: string; desc: string }> = [
    { key: 'approved', label: '✅ 承認済のみ',          desc: '①でユーザーが「承認」したものだけ' },
    { key: 'auto',     label: '⚡ 自動承認候補 (信頼度 高)', desc: 'engine 信頼度 0.85 以上 (人手承認不要レベル)' },
    { key: 'all',      label: '⚠️ 候補すべて (却下以外)',     desc: '低信頼の候補も含む。慎重に確認' },
  ];
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => setMode(o.key)}
          title={o.desc}
          style={{
            padding: '0.3rem 0.6rem',
            border: '1px solid',
            borderColor: mode === o.key ? '#3478f6' : '#8884',
            borderRadius: '0.3rem',
            background: mode === o.key ? '#3478f644' : 'transparent',
            cursor: 'pointer',
            fontSize: '0.85rem',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 600, color }}>{value.toLocaleString()}</div>
    </div>
  );
}

function btnStyle(color: string, outline = false): React.CSSProperties {
  return {
    padding: '0.4rem 0.8rem',
    border: outline ? `1px solid ${color}` : 'none',
    borderRadius: '0.3rem',
    background: outline ? 'transparent' : color,
    color: outline ? color : '#fff',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
  };
}

type Query = { query: string; clicks: number; impressions: number; avg_position: number };
type OverlapQuery = {
  query: string;
  a_clicks: number;
  a_impressions: number;
  a_position: number;
  b_clicks: number;
  b_impressions: number;
  b_position: number;
};

function PlanCard({ item, idx }: { item: PreviewItem; idx: number }) {
  const r = (() => {
    try {
      return JSON.parse(item.rationale_json) as { factors: string[] };
    } catch {
      return { factors: [] };
    }
  })();
  const reason = jpRationale(r.factors);
  const totalClicks = (item.winner_clicks ?? 0) + (item.loser_clicks ?? 0);

  const [showQueries, setShowQueries] = useState(false);
  const [winnerQ, setWinnerQ] = useState<Query[] | null>(null);
  const [loserQ, setLoserQ] = useState<Query[] | null>(null);
  const [overlap, setOverlap] = useState<OverlapQuery[] | null>(null);

  function loadQueries() {
    if (!showQueries) {
      Promise.all([
        fetch(`/api/articles/${item.winner_id}/queries?limit=5`).then((r) => r.json()),
        fetch(`/api/articles/${item.loser_id}/queries?limit=5`).then((r) => r.json()),
        fetch(`/api/articles/${item.winner_id}/queries-overlap/${item.loser_id}`).then((r) => r.json()),
      ]).then(([w, l, o]) => {
        setWinnerQ(w);
        setLoserQ(l);
        setOverlap(o);
      });
    }
    setShowQueries(!showQueries);
  }

  return (
    <article
      style={{
        border: '1px solid #8884',
        borderRadius: '0.5rem',
        padding: '0.7rem',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>#{idx}</span>
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{reason}</span>
        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', opacity: 0.6 }}>
          類似度 {(item.cosine_similarity * 100).toFixed(1)}% · 信頼度{' '}
          {(item.confidence_score * 100).toFixed(0)}%
        </span>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '0.5rem', alignItems: 'center' }}>
        <SidePanel
          tag="❌ 削除/転送"
          color="#e74c3c"
          id={item.loser_id}
          url={item.loser_url}
          title={item.loser_title}
          sub={item.loser_sub}
          v={item.loser_v}
          clicks={item.loser_clicks}
          impressions={item.loser_impressions}
        />
        <div style={{ fontSize: '1.4rem', opacity: 0.5, textAlign: 'center' }}>→</div>
        <SidePanel
          tag="✅ 残す (リダイレクト先)"
          color="#2ecc71"
          id={item.winner_id}
          url={item.winner_url}
          title={item.winner_title}
          sub={item.winner_sub}
          v={item.winner_v}
          clicks={item.winner_clicks}
          impressions={item.winner_impressions}
        />
      </div>
      {totalClicks > 0 && (
        <div style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: '0.3rem', textAlign: 'right' }}>
          90日間で 残す側 {item.winner_clicks ?? 0} クリック / 削除側 {item.loser_clicks ?? 0} クリック
        </div>
      )}
      <div style={{ marginTop: '0.4rem' }}>
        <button
          type="button"
          onClick={loadQueries}
          style={{
            padding: '0.2rem 0.5rem',
            background: 'transparent',
            border: '1px solid #8884',
            borderRadius: '0.3rem',
            cursor: 'pointer',
            fontSize: '0.75rem',
          }}
        >
          {showQueries ? '▲ 閉じる' : '▼ 検索クエリを見る'}
        </button>
        {showQueries && (
          <div style={{ marginTop: '0.4rem', fontSize: '0.78rem' }}>
            {overlap !== null && overlap.length > 0 && (
              <div style={{ background: '#f39c1222', padding: '0.4rem', borderRadius: '0.3rem', marginBottom: '0.3rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>
                  ⚠️ 両方が出現する共通クエリ ({overlap.length})
                </div>
                <table style={{ width: '100%', fontSize: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>クエリ</th>
                      <th>残す側 (clk/imp/順位)</th>
                      <th>削除側 (clk/imp/順位)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overlap.slice(0, 10).map((o, i) => (
                      <tr key={i}>
                        <td>{o.query}</td>
                        <td style={{ textAlign: 'right' }}>{o.a_clicks}/{o.a_impressions}/{o.a_position?.toFixed(1)}</td>
                        <td style={{ textAlign: 'right' }}>{o.b_clicks}/{o.b_impressions}/{o.b_position?.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem' }}>
              <QueryList title="✅ 残す側 トップ KW" queries={winnerQ} />
              <QueryList title="❌ 削除側 トップ KW" queries={loserQ} />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function QueryList({ title, queries }: { title: string; queries: Query[] | null }) {
  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: '0.75rem', marginBottom: '0.2rem' }}>{title}</div>
      {queries === null ? (
        <p style={{ fontSize: '0.7rem', opacity: 0.6 }}>読み込み中...</p>
      ) : queries.length === 0 ? (
        <p style={{ fontSize: '0.7rem', opacity: 0.6 }}>(GSC データなし)</p>
      ) : (
        <table style={{ width: '100%', fontSize: '0.72rem' }}>
          <tbody>
            {queries.map((q, i) => (
              <tr key={i}>
                <td>{q.query}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap', paddingLeft: '0.3rem' }}>
                  {q.clicks} clk · {q.impressions} imp
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SidePanel({
  tag,
  color,
  id,
  url,
  title,
  sub,
  v,
  clicks,
  impressions,
}: {
  tag: string;
  color: string;
  id: number;
  url: string;
  title: string;
  sub: string | null;
  v: string | null;
  clicks: number | null;
  impressions: number | null;
}) {
  return (
    <div style={{ background: `${color}22`, padding: '0.4rem', borderRadius: '0.3rem' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 600, color, marginBottom: '0.15rem' }}>{tag}</div>
      <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', display: 'block' }}>
        [{id}] {title}
      </a>
      <div style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: '0.15rem' }}>
        {sub ?? '?'} × {v ?? '?'}
        {clicks !== null && impressions !== null && (
          <>
            {' · '}
            {clicks} clk / {impressions.toLocaleString()} imp
          </>
        )}
      </div>
    </div>
  );
}
