/**
 * @file 17_SupabaseRepository.Supabase永続化.gs
 * @description Supabaseへのデータ書き込みモジュール。
 * 商品マスタから取得した在庫データをSupabase (PostgreSQL) に保存します。
 *
 * ### 依存関係
 * - **参照元**: 10_Main.エントリーポイント.gs, 99_Tests.テスト.gs
 * - **参照先**: 16_SupabaseClient.Supabase接続.gs, 12_Logger.ログ管理.gs, 11_Config.設定管理.gs
 *
 * ### 主要関数
 * @see buildSupabasePayload
 * @see upsertInventoryToSupabase
 *
 * @version 1.0
 */

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

/**
 * 在庫データを Supabase に全件 upsert する
 *
 * buildSupabasePayload で変換された配列をチャンク分割（500件）し、
 * upsert_ne_inventory_data RPCを呼び出します。一部チャンクが失敗しても
 * 全体の処理を止めずに処理を継続します。
 *
 * 【処理フロー】
 * 1. buildSupabasePayload(goodsMap) を呼び出してペイロード配列を生成
 * 2. 配列サイズから必要なチャンク数（分割数）を計算
 * 3. 各チャンク（500件単位）ごとにスライスして送信用 payload を作成
 * 4. 各チャンクごとに callSupabaseRpc('upsert_ne_inventory_data', { json_data: chunk }) を実行
 *    - 処理時間を計測しログに出力
 *    - エラー発生時は logError を呼び出し、カウントをインクリメント（例外は再スローせず継続）
 * 5. 全チャンク終了後、成功・失敗を集計しログに出力。失敗がある場合は例外は投げず結果の success を false とする。
 *
 * @param {Map} goodsMap - fetchAllGoodsData() の返却値 (Map型)
 * @return {Object} 処理結果オブジェクト { totalRecords: number, chunks: number, success: boolean }
 */
function upsertInventoryToSupabase(goodsMap) {
  const startTime = new Date();
  
  try {
    const allRecords = buildSupabasePayload(goodsMap);
    const totalRecords = allRecords.length;
    const chunkCount = Math.ceil(totalRecords / SUPABASE_CHUNK_SIZE);
    
    logWithLevel(LOG_LEVEL.MINIMAL, 'Supabaseへの書き込み開始: ' + totalRecords + '件 / ' + chunkCount + 'チャンク');

    let successChunks = 0;
    let errorChunks = 0;
    
    for (let i = 0; i < totalRecords; i += SUPABASE_CHUNK_SIZE) {
      const chunk = allRecords.slice(i, i + SUPABASE_CHUNK_SIZE);
      const chunkNumber = Math.floor(i / SUPABASE_CHUNK_SIZE) + 1;
      
      logWithLevel(LOG_LEVEL.SUMMARY, '  チャンク ' + chunkNumber + '/' + chunkCount + ': ' + chunk.length + '件 送信中...');
      
      const chunkStartTime = new Date();
      
      try {
        // RPC 呼び出し
        callSupabaseRpc('upsert_ne_inventory_data', { json_data: chunk });
        
        const chunkDuration = new Date() - chunkStartTime;
        successChunks++;
        logWithLevel(LOG_LEVEL.MINIMAL, '  チャンク ' + chunkNumber + '/' + chunkCount + ': ✓ 完了（ステータス: 200/204, ' + chunkDuration + 'ms）');
        
      } catch (chunkError) {
        errorChunks++;
        logError('  チャンク ' + chunkNumber + '/' + chunkCount + ': ✗ 失敗 - ' + chunkError.message);
      }
    }
    
    const totalDuration = ((new Date() - startTime) / 1000).toFixed(1);
    
    // 全体サマリーログ
    logWithLevel(LOG_LEVEL.MINIMAL, 'Supabaseへの書き込み完了: ' + totalRecords + '件 (処理時間: ' + totalDuration + '秒)');
    
    // SRE的品質向上：成功率の出力
    const successRate = ((successChunks / chunkCount) * 100).toFixed(1);
    logWithLevel(LOG_LEVEL.MINIMAL, '  ✓ チャンク成功率: ' + successRate + '% (' + successChunks + '/' + chunkCount + 'チャンク成功)');
    
    if (errorChunks > 0) {
      logError('Supabase書き込み: ' + errorChunks + 'チャンクが失敗しました。詳細は上記ログを確認してください。');
    }
    
    return {
      totalRecords: totalRecords,
      chunks: chunkCount,
      success: (errorChunks === 0)
    };
    
  } catch (error) {
    logError('Supabase書き込み処理（全体）エラー: ', error.message);
    throw error;
  }
}

