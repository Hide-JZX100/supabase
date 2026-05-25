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
