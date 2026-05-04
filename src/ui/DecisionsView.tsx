import { useEffect, useMemo, useState } from 'react';

type Decision = {
  decision_id: number;
  article_id: number | null;
  pair_id: number | null;
  action: string;
  target_url: string | null;
  confidence_score: number;
  rationale_json: string;
  human_reviewed: number;
  human_decision: string | null;

  article_title: string | null;
  article_url: string | null;
  cosine_similarity: number | null;
  serp_overlap_pct: number | null;
  pair_relation: string | null;
  severity: string | null;
  winner_article_id: number | null;
  article_a_id: number | null;
  article_b_id: number | null;
  a_title: string | null;
  a_url: string | null;
  b_title: string | null;
  b_url: string | null;
};

type Summary = {
  byAction: Array<{ action: string; c: number; avg_conf: number }>;
  byConfBucket: Array<{ bucket: string; c: number }>;
};

type Impact = {
  total: number;
  confirmedQuarantine: number;
  approved: { losers: number[]; deletes: number[] };
  pending: { losers: number[]; deletes: number[] };
};

const ACTION_LABEL: Record<string, { jp: string; desc: string; color: string }> = {
  CONSOLIDATE:   { jp: '統合', desc: '2つの記事を1つにまとめる (片方は残し、もう片方をリダイレクト)', color: '#e74c3c' },
  DIFFERENTIATE: { jp: '差別化', desc: '内容が似てるので、それぞれの意図を明確に分ける', color: '#f39c12' },
  REASSIGN:      { jp: '分類変更', desc: '記事のカテゴリ (subtopic / 商品軸) が間違っているので変える', color: '#3498db' },
  KEEP:          { jp: 'そのまま', desc: '問題なし。両方を残す', color: '#2ecc71' },
  DELETE:        { jp: '削除', desc: 'カテゴリ範囲外なので削除/移動する', color: '#7f8c8d' },
  SPLIT:         { jp: '分割', desc: '1つの記事を複数に分ける', color: '#9b59b6' },
};

const RATIONALE_JP: Record<string, string> = {
  same_cell: '同じカテゴリ × 同じ商品軸 = 完全に同じ枠の記事',
  same_subtopic_diff_v: '同じカテゴリだが商品軸が違う (例: 即日 × 各社)',
  diff_subtopic_same_v: '同じ商品軸だがカテゴリが違う (例: アコム × 別テーマ)',
  fully_different: 'カテゴリも商品軸も違う (内容が似てるだけ)',
  unclassified: '記事のカテゴリ/商品軸がまだ決まっていない',
  'cosine>=0.95': '本文の類似度が極めて高い (95%以上)',
  'cosine>=0.9': '本文の類似度が非常に高い (90%以上)',
  'cosine_in_0.85-0.9': '本文の類似度が高い (85-90%)',
  'serp_overlap>=0.5': 'Google 検索でも両方が同じクエリで上位表示されている',
  product_comparison: '商品ごとの比較記事として両立できる',
  normal_v_axis: '同じ商品の異なるテーマ記事 = 通常の関係',
  classification_mismatch_or_differentiated: 'カテゴリ判定が間違っているか、すでに差別化済み',
  reassign_then_re_evaluate: 'カテゴリを再判定する必要あり',
  skip_quarantined: 'どちらかが範囲外なのでスキップ',
  default_keep: '問題は見つからなかった',
  low_relevance: 'カードローン領域から離れている',
  low_perf: 'クリック・表示回数が極端に少ない',
  low_classification_confidence: 'カテゴリ判定の信頼度が低い',
  'quarantine=confirmed': 'カテゴリ範囲外確定',
};

function jpRationale(factors: string[]): string[] {
  return factors.map((f) => RATIONALE_JP[f] ?? f);
}

function similarityStars(cos: number | null): string {
  if (cos === null) return '—';
  if (cos >= 0.95) return '★★★★★';
  if (cos >= 0.9)  return '★★★★☆';
  if (cos >= 0.85) return '★★★☆☆';
  if (cos >= 0.8)  return '★★☆☆☆';
  return '★☆☆☆☆';
}

function confLabel(c: number): { text: string; color: string } {
  if (c >= 0.85) return { text: '高 (自動承認OK)', color: '#2ecc71' };
  if (c >= 0.6)  return { text: '中 (確認推奨)', color: '#f39c12' };
  return { text: '低 (要判断)', color: '#e74c3c' };
}

