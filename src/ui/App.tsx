import { useState } from 'react';
import { ArticlesView } from './ArticlesView.js';
import { DashboardView } from './DashboardView.js';
import { DecisionsView } from './DecisionsView.js';
import { ExecuteView } from './ExecuteView.js';
import { HeatmapView } from './HeatmapView.js';

type Tab = 'overview' | 'heatmap' | 'decisions' | 'execute' | 'articles';

const TABS: Array<{ key: Tab; label: string; desc: string }> = [
  { key: 'overview',  label: '📊 Overview',  desc: 'KPI とサマリ' },
  { key: 'heatmap',   label: '🗺️ Heatmap',  desc: 'subtopic × 商品軸 ヒートマップ' },
  { key: 'decisions', label: '① レビュー',   desc: 'engine の判定を承認/却下' },
  { key: 'execute',   label: '② 実行',       desc: '承認済みを一括実行' },
  { key: 'articles',  label: '📋 記事一覧',   desc: '434 記事の検索/フィルタ' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('heatmap');

  return (
    <>
      <header style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <h1 style={{ flex: 1, margin: 0, minWidth: '15rem' }}>cannibalization-system</h1>
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
      {tab === 'overview' && <DashboardView />}
      {tab === 'heatmap' && <HeatmapView />}
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
