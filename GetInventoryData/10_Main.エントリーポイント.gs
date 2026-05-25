/**
 * @file 10_Main.gs
 * @description アプリケーションエントリーポイント。
 * 処理全体の起点として、各モジュールを呼び出しオーケストレーション（指揮）を行います。
 * ビジネスロジックやAPI通信の実装は各専用ファイルに委譲しています。
 *
 * ### 依存ファイルと役割分担
 * - 11_Config.gs: 設定値・定数・トークン取得
 * - 12_Logger.gs: ログ出力・リトライ統計管理
 * - 13_NextEngineAPI.gs: NE APIへのHTTPリクエスト
 * - 14_InventoryLogic.gs: 在庫データの取得・整形
 * - 15_SpreadsheetRepository.gs: スプレッドシートへの書き込み
 * - 17_SupabaseRepository.gs: Supabaseへのデータ書き込み（全件・差分）
 *
 * ### 処理フロー (updateInventoryDataFromGoodsMaster)
 * Step 1. リトライ統計リセット        (12_Logger.gs)
 * Step 2. スプレッドシート・シート取得 (11_Config.gs)
 * Step 3. 商品マスタAPIで全件取得      (13_NextEngineAPI.gs)
 * Step 4. データ整形                   (14_InventoryLogic.gs)
 * Step 5. シート全件書き直し           (15_SpreadsheetRepository.gs)
 * Step 5b. Supabaseへの全件書き込み    (17_SupabaseRepository.gs)
 * Step 6. 実行タイムスタンプ記録       (15_SpreadsheetRepository.gs)
 *
 * ### 処理フロー (updateInventoryDataBatchWithRetry)
 * 1. リトライ統計リセット (12_Logger.gs)
 * 2. スプレッドシート・シート取得 (11_Config.gs)
 * 3. 商品コードリスト構築 (本ファイル内ループ)
 * 4. バッチ分割ループ (在庫取得・更新・エラー収集)
 * 5. エラーログをシートに記録 (15_SpreadsheetRepository.gs)
 * 6. リトライ統計を表示・記録 (12_Logger.gs / 15_SpreadsheetRepository.gs)
 * 7. 実行タイムスタンプを記録 (15_SpreadsheetRepository.gs)
 *
 * ### トリガー設定
 * - トリガー設定スクリプト.gsの setTrigger() で時間ベーストリガーを管理
 * - プロパティ `TRIGGER_FUNCTION_NAME` に関数名を設定
 * - GASの6分制限に注意し、必要に応じて `MAX_ITEMS_PER_CALL` を調整
 *
 * 【スクリプトプロパティ（要設定）】
 *   SPREADSHEET_ID   : 対象スプレッドシートのID
 *   SHEET_NAME       : 在庫データシート名
 *   LOG_SHEET_NAME   : 実行タイムスタンプ記録先シート名
 *   ACCESS_TOKEN     : NE APIアクセストークン（認証.gsで取得）
 *   REFRESH_TOKEN    : NE APIリフレッシュトークン（認証.gsで取得）
 *
 * @see updateInventoryDataBatchWithRetry - 【メイン】トリガーに設定する関数
 * @see showUsageGuide                   - 使い方ガイドをコンソールに表示
 *
 * @version 3.0 (Supabase対応)
 */
/**
 * メイン処理関数の修正版（リトライ統計対応）
 * 
 * 【変更内容】
 * - リトライ統計のリセットと表示を追加
 * - getBatchInventoryData → getBatchInventoryDataWithRetry に変更
 * - リトライログをシートに記録
 */