export function DecisionsView() {
  const [items, setItems] = useState<Decision[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [action, setAction] = useState('CONSOLIDATE');
  const [reviewed, setReviewed] = useState<'0' | '1' | ''>('0');
  const [minConf, setMinConf] = useState(0.6);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  function refreshAll() {
    setLoading(true);
    const p = new URLSearchParams({ limit: '300', min_conf: String(minConf), kind: 'pair' });
    if (action) p.set('action', action);
    if (reviewed) p.set('reviewed', reviewed);
    Promise.all([
      fetch(`/api/decisions?${p.toString()}`).then((r) => r.json()),
      fetch('/api/decisions/_/summary').then((r) => r.json()),
      fetch('/api/decisions/_/impact').then((r) => r.json()),
    ]).then(([d, s, i]) => {
      setItems(d.items);
      setTotal(d.total);
      setSummary(s);
      setImpact(i);
      setLoading(false);
    });
  }

  useEffect(refreshAll, [action, reviewed, minConf]);

  function review(id: number, op: 'approve' | 'reject') {
    fetch(`/api/decisions/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: op }),
    }).then(refreshAll);
  }

  const filtered = search
    ? items.filter(
        (d) =>
          (d.a_title?.toLowerCase().includes(search.toLowerCase()) ||
            d.b_title?.toLowerCase().includes(search.toLowerCase())) ??
          false,
      )
    : items;

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of summary?.byAction ?? []) m.set(a.action, a.c);
    return m;
  }, [summary]);

  return (
    <>
      {impact && <ImpactBanner impact={impact} />}

      {summary && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '0.5rem 0 0.75rem' }}>
          {(['CONSOLIDATE', 'DIFFERENTIATE', 'REASSIGN', 'KEEP', 'DELETE'] as const).map((a) => {
            const lbl = ACTION_LABEL[a]!;
            const n = counts.get(a) ?? 0;
            const isActive = action === a;
            return (
              <button
                key={a}
                type="button"
                onClick={() => setAction(a)}
                style={{
                  padding: '0.5rem 0.8rem',
                  border: `2px solid ${isActive ? lbl.color : '#8884'}`,
                  borderRadius: '0.5rem',
                  background: isActive ? `${lbl.color}22` : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  minWidth: '8rem',
                }}
                title={lbl.desc}
              >
                <div style={{ fontWeight: 600, color: isActive ? lbl.color : 'inherit' }}>
                  {lbl.jp}
                </div>
                <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{n} 件</div>
              </button>
            );
          })}
        </div>
      )}

      <details style={{ marginBottom: '0.5rem', fontSize: '0.85rem', opacity: 0.85 }}>
        <summary style={{ cursor: 'pointer' }}>「{ACTION_LABEL[action]?.jp ?? action}」とは?</summary>
        <p style={{ paddingLeft: '0.6rem', margin: '0.3rem 0 0' }}>{ACTION_LABEL[action]?.desc}</p>
      </details>

      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <label>
          状態{' '}
          <select value={reviewed} onChange={(e) => setReviewed(e.target.value as '0' | '1' | '')}>
            <option value="0">未確認のみ</option>
            <option value="1">確認済のみ</option>
            <option value="">すべて</option>
          </select>
        </label>
        <label>
          信頼度{' '}
          <select value={minConf} onChange={(e) => setMinConf(Number(e.target.value))}>
            <option value="0">すべて</option>
            <option value="0.6">中以上 (0.6+)</option>
            <option value="0.85">高のみ (0.85+)</option>
          </select>
        </label>
        <input
          placeholder="記事タイトルで検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: '12rem' }}
        />
        <span style={{ opacity: 0.6, alignSelf: 'center' }}>
          {loading ? '読み込み中...' : `${filtered.length} / ${total} 件 表示`}
        </span>
      </div>

      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {filtered.map((d) => (
          <DecisionCard key={d.decision_id} d={d} onReview={review} />
        ))}
        {filtered.length === 0 && !loading && (
          <p style={{ opacity: 0.6, textAlign: 'center', padding: '2rem' }}>
            条件に合う候補はありません。フィルタを変えてみてください。
          </p>
        )}
      </div>
    </>
  );
}

function ImpactBanner({ impact }: { impact: Impact }) {
  const approvedRemoved = new Set([...impact.approved.losers, ...impact.approved.deletes]).size;
  const pendingRemoved = new Set([...impact.pending.losers, ...impact.pending.deletes]).size;
  const afterApproved = impact.total - impact.confirmedQuarantine - approvedRemoved;
  const afterAll = impact.total - impact.confirmedQuarantine - approvedRemoved - pendingRemoved;

  return (
    <div
      style={{
        background: '#3478f622',
        border: '1px solid #3478f6',
        borderRadius: '0.5rem',
        padding: '0.6rem 0.8rem',
        marginBottom: '0.5rem',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>📊 統合シミュレーション</div>
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.9rem' }}>
        <div>
          <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>現在の記事数</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 600 }}>{impact.total}</div>
        </div>
        <div style={{ alignSelf: 'center', fontSize: '1.5rem', opacity: 0.4 }}>→</div>
        <div>
          <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>承認済 (確定済) を反映後</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 600, color: approvedRemoved > 0 ? '#3478f6' : 'inherit' }}>
            {afterApproved}
            <span style={{ fontSize: '0.85rem', opacity: 0.7 }}> ({approvedRemoved > 0 ? `−${approvedRemoved}` : '変化なし'})</span>
          </div>
        </div>
        <div style={{ alignSelf: 'center', fontSize: '1.5rem', opacity: 0.4 }}>→</div>
        <div>
          <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>未承認の候補もすべて承認した場合</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 600, color: '#e74c3c' }}>
            {afterAll}
            <span style={{ fontSize: '0.85rem', opacity: 0.7 }}> (−{approvedRemoved + pendingRemoved})</span>
          </div>
        </div>
      </div>
      <div style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '0.4rem' }}>
        ※ 範囲外確定 ({impact.confirmedQuarantine}件) は別途、統合の loser ({impact.pending.losers.length}件) は重複除外済
      </div>
    </div>
  );
}

function DecisionCard({
  d,
  onReview,
}: {
  d: Decision;
  onReview: (id: number, op: 'approve' | 'reject') => void;
}) {
  const rationale = useMemo(() => {
    try {
      return JSON.parse(d.rationale_json) as { factors: string[]; scores: Record<string, unknown> };
    } catch {
      return null;
    }
  }, [d.rationale_json]);

  const lbl = ACTION_LABEL[d.action] ?? { jp: d.action, desc: '', color: '#888' };
  const conf = confLabel(d.confidence_score);
  const winnerIsA = d.winner_article_id === d.article_a_id;
  const reviewed = d.human_reviewed === 1;

  return (
    <article
      style={{
        border: `1px solid ${reviewed ? '#8884' : `${lbl.color}55`}`,
        borderLeft: `5px solid ${lbl.color}`,
        borderRadius: '0.5rem',
        padding: '0.7rem',
        opacity: reviewed ? 0.5 : 1,
        background: reviewed ? '#8881' : 'transparent',
      }}
    >
      <header style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
        <span
          style={{
            padding: '0.15rem 0.5rem',
            borderRadius: '0.4rem',
            fontSize: '0.85rem',
            background: `${lbl.color}33`,
            color: lbl.color,
            fontWeight: 600,
          }}
        >
          {lbl.jp}
        </span>
        {d.cosine_similarity !== null && (
          <span title={`類似度 ${(d.cosine_similarity * 100).toFixed(1)}%`} style={{ fontSize: '0.85rem' }}>
            {similarityStars(d.cosine_similarity)}
          </span>
        )}
        <span style={{ fontSize: '0.78rem', color: conf.color, fontWeight: 600 }}>
          {conf.text}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
          {reviewed ? (
            <span style={{ fontSize: '0.85rem', color: d.human_decision === 'REJECTED' ? '#e74c3c' : '#2ecc71' }}>
              ✓ {d.human_decision === 'REJECTED' ? '却下済' : '承認済'}
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onReview(d.decision_id, 'approve')}
                style={{
                  padding: '0.3rem 0.7rem',
                  background: '#2ecc71',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '0.3rem',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                }}
              >
                承認
              </button>
              <button
                type="button"
                onClick={() => onReview(d.decision_id, 'reject')}
                style={{
                  padding: '0.3rem 0.7rem',
                  background: 'transparent',
                  color: '#e74c3c',
                  border: '1px solid #e74c3c',
                  borderRadius: '0.3rem',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                却下
              </button>
            </>
          )}
        </span>
      </header>

      {d.pair_id !== null ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '0.5rem', alignItems: 'center' }}>
          <ArticleSide
            id={d.article_a_id}
            url={d.a_url}
            title={d.a_title}
            isWinner={winnerIsA}
            action={d.action}
          />
          <div style={{ fontSize: '1.4rem', opacity: 0.4 }}>
            {d.action === 'CONSOLIDATE' ? '⇆' : '⋯'}
          </div>
          <ArticleSide
            id={d.article_b_id}
            url={d.b_url}
            title={d.b_title}
            isWinner={!winnerIsA}
            action={d.action}
          />
        </div>
      ) : (
        <div>
          <a href={d.article_url ?? '#'} target="_blank" rel="noreferrer">
            [{d.article_id}] {d.article_title}
          </a>
        </div>
      )}

      {rationale && (
        <details style={{ marginTop: '0.5rem', fontSize: '0.82rem' }}>
          <summary style={{ cursor: 'pointer', opacity: 0.75 }}>なぜこの判定?</summary>
          <ul style={{ margin: '0.3rem 0 0 1rem', padding: 0 }}>
            {jpRationale(rationale.factors ?? []).map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function ArticleSide({
  id,
  url,
  title,
  isWinner,
  action,
}: {
  id: number | null;
  url: string | null;
  title: string | null;
  isWinner: boolean;
  action: string;
}) {
  const isConsol = action === 'CONSOLIDATE';
  const tag = isConsol ? (isWinner ? '✅ 残す' : '❌ 削除/転送') : '';
  const bg = isConsol ? (isWinner ? '#2ecc7122' : '#e74c3c22') : 'transparent';

  return (
    <div style={{ background: bg, padding: '0.4rem', borderRadius: '0.3rem' }}>
      {tag && <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.15rem' }}>{tag}</div>}
      <a href={url ?? '#'} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem' }}>
        [{id}] {title}
      </a>
    </div>
  );
}
