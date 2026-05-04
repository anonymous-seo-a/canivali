import { describe, expect, it } from 'vitest';
import { classifyTitle, deriveSubtopicAxis } from '../../src/classification/title-to-cell.js';

describe('classifyTitle', () => {
  it('detects D1 + V1 for おすすめ pillar', () => {
    const r = classifyTitle('カードローンのおすすめはどこ？人気10社を徹底比較【2026年】');
    expect(r.subtopic_topic_id).toBe('D1');
    expect(r.vocabulary_topic_id).toBe('V1');
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('detects A1 + V1 for アルバイト×カードローン', () => {
    const r = classifyTitle('アルバイトでもカードローンは借りられる？審査のコツを解説【2026年】');
    expect(r.subtopic_topic_id).toBe('A1');
    expect(r.vocabulary_topic_id).toBe('V1');
  });

  it('detects E5 for 総量規制', () => {
    const r = classifyTitle('総量規制とは？年収3分の1ルールと対象外で借りる方法【2026年】');
    expect(r.subtopic_topic_id).toBe('E5');
  });

  it('detects A6 + V1 for 年金受給者', () => {
    const r = classifyTitle('年金受給者でも借りられるカードローンはある？おすすめ7選と審査のコツ【2026年】');
    expect(r.subtopic_topic_id).toBe('A6');
    expect(r.vocabulary_topic_id).toBe('V1');
  });

  it('detects C6 for おまとめ borrowing', () => {
    const r = classifyTitle('カードローン借り換えのおすすめはどこ？金利削減の方法を解説【2026年】');
    expect(r.subtopic_topic_id).toBe('C6');
  });

  it('detects V5-3 (アコム) over V1 fallback', () => {
    const r = classifyTitle('アコムの在籍確認は？電話なしで借りる方法を解説');
    expect(r.vocabulary_topic_id).toBe('V5-3');
  });

  it('detects B8 (バレ対策) for 郵送物なし', () => {
    const r = classifyTitle('郵送物なしのカードローン5選');
    expect(r.subtopic_topic_id).toBe('B8');
  });

  it('detects B2 for 在籍確認なし', () => {
    const r = classifyTitle('在籍確認なしカードローン3選');
    expect(r.subtopic_topic_id).toBe('B2');
  });

  it('detects F2 for 在籍確認 actual flow', () => {
    const r = classifyTitle('在籍確認の電話の流れと対処法');
    expect(r.subtopic_topic_id).toBe('F2');
  });

  it('returns low confidence on noise title', () => {
    const r = classifyTitle('ねこ');
    expect(r.confidence).toBeLessThan(0.4);
  });
});

describe('deriveSubtopicAxis', () => {
  it('extracts axis letter', () => {
    expect(deriveSubtopicAxis('A1')).toBe('A');
    expect(deriveSubtopicAxis('D1')).toBe('D');
    expect(deriveSubtopicAxis('V1')).toBeNull();
    expect(deriveSubtopicAxis(null)).toBeNull();
  });
});
