/**
 * 関数名: testSupabaseRpc
 * 目的: Supabaseに作成したカスタム関数（upsert_ne_inventory_data）を呼び出し、
 *       差分更新が正しく動作するかをテストする。
 * 注意: 事前にSupabaseのURLとサービスロールキー（またはAPIキー）を設定してください。
 * 
 * 作成日: 2026-05-24
 */
function testSupabaseRpc() {
  // 1. Supabaseの接続情報（ご自身のプロジェクトのものに書き換えてください）
  const SUPABASE_URL = "https://xxxxxxxx.supabase.co"; 
  const SUPABASE_KEY = "あなたのSUPABASE_SERVICE_ROLE_KEY（またはANON_KEY）";
  
  // RPC（関数呼び出し）専用のエンドポイントURL
  const url = SUPABASE_URL + "/rest/v1/rpc/upsert_ne_inventory_data";
  
  // 2. テスト用のダミーデータ（1件分）
  // ※ヒデノリさんのテーブル列名（日本語）と完全に一致させています
  const dummyData = [
    {
      "商品コード": "TEST-ITEM-001",
      "商品名": "テスト用スニーカー",
      "在庫数": 10,
      "引当数": 2,
      "フリー在庫数": 8,
      "予約在庫数": 0,
      "予約引当数": 0,
      "予約フリー在庫数": 0,
      "不良在庫数": 0,
      "発注残数": 0,
      "欠品数": 0,
      "JANコード": "1234567890123"
    }
  ];
  
  // 3. Supabaseの関数（引数名: json_data）に渡すためのパラメータを構築
  const payload = {
    "json_data": dummyData
  };
  
  // 4. HTTPリクエストのオプション設定
  const options = {
    "method": "post",
    "contentType": "application/json",
    "headers": {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true // エラーが起きたときに詳細をログに出すため
  };
  
  // 5. 実行（Supabaseへデータを送信）
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    Logger.log("ステータスコード: " + responseCode);
    Logger.log("レスポンス内容: " + responseText);
    
    if (responseCode === 200 || responseCode === 204) {
      Logger.log("成功しました！Supabaseのテーブルを確認してください。");
    } else {
      Logger.log("エラーが発生しました。メッセージを確認してください。");
    }
    
  } catch (e) {
    Logger.log("通信自体に失敗しました: " + e.toString());
  }
}