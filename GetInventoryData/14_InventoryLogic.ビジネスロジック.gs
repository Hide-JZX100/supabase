/**
 * @file 14_InventoryLogic.gs
 * @description 在庫データ取得・整形（ビジネスロジック）モジュール。
 * API通信層（13_NextEngineAPI.gs）とデータ永続化層（15_SpreadsheetRepository.gs）の橋渡しを担います。
 * APIから返却された生データをスプレッドシートへの書き込みに適した構造に変換・整形します。
 *
 * ### 依存関係
 * - **参照元**: 10_Main.gs（メイン処理から getBatchInventoryDataWithRetry を呼び出し）
 * - **参照先**:
 *   - 11_Config.gs: LOG_LEVEL 定数
 *   - 12_Logger.gs: logWithLevel, logError, logErrorDetail, logAPIErrorDetail
 *   - 13_NextEngineAPI.gs: getBatchStockDataWithRetry
 *
 * ### 処理フロー (getBatchInventoryDataWithRetry)
 * 1. 商品コードの大文字小文字正規化マップを構築 (codeMapping)
 * 2. API呼び出し（13_NextEngineAPI.gs に委譲）
 * 3. API返却コードを元の商品コードに逆引き (codeMapping経由)
 * 4. 生データを `inventoryData` オブジェクトに整形
 * 5. 整形済みデータを Map で返却
 *
 * ### 大文字小文字の正規化について
 * NE APIは商品コードを小文字で返却する場合があるため、`toLowerCase()` で統一して照合します。
 * 元の表記は `codeMapping` で保持し、整形後の Map のキーには元の表記を使用します。
 *
 * ### 返却データ構造 (InventoryData オブジェクト)
 * - `goods_id`: 商品コード
 * - `stock_quantity`: 在庫数
 * - `stock_allocated_quantity`: 引当数
 * - `stock_free_quantity`: フリー在庫数
 * - `stock_advance_order_quantity`: 予約在庫数
 * - ...（詳細は各関数の @return 参照）
 *
 * @version 2.1
 * @see getBatchInventoryDataWithRetry
 * @see buildInventoryDataRows
 */
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

/**
 * =============================================================================
 * Phase 3: 商品マスタAPIデータ整形関数
 * =============================================================================
 *
 * 【追加内容】
 * - buildInventoryDataRows() : fetchAllGoodsData() の返却値を
 *                              スプレッドシート書き込み用の2次元配列に整形する
 *
 * 【既存コードへの影響】
 * 追記のみのため既存関数への影響はありません
 *
 * 【返却データのイメージ】
 * [
 *   ['商品コード', '商品名', 在庫数, 引当数, フリー在庫数, ...., 'JANコード'],
 *   ['商品コード', '商品名', 在庫数, 引当数, フリー在庫数, ...., 'JANコード'],
 *   ...
 * ]
 *
 * 【列順序（11_Config.gs の COLUMNS 定義と対応）】
 * A列(0): goods_id                              商品コード
 * B列(1): goods_name                            商品名
 * C列(2): stock_quantity                        在庫数
 * D列(3): stock_allocation_quantity             引当数
 * E列(4): stock_free_quantity                   フリー在庫数
 * F列(5): stock_advance_order_quantity          予約在庫数
 * G列(6): stock_advance_order_allocation_quantity 予約引当数
 * H列(7): stock_advance_order_free_quantity     予約フリー在庫数
 * I列(8): stock_defective_quantity              不良在庫数
 * J列(9): stock_remaining_order_quantity        発注残数
 * K列(10): stock_out_quantity                   欠品数
 * L列(11): goods_jan_code                       JANコード
 * =============================================================================
 */

/**
 * 商品マスタAPIの返却データをシート書き込み用の2次元配列に整形
 *
 * 【処理フロー】
 * 1. fetchAllGoodsData() で取得した Map を受け取る
 * 2. 数値フィールドを parseInt() で変換（APIは文字列で返す場合がある）
 * 3. 列順序を COLUMNS 定義に合わせて2次元配列に変換して返す
 *
 * 【数値変換について】
 * NE APIの数値フィールドは文字列で返却される場合があるため parseInt で変換する
 * 値が取得できない・null の場合は 0 をセットしてシート書き込みエラーを防ぐ
 *
 * @param  {Map} goodsMap - fetchAllGoodsData() の返却値
 *                          key: goods_id, value: 商品データオブジェクト
 * @return {Array}        - シート書き込み用2次元配列
 *                          行数 = goodsMap.size、列数 = 12（A〜L列）
 */
function buildInventoryDataRows(goodsMap) {
    logWithLevel(LOG_LEVEL.SUMMARY, `データ整形開始: ${goodsMap.size}件`);

    const rows = [];

    for (const [goodsId, item] of goodsMap) {
        rows.push([
            item.goods_id || '',                                          // A列: 商品コード
            item.goods_name || '',                                          // B列: 商品名
            parseInt(item.stock_quantity) || 0, // C列: 在庫数
            parseInt(item.stock_allocation_quantity) || 0, // D列: 引当数
            parseInt(item.stock_free_quantity) || 0, // E列: フリー在庫数
            parseInt(item.stock_advance_order_quantity) || 0, // F列: 予約在庫数
            parseInt(item.stock_advance_order_allocation_quantity) || 0, // G列: 予約引当数
            parseInt(item.stock_advance_order_free_quantity) || 0, // H列: 予約フリー在庫数
            parseInt(item.stock_defective_quantity) || 0, // I列: 不良在庫数
            parseInt(item.stock_remaining_order_quantity) || 0, // J列: 発注残数
            parseInt(item.stock_out_quantity) || 0, // K列: 欠品数
            item.goods_jan_code || ''                                        // L列: JANコード
        ]);
    }

    logWithLevel(LOG_LEVEL.SUMMARY, `データ整形完了: ${rows.length}行`);
    return rows;
}