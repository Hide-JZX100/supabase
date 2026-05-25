/**
 * @file 12_Logger.gs
 * @description ログ管理・出力モジュール。
 * システム全体のログ出力とリトライ統計を一元管理します。
 * すべてのログ出力はこのファイルの関数を経由することで、ログレベルによる出力制御を統一的に行います。
 *
 * ### 依存関係
 * #### 参照元（このファイルを呼び出すファイル）
 * - 10_Main.gs: メイン処理でのログ・統計管理
 * - 13_NextEngineAPI.gs: APIエラー時の詳細ログ出力
 * - 14_InventoryLogic.gs: 在庫取得処理内のログ出力
 * - 15_SpreadsheetRepository.gs: リトライ統計のシート書き込み
 *
 * #### 参照先（このファイルが使う定数）
 * - 11_Config.gs: LOG_LEVEL, RETRY_CONFIG 定数
 *
 * ### ログレベル設定
 * 1. LOG_LEVEL.MINIMAL (1): 開始・終了・サマリーのみ（本番推奨）
 * 2. LOG_LEVEL.SUMMARY (2): バッチ集計＋最初/最後3件（デフォルト）
 * 3. LOG_LEVEL.DETAILED (3): 全商品コード出力（デバッグ用）
 *
 * ### グローバル変数
 * - `retryStats`: リトライ統計オブジェクト。
 *   実行ごとに `resetRetryStats()` でリセットが必要です。
 *   `15_SpreadsheetRepository.gs` からも参照されます。
 *
 * @version 2.1
 * @see getCurrentLogLevel
 * @see setLogLevel
 * @see showCurrentLogLevel
 * @see logWithLevel
 * @see logError
 * @see logErrorDetail
 * @see logAPIErrorDetail
 * @see logBatchErrorSummary
 * @see resetRetryStats
 * @see recordRetryAttempt
 * @see showRetryStats
 */
/**
 * 現在のログレベルを取得
 */
function getCurrentLogLevel() {
    const properties = PropertiesService.getScriptProperties();
    const logLevel = properties.getProperty('LOG_LEVEL');

    if (!logLevel) {
        // 未設定の場合はSUMMARY(2)をデフォルトとしてプロパティに書き込む
        properties.setProperty('LOG_LEVEL', '2');
        return LOG_LEVEL.SUMMARY;
    }

    return parseInt(logLevel);
}

/**
 * 現在のログレベル設定を表示
 */
function setLogLevel(level) {
    if (![1, 2, 3].includes(level)) {
        throw new Error('ログレベルは1(MINIMAL)、2(SUMMARY)、3(DETAILED)のいずれかを指定してください');
    }

    const properties = PropertiesService.getScriptProperties();
    properties.setProperty('LOG_LEVEL', level.toString());

    const levelName = Object.keys(LOG_LEVEL).find(key => LOG_LEVEL[key] === level);
    console.log(`ログレベルを ${levelName}(${level}) に設定しました`);
}

/**
 * 現在のログレベル設定を表示
 */
function showCurrentLogLevel() {
    const currentLevel = getCurrentLogLevel();
    const levelName = Object.keys(LOG_LEVEL).find(key => LOG_LEVEL[key] === currentLevel);

    console.log('=== 現在のログレベル設定 ===');
    console.log(`レベル: ${levelName} (${currentLevel})`);
    console.log('');
    console.log('【ログレベルの説明】');
    console.log('1. MINIMAL  : 開始/終了/サマリーのみ（本番運用推奨、最速）');
    console.log('2. SUMMARY  : バッチ集計 + 最初/最後3件（デフォルト）');
    console.log('3. DETAILED : 全商品コード出力（デバッグ用）');
    console.log('');
    console.log('【変更方法】');
    console.log('setLogLevel(1) // MINIMALに変更');
    console.log('setLogLevel(2) // SUMMARYに変更');
    console.log('setLogLevel(3) // DETAILEDに変更');
}

// ============================================================================
// ログ出力関数
// ============================================================================

/**
 * レベル指定付きログ出力
 */
function logWithLevel(requiredLevel, message, ...args) {
    const currentLevel = getCurrentLogLevel();

    if (currentLevel >= requiredLevel) {
        if (args.length > 0) {
            console.log(message, ...args);
        } else {
            console.log(message);
        }
    }
}

/**
 * エラーログ出力（標準）
 */
function logError(message, ...args) {
    if (args.length > 0) {
        console.error(message, ...args);
    } else {
        console.error(message);
    }
}

/**
 * 詳細エラー出力
 */
function logErrorDetail(goodsCode, errorType, errorMessage, additionalInfo = {}) {
    console.error('\n========================================');
    console.error(`❌ エラー詳細: ${goodsCode}`);
    console.error('========================================');
    console.error(`エラー種別: ${errorType}`);
    console.error(`エラー内容: ${errorMessage}`);
    console.error(`発生時刻: ${Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd HH:mm:ss')}`);

    if (Object.keys(additionalInfo).length > 0) {
        console.error('\n--- 追加情報 ---');
        for (const [key, value] of Object.entries(additionalInfo)) {
            console.error(`${key}: ${JSON.stringify(value)}`);
        }
    }

    console.error('========================================\n');
}

