import { useEffect, useState } from 'react';
import { ArticlesView } from './ArticlesView.js';
import { DecisionsView } from './DecisionsView.js';

type Tab = 'articles' | 'decisions';

export function App() {
  const [tab, setTab] = useState<Tab>('decisions');

  return (
    <>
      <header style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
        <h1 style={{ flex: 1 }}>cannibalization-system</h1>
        <button
          type="button"
          onClick={() => setTab('decisions')}
          aria-current={tab === 'decisions'}
          style={tabStyle(tab === 'decisions')}
        >
          Decisions
        </button>
        <button
          type="button"
          onClick={() => setTab('articles')}
          aria-current={tab === 'articles'}
          style={tabStyle(tab === 'articles')}
        >
          Articles
        </button>
      </header>
      {tab === 'articles' && <ArticlesView />}
      {tab === 'decisions' && <DecisionsView />}
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