function updateInventoryDataBatchWithRetry() {
    try {
        // リトライ統計をリセット
        resetRetryStats();

        const currentLogLevel = getCurrentLogLevel();

        logWithLevel(LOG_LEVEL.MINIMAL, '=== 在庫情報一括更新開始（リトライ対応版 v2.1） ===');
        const startTime = new Date();

        const { SPREADSHEET_ID, SHEET_NAME } = getSpreadsheetConfig();
        const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = spreadsheet.getSheetByName(SHEET_NAME);

        if (!sheet) {
            throw new Error(`シート "${SHEET_NAME}" が見つかりません`);
        }

        const lastRow = sheet.getLastRow();
        if (lastRow <= 1) {
            logWithLevel(LOG_LEVEL.MINIMAL, 'データが存在しません');
            return;
        }

        const dataRange = sheet.getRange(2, 1, lastRow - 1, 12);
        const values = dataRange.getValues();
        logWithLevel(LOG_LEVEL.MINIMAL, `処理対象: ${values.length}行`);

        const tokens = getStoredTokens();

        const goodsCodeList = [];

        // 商品コードをリスト化しつつ、後でシートの行番号を逆引きできるようMapに保持する
        // rowIndexMap: key=商品コード, value=スプレッドシートの実行番号（2始まり）
        const rowIndexMap = new Map();

        for (let i = 0; i < values.length; i++) {
            const goodsCode = values[i][COLUMNS.GOODS_CODE];
            if (goodsCode && goodsCode.toString().trim()) {
                goodsCodeList.push(goodsCode.toString().trim());
                rowIndexMap.set(goodsCode.toString().trim(), i + 2);
            }
        }

        logWithLevel(LOG_LEVEL.MINIMAL, `有効な商品コード: ${goodsCodeList.length}件`);

        if (goodsCodeList.length === 0) {
            logWithLevel(LOG_LEVEL.MINIMAL, '処理対象の商品コードがありません');
            return;
        }

        let totalUpdated = 0;
        let totalErrors = 0;
        const errorDetails = [];
        const batchCount = Math.ceil(goodsCodeList.length / MAX_ITEMS_PER_CALL);

        logWithLevel(LOG_LEVEL.SUMMARY, `バッチ数: ${batchCount}個（${MAX_ITEMS_PER_CALL}件/バッチ）`);
        logWithLevel(LOG_LEVEL.SUMMARY, `リトライ設定: 最大${RETRY_CONFIG.MAX_RETRIES}回（${RETRY_CONFIG.ENABLE_RETRY ? '有効' : '無効'}）`);

        for (let i = 0; i < goodsCodeList.length; i += MAX_ITEMS_PER_CALL) {
            const batch = goodsCodeList.slice(i, i + MAX_ITEMS_PER_CALL);
            const batchNumber = Math.floor(i / MAX_ITEMS_PER_CALL) + 1;

            logWithLevel(LOG_LEVEL.SUMMARY, `\n--- バッチ ${batchNumber}/${batchCount}: ${batch.length}件 ---`);

            const batchStartTime = new Date();
            const batchErrors = [];

            try {
                // ★★★ ここを変更: リトライ対応版の関数を使用 ★★★
                const inventoryDataMap = getBatchInventoryDataWithRetry(batch, tokens, batchNumber);

                const batchEndTime = new Date();
                const batchDuration = (batchEndTime - batchStartTime) / 1000;

                // バッチ単位で一括更新（既存コードをそのまま使用）
                const updateResult = updateBatchInventoryData(
                    sheet,
                    batch,
                    inventoryDataMap,
                    rowIndexMap
                );

                // Supabaseへの書き込み（バッチ単位）
                const supabaseResult = upsertStockToSupabase(inventoryDataMap);
                if (!supabaseResult.success) {
                    logWithLevel(LOG_LEVEL.MINIMAL,
                        `  Supabase書き込み失敗（バッチ${batchNumber}）: ${supabaseResult.records}件`);
                }

                const batchUpdated = updateResult.updated;
                const updateResults = updateResult.results;
                const batchErrorCount = updateResults.filter(r => r.status === 'error' || r.status === 'no_data').length;

                totalUpdated += batchUpdated;

                // エラー詳細を収集（既存コードと同じ）
                for (const result of updateResults) {
                    if (result.status === 'error') {
                        logErrorDetail(result.goodsCode, '更新エラー', result.error, {
                            'バッチ番号': batchNumber
                        });

                        const errorInfo = {
                            goodsCode: result.goodsCode,
                            errorType: '更新エラー',
                            errorMessage: result.error,
                            timestamp: new Date(),
                            batchNumber: batchNumber
                        };
                        errorDetails.push(errorInfo);
                        batchErrors.push(errorInfo);
                        totalErrors++;
                    } else if (result.status === 'no_data') {
                        logErrorDetail(result.goodsCode, 'データなし', 'inventory data not found', {
                            'バッチ番号': batchNumber
                        });

                        const errorInfo = {
                            goodsCode: result.goodsCode,
                            errorType: 'データなし',
                            errorMessage: 'inventory data not found',
                            timestamp: new Date(),
                            batchNumber: batchNumber
                        };
                        errorDetails.push(errorInfo);
                        batchErrors.push(errorInfo);
                    }
                }

                logWithLevel(LOG_LEVEL.SUMMARY, `処理時間: ${batchDuration.toFixed(1)}秒 | 成功: ${batchUpdated}件 | エラー: ${batchErrorCount}件`);

                if (batchErrors.length > 0) {
                    logBatchErrorSummary(batchNumber, batchErrors);
                }

                // ログ出力（既存コードと同じ - 省略）
                // ...

                // バッチ間のAPI負荷分散のため待機（API_WAIT_TIME ms、11_Config.gsで定義）
                // 連続リクエストによるレート制限エラーを防ぐ
                if (i + MAX_ITEMS_PER_CALL < goodsCodeList.length) {
                    logWithLevel(LOG_LEVEL.SUMMARY, `次のバッチまで ${API_WAIT_TIME}ms 待機...`);
                    Utilities.sleep(API_WAIT_TIME);
                }

            } catch (error) {
                logAPIErrorDetail(
                    '在庫マスタAPI（バッチ全体）',
                    {
                        goodsCodeCount: batch.length,
                        firstCode: batch[0],
                        lastCode: batch[batch.length - 1]
                    },
                    null,
                    error
                );

                batch.forEach(goodsCode => {
                    const errorInfo = {
                        goodsCode: goodsCode,
                        errorType: 'バッチエラー',
                        errorMessage: error.message,
                        timestamp: new Date(),
                        batchNumber: batchNumber
                    };
                    errorDetails.push(errorInfo);
                    batchErrors.push(errorInfo);
                });

                logError(`バッチ処理エラー: ${error.message}`);
                logBatchErrorSummary(batchNumber, batchErrors);
                totalErrors += batch.length;
            }
        }

        const endTime = new Date();
        const duration = (endTime - startTime) / 1000;

        if (errorDetails.length > 0) {
            logErrorsToSheet(errorDetails);
            logWithLevel(LOG_LEVEL.SUMMARY, `\nエラーレポートをシートに記録: ${errorDetails.length}件`);
        }

        // ★★★ リトライ統計を表示・記録 ★★★
        showRetryStats();
        logRetryStatsToSheet();

        logWithLevel(LOG_LEVEL.MINIMAL, '\n=== 一括更新完了 ===');
        logWithLevel(LOG_LEVEL.MINIMAL, `処理時間: ${duration.toFixed(1)}秒`);
        logWithLevel(LOG_LEVEL.MINIMAL, `更新成功: ${totalUpdated}件`);

        if (totalErrors > 0) {
            console.error(`❌ エラー: ${totalErrors}件 ← エラーログシートを確認してください`);
        } else {
            logWithLevel(LOG_LEVEL.MINIMAL, `✓ エラー: 0件`);
        }

        logWithLevel(LOG_LEVEL.MINIMAL, `処理速度: ${(goodsCodeList.length / duration).toFixed(1)}件/秒`);

        const conventionalTime = goodsCodeList.length * 2;
        const speedImprovement = conventionalTime / duration;
        logWithLevel(LOG_LEVEL.SUMMARY, `\n--- 性能改善結果 ---`);
        logWithLevel(LOG_LEVEL.SUMMARY, `従来版推定時間: ${conventionalTime.toFixed(1)}秒`);
        logWithLevel(LOG_LEVEL.SUMMARY, `高速化倍率: ${speedImprovement.toFixed(1)}倍`);

        recordExecutionTimestamp();

    } catch (error) {
        logError('一括更新エラー:', error.message);
        throw error;
    }
}

