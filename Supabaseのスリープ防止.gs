/**
 * ==================================================================================
 * 【スタンドアロン版】Supabase スリープ防止（Ping）＆ 双方向同期スクリプト
 * ==================================================================================
 * * [概要]
 * 本スクリプトは、特定のGoogleスプレッドシートに依存しない「スタンドアロン型」のプログラムです。
 * 重要な接続設定やキー情報はすべて「スクリプトプロパティ」から安全に読み込みます。
 * * [事前準備：スクリプトプロパティの設定手順]
 * GASエディタの画面左側にある「プロジェクトの設定（歯車マーク）」をクリックし、
 * 画面下部の「スクリプトプロパティ」セクションにて、以下の4つのプロパティを追加してください。
 * (※大文字・小文字を区別します。前後に不要なスペースが入らないようご注意ください)
 * * 1. プロパティ名: SUPABASE_URL
 * 値: https://******.supabase.co (Project URL)
 * * 2. プロパティ名: SUPABASE_KEY
 * 値: eyJ〜 (Publishable key / anonキー)
 * * 3. プロパティ名: TARGET_TABLE_NAME
 * 値: 店舗マスタ (Supabase側の既定のテーブル名。関数内で別名指定も可能です)
 * * ==================================================================================
 */

/**
 * 1. Supabaseスリープ防止（生存確認）関数
 * * [トリガー設定推奨] 
 * GASの「トリガー（目覚まし時計マーク）」から、この「pingSupabase」関数を
 * 「時間手動型 ＞ 日曜・毎日・午前9時〜10時」などの頻度で定期実行するように設定してください。
 * 外からアクセスを発生させ続けることで、Supabase無料プランの自動スリープ（1週間アクセス無し）を永久に防ぎます。
 */
function pingSupabase() {
  const config = getProperties_();
  if (!config) return;

  // 生存確認なので、データを全件取る必要はありません。
  // URLの末尾に「limit=1」を付与して、最軽量の「1行だけ取得」の通信を行います。
  const url = config.url + "/rest/v1/" + config.tableName + "?select=*&limit=1";
  
  const options = {
    "method": "get",
    "headers": {
      "apikey": config.key,
      "Authorization": "Bearer " + config.key
    },
    "muteHttpExceptions": true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    
    if (responseCode === 200) {
      Logger.log("--- Supabase生存確認（Ping）成功 ---");
      Logger.log("レスポンスコード: " + responseCode + " (正常稼働中)");
    } else {
      Logger.log("生存確認警告: 接続はできましたが、ステータスが200以外です。コード: " + responseCode);
      Logger.log("詳細: " + response.getContentText());
    }
  } catch(e) {
    Logger.log("生存確認エラー: Supabaseへのアクセスに失敗しました。サーバーがスリープしているか、通信エラーの可能性があります: " + e.toString());
  }
}

/**
 * [内部用ヘルパー関数] スクリプトプロパティを取得し、設定オブジェクトを返す
 * @return {Object|null} 取得に成功した場合は設定オブジェクト、不足している場合はnull
 * @private
 */
function getProperties_() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  
  const url = properties.SUPABASE_URL;
  const key = properties.SUPABASE_KEY;
  const tableName = properties.TARGET_TABLE_NAME;
  
  if (!url || !key ||  !tableName) {
    Logger.log("⚠️ エラー: スクリプトプロパティが正しく設定されていません。");
    Logger.log("確認状況 -> SUPABASE_URL: " + (url ? "OK" : "未設定") + 
               ", SUPABASE_KEY: " + (key ? "OK" : "未設定") + 
               ", TARGET_TABLE_NAME: " + (tableName ? "OK" : "未設定"));
    return null;
  }
  
  return {
    url: url,
    key: key,
    tableName: tableName
  };
}