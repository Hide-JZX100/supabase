/**
 * スプレッドシートの「店舗マスタ」シートの内容を、
 * Supabaseのテーブルへ一括で同期（Upsert：新規追加＆既存データは更新）する関数
 * * [処理の流れ]
 * 1. スプレッドシートの「店舗マスタ」から現在の全データを取得
 * 2. 1行目のヘッダー（カラム名）を基準に、全行のデータをJSON形式の配列に変換
 * 3. 日付データや空白セルを、データベース（PostgreSQL）に適した形式に自動変換
 * 4. Supabaseの「Upsert API（重複時はマージ）」を叩き、一瞬でデータを同期
 */
function exportSheetToSupabase() {
  // ==========================================
  // 【設定値】ご自身の環境に合わせて書き換えてください
  // ==========================================
  const supabaseUrl = "https://******.supabase.co"; // コピーしたProject URL
  const supabaseKey = "eyJ〜"; // コピーしたPublishable key (anonキー)
  
  const tableName = "店舗マスタ"; // Supabaseの同期先テーブル名
  const targetSheetName = "店舗マスタ"; // 同期元のスプレッドシートのシート名
  const primaryKeyName = "店舗ID"; // データの重複判定に使用する主キー（Primary Key）のカラム名
  
  // ==========================================
  // 1. スプレッドシートからのデータ取得
  // ==========================================
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(targetSheetName);
  
  if (!sheet) {
    Logger.log("エラー：「" + targetSheetName + "」という名前のシートが見つかりません。");
    ss.toast("同期対象のシートが見つかりません。", "同期エラー ❌", 5);
    return;
  }
  
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  
  if (lastRow < 2) {
    Logger.log("同期するデータ（2行目以降）が存在しません。");
    ss.toast("同期するデータが存在しません。", "同期完了 ⚠️", 5);
    return;
  }
  
  // シートのデータをすべて取得します（1行目はヘッダー、2行目以降がデータ）
  const allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = allValues[0]; // 1行目の列名リスト
  
  // ==========================================
  // 2. データベース送信用のJSONデータ（オブジェクト配列）の組み立て
  // ==========================================
  const payloadData = [];
  
  for (let i = 1; i < allValues.length; i++) {
    const row = allValues[i];
    const rowObject = {};
    
    // 主キー（店舗IDなど）が空っぽの行は、ゴミデータとみなしてスキップします
    const primaryKeyIndex = headers.indexOf(primaryKeyName);
    if (primaryKeyIndex === -1 || row[primaryKeyIndex] === "") {
      continue;
    }
    
    for (let j = 0; j < headers.length; j++) {
      const columnName = headers[j];
      let value = row[j];
      
      // --- プロのデータ型変換処理 ---
      if (value === "") {
        // スプレッドシートの「空白セル」は、データベース上では「NULL」として扱えるようにします
        value = null;
      } else if (value instanceof Date) {
        // GASの日付オブジェクト（Date）は、データベースが理解できる「yyyy-MM-dd HH:mm:ss」の文字列に変換します
        value = Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
      }
      
      rowObject[columnName] = value;
    }
    payloadData.push(rowObject);
  }
  
  // ==========================================
  // 3. Supabaseへの一括送信（Upsert APIの実行）
  // ==========================================
  // URLの末尾に「on_conflict=主キー」を指定することで、データ重複時の上書きルールを指定します
  const url = supabaseUrl + "/rest/v1/" + tableName + "?on_conflict=" + primaryKeyName;
  
  const options = {
    "method": "post", // 新規追加＆上書きの場合は POST を使います
    "contentType": "application/json",
    "headers": {
      "apikey": supabaseKey,
      "Authorization": "Bearer " + supabaseKey,
      // 【超重要】「重複データはマージ（上書き）する」という意思表示をするヘッダー設定です
      "Prefer": "resolution=merge-duplicates"
    },
    "payload": JSON.stringify(payloadData),
    "muteHttpExceptions": true
  };
  
  try {
    ss.toast("Supabaseへデータを同期中...", "処理中 ⏳", -1);
    
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    
    if (responseCode === 200 || responseCode === 201) {
      Logger.log("--- 同期成功！ ---");
      Logger.log("送信行数: " + payloadData.length + " 件");
      
      // スプレッドシートの右下に、オシャレで邪魔にならない通知を表示します
      ss.toast(payloadData.length + " 件のデータをSupabaseと同期しました！", "同期成功 🎉", 5);
    } else {
      Logger.log("同期エラーが発生しました。ステータスコード: " + responseCode);
      Logger.log("エラー詳細: " + response.getContentText());
      ss.toast("エラーの詳細はログを確認してください。", "同期失敗 ❌", 5);
    }
    
  } catch(e) {
    Logger.log("接続中に予期せぬエラーが発生しました: " + e.toString());
    ss.toast("接続エラーが発生しました。", "同期失敗 ❌", 5);
  }
}