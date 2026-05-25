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
