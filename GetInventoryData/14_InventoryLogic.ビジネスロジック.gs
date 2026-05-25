/**
 * バッチ単位で在庫情報を取得・整形
 * 
 * @param {Array} goodsCodeList - 商品コードリスト
 * @param {Object} tokens - 認証トークン
 * @param {number} batchNumber - バッチ番号
 * @return {Map} 在庫データマップ (key: 商品コード, value: InventoryDataオブジェクト)
 */
function getBatchInventoryDataWithRetry(goodsCodeList, tokens, batchNumber) {
    const inventoryDataMap = new Map();

    try {
        logWithLevel(LOG_LEVEL.DETAILED, `  在庫マスタ一括検索: ${goodsCodeList.length}件`);

        // 商品コードの大文字小文字表記ゆれを吸収するための変換マップを構築
        // NE APIは小文字で返却することがあるため toLowerCase() で統一して照合する
        // key: 小文字に変換した商品コード, value: 元の表記（スプレッドシート側）
        const codeMapping = new Map();
        for (const code of goodsCodeList) {
            codeMapping.set(code.toLowerCase(), code);
        }

        // ★★★ ここだけ変更: リトライ機能付き関数に置き換え ★★★
        const stockDataMap = getBatchStockDataWithRetry(goodsCodeList, tokens, batchNumber);

        logWithLevel(LOG_LEVEL.DETAILED, `  在庫マスタ取得完了: ${stockDataMap.size}件`);

        // 正常なAPIレスポンスでもデータが0件の場合は設定ミスや権限不足の可能性がある
        // エラーとして記録し、後続の調査に役立てる
        if (stockDataMap.size === 0) {
            logWithLevel(LOG_LEVEL.SUMMARY, '  在庫データが見つかりませんでした');

            logAPIErrorDetail(
                '在庫マスタAPI',
                {
                    goodsCodeCount: goodsCodeList.length,
                    firstCode: goodsCodeList[0],
                    lastCode: goodsCodeList[goodsCodeList.length - 1]
                },
                { message: 'データが1件も取得できませんでした' },
                new Error('API応答にデータが含まれていません')
            );

            // エラー時は例外をスローせず空のMapを返す
            // 呼び出し元（10_Main.gs）でバッチ単位のエラーとして処理を継続させるため
            return inventoryDataMap;
        }

        for (const [goodsCode, stockData] of stockDataMap) {
            // API返却コード（小文字）を元の表記に逆引きする
            // 一致しない場合は商品コードの表記ゆれ以外の問題（未登録など）の可能性がある
            const originalCode = codeMapping.get(goodsCode.toLowerCase());

            if (!originalCode) {
                logErrorDetail(goodsCode, 'コードマッピングエラー', '元のコードが見つかりません', {
                    'バッチ番号': batchNumber,
                    'API返却コード': goodsCode,
                    'マッピング数': codeMapping.size,
                    '要求コード数': goodsCodeList.length
                });
                continue;
            }

            // NE APIの数値フィールドは文字列で返却される場合があるため parseInt で変換
            // 値が取得できない・nullの場合は 0 をセットして以降の計算エラーを防ぐ
            const inventoryData = {
                goods_id: stockData.stock_goods_id,
                goods_name: '',
                stock_quantity: parseInt(stockData.stock_quantity) || 0,
                stock_allocated_quantity: parseInt(stockData.stock_allocation_quantity) || 0,
                stock_free_quantity: parseInt(stockData.stock_free_quantity) || 0,
                stock_defective_quantity: parseInt(stockData.stock_defective_quantity) || 0,
                stock_advance_order_quantity: parseInt(stockData.stock_advance_order_quantity) || 0,
                stock_advance_order_allocation_quantity: parseInt(stockData.stock_advance_order_allocation_quantity) || 0,
                stock_advance_order_free_quantity: parseInt(stockData.stock_advance_order_free_quantity) || 0,
                stock_remaining_order_quantity: parseInt(stockData.stock_remaining_order_quantity) || 0,
                stock_out_quantity: parseInt(stockData.stock_out_quantity) || 0
            };

            inventoryDataMap.set(originalCode, inventoryData);
        }

        logWithLevel(LOG_LEVEL.DETAILED, `  在庫情報構築完了: ${inventoryDataMap.size}件`);
        return inventoryDataMap;

    } catch (error) {
        logError(`在庫情報取得エラー: ${error.message}`);

        logAPIErrorDetail(
            '在庫情報構築処理',
            {
                goodsCodeCount: goodsCodeList.length,
                firstCode: goodsCodeList[0],
                lastCode: goodsCodeList[goodsCodeList.length - 1]
            },
            null,
            error
        );

        // エラー時は空または部分的なMapを返す（呼び出し元で処理続行可能にするため）
        return inventoryDataMap;
    }
}
