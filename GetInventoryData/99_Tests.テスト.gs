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
