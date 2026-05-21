/**
 * 二つの数値を足し合わせる関数
 * @param {number} a - 最初の数値
 * @param {number} b - 二番目の数値
 * @return {number} 二つの数値の合計
 */
function addNumbers(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new Error('引数は数値である必要があります。');
  }
  return a + b;
}

/**
 * addNumbers 関数の動作を検証するテスト用メイン関数
 * 各種テストケースを実行し、Loggerに結果を出力します。
 */
function runAddNumbersTest() {
  Logger.log('--- テスト開始 ---');
  
  // テストケース1: 正の整数同士の加算
  try {
    var result1 = addNumbers(10, 20);
    if (result1 === 30) {
      Logger.log('[PASS] ケース1 (10 + 20 = 30): 期待通りの結果です。');
    } else {
      Logger.log('[FAIL] ケース1: 期待値は 30 ですが、結果は ' + result1 + ' でした。');
    }
  } catch (e) {
    Logger.log('[ERROR] ケース1で予期せぬエラーが発生しました: ' + e.message);
  }
  
  // テストケース2: 負の数を含む加算
  try {
    var result2 = addNumbers(-5, 5);
    if (result2 === 0) {
      Logger.log('[PASS] ケース2 (-5 + 5 = 0): 期待通りの結果です。');
    } else {
      Logger.log('[FAIL] ケース2: 期待値は 0 ですが、結果は ' + result2 + ' でした。');
    }
  } catch (e) {
    Logger.log('[ERROR] ケース2で予期せぬエラーが発生しました: ' + e.message);
  }

  // テストケース3: 無効な引数のエラーハンドリング
  try {
    addNumbers('10', 20);
    Logger.log('[FAIL] ケース3: 文字列を入力した際にエラーが発生しませんでした。');
  } catch (e) {
    if (e.message.indexOf('引数は数値である必要があります') !== -1) {
      Logger.log('[PASS] ケース3: 期待通りエラーが発生しました (' + e.message + ')');
    } else {
      Logger.log('[FAIL] ケース3: エラーは発生しましたが、メッセージが異なります: ' + e.message);
    }
  }
  
  Logger.log('--- テスト終了 ---');
}
