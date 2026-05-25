/**
 * Supabase接続設定を取得
 *
 * スクリプトプロパティから SUPABASE_URL と SUPABASE_KEY を取得します。
 * いずれかが設定されていない場合は、エラーをスローします。
 *
 * @return {Object} { url: string, key: string } - 接続用URLとAPIキーのオブジェクト
 * @throws {Error} 必要なスクリプトプロパティが設定されていない場合
 */
function getSupabaseConfig() {
  const properties = PropertiesService.getScriptProperties();
  const url = properties.getProperty('SUPABASE_URL');
  const key = properties.getProperty('SUPABASE_KEY');

  if (!url || !key) {
    throw new Error('必要なスクリプトプロパティが設定されていません。SUPABASE_URLおよびSUPABASE_KEYを設定してください。');
  }

  return {
    url: url,
    key: key
  };
}

/**
 * Supabase RPC関数を呼び出す汎用ラッパー
 *
 * 指定された RPC 関数名とパラメータを使用して Supabase の REST API（RPC）を呼び出します。
 * 一時的なネットワークエラーやサーバーエラー（5xx）が発生した場合は、自動的に指数バックオフでリトライします。
 *
 * 【処理フロー】
 * 1. getSupabaseConfig() からURLとAPIキーを取得
 * 2. RPCエンドポイントURLを構築
 * 3. HTTPリクエストのオプションを設定
 * 4. 設定に基づき最大試行回数分ループし、UrlFetchApp.fetch() でAPIリクエストを送信
 *    - ステータスコードが200または204の場合は正常終了
 *    - クライアントエラー（4xx）の場合はリトライせずに即座に例外をスロー
 *    - サーバーエラー（5xx）や通信タイムアウトの場合は待機（指数バックオフ）してリトライ
 * 5. すべての試行が失敗した場合はエラーログを記録し、例外を再スロー
 *
 * @param {string} functionName - 呼び出すPostgreSQL関数名
 * @param {Object} params - 関数に渡す引数オブジェクト
 * @return {Object} 返却オブジェクト { success: boolean, statusCode: number, body: string }
 * @throws {Error} APIリクエストが失敗した場合やエラーレスポンスの場合
 */
function callSupabaseRpc(functionName, params) {
  const config = getSupabaseConfig();
  const url = config.url + '/rest/v1/rpc/' + functionName;

  const options = {
    "method": "post",
    "contentType": "application/json",
    "headers": {
      "apikey": config.key,
      "Authorization": "Bearer " + config.key
    },
    "payload": JSON.stringify(params),
    "muteHttpExceptions": true
  };

  const maxRetries = RETRY_CONFIG.MAX_RETRIES;
  const enableRetry = RETRY_CONFIG.ENABLE_RETRY;
  let lastError = null;

  for (let attempt = 1; attempt <= (enableRetry ? maxRetries : 1); attempt++) {
    try {
      if (attempt > 1) {
        logWithLevel(LOG_LEVEL.SUMMARY, '  Supabase RPC リトライ ' + attempt + '/' + maxRetries + '回目... (' + functionName + ')');
      }

      const response = UrlFetchApp.fetch(url, options);
      const statusCode = response.getResponseCode();
      const body = response.getContentText();

      if (statusCode === 200 || statusCode === 204) {
        if (attempt > 1) {
          logWithLevel(LOG_LEVEL.SUMMARY, '  ✓ Supabase RPC リトライ成功（' + attempt + '回目の試行で成功）');
        }
        return {
          success: true,
          statusCode: statusCode,
          body: body
        };
      }

      const errorMsg = 'ステータスコード ' + statusCode + ': ' + body;
      
      // 4xx クライアントエラーはリトライ不可能なため即時スロー
      if (statusCode >= 400 && statusCode < 500) {
        logError('  即座に失敗: クライアントエラー - ' + errorMsg);
        throw new Error(errorMsg);
      }

      // 5xx 等のエラーは一時的エラーとしてスローし、リトライへ進む
      throw new Error(errorMsg);

    } catch (error) {
      lastError = error;

      // 既に投げられた 4xx エラーの場合はリトライループを抜けて即座に再スローする
      const errorMsg = error.message;
      if (errorMsg.includes('ステータスコード 4')) {
        logError('Supabase RPC 呼び出しエラー (' + functionName + '):', errorMsg);
        throw error;
      }

      logError('  ✗ Supabase RPC接続エラー（試行 ' + attempt + '/' + maxRetries + '）: ' + errorMsg);

      if (enableRetry && attempt < maxRetries) {
        const waitSeconds = Math.pow(2, attempt - 1);
        logWithLevel(LOG_LEVEL.SUMMARY, '  → ' + waitSeconds + '秒後にリトライします...');
        Utilities.sleep(waitSeconds * 1000);
      }
    }
  }

  // すべてのリトライが失敗した場合
  const finalErrorMsg = 'Supabase RPC 呼び出し失敗（' + maxRetries + '回試行）: ' + lastError.message;
  logError('  ✗✗✗ ' + finalErrorMsg);
  throw new Error(finalErrorMsg);
}