/**
 * 使い方ガイドを表示
 */
function showUsageGuide() {
    console.log(`
=============================================================================
在庫情報取得スクリプト - リファクタリング版 v2.0
=============================================================================
【機能概要】
Next Engine APIから商品在庫情報を一括取得し、スプレッドシートを更新します。
【主要機能】
1. 一括取得: ${MAX_ITEMS_PER_CALL}件ずつまとめてAPI取得し高速化
2. リトライ: APIエラー時に自動で再試行（最大${RETRY_CONFIG.MAX_RETRIES}回）
3. ログ管理: 実行結果やエラー詳細をコンソールとシートに記録
【使用方法】
1. 関数「updateInventoryDataBatchWithRetry」を実行してください。
2. これを時間主導型トリガーに設定することで定期実行できます。
=============================================================================
  `);
}

/**
 * =============================================================================
 * Phase 5: 新メイン処理関数
 * =============================================================================
 *
 * 【追加内容】
 * - updateInventoryDataFromGoodsMaster() : 新メイン処理関数
 *                                          商品マスタAPIで全件取得して
 *                                          スプレッドシートを全件書き直す
 * - testPhase5_IntegrationTest()         : テスト環境での統合テスト
 *
 * 【既存コードへの影響】
 * 追記のみのため既存関数への影響はありません
 *
 * 【旧メイン処理との違い】
 * ┌────────────────────────┬──────────────────────────────┐
 * │ 旧: updateInventory    │ 新: updateInventoryData      │
 * │     DataBatchWithRetry │     FromGoodsMaster          │
 * ├────────────────────────┼──────────────────────────────┤
 * │ A列の商品コードを読む  │ APIから全件取得              │
 * │ 在庫マスタAPIを呼ぶ    │ 商品マスタAPIを呼ぶ          │
 * │ C〜K列のみ更新         │ A〜L列を全件書き直し         │
 * │ 手動ダウンロード必要   │ 手動ダウンロード不要         │
 * └────────────────────────┴──────────────────────────────┘
 *
 * 【トリガー切り替え手順】
 * 統合テスト完了後、スクリプトプロパティを以下の通り変更する
 * TRIGGER_FUNCTION_NAME:
 *   updateInventoryDataBatchWithRetry → updateInventoryDataFromGoodsMaster
 * =============================================================================
 */

