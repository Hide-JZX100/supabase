# NE_在庫情報取得

## 概要
ネクストエンジン（NE）の商品・在庫データを Google Apps Script（GAS）で取得し、
Google スプレッドシートおよび **Supabase（PostgreSQL）** に同期する自動化プロジェクトです。

認証には NEAuth ライブラリ（`認証_ライブラリ.gs`）を使用しています。
スプレッドシートは既存の IMPORTRANGE 連携を維持しつつ、
Supabase を新たなデータストアとして追加した二重書き込み構成で運用します。

---

## アーキテクチャ

```
ネクストエンジン API
    │
    ↓（GAS が定期取得）
Google Apps Script（本プロジェクト）
    │
    ├─→ Google スプレッドシート（IMPORTRANGE 連携を維持）
    │
    └─→ Supabase / NE_InventoryData テーブル
              │
              └─→ 別プロジェクト・外部システムへの連携（将来）
```

---

## 主な機能

### 1. 商品マスタ全件同期（1日1回 / 0:10 実行）
**実行関数：** `updateInventoryDataFromGoodsMaster`

- NE 商品マスタ API（`/api_v1_master_goods/search`）から全件取得
- ロケーションに `xxxxxx` を含む商品を除外（空欄は取得対象）
- スプレッドシートと Supabase の **両方** に全件書き直し
- ページネーション対応（1,000件 × 最大5ページ）
- 実行完了後に翌日分トリガーを自動登録（自己スケジューリング方式）

### 2. 在庫情報リアルタイム更新（1日6回）
**実行関数：** `updateInventoryDataBatchWithRetry`

- NE 在庫マスタ API（`/api_v1_master_stock/search`）から在庫情報を取得
- スプレッドシートと Supabase の **両方** に在庫数値を更新
- Supabase 側は在庫数値列のみ更新（商品名・JANコードは変更しない）
- 在庫数・引当数・フリー在庫数・欠品数のいずれかに変化がある場合のみ `更新日時` を更新
- 1,000件バッチ処理（約3,200件を約18秒で処理）
- エクスポネンシャルバックオフによる自動リトライ（最大3回）

### 3. 差分取得機能
**提供関数：** `getChangedInventorySince(since)`

- 指定日時以降に `更新日時` が更新された商品のみを Supabase から取得
- `saveLastExecutedAt()` / `loadLastExecutedAt()` で前回実行日時を管理
- 将来の外部連携・通知処理の基盤として利用可能

---

## 取得項目一覧

| 列 | 項目名 | フィールド名 | 更新元 |
|----|--------|-------------|--------|
| A | 商品コード | goods_id | 商品マスタ |
| B | 商品名 | goods_name | 商品マスタ |
| C | 在庫数 | stock_quantity | 商品マスタ / 在庫マスタ |
| D | 引当数 | stock_allocation_quantity | 商品マスタ / 在庫マスタ |
| E | フリー在庫数 | stock_free_quantity | 商品マスタ / 在庫マスタ |
| F | 予約在庫数 | stock_advance_order_quantity | 商品マスタ / 在庫マスタ |
| G | 予約引当数 | stock_advance_order_allocation_quantity | 商品マスタ / 在庫マスタ |
| H | 予約フリー在庫数 | stock_advance_order_free_quantity | 商品マスタ / 在庫マスタ |
| I | 不良在庫数 | stock_defective_quantity | 商品マスタ / 在庫マスタ |
| J | 発注残数 | stock_remaining_order_quantity | 商品マスタ / 在庫マスタ |
| K | 欠品数 | stock_out_quantity | 商品マスタ / 在庫マスタ |
| L | JANコード | goods_jan_code | 商品マスタ |
| - | 更新日時 | - | Supabase（RPC内で自動セット）|

---

## ファイル構成

| ファイル | 役割 |
|---------|------|
| `00_認証ライブラリ使用必須関数.gs` | NE OAuth2 認証・doGet・トークン更新 |
| `10_Main.エントリーポイント.gs` | エントリーポイント・処理オーケストレーション |
| `11_Config.設定管理.gs` | 定数・設定値・トークン取得 |
| `12_Logger.ログ管理.gs` | ログ出力・リトライ統計管理 |
| `13_NextEngineAPI.API通信.gs` | NE API への HTTP リクエスト・トークン更新 |
| `14_InventoryLogic.ビジネスロジック.gs` | 在庫データ取得・整形 |
| `15_SpreadsheetRepository.データ永続化.gs` | スプレッドシートへの書き込み・ログ記録 |
| `16_SupabaseClient.Supabase接続.gs` | Supabase 接続・RPC 呼び出し・REST API 汎用層 |
| `17_SupabaseRepository.Supabase永続化.gs` | Supabase へのデータ書き込み・差分取得 |
| `トリガー設定.gs` | 時間ベーストリガーの登録・削除 |
| `99_Tests.テスト.gs` | 動作確認・診断ツール |

---

## Supabase 構成

### テーブル

| テーブル名 | 用途 |
|-----------|------|
| `public."NE_InventoryData"` | 在庫情報の保存先 |

### RPC 関数

| 関数名 | 呼び出し元 | 用途 |
|--------|-----------|------|
| `upsert_ne_inventory_data` | `updateInventoryDataFromGoodsMaster` | 商品マスタ全件 upsert（全列更新） |
| `upsert_ne_stock_data` | `updateInventoryDataBatchWithRetry` | 在庫マスタ差分 upsert（在庫数値列のみ更新） |

