-- =====================================================
-- master_topics: V軸 (商品/サービス軸)
-- 出典: docs/strategic/cardloan_topic_map.md §4
-- =====================================================

-- V軸トップ
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, vocabulary_group, name) VALUES
  ('V', 'vocabulary', 'meta', 'V軸 (商品/サービス軸)');

-- V1〜V4: 語彙バリエーション
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, vocabulary_group, name) VALUES
  ('V1', 'vocabulary', 'V', 'lexical', 'カードローン'),
  ('V2', 'vocabulary', 'V', 'lexical', 'キャッシング'),
  ('V3', 'vocabulary', 'V', 'lexical', '消費者金融'),
  ('V4', 'vocabulary', 'V', 'lexical', 'お金借りる/借入');

-- V5: 大手消費者金融
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, vocabulary_group, name) VALUES
  ('V5',   'vocabulary', 'V',  'product_brand', '大手消費者金融'),
  ('V5-1', 'vocabulary', 'V5', 'product_brand', 'アイフル'),
  ('V5-2', 'vocabulary', 'V5', 'product_brand', 'プロミス'),
  ('V5-3', 'vocabulary', 'V5', 'product_brand', 'アコム'),
  ('V5-4', 'vocabulary', 'V5', 'product_brand', 'SMBCモビット'),
  ('V5-5', 'vocabulary', 'V5', 'product_brand', 'レイク');

-- V6: メガ・ネット銀行
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, vocabulary_group, name) VALUES
  ('V6',    'vocabulary', 'V',  'product_brand', 'メガ・ネット銀行'),
  ('V6-1',  'vocabulary', 'V6', 'product_brand', '三菱UFJ (バンクイック)'),
  ('V6-2',  'vocabulary', 'V6', 'product_brand', '三井住友銀行カードローン'),
  ('V6-3',  'vocabulary', 'V6', 'product_brand', 'みずほ銀行カードローン'),
  ('V6-4',  'vocabulary', 'V6', 'product_brand', '楽天銀行スーパーローン'),
  ('V6-5',  'vocabulary', 'V6', 'product_brand', 'PayPay銀行'),
  ('V6-6',  'vocabulary', 'V6', 'product_brand', 'auじぶん銀行'),
  ('V6-7',  'vocabulary', 'V6', 'product_brand', '住信SBIネット銀行'),
  ('V6-8',  'vocabulary', 'V6', 'product_brand', 'ソニー銀行'),
  ('V6-9',  'vocabulary', 'V6', 'product_brand', 'イオン銀行'),
  ('V6-10', 'vocabulary', 'V6', 'product_brand', 'りそな銀行'),
  ('V6-11', 'vocabulary', 'V6', 'product_brand', 'オリックス銀行'),
  ('V6-12', 'vocabulary', 'V6', 'product_brand', '東京スター銀行'),
  ('V6-13', 'vocabulary', 'V6', 'product_brand', 'みんなの銀行'),
  ('V6-14', 'vocabulary', 'V6', 'product_brand', 'UI銀行'),
  ('V6-15', 'vocabulary', 'V6', 'product_brand', 'セブン銀行');

-- V7: 地方銀行 (代表的なもの — 個社追加は随時)
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, vocabulary_group, name) VALUES
  ('V7',    'vocabulary', 'V',  'product_brand', '地方銀行'),
  ('V7-1',  'vocabulary', 'V7', 'product_brand', '横浜銀行'),
  ('V7-2',  'vocabulary', 'V7', 'product_brand', '千葉銀行'),
  ('V7-3',  'vocabulary', 'V7', 'product_brand', '静岡銀行'),
  ('V7-4',  'vocabulary', 'V7', 'product_brand', '愛媛銀行'),
  ('V7-5',  'vocabulary', 'V7', 'product_brand', 'きらぼし銀行'),
  ('V7-6',  'vocabulary', 'V7', 'product_brand', '足利銀行'),
  ('V7-7',  'vocabulary', 'V7', 'product_brand', '仙台銀行'),
  ('V7-8',  'vocabulary', 'V7', 'product_brand', '中京銀行'),
  ('V7-9',  'vocabulary', 'V7', 'product_brand', '関西みらい銀行'),
  ('V7-10', 'vocabulary', 'V7', 'product_brand', '北洋銀行'),
  ('V7-11', 'vocabulary', 'V7', 'product_brand', '十八親和銀行'),
  ('V7-12', 'vocabulary', 'V7', 'product_brand', '七十七銀行'),
  ('V7-13', 'vocabulary', 'V7', 'product_brand', '八十二銀行'),
  ('V7-14', 'vocabulary', 'V7', 'product_brand', '青森みちのく銀行'),
  ('V7-15', 'vocabulary', 'V7', 'product_brand', '宮崎銀行'),
  ('V7-16', 'vocabulary', 'V7', 'product_brand', '佐賀銀行'),
  ('V7-17', 'vocabulary', 'V7', 'product_brand', '福岡銀行'),
  ('V7-18', 'vocabulary', 'V7', 'product_brand', '常陽銀行'),
  ('V7-19', 'vocabulary', 'V7', 'product_brand', '南都銀行'),
  ('V7-20', 'vocabulary', 'V7', 'product_brand', 'トマト銀行'),
  ('V7-21', 'vocabulary', 'V7', 'product_brand', '山口銀行'),
  ('V7-22', 'vocabulary', 'V7', 'product_brand', '西日本シティ銀行'),
  ('V7-23', 'vocabulary', 'V7', 'product_brand', '北海道銀行'),
  ('V7-24', 'vocabulary', 'V7', 'product_brand', '北國銀行'),
  ('V7-25', 'vocabulary', 'V7', 'product_brand', 'スルガ銀行'),
  ('V7-26', 'vocabulary', 'V7', 'product_brand', '第四北越銀行');