/**
 * APIエラー詳細ログ
 * @param {string} apiName      - API名称（ログ表示用ラベル）
 * @param {Object} requestData  - リクエスト情報 { goodsCodeCount, firstCode, lastCode }
 * @param {Object|null} responseData - APIレスポンス（通信エラー時はnull）
 * @param {Error}  error        - 発生したエラーオブジェクト
 */
function logAPIErrorDetail(apiName, requestData, responseData, error) {
    console.error('\n========================================');
    console.error(`❌ API呼び出しエラー: ${apiName}`);
    console.error('========================================');
    console.error(`エラー内容: ${error.message}`);
    console.error(`発生時刻: ${Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd HH:mm:ss')}`);

    console.error('\n--- リクエスト情報 ---');
    console.error(`商品コード数: ${requestData.goodsCodeCount || 'unknown'}`);
    if (requestData.firstCode && requestData.lastCode) {
        console.error(`範囲: ${requestData.firstCode} ～ ${requestData.lastCode}`);
    }

    console.error('\n--- レスポンス情報 ---');
    if (responseData) {
        console.error(`result: ${responseData.result || 'undefined'}`);
        console.error(`message: ${responseData.message || 'undefined'}`);
        console.error(`count: ${responseData.count || 'undefined'}`);
        if (responseData.data) {
            console.error(`data length: ${Array.isArray(responseData.data) ? responseData.data.length : 'not an array'}`);
        }
    } else {
        console.error('レスポンスデータなし');
    }

    console.error('========================================\n');
}

/**
 * バッチエラーメンテナンス
 */
function logBatchErrorSummary(batchNumber, errorList) {
    if (errorList.length === 0) return;

    console.error('\n========================================');
    console.error(`⚠️ バッチ ${batchNumber} エラーサマリー`);
    console.error('========================================');
    console.error(`エラー件数: ${errorList.length}件`);

    const errorTypes = {};
    errorList.forEach(error => {
        errorTypes[error.errorType] = (errorTypes[error.errorType] || 0) + 1;
    });

    console.error('\n--- エラー種別内訳 ---');
    for (const [type, count] of Object.entries(errorTypes)) {
        console.error(`${type}: ${count}件`);
    }

    const displayCount = Math.min(5, errorList.length);
    console.error(`\n--- エラー詳細（最初の${displayCount}件） ---`);
    for (let i = 0; i < displayCount; i++) {
        const error = errorList[i];
        console.error(`${i + 1}. ${error.goodsCode}: ${error.errorMessage}`);
    }

    if (errorList.length > 5) {
        console.error(`... 他 ${errorList.length - 5}件のエラーはエラーログシートを参照してください`);
    }

    console.error('========================================\n');
}

// ----------------------------------------------------------------------------
// リトライ統計オブジェクト（グローバル変数）
// 実行ごとに resetRetryStats() でリセットされる
// 15_SpreadsheetRepository.gs の logRetryStatsToSheet() からも直接参照される
// ----------------------------------------------------------------------------
let retryStats = {
    totalRetries: 0,           // 総リトライ回数
    batchesWithRetry: 0,       // リトライが発生したバッチ数
    maxRetriesUsed: 0,         // 最大使用リトライ回数
    retriesByBatch: []         // バッチごとのリトライ回数
};

/**
 * リトライ統計をリセット
 */
function resetRetryStats() {
    retryStats = {
        totalRetries: 0,
        batchesWithRetry: 0,
        maxRetriesUsed: 0,
        retriesByBatch: []
    };
}

/**
 * リトライ統計を記録
 */
function recordRetryAttempt(batchNumber, attemptNumber) {
    retryStats.totalRetries++;

    if (attemptNumber > 1) {
        if (!retryStats.retriesByBatch[batchNumber]) {
            retryStats.batchesWithRetry++;
        }
        retryStats.retriesByBatch[batchNumber] = attemptNumber;
        retryStats.maxRetriesUsed = Math.max(retryStats.maxRetriesUsed, attemptNumber);
    }
}

/**
 * リトライ統計を表示
 */
function showRetryStats() {
    if (!RETRY_CONFIG.LOG_RETRY_STATS || retryStats.totalRetries === 0) {
        return;
    }

    console.log('\n========================================');
    console.log('  リトライ統計情報');
    console.log('========================================');
    console.log(`総リトライ回数: ${retryStats.totalRetries}回`);
    console.log(`リトライ発生バッチ: ${retryStats.batchesWithRetry}個`);
    console.log(`最大リトライ回数: ${retryStats.maxRetriesUsed}回`);

    if (retryStats.totalRetries > 0) {
        console.log('\n--- リトライ発生バッチ詳細 ---');
        retryStats.retriesByBatch.forEach((retries, batchNum) => {
            if (retries > 1) {
                console.log(`バッチ ${batchNum}: ${retries}回試行`);
            }
        });
    }

    // 障害検知アラート
    if (retryStats.batchesWithRetry > 0) {
        const retryRate = (retryStats.batchesWithRetry / retryStats.retriesByBatch.length * 100).toFixed(1);
        console.log(`\n⚠️ リトライ発生率: ${retryRate}%`);

        // リトライ発生率 10% 超は Google側またはネットワーク不調のサイン
        // 参考: 正常時は 0〜5% 程度、5〜10% は軽度の不調
        if (retryRate > 10) {
            console.log('⚠️⚠️ 注意: リトライ発生率が高いです（10%以上）');
            console.log('   → Google側またはネットワークの不調の可能性があります');
        }
    }

    console.log('========================================\n');
}