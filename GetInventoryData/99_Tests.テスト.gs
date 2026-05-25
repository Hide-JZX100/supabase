/**
 * @file 99_Tests.gs
 * @description テスト・管理・診断ツール。
 * システムの動作確認、設定検証、健全性チェックのためのテスト関数と管理用ユーティリティを提供します。
 * 本番処理（10_Main.gs）には影響を与えません。
 *
 * ### 依存関係
 * - **参照先**:
 *   - 11_Config.gs (getSpreadsheetConfig, getStoredTokens, LOG_LEVEL, RETRY_CONFIG)
 *   - 12_Logger.gs (resetRetryStats, showRetryStats, recordRetryAttempt, getCurrentLogLevel, retryStats)
 *   - 14_InventoryLogic.gs (getBatchInventoryDataWithRetry)
 *   - 15_SpreadsheetRepository.gs (シート参照)
 *
 * ### 推奨実行順序
 * #### 初回セットアップ時
 * 1. `verifyConfiguration()` : 設定値・トークンの確認
 * 2. `testRetryFunction()` : API接続とリトライ動作の確認
 * 3. `showSREDashboard()` : システム全体の健全性確認
 *
 * #### トラブル発生時
 * 1. `verifyConfiguration()` : 設定値の再確認
 * 2. `testRetryFunction()` : API応答の確認
 * 3. `showSREDashboard()` : エラーログ・リトライ統計の確認
 *
 * ### 主要機能
 * - **動作確認**: `testRetryFunction`, `verifyConfiguration`
 * - **システム健全性**: `showSREDashboard`
 * - **リトライ検証**: `testRetryLogging`, `finalRetryTest`
 * - **デバッグ・診断**: `checkFileUsage`, `locateFunctions`
 *
 * ### 注意事項
 * - `finalRetryTest()` は `retryStats` グローバル変数を直接操作するため、本番処理と並行して実行しないでください。
 * - `testRetryFunction()` は実際にAPIを呼び出すため、レート制限に注意してください。
 * - スプレッドシートへの書き込みを伴うテストは本番データへの影響に注意してください。
 *
 * @version 2.1
 * @see testRetryFunction
 * @see verifyConfiguration
 * @see showSREDashboard
 * @see testRetryLogging
 * @see finalRetryTest
 * @see checkFileUsage
 * @see locateFunctions
 */

/**
 * API接続・リトライ動作確認テスト
 *
 * スプレッドシートの先頭10件を使用してAPIを実際に呼び出し
 * リトライ機能が正常に動作するかを確認する
 * スプレッドシートへの書き込みは行わない（読み取りのみ）
 *
 * 【確認内容】
 * - NE APIへの接続が正常に行えるか
 * - 在庫データが期待通りに取得・整形されるか
 * - リトライ統計が正しく記録されるか
 */
function testRetryFunction() {
    console.log('=== リトライ機能テスト ===');
    console.log('');

    // リトライ統計をリセット
    resetRetryStats();

    // 小規模データでテスト
    try {
        const { SPREADSHEET_ID, SHEET_NAME } = getSpreadsheetConfig();
        const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = spreadsheet.getSheetByName(SHEET_NAME);

        // シートのデータが10件未満の場合に備えてMath.minで件数を制限する
        const dataRange = sheet.getRange(2, 1, Math.min(10, sheet.getLastRow() - 1), 1);
        const values = dataRange.getValues();
        const goodsCodeList = values
            .map(row => row[0])
            .filter(code => code && code.toString().trim())
            .slice(0, 10);

        console.log(`テスト対象: ${goodsCodeList.length}件`);
        console.log(`商品コード: ${goodsCodeList.join(', ')}`);
        console.log('');

        const tokens = getStoredTokens();
        const startTime = new Date();

        // リトライ対応版で取得
        const inventoryDataMap = getBatchInventoryDataWithRetry(goodsCodeList, tokens, 0);

        const endTime = new Date();
        const duration = (endTime - startTime) / 1000;

        console.log(`\n=== テスト結果 ===`);
        console.log(`処理時間: ${duration.toFixed(1)}秒`);
        console.log(`取得件数: ${inventoryDataMap.size}件`);

        // リトライ統計を表示
        showRetryStats();

        console.log('\n=== 取得データサンプル ===');
        let count = 0;
        for (const [goodsCode, data] of inventoryDataMap) {
            if (count < 3) {
                console.log(`${goodsCode}: 在庫${data.stock_quantity} 引当${data.stock_allocated_quantity} フリー${data.stock_free_quantity}`);
                count++;
            }
        }

        console.log('\n✓ リトライ機能のテストが完了しました');

    } catch (error) {
        console.error('✗ テストエラー:', error.message);
        showRetryStats();
    }
}

/**
 * SREダッシュボード: システムの健全性を一覧表示
 *
 * 以下のシートと設定値を集計してコンソールに出力する
 * - リトライログシート : 直近5回分のリトライ統計
 * - エラーログシート   : 累計エラー件数と直近3件の内容
 * - RETRY_CONFIG       : 現在のリトライ設定
 * - LOG_LEVEL          : 現在のログレベル設定
 *
 * 定期的な健全性チェックや障害発生時の初動調査に使用する
 */