### 差分更新の仕組み

両 RPC 関数とも、以下の列に変化がある場合のみ `更新日時` を更新する。

- 在庫数
- 引当数
- フリー在庫数
- 欠品数

変化がない商品は `更新日時` を変更しない。  
これにより `getChangedInventorySince()` で実際に在庫が変化した商品のみを効率的に取得できる。

---

## スクリプトプロパティ設定

GAS エディタの「プロジェクトの設定」→「スクリプトプロパティ」に以下を設定する。

### NE API 認証

| キー | 値 |
|------|----|
| `CLIENT_ID` | ネクストエンジン クライアントID |
| `CLIENT_SECRET` | ネクストエンジン クライアントシークレット |
| `REDIRECT_URI` | GAS Web アプリのデプロイ URL |
| `ACCESS_TOKEN` | NE アクセストークン（認証後に自動保存） |
| `REFRESH_TOKEN` | NE リフレッシュトークン（認証後に自動保存） |

### スプレッドシート

| キー | 値 |
|------|----|
| `SPREADSHEET_ID` | 在庫データスプレッドシートの ID |
| `SHEET_NAME` | 在庫データシート名 |
| `LOG_SHEET_NAME` | 実行タイムスタンプ記録シート名 |

### Supabase

| キー | 値 |
|------|----|
| `SUPABASE_URL` | `https://xxxxxxxx.supabase.co` |
| `SUPABASE_KEY` | Supabase anon key（publishable key） |
| `SUPABASE_LAST_EXECUTED_AT` | 最終差分取得日時（自動保存・手動設定不要） |

### トリガー制御

| キー | 値 |
|------|----|
| `TRIGGER_FUNCTION_NAME` | `updateInventoryDataFromGoodsMaster` または `updateInventoryDataBatchWithRetry` |
| `TRIGGER_MODE` | `TODAY` または `TOMORROW` |
| `LOG_LEVEL` | `1`（MINIMAL）/ `2`（SUMMARY）/ `3`（DETAILED） |
| `TEST_SPREADSHEET_ID` | テスト用スプレッドシートの ID |

---

## トリガー構成

| 時刻 | 関数 | 目的 |
|------|------|------|
| 0:10 | `updateInventoryDataFromGoodsMaster` | 商品マスタ全件同期 |
| 8:00 | `updateInventoryDataBatchWithRetry` | 在庫情報更新 |
| 10:00 | `updateInventoryDataBatchWithRetry` | 在庫情報更新 |
| 13:30 | `updateInventoryDataBatchWithRetry` | 在庫情報更新 |
| 16:00 | `updateInventoryDataBatchWithRetry` | 在庫情報更新 |
| 19:00 | `updateInventoryDataBatchWithRetry` | 在庫情報更新 |
| 21:00 | `updateInventoryDataBatchWithRetry` | 在庫情報更新 |

---

## 初回セットアップ手順

1. **NEAuth ライブラリの追加**
   - 左メニュー「ライブラリ」→ 認証プロジェクトのスクリプト ID を入力
   - 識別子: `NEAuth`、最新バージョンを選択

2. **スクリプトプロパティの設定**
   - 上記「スクリプトプロパティ設定」の全項目を設定する

3. **Web アアプリとしてデプロイ**
   - 「デプロイ」→「新しいデプロイ」→ 種類: ウェブアプリ
   - デプロイ後の URL を `REDIRECT_URI` に設定する

4. **NE 認証の実行**
   - `testGenerateAuthUrl()` を実行して認証 URL を取得
   - ブラウザで認証を完了する

5. **動作確認**
   - `verifyConfiguration()` で設定を確認
   - `testSupabaseConnection()` で Supabase 接続を確認
   - `testUpsertInventoryToSupabase()` で書き込みをテスト

6. **トリガーの設定**
   - `setTriggerForGoodsMaster()` で 0:10 のトリガーを登録
   - `setTrigger()` で在庫更新トリガーを登録

---

## 主要テスト関数一覧（99_Tests.テスト.gs）

| 関数名 | 目的 |
|--------|------|
| `verifyConfiguration()` | 設定値・トークンの確認 |
| `testRetryFunction()` | NE API 接続・リトライ動作確認 |
| `showSREDashboard()` | システム健全性の一覧表示 |
| `testSupabaseConnection()` | Supabase 接続確認 |
| `testSupabaseRpcCall()` | Supabase RPC 動作確認（ダミーデータ） |
| `testBuildSupabasePayload()` | 商品マスタデータの変換確認 |
| `testUpsertInventoryToSupabase()` | 商品マスタ→Supabase 書き込みテスト |
| `testBuildStockPayload()` | 在庫マスタデータの変換確認 |
| `testUpsertStockToSupabase()` | 在庫マスタ→Supabase 書き込みテスト |
| `testQuerySupabaseTable()` | Supabase REST API 読み取りテスト |
| `testGetChangedInventorySince()` | 差分取得動作確認 |
| `testLastExecutedAtFlow()` | 実行日時の保存・読み出し確認 |
| `testPhase5_IntegrationTest()` | 商品マスタ全件取得の統合テスト |
