/**
 * ネクストエンジン認証ライブラリ使用必須関数
 * 
 * このファイルは、認証ライブラリ(NEAuth)を使用するプロジェクトで
 * 実装する必要がある関数を含んでいます。
 * 
 * 【前提条件】
 * 認証ライブラリ(NEAuth)がバージョン5で追加されていること
 * 認証ライブラリを利用するGASプロジェクトで、以下の設定が必要です。
 * 
 * 1. Webアプリとしてデプロイ
 *    - GASエディタの「デプロイ」>「新しいデプロイ」からWebアプリとしてデプロイし、デプロイURLを取得します。
 * 
 * 2. スクリプトプロパティの設定
 *    - GASエディタの「プロジェクトの設定」(歯車アイコン) >「スクリプト プロパティ」に以下を設定します。
 * 
 *      キー           | 値
 *      -------------|------------------------------------
 *      CLIENT_ID    | ネクストエンジンアプリのクライアントID
 *      CLIENT_SECRET| ネクストエンジンアプリのクライアントシークレット
 *      REDIRECT_URI | 上記1で取得したWebアプリのデプロイURL
 * 
 * 3. ライブラリの追加
 *     - 左メニュー「ライブラリ」の「+」をクリック
 *     - 認証プロジェクトのスクリプトIDを入力
 *     - 認証プロジェクトの「プロジェクトの設定」→「スクリプトID」
 *     - 「検索」をクリック
 *     - 最新バージョンを選択(重要!)
 *     - 識別子: NEAuth と入力
 *     - 「追加」をクリック
 * 
*/

/**
 * 認証URL生成テスト
 * ライブラリの関数を呼び出して認証URLを生成
 * 
 * 【使用タイミング】
 * - 初回認証時
 * - トークンが完全に期限切れになった場合
 * 
 * 【実行後の手順】
 * 1. 表示されたURLをコピー
 * 2. ブラウザで開く
 * 3. ネクストエンジンにログイン
 * 4. 自動的にdoGet()が実行され、トークンが保存される
 */
function testGenerateAuthUrl() {
  console.log('=== 認証URL生成テスト ===');
  
  try {
    // 自分のプロジェクトのスクリプトプロパティを取得
    const myProperties = PropertiesService.getScriptProperties();
    
    // ライブラリに渡して認証URLを生成
    const authUrl = NEAuth.generateAuthUrl(myProperties);
    
    console.log('認証URL:', authUrl);
    console.log('');
    console.log('このURLをブラウザで開いて認証を完了してください');
    
    return authUrl;
    
  } catch (error) {
    console.error('❌ 認証URL生成エラー:', error.message);
    console.error('');
    console.error('【確認事項】');
    console.error('1. スクリプトプロパティが設定されているか確認');
    console.error('   - CLIENT_ID');
    console.error('   - CLIENT_SECRET');
    console.error('   - REDIRECT_URI');
    throw error;
  }
}

/**
 * doGet関数 - ネクストエンジンからのリダイレクトを受け取る
 * Webアプリとしてデプロイされている場合に自動的に実行される
 * 
 * 【動作】
 * 1. ネクストエンジンから uid と state を受け取る
 * 2. これらを使ってアクセストークンを取得
 * 3. トークンをスクリプトプロパティに保存
 * 4. 成功/失敗の画面を表示
 * 
 * @param {Object} e - イベントオブジェクト(URLパラメータを含む)
 * @return {HtmlService.HtmlOutput} HTML出力
 */