function showSREDashboard() {
    console.log('==========================================================');
    console.log('  SREダッシュボード - システム健全性');
    console.log('==========================================================');
    console.log('');

    try {
        // 1. リトライ設定状況
        console.log('【1. リトライ機能】');
        console.log(`状態: ${RETRY_CONFIG.ENABLE_RETRY ? '✓ 有効' : '✗ 無効'}`);
        console.log(`最大リトライ回数: ${RETRY_CONFIG.MAX_RETRIES}回`);
        console.log('');

        // 2. 最近のリトライ統計（リトライログシートから取得）
        console.log('【2. 直近のリトライ統計】');
        const { SPREADSHEET_ID } = getSpreadsheetConfig();
        const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
        const retryLogSheet = spreadsheet.getSheetByName('リトライログ');

        if (retryLogSheet) {
            const lastRow = retryLogSheet.getLastRow();
            if (lastRow > 1) {
                const recentLogs = Math.min(5, lastRow - 1);
                const data = retryLogSheet.getRange(lastRow - recentLogs + 1, 1, recentLogs, 6).getValues();

                console.log('直近5回の実行:');
                data.forEach((row, index) => {
                    const date = Utilities.formatDate(row[0], 'JST', 'MM/dd HH:mm');
                    const retryCount = row[1];
                    const retryRate = row[4];
                    const note = row[5];

                    // リトライ発生率によるステータス判定
                    // ✓ : 0%（正常）
                    // △ : 5%以上（軽度の不調、経過観察）
                    // ⚠️ : 10%超（Google側またはネットワークの問題の可能性）
                    let status = '✓';
                    if (retryRate > 10) status = '⚠️';
                    else if (retryRate > 5) status = '△';

                    console.log(`${status} ${date} | リトライ${retryCount}回 | 発生率${retryRate}% ${note ? '(' + note + ')' : ''}`);
                });
            } else {
                console.log('まだリトライログがありません');
            }
        } else {
            console.log('リトライログシートが存在しません');
        }
        console.log('');

        // 3. エラーログ統計
        console.log('【3. エラー発生状況】');
        const errorLogSheet = spreadsheet.getSheetByName('エラーログ');

        if (errorLogSheet) {
            const lastRow = errorLogSheet.getLastRow();
            if (lastRow > 1) {
                console.log(`累計エラー件数: ${lastRow - 1}件`);

                // 直近のエラー
                const recentErrors = Math.min(3, lastRow - 1);
                const errorData = errorLogSheet.getRange(lastRow - recentErrors + 1, 1, recentErrors, 4).getValues();

                console.log('\n直近のエラー:');
                errorData.forEach(row => {
                    const date = Utilities.formatDate(row[0], 'JST', 'MM/dd HH:mm');
                    const goodsCode = row[1];
                    const errorType = row[2];
                    console.log(`  ${date} | ${goodsCode} | ${errorType}`);
                });
            } else {
                console.log('✓ エラーなし');
            }
        } else {
            console.log('エラーログシートが存在しません');
        }
        console.log('');

        // 4. 推奨アクション
        console.log('【4. 推奨アクション】');

        if (!RETRY_CONFIG.ENABLE_RETRY) {
            console.log('⚠️ リトライ機能が無効です');
            console.log('   → enableRetry() で有効化することを推奨します');
        } else {
            console.log('✓ リトライ機能が有効です');
        }

        const currentLogLevel = getCurrentLogLevel();
        if (currentLogLevel === LOG_LEVEL.DETAILED) {
            console.log('⚠️ ログレベルがDETAILEDです（デバッグモード）');
            console.log('   → 本番運用では setLogLevel(1) または setLogLevel(2) を推奨');
        } else if (currentLogLevel === LOG_LEVEL.MINIMAL) {
            console.log('✓ ログレベルがMINIMALです（本番モード）');
        } else {
            console.log('✓ ログレベルがSUMMARYです（推奨設定）');
        }

        console.log('');
        console.log('==========================================================');
        console.log('すべて正常です。システムは健全に動作しています。');
        console.log('==========================================================');

    } catch (error) {
        console.error('ダッシュボード表示エラー:', error.message);
    }
}

/**
 * 設定確認（デプロイ前・トラブル時の疎通確認）
 *
 * 以下の2項目を確認してコンソールに結果を出力する
 * 確認1: ACCESS_TOKEN・REFRESH_TOKEN が取得できるか
 * 確認2: SPREADSHEET_ID・SHEET_NAME でシートにアクセスできるか
 *
 * 初回セットアップ時やトークン再取得後に実行することを推奨する
 */
function verifyConfiguration() {
    console.log('=== 設定確認 ===');

    // プロパティチェック
    try {
        const tokens = getStoredTokens();
        console.log('✅ 認証トークン: 設定済み');
        console.log(`   (Access Token末尾: ...${tokens.accessToken.slice(-5)})`);
    } catch (e) {
        console.error('❌ 認証トークン: 未設定または取得エラー');
    }

    // シートアクセスチェック
    try {
        const config = getSpreadsheetConfig();
        const ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
        const sheet = ss.getSheetByName(config.SHEET_NAME);
        if (sheet) {
            console.log(`✅ スプレッドシート: 接続OK (シート名: ${config.SHEET_NAME})`);
            console.log(`   データ行数: ${sheet.getLastRow()}行`);
        } else {
            console.error(`❌ シートが見つかりません: ${config.SHEET_NAME}`);
        }
    } catch (e) {
        console.error(`❌ スプレッドシート接続エラー: ${e.message}`);
    }

    console.log('================');
}

/**
 * 使用状況確認スクリプト
 */
function checkFileUsage() {
    console.log('=== ファイル使用状況確認 ===');

    // 1. トリガー設定確認
    const properties = PropertiesService.getScriptProperties();
    const triggerFunction = properties.getProperty('TRIGGER_FUNCTION_NAME');
    console.log('1. トリガー関数:', triggerFunction || '未設定');

    // 2. 関数の存在確認
    console.log('\n2. 関数の存在確認:');

    const functionsToCheck = [
        'updateInventoryDataBatchWithRetry',
        'updateInventoryDataBatch',
        'showUsageGuideWithRetry',
        'enableRetry',
        'disableRetry',
        'showSREDashboard',
        'compareVersions'
    ];

    functionsToCheck.forEach(funcName => {
        try {
            const func = this[funcName];
            console.log(`  ${funcName}: ${func ? '✓存在' : '✗不在'}`);
        } catch (e) {
            console.log(`  ${funcName}: ✗不在 (${e.message})`);
        }
    });

    // 3. 実際のトリガー確認
    console.log('\n3. 設定済みトリガー:');
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
        console.log(`  - ${trigger.getHandlerFunction()}`);
    });
}

/**
 * 関数の所在地を特定
 */
function locateFunctions() {
    console.log('=== 関数の所在確認 ===\n');

    // 確認したい関数のリスト
    const functionsToLocate = [
        'updateInventoryDataBatchWithRetry',
        'updateInventoryDataBatch',
        'showUsageGuideWithRetry',
        'showUsageGuide',
        'enableRetry',
        'disableRetry',
        'showSREDashboard',
        'compareVersions',
        'getBatchInventoryDataWithRetry',
        'getBatchInventoryData'
    ];

    functionsToLocate.forEach(funcName => {
        try {
            // GASではReflect APIが使えないためevalで関数オブジェクトを取得する
            // 関数が存在しない場合はReferenceErrorがスローされるためtry-catchで処理する
            const func = eval(funcName);
            if (func) {
                // 関数のソースコードを取得して最初の数行を表示
                const source = func.toString();
                const firstLine = source.split('\n')[0];
                console.log(`✓ ${funcName}`);
                console.log(`  先頭: ${firstLine.substring(0, 80)}...`);
                console.log('');
            }
        } catch (e) {
            console.log(`✗ ${funcName}: ${e.message}\n`);
        }
    });
}