/**
 * 在庫マスタ取得データをSupabase用ペイロードに変換
 *
 * inventoryDataMap (Map型) の各要素に対して、キー名の日本語化を行い、
 * 在庫数値フィールドのみを保持したオブジェクト配列を作成します。
 * 商品名およびJANコードは送信データに含めません。
 *
 * 【処理フロー】
 * 1. Map内の各要素をループ処理
 * 2. 各在庫数値項目について、念のため undefined/null 回避のフォールバック (|| 0) を指定
 * 3. 整形済みのオブジェクトを配列に集約して返す
 *
 * @param {Map} inventoryDataMap - getBatchInventoryDataWithRetry() の返却値 (Map<goodsCode, inventoryData>)
 * @return {Array} Supabase RPC (upsert_ne_stock_data) 用のオブジェクト配列
 */
function buildStockPayload(inventoryDataMap) {
  const payload = [];

  for (const [goodsCode, data] of inventoryDataMap) {
    payload.push({
      "商品コード": goodsCode,
      "在庫数": data.stock_quantity || 0,
      "引当数": data.stock_allocated_quantity || 0,
      "フリー在庫数": data.stock_free_quantity || 0,
      "予約在庫数": data.stock_advance_order_quantity || 0,
      "予約引当数": data.stock_advance_order_allocation_quantity || 0,
      "予約フリー在庫数": data.stock_advance_order_free_quantity || 0,
      "不良在庫数": data.stock_defective_quantity || 0,
      "発注残数": data.stock_remaining_order_quantity || 0,
      "欠品数": data.stock_out_quantity || 0
    });
  }

  return payload;
}

/**
 * 在庫データを Supabase にバッチ単位で upsert する
 *
 * buildStockPayload で変換された配列を、upsert_ne_stock_data RPC を用いて
 * Supabase に送信します。失敗時は例外を投げず、エラーログを記録して
 * バッチ処理ループ全体の継続性を確保します。
 *
 * 【処理フロー】
 * 1. inventoryDataMap が空の場合は即座に成功結果を返却
 * 2. buildStockPayload() を呼び出して送信ペイロードを構築
 * 3. callSupabaseRpc('upsert_ne_stock_data', { json_data: payload }) を実行
 *    - 処理時間をミリ秒単位で計測（SRE 観点での監視用）
 * 4. 成功時は { records, success: true }、失敗時は logError 記録後に { records, success: false } を返却
 *
 * @param {Map} inventoryDataMap - バッチ1回分の在庫データ Map（最大1,000件）
 * @return {Object} 処理結果オブジェクト { records: number, success: boolean }
 */
function upsertStockToSupabase(inventoryDataMap) {
  if (!inventoryDataMap || inventoryDataMap.size === 0) {
    return { records: 0, success: true };
  }

  const payload = buildStockPayload(inventoryDataMap);
  const startTime = new Date();

  try {
    callSupabaseRpc('upsert_ne_stock_data', { json_data: payload });
    
    const duration = new Date() - startTime;
    logWithLevel(LOG_LEVEL.SUMMARY, '  Supabase在庫更新完了: ' + payload.length + '件 (' + duration + 'ms)');
    
    return {
      records: payload.length,
      success: true
    };
  } catch (error) {
    logError('Supabase在庫更新エラー: ' + error.message);
    return {
      records: payload.length,
      success: false
    };
  }
}
