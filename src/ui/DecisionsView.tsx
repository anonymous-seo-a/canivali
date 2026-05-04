import { useEffect, useState } from 'react';

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

const ACTIONS = ['CONSOLIDATE', 'DIFFERENTIATE', 'REASSIGN', 'KEEP', 'DELETE', 'SPLIT'];

export function DecisionsView() {
  const [items, setItems] = useState<Decision[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [action, setAction] = useState('CONSOLIDATE');
  const [kind, setKind] = useState<'pair' | 'article' | ''>('pair');
  const [reviewed, setReviewed] = useState<'0' | '1' | ''>('0');
  const [minConf, setMinConf] = useState(0.6);
  const [search, setSearch] = useState('');

  function fetchData() {
    const p = new URLSearchParams({ limit: '200', min_conf: String(minConf) });
    if (action) p.set('action', action);
    if (kind) p.set('kind', kind);
    if (reviewed) p.set('reviewed', reviewed);
    fetch(`/api/decisions?${p.toString()}`)
      .then((r) => r.json())
      .then((d: { items: Decision[]; total: number }) => {
        setItems(d.items);
        setTotal(d.total);
      });
    fetch('/api/decisions/_/summary')
      .then((r) => r.json())
      .then(setSummary);
  }

  useEffect(fetchData, [action, kind, reviewed, minConf]);

  function review(id: number, op: 'approve' | 'modify' | 'reject', decision?: string) {
    fetch(`/api/decisions/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: op, decision }),
    }).then(() => fetchData());
  }

  const filtered = search
    ? items.filter(
        (d) =>
          (d.a_title?.toLowerCase().includes(search.toLowerCase()) ||
            d.b_title?.toLowerCase().includes(search.toLowerCase()) ||
            d.article_title?.toLowerCase().includes(search.toLowerCase())) ??
          false,
      )
    : items;

  return (
    <>
      {summary && (
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', margin: '0.5rem 0 1rem' }}>
          <div>
            <strong>action:</strong>{' '}
            {summary.byAction.map((a) => (
              <span key={a.action} style={{ marginRight: '0.6rem' }}>
                {a.action}={a.c}
              </span>
            ))}
          </div>
          <div>
            <strong>conf:</strong>{' '}
            {summary.byConfBucket.map((b) => (
              <span key={b.bucket} style={{ marginRight: '0.6rem' }}>
                {b.bucket}={b.c}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="toolbar">
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">all actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as 'pair' | 'article' | '')}>
          <option value="">all</option>
          <option value="pair">pair</option>
          <option value="article">article</option>
        </select>
        <select value={reviewed} onChange={(e) => setReviewed(e.target.value as '0' | '1' | '')}>
          <option value="">all</option>
          <option value="0">unreviewed</option>
          <option value="1">reviewed</option>
        </select>
        <label>
          min_conf{' '}
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={minConf}
            onChange={(e) => setMinConf(Number(e.target.value))}
            style={{ width: '5rem' }}
          />
        </label>
        <input
          placeholder="title 検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>
          showing {filtered.length} / {total}
        </span>
      </div>

      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {filtered.map((d) => (
          <DecisionCard key={d.decision_id} d={d} onReview={review} />
        ))}
        {filtered.length === 0 && <p style={{ opacity: 0.6 }}>(no matches)</p>}
      </div>
    </>
  );
}

function DecisionCard({
  d,
  onReview,
}: {
  d: Decision;
  onReview: (id: number, op: 'approve' | 'modify' | 'reject', decision?: string) => void;
}) {
  const rationale = (() => {
    try {
      return JSON.parse(d.rationale_json);
    } catch {
      return null;
    }
  })();
  const isPair = d.pair_id !== null;
  const winnerIsA = d.winner_article_id === d.article_a_id;
  const loserIsA = !winnerIsA;

  return (
    <article
      style={{
        border: '1px solid #8884',
        borderRadius: '0.5rem',
        padding: '0.6rem',
        opacity: d.human_reviewed ? 0.55 : 1,
      }}
    >
      <header style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.3rem' }}>
        <span className={`pill action-${d.action.toLowerCase()}`} style={pillStyle(d.action)}>
          {d.action}
        </span>
        <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>conf {d.confidence_score.toFixed(2)}</span>
        {isPair && d.severity && (
          <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>severity={d.severity}</span>
        )}
        {isPair && d.pair_relation && (
          <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>{d.pair_relation}</span>
        )}
        {isPair && (
          <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>
            cos {d.cosine_similarity?.toFixed(3)}
            {d.serp_overlap_pct !== null && ` · serp ${d.serp_overlap_pct?.toFixed(2)}`}
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.3rem' }}>
          {d.human_reviewed === 0 ? (
            <>
              <button type="button" onClick={() => onReview(d.decision_id, 'approve')}>承認</button>
              <button type="button" onClick={() => onReview(d.decision_id, 'reject')}>却下</button>
            </>
          ) : (
            <span style={{ fontSize: '0.8rem' }}>
              ✓ {d.human_decision ?? 'approved'}
            </span>
          )}
        </span>
      </header>

      {isPair ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem' }}>
          <div style={{ background: winnerIsA ? '#2ecc7122' : 'transparent', padding: '0.3rem', borderRadius: '0.25rem' }}>
            <a href={d.a_url ?? '#'} target="_blank" rel="noreferrer" style={{ fontWeight: winnerIsA ? 600 : 400 }}>
              [{d.article_a_id}] {d.a_title}
            </a>
            {winnerIsA && <span style={{ marginLeft: '0.3rem', fontSize: '0.7rem' }}>👑 winner</span>}
          </div>
          <div style={{ background: loserIsA ? 'transparent' : '#2ecc7122', padding: '0.3rem', borderRadius: '0.25rem' }}>
            <a href={d.b_url ?? '#'} target="_blank" rel="noreferrer" style={{ fontWeight: !winnerIsA ? 600 : 400 }}>
              [{d.article_b_id}] {d.b_title}
            </a>
            {!winnerIsA && d.winner_article_id && (
              <span style={{ marginLeft: '0.3rem', fontSize: '0.7rem' }}>👑 winner</span>
            )}
          </div>
        </div>
      ) : (
        <div>
          <a href={d.article_url ?? '#'} target="_blank" rel="noreferrer">
            [{d.article_id}] {d.article_title}
          </a>
        </div>
      )}

      {rationale && (
        <details style={{ marginTop: '0.3rem', fontSize: '0.78rem', opacity: 0.85 }}>
          <summary style={{ cursor: 'pointer' }}>rationale</summary>
          <div style={{ paddingLeft: '0.6rem' }}>
            <div>factors: {(rationale.factors ?? []).join(', ')}</div>
            <pre style={{ margin: 0 }}>{JSON.stringify(rationale.scores, null, 2)}</pre>
          </div>
        </details>
      )}
    </article>
  );
}

function pillStyle(action: string): React.CSSProperties {
  const palette: Record<string, string> = {
    CONSOLIDATE: '#e74c3c',
    DIFFERENTIATE: '#f39c12',
    REASSIGN: '#3498db',
    SPLIT: '#9b59b6',
    DELETE: '#7f8c8d',
    KEEP: '#2ecc71',
  };
  const c = palette[action] ?? '#888';
  return {
    padding: '0.1rem 0.4rem',
    borderRadius: '0.4rem',
    fontSize: '0.75rem',
    background: `${c}33`,
    color: c,
    fontWeight: 600,
  };
}