/**
 * =============================================================================
 * 商品マスタAPIへのエンドポイント変更テスト
 * =============================================================================
 *
 * 【目的】
 * 在庫マスタAPI (/api_v1_master_stock/search) から
 * 商品マスタAPI (/api_v1_master_goods/search) への変更が可能かを検証する
 *
 * 【確認ポイント】
 * 1. goods_id-in による複数コード一括検索が動作するか
 * 2. goods_name, goods_jan_code が取得できるか（新規取得項目）
 * 3. stock_allocation_quantity 等の在庫詳細フィールドが返ってくるか
 *
 * 【注意】
 * - 既存コードへの影響はありません（読み取りのみ）
 * - スプレッドシートへの書き込みは行いません
 * =============================================================================
 */
function testGoodsMasterApiEndpoint() {
    console.log('=== 商品マスタAPIエンドポイント変更テスト ===\n');

    try {
        // スプレッドシートから先頭3件の商品コードを取得（テスト用）
        const { SPREADSHEET_ID, SHEET_NAME } = getSpreadsheetConfig();
        const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = spreadsheet.getSheetByName(SHEET_NAME);

        const TEST_COUNT = 3;
        const dataRange = sheet.getRange(2, 1, TEST_COUNT, 1);
        const goodsCodeList = dataRange.getValues()
            .map(row => row[0])
            .filter(code => code && code.toString().trim())
            .slice(0, TEST_COUNT);

        if (goodsCodeList.length === 0) {
            console.log('テスト用商品コードが取得できませんでした');
            return;
        }

        console.log(`テスト対象: ${goodsCodeList.join(', ')}\n`);

        const tokens = getStoredTokens();

        // -----------------------------------------------------------------------
        // 商品マスタAPIへのリクエスト
        // -----------------------------------------------------------------------
        const url = `${NE_API_URL}/api_v1_master_goods/search`;

        // 在庫マスタAPIとの変更点:
        //   検索キー : stock_goods_id-in → goods_id-in
        //   エンドポイント: /api_v1_master_stock/search → /api_v1_master_goods/search
        //   fieldsに追加 : goods_name, goods_jan_code（新規取得項目）
        const payload = {
            'access_token': tokens.accessToken,
            'refresh_token': tokens.refreshToken,
            'goods_id-in': goodsCodeList.join(','),
            'fields': [
                'goods_id',
                'goods_name',
                'goods_jan_code',
                'stock_quantity',
                'stock_allocation_quantity',
                'stock_free_quantity',
                'stock_advance_order_quantity',
                'stock_advance_order_allocation_quantity',
                'stock_advance_order_free_quantity',
                'stock_defective_quantity',
                'stock_remaining_order_quantity',
                'stock_out_quantity'
            ].join(','),
            'limit': TEST_COUNT.toString()
        };

        const options = {
            'method': 'POST',
            'headers': { 'Content-Type': 'application/x-www-form-urlencoded' },
            'payload': Object.keys(payload)
                .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(payload[key]))
                .join('&')
        };

        console.log('APIリクエスト送信中...\n');
        const startTime = new Date();
        const response = UrlFetchApp.fetch(url, options);
        const responseData = JSON.parse(response.getContentText());
        const duration = ((new Date() - startTime) / 1000).toFixed(2);

        // -----------------------------------------------------------------------
        // 結果の検証
        // -----------------------------------------------------------------------
        console.log(`レスポンスコード : ${response.getResponseCode()}`);
        console.log(`処理時間         : ${duration}秒`);
        console.log(`APIレスポンス    : ${responseData.result}\n`);

        if (responseData.result !== 'success') {
            console.log('❌ APIエラー');
            console.log(`メッセージ: ${responseData.message || '不明'}`);
            return;
        }

        const data = responseData.data;
        console.log(`取得件数: ${data ? data.length : 0}件`);

        if (!data || data.length === 0) {
            console.log('❌ データが0件でした');
            return;
        }

        // -----------------------------------------------------------------------
        // 確認ポイント別の結果表示
        // -----------------------------------------------------------------------
        const sample = data[0];

        console.log('\n【確認1】goods_id-in による一括検索');
        console.log(data.length === goodsCodeList.length
            ? `  ✓ 要求 ${goodsCodeList.length}件 / 取得 ${data.length}件`
            : `  △ 要求 ${goodsCodeList.length}件 / 取得 ${data.length}件（件数が一致しません）`
        );

        console.log('\n【確認2】新規取得項目（商品マスタ固有フィールド）');
        console.log(`  goods_name    : ${sample.goods_name !== undefined ? '✓ 取得可' : '❌ 取得不可'} → ${sample.goods_name}`);
        console.log(`  goods_jan_code: ${sample.goods_jan_code !== undefined ? '✓ 取得可' : '❌ 取得不可'} → ${sample.goods_jan_code}`);

        console.log('\n【確認3】在庫詳細フィールド（在庫マスタ由来）');
        const stockFields = [
            'stock_quantity',
            'stock_allocation_quantity',
            'stock_free_quantity',
            'stock_advance_order_quantity',
            'stock_advance_order_allocation_quantity',
            'stock_advance_order_free_quantity',
            'stock_defective_quantity',
            'stock_remaining_order_quantity',
            'stock_out_quantity'
        ];
        stockFields.forEach(field => {
            const exists = sample[field] !== undefined;
            console.log(`  ${field.padEnd(42)}: ${exists ? '✓' : '❌'} → ${sample[field]}`);
        });

        // -----------------------------------------------------------------------
        // 全件サンプル表示
        // -----------------------------------------------------------------------
        console.log('\n【全取得データ】');
        data.forEach((item, index) => {
            console.log(`\n  [${index + 1}] ${item.goods_id}`);
            console.log(`      商品名      : ${item.goods_name}`);
            console.log(`      JANコード   : ${item.goods_jan_code}`);
            console.log(`      在庫数      : ${item.stock_quantity}`);
            console.log(`      引当数      : ${item.stock_allocation_quantity}`);
            console.log(`      フリー在庫  : ${item.stock_free_quantity}`);
        });

        console.log('\n=== テスト完了 ===');
        console.log('上記の確認3の結果が全て ✓ であれば、エンドポイント変更が可能です。');

    } catch (error) {
        console.error(`テストエラー: ${error.message}`);
        console.error(error.stack);
    }
}

