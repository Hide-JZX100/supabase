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
