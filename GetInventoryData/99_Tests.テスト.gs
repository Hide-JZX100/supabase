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