/**
 * =============================================================================
 * Phase 1: 商品マスタAPI全件取得テスト
 * =============================================================================
 *
 * 【目的】
 * エンドポイント変更にあたり以下の3点を段階的に検証する
 *
 * 【実行順序】
 * Step 1: testPhase1_Step1() → フィルタ動作確認（1件取得）
 * Step 2: testPhase1_Step2() → ページネーション動作確認（2ページ分）
 * Step 3: testPhase1_Step3() → 全件取得して総件数を把握
 *
 * 【注意】
 * - 既存コードへの影響はありません（読み取りのみ）
 * - スプレッドシートへの書き込みは行いません
 * =============================================================================
 */

// ============================================================================
// Phase 1 共通設定
// ============================================================================

// xxxxxxを含む商品を除外するフィルタ値
// MySQLのLIKE演算子と同じ書式: % は任意の文字列にマッチする
const PHASE1_LOCATION_EXCLUDE = '%xxxxxx%';

// 取得するフィールド一覧（変更後のスプレッドシート列と対応）
// A列: goods_id          B列: goods_name
// C列: stock_quantity    D列: stock_allocation_quantity
// E列: stock_free_quantity
// F列: stock_advance_order_quantity
// G列: stock_advance_order_allocation_quantity
// H列: stock_advance_order_free_quantity
// I列: stock_defective_quantity
// J列: stock_remaining_order_quantity
// K列: stock_out_quantity
// L列: goods_jan_code
const PHASE1_FIELDS = [
    'goods_id',
    'goods_name',
    'goods_jan_code',
    'goods_location',                              // フィルタ結果の確認用（本番では不要）
    'stock_quantity',
    'stock_allocation_quantity',
    'stock_free_quantity',
    'stock_advance_order_quantity',
    'stock_advance_order_allocation_quantity',
    'stock_advance_order_free_quantity',
    'stock_defective_quantity',
    'stock_remaining_order_quantity',
    'stock_out_quantity'
].join(',');

/**
 * Phase 1 共通APIリクエスト関数
 *
 * @param {Object} tokens    - 認証トークン
 * @param {number} limit     - 取得件数
 * @param {number} offset    - 取得開始位置（0始まり）
 * @return {Object}          - APIレスポンスオブジェクト
 */
function phase1_fetchGoodsData_(tokens, limit, offset) {
    const url = `${NE_API_URL}/api_v1_master_goods/search`;

    const payload = {
        'access_token': tokens.accessToken,
        'refresh_token': tokens.refreshToken,
        'fields': PHASE1_FIELDS,
        'goods_location-nlikeornull': PHASE1_LOCATION_EXCLUDE,
        'limit': limit.toString(),
        'offset': offset.toString()
    };

    const options = {
        'method': 'POST',
        'headers': { 'Content-Type': 'application/x-www-form-urlencoded' },
        'payload': Object.keys(payload)
            .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(payload[key]))
            .join('&')
    };

    const startTime = new Date();
    const response = UrlFetchApp.fetch(url, options);
    const responseData = JSON.parse(response.getContentText());
    const duration = ((new Date() - startTime) / 1000).toFixed(2);

    return { responseData, duration };
}

// ============================================================================
// Step 1: フィルタ動作確認（1件取得）
// ============================================================================

/**
 * Phase1 Step1: フィルタ動作確認
 *
 * 【確認内容】
 * - goods_location-nlikeornull で xxxxxx を含む商品が除外されているか
 * - 空欄ロケーションの商品が含まれているか
 * - 全フィールドが正しく取得できているか
 *
 * 【まずこの関数から実行してください】
 */
function testPhase1_Step1() {
    console.log('=== Phase1 Step1: フィルタ動作確認 ===\n');

    try {
        const tokens = getStoredTokens();
        const { responseData, duration } = phase1_fetchGoodsData_(tokens, 1, 0);

        console.log(`処理時間: ${duration}秒`);
        console.log(`APIレスポンス: ${responseData.result}\n`);

        if (responseData.result !== 'success') {
            console.log('❌ APIエラー');
            console.log(`メッセージ: ${responseData.message || '不明'}`);
            return;
        }

        const data = responseData.data;

        if (!data || data.length === 0) {
            console.log('❌ データが0件でした');
            console.log('フィルタ条件が厳しすぎる可能性があります');
            return;
        }

        // フィールド取得確認
        const sample = data[0];
        console.log('【フィールド取得確認】');
        console.log(`  goods_id        : ${sample.goods_id !== undefined ? '✓' : '❌'} → ${sample.goods_id}`);
        console.log(`  goods_name      : ${sample.goods_name !== undefined ? '✓' : '❌'} → ${sample.goods_name}`);
        console.log(`  goods_jan_code  : ${sample.goods_jan_code !== undefined ? '✓' : '❌'} → ${sample.goods_jan_code}`);
        console.log(`  goods_location  : ${sample.goods_location !== undefined ? '✓' : '❌'} → "${sample.goods_location}"`);
        console.log(`  stock_quantity  : ${sample.stock_quantity !== undefined ? '✓' : '❌'} → ${sample.stock_quantity}`);

        // フィルタ確認
        console.log('\n【フィルタ確認】');
        const location = sample.goods_location || '';
        if (location.includes('xxxxxx')) {
            console.log('❌ xxxxxxを含む商品が取得されています（フィルタが機能していません）');
        } else {
            console.log(`✓ xxxxxxを含まない商品のみ取得されています`);
            console.log(`  ロケーション値: "${location}" ${location === '' ? '（空欄）' : ''}`);
        }

        console.log('\n✓ Step1 完了 → 問題なければ testPhase1_Step2() を実行してください');

    } catch (error) {
        console.error(`テストエラー: ${error.message}`);
    }
}

// ============================================================================
// Step 2: ページネーション動作確認（2ページ分）
// ============================================================================