/**
 * 新メイン処理関数
 * 商品マスタAPIで全件取得してスプレッドシートを全件書き直す
 *
 * 【処理フロー】
 * Step 1. リトライ統計リセット        (12_Logger.gs)
 * Step 2. スプレッドシート・シート取得 (11_Config.gs)
 * Step 3. 商品マスタAPIで全件取得      (13_NextEngineAPI.gs)
 * Step 4. データ整形                   (14_InventoryLogic.gs)
 * Step 5. シート全件書き直し           (15_SpreadsheetRepository.gs)
 * Step 5b. Supabaseへの全件書き込み   (17_SupabaseRepository.gs)
 * Step 6. 実行タイムスタンプ記録       (15_SpreadsheetRepository.gs)
 *
 * 【トリガー設定】
 * スクリプトプロパティ TRIGGER_FUNCTION_NAME に
 * 「updateInventoryDataFromGoodsMaster」を設定してください
 */
function updateInventoryDataFromGoodsMaster() {
    try {
        // Step 1: リトライ統計リセット
        resetRetryStats();

        logWithLevel(LOG_LEVEL.MINIMAL, '=== 在庫情報全件更新開始（商品マスタAPI版） ===');
        const startTime = new Date();

        // Step 2: スプレッドシート・シート取得
        const { SPREADSHEET_ID, SHEET_NAME } = getSpreadsheetConfig();
        const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
        const sheet = spreadsheet.getSheetByName(SHEET_NAME);

        if (!sheet) {
            throw new Error(`シート "${SHEET_NAME}" が見つかりません`);
        }

        const tokens = getStoredTokens();

        // Step 3: 商品マスタAPIで全件取得（ページネーション対応）
        logWithLevel(LOG_LEVEL.MINIMAL, '商品マスタAPIから全件取得中...');
        const goodsMap = fetchAllGoodsData(tokens);

        if (goodsMap.size === 0) {
            throw new Error('商品マスタAPIから取得したデータが0件でした');
        }

        logWithLevel(LOG_LEVEL.MINIMAL, `取得完了: ${goodsMap.size}件`);

        // Step 4: データ整形
        const rows = buildInventoryDataRows(goodsMap);

        // Step 5: シート全件書き直し
        logWithLevel(LOG_LEVEL.MINIMAL, 'スプレッドシートへの書き込み中...');
        const writeResult = writeAllInventoryData(sheet, rows);

        // Step 5b: Supabaseへの書き込み
        logWithLevel(LOG_LEVEL.MINIMAL, 'Supabaseへの書き込み中...');
        const supabaseResult = upsertInventoryToSupabase(goodsMap);
        logWithLevel(LOG_LEVEL.MINIMAL, `Supabase書き込み完了: ${supabaseResult.totalRecords}件`);

        // Step 6: 実行タイムスタンプ記録
        recordExecutionTimestamp();

        // Step 7: 翌日分のトリガーを自動登録（自己スケジューリング）
        setTriggerForGoodsMaster();
        logWithLevel(LOG_LEVEL.MINIMAL, '翌日分トリガー登録完了');

        // 完了ログ
        const duration = ((new Date() - startTime) / 1000).toFixed(1);
        logWithLevel(LOG_LEVEL.MINIMAL, '\n=== 全件更新完了 ===');
        logWithLevel(LOG_LEVEL.MINIMAL, `処理時間  : ${duration}秒`);
        logWithLevel(LOG_LEVEL.MINIMAL, `取得件数  : ${goodsMap.size}件`);
        logWithLevel(LOG_LEVEL.MINIMAL, `書込件数  : ${writeResult.dataRows}行`);
        logWithLevel(LOG_LEVEL.MINIMAL, `Supabase  : ${supabaseResult.totalRecords}件（${supabaseResult.chunks}チャンク）`);
        logWithLevel(LOG_LEVEL.MINIMAL, `処理速度  : ${(goodsMap.size / duration).toFixed(1)}件/秒`);

    } catch (error) {
        logError('全件更新エラー:', error.message);
        throw error;
    }
}

