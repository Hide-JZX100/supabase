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