/**
 * Phase1 Step2: ページネーション動作確認
 *
 * 【確認内容】
 * - offset=0 と offset=1000 で異なるデータが返ってくるか
 * - 返却件数が limit 未満になったタイミングが最終ページかどうか
 * - 重複データがないか（1ページ目の末尾と2ページ目の先頭を比較）
 *
 * 【Step1 完了後に実行してください】
 */
function testPhase1_Step2() {
    console.log('=== Phase1 Step2: ページネーション動作確認 ===\n');

    try {
        const tokens = getStoredTokens();
        const LIMIT = 1000;

        // 1ページ目
        console.log('--- 1ページ目 (offset=0) ---');
        const page1 = phase1_fetchGoodsData_(tokens, LIMIT, 0);

        if (page1.responseData.result !== 'success') {
            console.log(`❌ 1ページ目 APIエラー: ${page1.responseData.message}`);
            return;
        }

        const page1Data = page1.responseData.data || [];
        const page1Count = page1Data.length;
        console.log(`処理時間: ${page1.duration}秒`);
        console.log(`取得件数: ${page1Count}件`);
        console.log(`最終ページ判定: ${page1Count < LIMIT ? '✓ これが最終ページ' : '次のページあり'}`);

        // 1ページ目が既に最終ページの場合
        if (page1Count < LIMIT) {
            console.log(`\n総件数: ${page1Count}件（1ページで全件取得完了）`);
            console.log('\n✓ Step2 完了 → testPhase1_Step3() を実行してください');
            return;
        }

        // 2ページ目
        console.log('\n--- 2ページ目 (offset=1000) ---');
        Utilities.sleep(500); // API負荷分散
        const page2 = phase1_fetchGoodsData_(tokens, LIMIT, LIMIT);

        if (page2.responseData.result !== 'success') {
            console.log(`❌ 2ページ目 APIエラー: ${page2.responseData.message}`);
            return;
        }

        const page2Data = page2.responseData.data || [];
        const page2Count = page2Data.length;
        console.log(`処理時間: ${page2.duration}秒`);
        console.log(`取得件数: ${page2Count}件`);
        console.log(`最終ページ判定: ${page2Count < LIMIT ? '✓ これが最終ページ' : '次のページあり'}`);

        // 重複チェック（1ページ目末尾と2ページ目先頭の比較）
        console.log('\n【重複チェック】');
        const page1Last = page1Data[page1Data.length - 1].goods_id;
        const page2First = page2Data[0].goods_id;
        console.log(`1ページ目の末尾: ${page1Last}`);
        console.log(`2ページ目の先頭: ${page2First}`);
        console.log(page1Last !== page2First ? '✓ 重複なし' : '❌ 重複あり（ページネーションに問題あり）');

        // 2ページ目以降があるかの情報
        if (page2Count === LIMIT) {
            console.log('\n3ページ目以降が存在します → testPhase1_Step3() で全件数を確認してください');
        }

        console.log('\n✓ Step2 完了 → 問題なければ testPhase1_Step3() を実行してください');

    } catch (error) {
        console.error(`テストエラー: ${error.message}`);
    }
}

// ============================================================================
// Step 3: 全件取得して総件数を把握
// ============================================================================

/**
 * Phase1 Step3: 全件取得・総件数把握
 *
 * 【確認内容】
 * - 全ページを取得して総件数を確認
 * - 各ページの処理時間と合計処理時間を計測
 * - xxxxxxを含む商品が1件も含まれていないかを抽出確認
 *
 * 【Step2 完了後に実行してください】
 * 【注意】全件取得するため数秒かかります
 */
function testPhase1_Step3() {
    console.log('=== Phase1 Step3: 全件取得・総件数把握 ===\n');

    try {
        const tokens = getStoredTokens();
        const LIMIT = 1000;
        let offset = 0;
        let page = 1;
        let totalCount = 0;
        let hasNext = true;
        const allStartTime = new Date();

        // ページネーションループ
        // 返却件数が limit 未満になったら最終ページと判定して終了
        while (hasNext) {
            console.log(`--- ${page}ページ目 (offset=${offset}) ---`);

            const { responseData, duration } = phase1_fetchGoodsData_(tokens, LIMIT, offset);

            if (responseData.result !== 'success') {
                console.log(`❌ APIエラー: ${responseData.message}`);
                break;
            }

            const data = responseData.data || [];
            const count = data.length;
            totalCount += count;

            console.log(`処理時間: ${duration}秒 | 取得件数: ${count}件 | 累計: ${totalCount}件`);

            // xxxxxxフィルタ漏れチェック（各ページのサンプルを確認）
            const leaked = data.filter(item =>
                item.goods_location && item.goods_location.includes('xxxxxx')
            );
            if (leaked.length > 0) {
                console.log(`  ⚠️ xxxxxxを含む商品が${leaked.length}件混入: ${leaked.map(i => i.goods_id).join(', ')}`);
            }

            // 最終ページ判定
            if (count < LIMIT) {
                hasNext = false;
                console.log('  → 最終ページ');
            } else {
                offset += LIMIT;
                page++;

                // API負荷分散のため待機（現在の本番設定と同じ500ms）
                if (hasNext) Utilities.sleep(500);
            }
        }

        // 結果サマリー
        const totalDuration = ((new Date() - allStartTime) / 1000).toFixed(1);
        console.log('\n=== Phase1 Step3 結果サマリー ===');
        console.log(`総ページ数  : ${page}ページ`);
        console.log(`総件数      : ${totalCount}件`);
        console.log(`合計処理時間: ${totalDuration}秒`);
        console.log(`APIコール数 : ${page}回`);

        console.log('\n【Phase1 完了後の次のステップ】');
        console.log('上記の結果に問題がなければ Phase2 に進めます。');
        console.log('結果をお知らせください。');

    } catch (error) {
        console.error(`テストエラー: ${error.message}`);
    }
}

/**
 * Supabaseへの接続と設定値ロードテスト
 *
 * getSupabaseConfig() を呼び出し、URL と API キーが正常に取得できるか確認します。
 * セキュリティのため、APIキーは末尾の5文字のみを出力します。
 *
 * 【処理フロー】
 * 1. getSupabaseConfig() から設定情報を取得
 * 2. 取得した設定情報をログに出力
 */