// ----------------------------------------------------------------------------
// 統合テスト関数
// ----------------------------------------------------------------------------

/**
 * Phase 5 統合テスト
 *
 * 【確認内容】
 * 1. Step 3〜5 の一連の流れが正常に動作するか
 * 2. テスト用スプレッドシートに正しく書き込まれるか
 * 3. 処理時間が許容範囲内か（GAS 6分制限に対して余裕があるか）
 *
 * 【注意】
 * - TEST_SPREADSHEET_ID に設定したテスト用スプレッドシートに書き込みます
 * - 本番スプレッドシートへの書き込みは行いません
 * - Phase 4 で設定済みの TEST_SPREADSHEET_ID をそのまま使用します
 *
 * 【本番切り替え手順】
 * このテストが正常完了したら以下を実施してください
 * 1. スクリプトプロパティ TRIGGER_FUNCTION_NAME を変更
 *    変更前: updateInventoryDataBatchWithRetry
 *    変更後: updateInventoryDataFromGoodsMaster
 * 2. setTrigger() を実行してトリガーを再設定
 */
function testPhase5_IntegrationTest() {
    console.log('=== Phase 5 統合テスト ===\n');

    try {
        // テスト用スプレッドシートIDの確認
        const properties = PropertiesService.getScriptProperties();
        const testSheetId = properties.getProperty('TEST_SPREADSHEET_ID');

        if (!testSheetId) {
            console.log('❌ TEST_SPREADSHEET_ID が設定されていません');
            return;
        }

        const testSpreadsheet = SpreadsheetApp.openById(testSheetId);
        const { SHEET_NAME } = getSpreadsheetConfig();
        const testSheet = testSpreadsheet.getSheetByName(SHEET_NAME);

        if (!testSheet) {
            console.log(`❌ テスト用シート "${SHEET_NAME}" が見つかりません`);
            return;
        }

        console.log(`テスト用スプレッドシート: ${testSpreadsheet.getName()}`);
        console.log(`テスト用シート          : ${SHEET_NAME}\n`);

        const tokens = getStoredTokens();
        const startTime = new Date();

        // Step 3: 全件取得
        console.log('--- Step 3: 商品マスタAPI全件取得 ---');
        const goodsMap = fetchAllGoodsData(tokens);
        console.log(`取得件数: ${goodsMap.size}件\n`);

        // Step 4: データ整形
        console.log('--- Step 4: データ整形 ---');
        const rows = buildInventoryDataRows(goodsMap);
        console.log(`整形完了: ${rows.length}行\n`);

        // Step 5: テスト用シートに書き込み
        console.log('--- Step 5: テスト用シートへの書き込み ---');
        const writeResult = writeAllInventoryData(testSheet, rows);

        // Step 5b: Supabaseへの書き込み
        console.log('--- Step 5b: Supabaseへの書き込み ---');
        const supabaseResult = upsertInventoryToSupabase(goodsMap);

        // 処理時間
        const duration = ((new Date() - startTime) / 1000).toFixed(1);

        // 結果確認
        console.log('\n=== 統合テスト結果 ===');
        console.log(`処理時間    : ${duration}秒`);
        console.log(`取得件数    : ${goodsMap.size}件`);
        console.log(`書込行数    : ${writeResult.dataRows}行`);
        console.log(`Supabase    : ${supabaseResult.totalRecords}件（${supabaseResult.chunks}チャンク）`);
        console.log(`GAS制限余裕 : ${360 - duration}秒（6分制限に対して）`);

        // ヘッダー確認
        const writtenHeaders = testSheet.getRange(1, 1, 1, 12).getValues()[0];
        const headerOk = INVENTORY_SHEET_HEADERS.every(
            (h, i) => h === writtenHeaders[i]
        );
        console.log(`ヘッダー    : ${headerOk ? '✓ 正常' : '❌ 異常'}`);

        // データ確認（先頭・末尾3件）
        const firstRows = testSheet.getRange(2, 1, 3, 12).getValues();
        const lastRows = testSheet.getRange(
            writeResult.dataRows - 1, 1, 3, 12
        ).getValues();

        console.log('\n【先頭3件】');
        firstRows.forEach((row, i) => {
            console.log(`  [${i + 1}] ${row[0]} | ${row[1]} | 在庫:${row[2]} | JAN:${row[11]}`);
        });

        console.log('\n【末尾3件】');
        lastRows.forEach((row, i) => {
            console.log(`  [${i + 1}] ${row[0]} | ${row[1]} | 在庫:${row[2]} | JAN:${row[11]}`);
        });

        console.log('\n=== 統合テスト完了 ===');
        console.log('問題がなければ以下の手順で本番切り替えを実施してください');
        console.log('');
        console.log('1. スクリプトプロパティ TRIGGER_FUNCTION_NAME を変更');
        console.log('   変更前: updateInventoryDataBatchWithRetry');
        console.log('   変更後: updateInventoryDataFromGoodsMaster');
        console.log('');
        console.log('2. setTrigger() を実行してトリガーを再設定');

    } catch (error) {
        console.error(`統合テストエラー: ${error.message}`);
        console.error(error.stack);
    }
}