import { useEffect, useState } from 'react';

type Article = {
  article_id: number;
  url: string;
  title: string;
  status: string;
  subtopic_axis: string | null;
  subtopic_topic_id: string | null;
  vocabulary_topic_id: string | null;
  classification_method: string | null;
  classification_confidence: number | null;
  category_quarantine: string;
  quarantine_reason: string | null;
  word_count: number | null;
  publish_date: string | null;
  last_modified: string | null;
  crawled_at: number | null;
};

export function App() {
  const [items, setItems] = useState<Article[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [quarantine, setQuarantine] = useState('');
  const [subtopic, setSubtopic] = useState('');
  const [vocabulary, setVocabulary] = useState('');

  useEffect(() => {
    const params = new URLSearchParams({ limit: '500' });
    if (quarantine) params.set('quarantine', quarantine);
    if (subtopic) params.set('subtopic', subtopic);
    if (vocabulary) params.set('vocabulary', vocabulary);
    fetch(`/api/articles?${params.toString()}`)
      .then((r) => r.json())
      .then((d: { items: Article[]; total: number }) => {
        setItems(d.items);
        setTotal(d.total);
      });
  }, [quarantine, subtopic, vocabulary]);

  const filtered = q
    ? items.filter(
        (a) =>
          a.title.toLowerCase().includes(q.toLowerCase()) || String(a.article_id).includes(q),
      )
    : items;

  return (
    <>
      <h1>cannibalization-system — 記事インベントリ ({total})</h1>
      <div className="toolbar">
        <input
          placeholder="title / id 検索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={quarantine} onChange={(e) => setQuarantine(e.target.value)}>
          <option value="">all quarantine</option>
          <option value="in_scope">in_scope</option>
          <option value="pending">pending</option>
          <option value="confirmed">confirmed</option>
        </select>
        <input
          placeholder="subtopic (例: D1)"
          value={subtopic}
          onChange={(e) => setSubtopic(e.target.value)}
          size={10}
        />
        <input
          placeholder="vocab (例: V1)"
          value={vocabulary}
          onChange={(e) => setVocabulary(e.target.value)}
          size={10}
        />
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>title</th>
            <th>subtopic</th>
            <th>V</th>
            <th>conf</th>
            <th>quarantine</th>
            <th>words</th>
            <th>publish</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => (
            <tr key={a.article_id}>
              <td>
                <a href={a.url} target="_blank" rel="noreferrer">
                  {a.article_id}
                </a>
              </td>
              <td>{a.title}</td>
              <td>{a.subtopic_topic_id ?? '—'}</td>
              <td>{a.vocabulary_topic_id ?? '—'}</td>
              <td>{a.classification_confidence?.toFixed(2) ?? '—'}</td>
              <td>
                <span className={`pill ${a.category_quarantine}`}>{a.category_quarantine}</span>
                {a.quarantine_reason ? ` ${a.quarantine_reason}` : ''}
              </td>
              <td>{a.word_count ?? '—'}</td>
              <td>{a.publish_date ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="footer">
        Phase 1 Foundation. 詳細は <code>docs/handoffs/phase1_foundation_handoff.md</code>。
      </div>
    </>
  );
}