function testSupabaseConnection() {
    console.log('=== Supabase 接続・設定確認テスト ===');
    try {
        const config = getSupabaseConfig();
        const maskedKey = config.key ? '...' + config.key.slice(-5) : '未設定';
        
        console.log(`✅ SUPABASE_URL: ${config.url}`);
        console.log(`✅ SUPABASE_KEY: 末尾5文字 = ${maskedKey}`);
        console.log('✓ 設定値の読み込みテストが正常に完了しました。');
    } catch (error) {
        console.error('❌ 設定取得エラー:', error.message);
    }
}

/**
 * Supabase RPC 呼び出しテスト (upsert_ne_inventory_data)
 *
 * ダミーの在庫データを作成し、callSupabaseRpc を用いて Supabase 側の
 * upsert_ne_inventory_data RPC関数を呼び出すテストを行います。
 *
 * 【処理フロー】
 * 1. 1件のテスト用ダミーデータを作成
 * 2. 引数オブジェクトを params = { "json_data": dummyData } の形式で構築
 * 3. callSupabaseRpc() を呼び出し、結果を検証
 * 4. 成功・失敗の結果をコンソールに出力
 */
function testSupabaseRpcCall() {
    console.log('=== Supabase RPC 呼び出しテスト ===');
    
    // テスト用ダミーデータ（1件）
    const dummyData = [
        {
            "商品コード": "TEST-ITEM-001",
            "商品名": "テスト商品（Supabase接続確認用）",
            "在庫数": 10,
            "引当数": 2,
            "フリー在庫数": 8,
            "予約在庫数": 0,
            "予約引当数": 0,
            "予約フリー在庫数": 0,
            "不良在庫数": 0,
            "発注残数": 0,
            "欠品数": 0,
            "JANコード": 1234567890123 // 数値型（BIGINT）で渡す
        }
    ];

    const params = { "json_data": dummyData };

    try {
        console.log('RPC 呼び出しを実行中...');
        const result = callSupabaseRpc('upsert_ne_inventory_data', params);
        
        console.log('\n=== テスト結果 ===');
        console.log(`ステータスコード: ${result.statusCode}`);
        console.log(`レスポンス内容  : ${result.body}`);
        console.log('✅ Supabase RPC 呼び出しテストに成功しました！');
        console.log('⚠️ 実行後に Supabase ダッシュボードで "NE_InventoryData" テーブルを確認し、');
        console.log('   "TEST-ITEM-001" が正しく書き込まれている（または更新されている）ことを確認してください。');
        
    } catch (error) {
        console.error('\n❌ テストエラー:', error.message);
        console.error('Supabase RPC 呼び出しテストに失敗しました。');
    }
}

/**
 * buildSupabasePayload() の変換ロジック単体テスト
 *
 * NE APIから3件の商品データを取得し、buildSupabasePayload() を使って
 * Supabase へのインポート用データ構造に正しく変換されるかを確認します。
 * キー名が日本語に変換されているか、型変換（JANコードが数値/null、その他が数値）が正しく行われているかを確認します。
 *
 * 【処理フロー】
 * 1. getStoredTokens() でトークンを取得
 * 2. fetchGoodsDataOnePage_(tokens, 3, 0) で NE API から商品データを3件取得
 * 3. 取得データを Map に格納
 * 4. buildSupabasePayload(goodsMap) を呼び出して変換
 * 5. 変換前後の値をコンソールに出力して目視確認できるようにする
 */
function testBuildSupabasePayload() {
    console.log('=== buildSupabasePayload テスト ===\n');

    try {
        const tokens = getStoredTokens();
        
        console.log('NE APIから3件取得中...');
        const { data, updatedTokens } = fetchGoodsDataOnePage_(tokens, 3, 0);

        // テスト中も最新のトークンを保持するように修正
        if (updatedTokens) {
            updateStoredTokens(updatedTokens.accessToken, updatedTokens.refreshToken);
        }

        if (!data || data.length === 0) {
            console.log('❌ NE APIからデータが取得できませんでした');
            return;
        }

        const testMap = new Map();
        data.forEach(item => testMap.set(item.goods_id, item));

        const payload = buildSupabasePayload(testMap);

        console.log(`取得件数: ${testMap.size}件\n`);

        payload.forEach((converted, index) => {
            const original = data[index];
            console.log(`--- [データ ${index + 1}] 商品コード: ${converted['商品コード']} ---`);
            console.log(`  変換前 (NE API形式):`);
            console.log(`    goods_id                  : ${original.goods_id} (型: ${typeof original.goods_id})`);
            console.log(`    goods_name                : ${original.goods_name} (型: ${typeof original.goods_name})`);
            console.log(`    goods_jan_code            : "${original.goods_jan_code}" (型: ${typeof original.goods_jan_code})`);
            console.log(`    stock_quantity            : "${original.stock_quantity}" (型: ${typeof original.stock_quantity})`);
            console.log(`    stock_allocation_quantity : "${original.stock_allocation_quantity}" (型: ${typeof original.stock_allocation_quantity})`);
            
            console.log(`  変換後 (Supabase形式):`);
            console.log(`    商品コード : ${converted['商品コード']} (型: ${typeof converted['商品コード']})`);
            console.log(`    商品名     : ${converted['商品名']} (型: ${typeof converted['商品名']})`);
            console.log(`    JANコード  : ${converted['JANコード']} (型: ${typeof converted['JANコード']})`);
            console.log(`    在庫数     : ${converted['在庫数']} (型: ${typeof converted['在庫数']})`);
            console.log(`    引当数     : ${converted['引当数']} (型: ${typeof converted['引当数']})`);
            console.log('');
        });

        console.log('✓ 変換テスト完了');

    } catch (error) {
        console.error(`テストエラー: ${error.message}`);
    }
}

/**
 * upsertInventoryToSupabase() の結合テスト
 *
 * NE APIから実際に先頭10件の商品データを取得し、upsertInventoryToSupabase() を実行します。
 * 送信が正常に完了することを確認します。
 *
 * 【処理フロー】
 * 1. getStoredTokens() でトークンを取得
 * 2. fetchGoodsDataOnePage_(tokens, 10, 0) で NE API から商品データを10件取得
 * 3. 取得データを Map に格納
 * 4. upsertInventoryToSupabase(testMap) を実行
 * 5. 実行結果（送信件数、チャンク数、成否）をコンソールに出力
 */