-- V8: 中小消費者金融
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, vocabulary_group, name) VALUES
  ('V8',    'vocabulary', 'V',  'product_brand', '中小消費者金融'),
  ('V8-1',  'vocabulary', 'V8', 'product_brand', 'フクホー'),
  ('V8-2',  'vocabulary', 'V8', 'product_brand', 'エイワ'),
  ('V8-3',  'vocabulary', 'V8', 'product_brand', 'セントラル'),
  ('V8-4',  'vocabulary', 'V8', 'product_brand', 'アロー'),
  ('V8-5',  'vocabulary', 'V8', 'product_brand', 'アムザ'),
  ('V8-6',  'vocabulary', 'V8', 'product_brand', 'キャネット'),
  ('V8-7',  'vocabulary', 'V8', 'product_brand', 'ライフティ'),
  ('V8-8',  'vocabulary', 'V8', 'product_brand', 'AZ'),
  ('V8-9',  'vocabulary', 'V8', 'product_brand', 'アスト'),
  ('V8-10', 'vocabulary', 'V8', 'product_brand', 'キャレント'),
  ('V8-11', 'vocabulary', 'V8', 'product_brand', 'ニチデン'),
  ('V8-12', 'vocabulary', 'V8', 'product_brand', 'ダイレクトワン'),
  ('V8-13', 'vocabulary', 'V8', 'product_brand', 'フタバ'),
  ('V8-14', 'vocabulary', 'V8', 'product_brand', 'ベルーナノーティス'),
  ('V8-15', 'vocabulary', 'V8', 'product_brand', 'いつも'),
  ('V8-16', 'vocabulary', 'V8', 'product_brand', 'VIP'),
  ('V8-17', 'vocabulary', 'V8', 'product_brand', 'キャッシングエイワ');

-- V9: スマホ・新興
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, vocabulary_group, name) VALUES
  ('V9',   'vocabulary', 'V',  'product_brand', 'スマホ・新興'),
  ('V9-1', 'vocabulary', 'V9', 'product_brand', 'au PAY スマートローン'),
  ('V9-2', 'vocabulary', 'V9', 'product_brand', 'd スマホローン'),
  ('V9-3', 'vocabulary', 'V9', 'product_brand', 'ファミペイローン'),
  ('V9-4', 'vocabulary', 'V9', 'product_brand', 'メルペイスマートマネー'),
  ('V9-5', 'vocabulary', 'V9', 'product_brand', 'LINEポケットマネー');

-- V10: クレカ商標 (キャッシング枠の文脈時のみ範囲内)
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, vocabulary_group, name, description) VALUES
  ('V10',   'vocabulary', 'V',   'product_brand', 'クレカ商標', 'キャッシング機能文脈なら範囲内'),
  ('V10-1', 'vocabulary', 'V10', 'product_brand', 'ACマスターカード', NULL),
  ('V10-2', 'vocabulary', 'V10', 'product_brand', 'ライフカード',     NULL),
  ('V10-3', 'vocabulary', 'V10', 'product_brand', 'エポスカード',     NULL),
  ('V10-4', 'vocabulary', 'V10', 'product_brand', 'JCBカード',         NULL),
  ('V10-5', 'vocabulary', 'V10', 'product_brand', 'PayPayカード',      NULL),
  ('V10-6', 'vocabulary', 'V10', 'product_brand', 'メルカード',        NULL),
  ('V10-7', 'vocabulary', 'V10', 'product_brand', 'セゾンカード',      NULL);

-- V11〜V15: 代替金融サービス
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, vocabulary_group, name) VALUES
  ('V11', 'vocabulary', 'V', 'alternative', '担保系・契約者貸付'),
  ('V12', 'vocabulary', 'V', 'alternative', '後払いアプリ・先払い買取'),
  ('V13', 'vocabulary', 'V', 'alternative', '学生ローン専門業者'),
  ('V14', 'vocabulary', 'V', 'public',      '公的制度'),
  ('V15', 'vocabulary', 'V', 'alternative', '個人間借入');

-- V16: 違法警告 (反商品)
INSERT OR REPLACE INTO master_topics (topic_id, topic_kind, parent_topic_id, vocabulary_group, name, description) VALUES
  ('V16', 'vocabulary', 'V', 'illegal_warning', '違法警告', '送客対象外。警告コンテンツとしてのみ範囲内');
