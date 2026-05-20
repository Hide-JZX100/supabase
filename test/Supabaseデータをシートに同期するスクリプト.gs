/**
 * Supabaseの指定したテーブルからデータを取得し、
 * スプレッドシートの指定したシートに一括書き出しする関数
 * * [処理の流れ]
 * 1. SupabaseのAPIを叩いてデータをJSON形式で取得
 * 2. データの「キー（カラム名）」を自動解析して、スプレッドシートの1行目のヘッダー（列名）にする
 * 3. 2行目以降に、各行のデータを配置した二次元配列をメモリ上に作成
 * 4. 対象シートを一度クリアし、二次元配列を一括書き込み（高速処理）
 */
function importSupabaseToSheet() {
  // ==========================================
  // 【設定値】ご自身の環境に合わせて書き換えてください
  // ==========================================
  const supabaseUrl = "https://******.supabase.co"; // コピーしたProject URL
  const supabaseKey = "eyJ〜"; // コピーしたPublishable key (anonキー)
  
  const tableName = "店舗マスタ"; // Supabaseのテーブル名
  const targetSheetName = "店舗マスタ"; // 書き出し先のスプレッドシートのシート名
  
  // ==========================================
  // 1. Supabaseからのデータ取得（APIコール）
  // ==========================================
  const url = supabaseUrl + "/rest/v1/" + tableName + "?select=*";
  const options = {
    "method": "get",
    "headers": {
      "apikey": supabaseKey,
      "Authorization": "Bearer " + supabaseKey
    },
    "muteHttpExceptions": true
  };
  
  let responseData;
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    
    if (responseCode !== 200) {
      Logger.log("APIエラーが発生しました。ステータスコード: " + responseCode);
      Logger.log("エラー詳細: " + response.getContentText());
      return;
    }
    
    responseData = JSON.parse(response.getContentText());
    if (!responseData || responseData.length === 0) {
      Logger.log("Supabase側にデータが存在しないか、空のリストが返されました。");
      return;
    }
    
    Logger.log("Supabaseから " + responseData.length + " 件のデータを取得しました。");
    
  } catch(e) {
    Logger.log("接続中に予期せぬエラーが発生しました: " + e.toString());
    return;
  }
  
  // ==========================================
  // 2. スプレッドシートへの書き出し用データの成形
  // ==========================================
  // データベースのカラム名（キー）を動的に抽出して、1行目のヘッダーにします
  // これにより、カラムが増えたり順序が変わったりしても自動で対応できます
  const headers = Object.keys(responseData[0]);
  
  // シートに一括で書き込むための「二次元配列」を準備します
  // N88-BASICの 2次元配列（DIM A$(行, 列)）のようなイメージです
  const sheetValues = [];
  
  // まず、1行目にヘッダー（列名）を追加します
  sheetValues.push(headers);
  
  // 2行目以降に、それぞれの行のデータをヘッダーの順番通りに配置していきます
  for (let i = 0; i < responseData.length; i++) {
    const rowData = responseData[i];
    const rowValues = [];
    
    // 二次元配列を組み立てるループ処理：2次元配列の組み立ては、ヘッダーの順番に従って行います
    for (let j = 0; j < headers.length; j++) {
      const columnName = headers[j]; // 順番が保証されたヘッダー名を取り出す
      const value = rowData[columnName]; // その名前のデータを引き抜く
      
      // データがnull（空っぽ）の場合は、シート上で空白文字になるようにします
      rowValues.push(value === null ? "" : value);
    }
    sheetValues.push(rowValues);
  }
  
  // ==========================================
  // 3. スプレッドシートへの書き込み実行
  // ==========================================
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(targetSheetName);
  
  // もし指定した名前のシートが無ければ、新しく作成します（親切設計）
  if (!sheet) {
    sheet = ss.insertSheet(targetSheetName);
    Logger.log("「" + targetSheetName + "」シートが存在しなかったため、新規作成しました。");
  }
  
  // 前回の古いデータが残らないように、一度シート全体の文字や枠線をクリアします
  sheet.clear();
  
  // メモリ上で組み立てた二次元配列を、シートの左上（1行1列目）から一括で書き込みます
  const numRows = sheetValues.length;
  const numCols = sheetValues[0].length;
  
  sheet.getRange(1, 1, numRows, numCols).setValues(sheetValues);
  
  Logger.log("スプレッドシートへの書き込みが完了しました！ (" + (numRows - 1) + "行のデータを反映)");
}