function testUpsertInventoryToSupabase() {
    console.log('=== Supabase upsert テスト（10件） ===\n');

    try {
        const tokens = getStoredTokens();

        // NE APIから10件取得
        console.log('NE APIから10件取得中...');
        const { data, updatedTokens } = fetchGoodsDataOnePage_(tokens, 10, 0);

        // テスト中も最新のトークンを保持するように修正（認証切れ防止）
        if (updatedTokens) {
            updateStoredTokens(updatedTokens.accessToken, updatedTokens.refreshToken);
        }

        if (!data || data.length === 0) {
            console.log('❌ NE APIからデータが取得できませんでした');
            return;
        }

        // テスト用Mapを構築
        const testMap = new Map();
        data.forEach(item => testMap.set(item.goods_id, item));
        console.log(`取得件数: ${testMap.size}件\n`);

        // Supabaseへ書き込み
        console.log('Supabaseへ書き込み中...');
        const result = upsertInventoryToSupabase(testMap);

        // 結果出力
        console.log('\n=== テスト結果 ===');
        console.log(`総レコード数 : ${result.totalRecords}件`);
        console.log(`チャンク数   : ${result.chunks}個`);
        console.log(`成功         : ${result.success ? '✓' : '✗'}`);

        console.log('\n【Supabaseダッシュボードで以下を確認してください】');
        console.log('Table Editor → NE_InventoryData');
        console.log('上記商品コードのデータが更新されているか確認してください。');

    } catch (error) {
        console.error(`テストエラー: ${error.message}`);
    }
}

/**
 * buildStockPayload() の変換ロジック単体テスト
 *
 * スプレッドシートの先頭3件の商品コードを使用して、在庫マスタAPIからデータを取得し、
 * buildStockPayload() によって在庫数値のみの日本語キーオブジェクトに変換できるかをテストします。
 * 商品名およびJANコードが含まれていないことを確認します。
 *
 * 【処理フロー】
 * 1. getSpreadsheetConfig() から設定情報を取得し、シートの A 列から先頭3件の商品コードを取得
 * 2. getStoredTokens() でトークンを取得
 * 3. getBatchInventoryDataWithRetry() で在庫マスタデータを取得
 * 4. buildStockPayload() を呼び出して変換
 * 5. 変換前後の値をコンソールに出力し、商品名・JANコードが含まれていないかを確認
 */
function testBuildStockPayload() {
    console.log('=== buildStockPayload テスト ===\n');

    try {
        // スプレッドシートから先頭3件の商品コードを取得
        const { SPREADSHEET_ID, SHEET_NAME } = getSpreadsheetConfig();
        const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
        const codes = sheet.getRange(2, 1, 3, 1).getValues()
            .map(r => r[0]).filter(c => c);

        const tokens = getStoredTokens();

        // 在庫マスタAPIから3件取得
        const inventoryDataMap = getBatchInventoryDataWithRetry(codes, tokens, 0);

        console.log(`取得件数: ${inventoryDataMap.size}件\n`);

        // 変換実行
        const payload = buildStockPayload(inventoryDataMap);

        // 結果確認
        console.log('【変換結果（先頭1件）】');
        if (payload.length > 0) {
            const sample = payload[0];
            console.log(`商品コード    : ${sample['商品コード']}`);
            console.log(`在庫数        : ${sample['在庫数']} (${typeof sample['在庫数']})`);
            console.log(`引当数        : ${sample['引当数']}`);
            console.log(`フリー在庫数  : ${sample['フリー在庫数']}`);
            console.log(`商品名        : ${sample['商品名'] !== undefined ? '❌ 含まれている（削除すること）' : '✓ 含まれていない'}`);
            console.log(`JANコード     : ${sample['JANコード'] !== undefined ? '❌ 含まれている（削除すること）' : '✓ 含まれていない'}`);
        }

        console.log('\n✓ buildStockPayload テスト完了');

    } catch (error) {
        console.error(`テストエラー: ${error.message}`);
    }
}

/**
 * upsertStockToSupabase() の結合テスト
 *
 * スプレッドシートから先頭10件の商品コードを取得し、在庫マスタAPIからデータを取得後、
 * upsertStockToSupabase() を実行します。
 * 送信結果（成功・失敗・件数）を確認します。
 *
 * 【処理フロー】
 * 1. getSpreadsheetConfig() で設定を取得し、シートの A 列から先頭10件の商品コードを取得
 * 2. getStoredTokens() でトークンを取得
 * 3. getBatchInventoryDataWithRetry() で在庫マスタデータを取得
 * 4. upsertStockToSupabase(inventoryDataMap) を呼び出して Supabase へ一括送信
 * 5. 送信件数および成否をコンソールに出力
 */
function testUpsertStockToSupabase() {
    console.log('=== Supabase 在庫マスタ upsert テスト（10件） ===\n');

    try {
        // スプレッドシートから先頭10件の商品コードを取得
        const { SPREADSHEET_ID, SHEET_NAME } = getSpreadsheetConfig();
        const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
        const lastRow = sheet.getLastRow();
        const codes = sheet.getRange(2, 1, Math.min(10, lastRow - 1), 1)
            .getValues().map(r => r[0]).filter(c => c).slice(0, 10);

        console.log(`テスト対象: ${codes.join(', ')}\n`);

        const tokens = getStoredTokens();

        // 在庫マスタAPIから取得
        console.log('在庫マスタAPIから取得中...');
        const inventoryDataMap = getBatchInventoryDataWithRetry(codes, tokens, 0);
        console.log(`取得件数: ${inventoryDataMap.size}件\n`);

        // Supabaseへ書き込み
        console.log('Supabaseへ書き込み中...');
        const result = upsertStockToSupabase(inventoryDataMap);

        // 結果出力
        console.log('\n=== テスト結果 ===');
        console.log(`レコード数  : ${result.records}件`);
        console.log(`成功        : ${result.success ? '✓' : '✗'}`);

        console.log('\n【Supabaseダッシュボードで以下を確認してください】');
        console.log('Table Editor → NE_InventoryData');
        console.log('上記商品コードの在庫数が更新されているか確認してください。');
        console.log('商品名・JANコードが変わっていないことも確認してください。');
        console.log('在庫数が変化していない商品は 更新日時 が変わっていないはずです。');

    } catch (error) {
        console.error(`テストエラー: ${error.message}`);
    }
}