function doGet(e) {
  const uid = e.parameter.uid;
  const state = e.parameter.state;
  
  console.log('doGet実行: uid=', uid, 'state=', state);
  
  if (uid && state) {
    try {
      // このプロジェクトのスクリプトプロパティを取得
      const myProperties = PropertiesService.getScriptProperties();
      const clientId = myProperties.getProperty('CLIENT_ID');
      const clientSecret = myProperties.getProperty('CLIENT_SECRET');
      
      console.log('CLIENT_ID:', clientId ? '設定済み' : '未設定');
      console.log('CLIENT_SECRET:', clientSecret ? '設定済み' : '未設定');
      
      // プロパティが設定されているか確認
      if (!clientId || !clientSecret) {
        throw new Error('スクリプトプロパティが設定されていません');
      }
      
      // アクセストークン取得のAPIリクエスト
      const NE_API_URL = 'https://api.next-engine.org';
      const url = `${NE_API_URL}/api_neauth`;
      
      const payload = {
        'uid': uid,
        'state': state,
        'client_id': clientId,
        'client_secret': clientSecret
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
      
      console.log('アクセストークン取得リクエスト送信中...');
      const response = UrlFetchApp.fetch(url, options);
      const responseText = response.getContentText();
      const responseData = JSON.parse(responseText);
      
      console.log('レスポンス:', responseData);
      
      if (responseData.result === 'success') {
        // トークンをこのプロジェクトのスクリプトプロパティに保存
        myProperties.setProperties({
          'ACCESS_TOKEN': responseData.access_token,
          'REFRESH_TOKEN': responseData.refresh_token,
          'TOKEN_OBTAINED_AT': new Date().getTime().toString()
        });
        
        console.log('トークンを保存しました');
        
        // 成功画面を表示
        return HtmlService.createHtmlOutput(`
          <html>
            <head>
              <title>ネクストエンジン認証完了</title>
              <style>
                body { 
                  font-family: 'Helvetica Neue', Arial, sans-serif; 
                  max-width: 600px; 
                  margin: 50px auto; 
                  padding: 20px;
                  background-color: #f5f5f5;
                }
                .container {
                  background: white;
                  padding: 30px;
                  border-radius: 10px;
                  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
                .success { color: #28a745; }
                .info { color: #17a2b8; }
                .code { 
                  background: #f8f9fa; 
                  padding: 10px; 
                  border-radius: 5px; 
                  font-family: monospace;
                  margin: 10px 0;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <h2 class="success">✅ 認証成功!</h2>
                <p>ネクストエンジンAPIの認証が完了しました。</p>
                
                <h3>取得した情報:</h3>
                <div class="code">
                  <strong>UID:</strong> ${uid}<br>
                  <strong>State:</strong> ${state}<br>
                  <strong>Access Token:</strong> ${responseData.access_token.substring(0, 20)}...<br>
                  <strong>Refresh Token:</strong> ${responseData.refresh_token.substring(0, 20)}...
                </div>
                
                <h3 class="info">次のステップ:</h3>
                <p>GASエディタに戻り、以下の関数を実行してAPI接続をテストしてください:</p>
                <ul>
                  <li><code>testApiConnection()</code> - API接続テスト</li>
                  <li><code>showMyTokens()</code> - トークン情報確認</li>
                </ul>
                
                <p><small>このページを閉じて構いません。</small></p>
              </div>
            </body>
          </html>
        `);
      } else {
        throw new Error('認証失敗: ' + JSON.stringify(responseData));
      }
      
    } catch (error) {
      console.error('認証エラー:', error.message);
      
      // エラー画面を表示
      return HtmlService.createHtmlOutput(`
        <html>
          <head>
            <title>認証エラー</title>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                max-width: 600px; 
                margin: 50px auto; 
                padding: 20px;
              }
              .error { color: #dc3545; }
              .code {
                background: #f8f9fa;
                padding: 10px;
                border-radius: 5px;
                font-family: monospace;
                margin: 10px 0;
              }
            </style>
          </head>
          <body>
            <h2 class="error">❌ 認証エラー</h2>
            <p>認証処理中にエラーが発生しました:</p>
            <div class="code">${error.message}</div>
            <p>GASエディタでログを確認してください。</p>
            <p>スクリプトプロパティが正しく設定されているか確認してください:</p>
            <ul>
              <li>CLIENT_ID</li>
              <li>CLIENT_SECRET</li>
              <li>REDIRECT_URI</li>
            </ul>
          </body>
        </html>
      `);
    }
  } else {
    // パラメータエラー画面
    return HtmlService.createHtmlOutput(`
      <html>
        <head>
          <title>パラメータエラー</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              max-width: 600px; 
              margin: 50px auto; 
              padding: 20px;
            }
            .error { color: #dc3545; }
          </style>
        </head>
        <body>
          <h2 class="error">❌ パラメータエラー</h2>
          <p>必要なパラメータ（uid、state）が見つかりません。</p>
          <p>認証URLから正しくリダイレクトされていない可能性があります。</p>
          <p>GASエディタで <code>testGenerateAuthUrl()</code> を実行して、正しい認証URLを取得してください。</p>
        </body>
      </html>
    `);
  }
}

/**
 * API接続テスト
 * 認証が完了した後、トークンが正しく取得できているか確認
 * 
 * 【機能】
 * - トークンの有効性を確認
 * - トークンが期限切れの場合は自動更新
 * - ユーザー情報を取得
 * 
 * 【使用タイミング】
 * - 認証完了後の動作確認
 * - トラブルシューティング
 * - 定期的な動作確認
 */
function testApiConnection() {
  console.log('=== API接続テスト ===');
  
  try {
    // 自分のプロジェクトのスクリプトプロパティを取得
    const myProperties = PropertiesService.getScriptProperties();
    
    // ライブラリのテスト関数を呼び出し
    const result = NEAuth.testApiConnection(myProperties);
    
    console.log('✅ テスト成功!');
    console.log('ユーザー情報:', result);
    console.log('');
    
    // resultは配列なので、最初の要素を取得
    if (result && result.length > 0) {
      const userInfo = result[0];
      console.log('担当者ID:', userInfo.pic_id);
      console.log('担当者名:', userInfo.pic_name);
      console.log('担当者かな:', userInfo.pic_kana);
      console.log('メールアドレス:', userInfo.pic_mail_address);
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ API接続テスト失敗:', error.message);
    console.error('');
    console.error('【確認事項】');
    console.error('1. トークンが保存されているか確認: showMyTokens()');
    console.error('2. トークンが有効期限切れの可能性');
    console.error('3. 必要に応じて再認証: testGenerateAuthUrl()');
    throw error;
  }
}

/**
 * 保存されているトークン情報を確認
 * 
 * 【機能】
 * - 現在保存されているトークン情報を表示
 * - トークンの取得日時・更新日時を表示
 * 
 * 【使用タイミング】
 * - トークンの状態確認
 * - トラブルシューティング
 * - いつ認証したか確認したい時
 */
function showMyTokens() {
  console.log('=== トークン情報確認 ===');
  
  try {
    // 自分のプロジェクトのスクリプトプロパティを取得
    const myProperties = PropertiesService.getScriptProperties();
    
    // ライブラリの表示関数を使用
    NEAuth.showStoredTokens(myProperties);
    
    // 追加情報: 日時を人間が読みやすい形式で表示
    const obtainedAt = myProperties.getProperty('TOKEN_OBTAINED_AT');
    const updatedAt = myProperties.getProperty('TOKEN_UPDATED_AT');
    
    if (obtainedAt) {
      const obtainedDate = new Date(parseInt(obtainedAt));
      console.log('');
      console.log('取得日時:', obtainedDate.toLocaleString('ja-JP'));
      
      if (updatedAt) {
        const updatedDate = new Date(parseInt(updatedAt));
        console.log('最終更新:', updatedDate.toLocaleString('ja-JP'));
      }
    }
    
  } catch (error) {
    console.error('❌ トークン情報の取得に失敗:', error.message);
    throw error;
  }
}

/**
 * トークン情報をクリア（再認証が必要な場合）
 * 
 * 【機能】
 * - 保存されているトークンを全て削除
 * - 再認証の準備
 * 
 * 【使用タイミング】
 * - トークンが完全に無効になった場合
 * - 別のアカウントで認証し直す場合
 * - テスト時
 * 
 * 【注意】
 * - 実行後は再認証が必要になります
 */
function clearMyTokens() {
  console.log('=== トークンクリア ===');
  
  try {
    // 自分のプロジェクトのスクリプトプロパティを取得
    const myProperties = PropertiesService.getScriptProperties();
    
    // 確認
    console.log('本当にトークンをクリアしますか?');
    console.log('実行後は再認証が必要になります。');
    
    // ライブラリのクリア関数を使用
    NEAuth.clearProperties(myProperties);
    
    console.log('');
    console.log('✅ トークンをクリアしました');
    console.log('');
    console.log('【次のステップ】');
    console.log('1. testGenerateAuthUrl() を実行');
    console.log('2. 表示されたURLで再認証');
    
  } catch (error) {
    console.error('❌ トークンのクリアに失敗:', error.message);
    throw error;
  }
}

/**
 * トークン更新処理(毎日実行)
 * 
 * この関数を時間主導型トリガーで毎日実行することで、
 * トークンの有効期限を延長し続けます。
 * エラー発生時はメール通知を送信します。
 * 
 * 【トリガー設定】
 * 1. 左メニュー「トリガー」をクリック
 * 2. 「トリガーを追加」をクリック
 * 3. 以下のように設定:
 *    - 実行する関数: dailyTokenRefresh
 *    - イベントのソース: 時間主導型
 *    - タイプ: 日付ベースのタイマー
 *    - 時刻: 午前3時~4時(推奨)
 * 
 * 【重要】
 * - メイン処理が週1回や月1回の場合でも、
 *   この関数は毎日実行してください
 * - トークンの有効期限(3日)を延長し続けるため
 */
function dailyTokenRefresh() {
  console.log('=== 定期トークン更新 ===');
  console.log('実行時刻:', new Date().toLocaleString('ja-JP'));
  
  try {
    const props = PropertiesService.getScriptProperties();
    const result = NEAuth.refreshTokens(props);
    
    if (result.success) {
      console.log('✅ トークン更新成功:', result.message);
      
      // ユーザー情報を表示(配列の最初の要素)
      if (result.userInfo && result.userInfo.length > 0) {
        console.log('担当者名:', result.userInfo[0].pic_name);
      }
      
      // 成功時は何もしない(メール不要)
      
    } else {
      // エラー時はメール通知
      throw new Error(result.message);
    }
    
  } catch (error) {
    console.error('❌ トークン更新失敗:', error.message);
    
    // エラー通知メールを送信
    const recipient = Session.getActiveUser().getEmail(); // 実行者のメール
    const subject = '[エラー] ネクストエンジン トークン更新失敗';
    const body = `
トークンの更新に失敗しました。

エラー内容:
${error.message}

対処方法:
1. GASエディタを開く: ${ScriptApp.getScriptId()}
2. testGenerateAuthUrl() を実行
3. 表示されたURLで再認証を実行

プロジェクト名: ${ScriptApp.getScriptId()}
発生時刻: ${new Date().toLocaleString('ja-JP')}

このメールは自動送信されています。
    `;
    
    MailApp.sendEmail(recipient, subject, body);
    console.log('エラー通知メールを送信しました:', recipient);
    
    throw error; // エラーを再スロー(実行ログに記録)
  }
}