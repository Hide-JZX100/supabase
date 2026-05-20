/**
 * Supabaseへの接続テスト関数
 * * ヘッダー説明：
 * コピーしたURLとAPIキーを使って、Supabaseから「店舗マスタ」のデータを
 * 試しに1回だけ引っ張ってくるテストスクリプトです。
 */
function testSupabaseConnection() {
  // 1. 先ほど控えた情報をここに貼り付けます
  const supabaseUrl = "https://******.supabase.co"; // ここをご自身のURLに書き換えてください
  const supabaseKey = "eyJ〜"; // ここをご自身のanonキーに書き換えてください
  
  // 2. アクセス先のテーブルを指定します（店舗マスタの場合）
  // ※Supabaseで作ったテーブル名が「店舗マスタ」ではない場合は、実際の英語名（例: shop_master等）に変えてください
  const tableName = "店舗マスタ"; 
  
  // 3. 以前ネクストエンジンで学ばれた APIを叩く（UrlFetchApp）の仕組みを使います
  const url = supabaseUrl + "/rest/v1/" + tableName + "?select=*";
  
  const options = {
    "method": "get",
    "headers": {
      "apikey": supabaseKey,
      "Authorization": "Bearer " + supabaseKey
    },
    "muteHttpExceptions": true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    
    // ログに出力して、データが取れているか確認します
    Logger.log("--- 接続成功！ ---");
    Logger.log("取得した行数: " + json.length + " 件");
    Logger.log(json); // 最初の中身を覗き見します
    
  } catch(e) {
    Logger.log("エラーが発生しました: " + e.toString());
  }
}