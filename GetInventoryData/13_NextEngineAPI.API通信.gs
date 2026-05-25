/**
 * 在庫マスタデータ取得（API呼び出し）
 * @param {Array} goodsCodeList - 商品コードリスト
 * @param {Object} tokens - 認証トークン
 * @param {number} batchNumber - バッチ番号(ログ用)
 * @return {Map} 在庫データマップ (key: stock_goods_id, value: stockData)
 */
function getBatchStockData(goodsCodeList, tokens, batchNumber) {
    const url = `${NE_API_URL}/api_v1_master_stock/search`;

    // NE APIの複数検索パラメータ: カンマ区切りで最大1000件指定可能
    // 例: "CODE001,CODE002,CODE003"
    const goodsIdCondition = goodsCodeList.join(',');

    const payload = {
        'access_token': tokens.accessToken,
        'refresh_token': tokens.refreshToken,
        'stock_goods_id-in': goodsIdCondition,
        'fields': 'stock_goods_id,stock_quantity,stock_allocation_quantity,stock_defective_quantity,stock_remaining_order_quantity,stock_out_quantity,stock_free_quantity,stock_advance_order_quantity,stock_advance_order_allocation_quantity,stock_advance_order_free_quantity',
        'limit': MAX_ITEMS_PER_CALL.toString()
    };

    const options = {
        'method': 'POST',
        'headers': {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        'payload': Object.keys(payload).map(key =>
            encodeURIComponent(key) + '=' + encodeURIComponent(payload[key])
        ).join('&')
    };

    const stockDataMap = new Map();

    try {
        const response = UrlFetchApp.fetch(url, options);
        const responseText = response.getContentText();
        const responseData = JSON.parse(responseText);

        // NE APIはリクエストのたびにトークンを更新して返す仕様
        // 変更がある場合のみプロパティを更新する（updateStoredTokensで差分チェック済み）
        if (responseData.access_token && responseData.refresh_token) {
            updateStoredTokens(responseData.access_token, responseData.refresh_token);
            tokens.accessToken = responseData.access_token;
            tokens.refreshToken = responseData.refresh_token;
        }

        if (responseData.result === 'success' && responseData.data) {
            responseData.data.forEach(stockData => {
                stockDataMap.set(stockData.stock_goods_id, stockData);
            });
            logWithLevel(LOG_LEVEL.DETAILED, `  API応答: ${responseData.data.length}件取得`);
        } else {
            logAPIErrorDetail(
                '在庫マスタAPI',
                {
                    goodsCodeCount: goodsCodeList.length,
                    firstCode: goodsCodeList[0],
                    lastCode: goodsCodeList[goodsCodeList.length - 1]
                },
                responseData,
                new Error(responseData.message || 'API呼び出しに失敗しました')
            );

            logError(`  在庫マスタAPI エラー: ${responseData.message || 'Unknown error'}`);
        }

        return stockDataMap;

    } catch (error) {
        logAPIErrorDetail(
            '在庫マスタAPI（通信エラー）',
            {
                goodsCodeCount: goodsCodeList.length,
                firstCode: goodsCodeList[0],
                lastCode: goodsCodeList[goodsCodeList.length - 1]
            },
            null,
            error
        );

        logError(`在庫マスタ一括取得エラー: ${error.message}`);
        return stockDataMap;
    }
}

/**
 * トークン更新処理（最適化版）
 * - 変更がある場合のみ更新
 * - 更新日時も記録
 */
function updateStoredTokens(accessToken, refreshToken) {
    const properties = PropertiesService.getScriptProperties();
    const currentAccess = properties.getProperty('ACCESS_TOKEN');
    const currentRefresh = properties.getProperty('REFRESH_TOKEN');

    // 値が変わっていない場合は書き込みをスキップ
    // PropertiesServiceへの書き込みはAPIクォータを消費するため無駄な更新を避ける
    if (accessToken !== currentAccess || refreshToken !== currentRefresh) {
        properties.setProperties({
            'ACCESS_TOKEN': accessToken,
            'REFRESH_TOKEN': refreshToken,
            'TOKEN_UPDATED_AT': new Date().getTime().toString() // 追跡用に更新日時も保存
        });

        // Logger.gsの関数を使用
        logWithLevel(LOG_LEVEL.DETAILED, '  認証トークンを更新しました');
    }
}

// ============================================================================
// リトライ機能付きラッパー
// ============================================================================

/**
 * リトライ処理付き在庫マスタデータ取得
 * 
 * 【変更内容】
 * - 既存のgetBatchStockData関数をラップ
 * - エクスポネンシャルバックオフでリトライ
 * - リトライ統計を記録
 * 
 * @param {Array} goodsCodeList - 商品コードリスト
 * @param {Object} tokens - 認証トークン
 * @param {number} batchNumber - バッチ番号
 * @param {number} maxRetries - 最大リトライ回数
 * @return {Map} 在庫データマップ
 */
function getBatchStockDataWithRetry(goodsCodeList, tokens, batchNumber, maxRetries = RETRY_CONFIG.MAX_RETRIES) {
    // リトライ機能が無効の場合は既存関数をそのまま呼び出し
    if (!RETRY_CONFIG.ENABLE_RETRY) {
        return getBatchStockData(goodsCodeList, tokens, batchNumber);
    }

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // ★★★ 修正: 2回目以降のみrecordする ★★★
            if (attempt > 1) {
                recordRetryAttempt(batchNumber, attempt);
                logWithLevel(LOG_LEVEL.SUMMARY, `  リトライ ${attempt}/${maxRetries}回目...`);
            }

            const stockDataMap = getBatchStockData(goodsCodeList, tokens, batchNumber);

            if (attempt > 1) {
                logWithLevel(LOG_LEVEL.SUMMARY, `  ✓ リトライ成功（${attempt}回目の試行で成功）`);
            }

            return stockDataMap;

        } catch (error) {
            lastError = error;

            // エラーの種類を判定してリトライすべきか判断
            const errorMessage = error.message.toLowerCase();

            // 認証・権限系エラーはリトライしても解決しないため即座にスロー
            // 対象キーワード: 認証, auth, permission, 権限, invalid, token
            if (
                errorMessage.includes('認証') ||
                errorMessage.includes('auth') ||
                errorMessage.includes('permission') ||
                errorMessage.includes('権限') ||
                errorMessage.includes('invalid') ||
                errorMessage.includes('token')
            ) {
                logError(`  即座に失敗: リトライ不可能なエラー - ${error.message}`);
                throw error; // リトライせずに即座にスロー
            }

            logError(`  ✗ API接続エラー（試行 ${attempt}/${maxRetries}）: ${error.message}`);

            // 最後の試行でなければ、待機してからリトライ
            if (attempt < maxRetries) {
                // エクスポネンシャルバックオフ（指数バックオフ）
                // 待機時間: 2^(attempt-1) 秒
                // attempt=1失敗後 → 1秒, attempt=2失敗後 → 2秒, attempt=3失敗後 → 4秒
                const waitSeconds = Math.pow(2, attempt - 1);
                logWithLevel(LOG_LEVEL.SUMMARY, `  → ${waitSeconds}秒後にリトライします...`);
                Utilities.sleep(waitSeconds * 1000);
            }
        }
    }

    // すべてのリトライが失敗した場合
    const errorMessage = `API接続失敗（${maxRetries}回試行）: ${lastError.message}`;
    logError(`  ✗✗✗ ${errorMessage}`);

    // 詳細なエラー情報を記録
    logAPIErrorDetail(
        '在庫マスタAPI（リトライ失敗）',
        {
            goodsCodeCount: goodsCodeList.length,
            firstCode: goodsCodeList[0],
            lastCode: goodsCodeList[goodsCodeList.length - 1],
            totalAttempts: maxRetries
        },
        null,
        lastError
    );

    throw new Error(errorMessage);
}
