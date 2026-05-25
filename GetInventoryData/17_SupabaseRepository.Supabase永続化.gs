// ============================================================================
// 定数定義
// ============================================================================

/** 1回のRPC呼び出しで送信するレコード数 */
const SUPABASE_CHUNK_SIZE = 500;

// ============================================================================
// 公開関数
// ============================================================================

/**
 * NE API取得データをSupabase用ペイロードに変換
 *
 * goodsMap (Map型) の各要素に対して、キー名の日本語化および
 * データ型のパース（JANコード、数値）を適用し、オブジェクトの配列を作成します。
 *
 * 【処理フロー】
 * 1. Map内の各要素をループ処理
 * 2. 整数型フィールド（在庫数、引当数など）を parseInt で安全に変換
 * 3. JANコードをBIGINT型要件（空文字時はnull、値あり時は整数）に変換
 * 4. 整形済みのオブジェクトを配列に集約して返す
 *
 * @param {Map} goodsMap - fetchAllGoodsData() の返却値 (Map<goods_id, goodsItem>)
 * @return {Array} Supabase RPC 用のオブジェクト配列
 */
function buildSupabasePayload(goodsMap) {
  const payload = [];
  
  // 安全な数値パースヘルパー
  const parseVal = (val) => {
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? 0 : parsed;
  };

  for (const [goodsId, item] of goodsMap) {
    // JANコード変換ルール：
    // 空欄・null・undefined の場合は null、それ以外は10進数でパース
    const jan = item.goods_jan_code;
    const janCodeValue = (jan && jan !== '') ? parseInt(jan, 10) : null;

    payload.push({
      "商品コード": item.goods_id,
      "商品名": item.goods_name || "",
      "在庫数": parseVal(item.stock_quantity),
      "引当数": parseVal(item.stock_allocation_quantity),
      "フリー在庫数": parseVal(item.stock_free_quantity),
      "予約在庫数": parseVal(item.stock_advance_order_quantity),
      "予約引当数": parseVal(item.stock_advance_order_allocation_quantity),
      "予約フリー在庫数": parseVal(item.stock_advance_order_free_quantity),
      "不良在庫数": parseVal(item.stock_defective_quantity),
      "発注残数": parseVal(item.stock_remaining_order_quantity),
      "欠品数": parseVal(item.stock_out_quantity),
      "JANコード": janCodeValue
    });
  }
  
  return payload;
}
