import { useState } from 'react';
import { ArticlesView } from './ArticlesView.js';
import { DecisionsView } from './DecisionsView.js';
import { ExecuteView } from './ExecuteView.js';

type Tab = 'articles' | 'decisions' | 'execute';

const TABS: Array<{ key: Tab; label: string; desc: string }> = [
  { key: 'decisions', label: '① 候補をレビュー', desc: 'engine の判定を1件ずつ承認/却下' },
  { key: 'execute',   label: '② 実行プレビュー',  desc: '承認済の統合をまとめて確認 → 一括実行' },
  { key: 'articles',  label: '記事一覧',          desc: '全 434 記事の検索/フィルタ' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('decisions');

  return (
    <>
      <header style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', marginBottom: '0.5rem' }}>
        <h1 style={{ flex: 1, margin: 0 }}>cannibalization-system</h1>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key}
            style={tabStyle(tab === t.key)}
            title={t.desc}
          >
            {t.label}
          </button>
        ))}
      </header>
      {tab === 'articles' && <ArticlesView />}
      {tab === 'decisions' && <DecisionsView />}
      {tab === 'execute' && <ExecuteView />}
    </>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '0.4rem 0.8rem',
    border: '1px solid #8888',
    borderRadius: '0.4rem',
    background: active ? '#3478f6' : 'transparent',
    color: active ? '#fff' : 'inherit',
    cursor: 'pointer',
  };
}