/**
 * querySupabaseTable() の疎通およびGETクエリ基本テスト
 *
 * 直近1時間に更新されたデータを Supabase から GET リクエストで取得し、
 * 通信の成功成否および取得データの構造を確認します。
 *
 * 【処理フロー】
 * 1. 1時間前の日時を計算し、ISO 8601 形式の文字列を作成
 * 2. querySupabaseTable() を使用して 'NE_InventoryData' テーブルから該当レコードをクエリ
 * 3. ステータスコードが200であること、および返却データ形式が配列であることを検証
 * 4. 結果をコンソールにログ出力
 */
function testQuerySupabaseTable() {
    console.log('=== querySupabaseTable 疎通テスト ===\n');
    try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        console.log('検索条件: 更新日時 >= ' + oneHourAgo);

        const result = querySupabaseTable('NE_InventoryData', {
            '更新日時': 'gte.' + oneHourAgo,
            'limit': '5'
        });

        console.log('ステータスコード: ' + result.statusCode);
        console.log('成功フラグ      : ' + result.success);
        console.log('取得件数        : ' + result.data.length + '件');

        if (result.data.length > 0) {
            console.log('\n【サンプルデータ（先頭1件）】');
            console.log(JSON.stringify(result.data[0], null, 2));
        }

        console.log('\n✓ querySupabaseTable 疎通テスト完了');
    } catch (error) {
        console.error('❌ テストエラー: ' + error.message);
    }
}

/**
 * getChangedInventorySince() の差分取得テスト
 *
 * 過去の日時および未来の日時を指定して、差分抽出ロジックが
 * 期待通り機能するかを検証します。
 *
 * 【処理フロー】
 * 1. 過去（2時間前）の日時を基準として getChangedInventorySince() を実行
 *    - 取得件数と結果配列を出力
 * 2. 未来（1時間後）の日時を基準として getChangedInventorySince() を実行
 *    - 期待値：取得件数 0件
 * 3. 取得件数が0件であることを検証
 */
function testGetChangedInventorySince() {
    console.log('=== getChangedInventorySince 差分抽出テスト ===\n');
    try {
        // 1. 過去日時テスト
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        console.log('[テスト1] 過去（2時間前）からの差分取得を実行中...');
        const pastResult = getChangedInventorySince(twoHoursAgo);
        console.log('結果: ' + pastResult.length + '件取得');

        // 2. 未来日時テスト
        const oneHourHence = new Date(Date.now() + 60 * 60 * 1000);
        console.log('\n[テスト2] 未来（1時間後）からの差分取得を実行中...');
        const futureResult = getChangedInventorySince(oneHourHence);
        console.log('結果: ' + futureResult.length + '件取得');

        if (futureResult.length === 0) {
            console.log('✓ 期待通り未来日時の取得結果は0件でした。');
        } else {
            console.error('❌ エラー: 未来日時を指定したにもかかわらずデータが取得されました。');
        }

        console.log('\n✓ getChangedInventorySince 差分抽出テスト完了');
    } catch (error) {
        console.error('❌ テストエラー: ' + error.message);
    }
}

/**
 * loadLastExecutedAt/saveLastExecutedAt のタイムスタンプ管理テスト
 *
 * スクリプトプロパティを使用した日時の保存、取得、および
 * 保存値が存在しない場合のフォールバック処理を検証します。
 * テスト前後で既存のスクリプトプロパティの値を退避・復元します。
 *
 * 【処理フロー】
 * 1. 既存のスクリプトプロパティ 'SUPABASE_LAST_EXECUTED_AT' の値を退避
 * 2. 一旦プロパティを削除し、loadLastExecutedAt(3) が 3時間前の時刻を返すか（フォールバック）をテスト
 * 3. saveLastExecutedAt() を呼び出して現在時刻を保存
 * 4. 再度 loadLastExecutedAt() を呼び出し、保存された日時とミリ秒単位に近い値（またはパースして同等）であることを確認
 * 5. 退避していた元の値を復元してテストをクリーンアップ
 */
function testLastExecutedAtFlow() {
    console.log('=== タイムスタンプ管理（スクリプトプロパティ）テスト ===\n');
    const propKey = 'SUPABASE_LAST_EXECUTED_AT';
    const properties = PropertiesService.getScriptProperties();
    const originalVal = properties.getProperty(propKey);

    try {
        // 1. フォールバックのテスト
        console.log('[テスト1] 一時的にプロパティをクリアしてフォールバック動作を検証');
        properties.deleteProperty(propKey);

        const fallbackHours = 3;
        const fallbackTime = loadLastExecutedAt(fallbackHours);
        const now = Date.now();
        const expectedFallbackTime = now - fallbackHours * 60 * 60 * 1000;

        // 許容誤差を 5秒とする
        const diff = Math.abs(fallbackTime.getTime() - expectedFallbackTime);
        if (diff < 5000) {
            console.log('✓ フォールバック日時は期待値通り約 ' + fallbackHours + '時間前 です: ' + fallbackTime.toISOString());
        } else {
            console.error('❌ エラー: フォールバック日時が期待値からズレています。 差分: ' + diff + 'ms');
        }

        // 2. 保存と読み出しのテスト
        console.log('\n[テスト2] 日時の保存と読み出しを検証');
        const savedString = saveLastExecutedAt();
        const loadedDate = loadLastExecutedAt();

        console.log('保存値 (文字列): ' + savedString);
        console.log('読込値 (Date)  : ' + loadedDate.toISOString());

        if (loadedDate.toISOString() === savedString) {
            console.log('✓ 保存された日時の文字列と、読み出して再変換した文字列が完全に一致しました。');
        } else {
            console.error('❌ エラー: 保存した日時と読み出した日時が一致しません。');
        }

        console.log('\n✓ タイムスタンプ管理テスト完了');
    } catch (error) {
        console.error('❌ テストエラー: ' + error.message);
    } finally {
        // 3. 元の値を復元
        if (originalVal !== null) {
            properties.setProperty(propKey, originalVal);
            console.log('\n[クリーンアップ] 元のプロパティ値を復元しました: ' + originalVal);
        } else {
            properties.deleteProperty(propKey);
            console.log('\n[クリーンアップ] テスト前の空状態を復元しました');
        }
    }
}