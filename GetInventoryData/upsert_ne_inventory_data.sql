/*******************************************************************************
 * 関数名: upsert_ne_inventory_data
 * 説明: GASから受信したネクストエンジンの在庫データ配列（複数件）を展開し、
 *       既存データと「在庫数」「引当数」「フリー在庫数」「欠品数」に差分がある商品のみを更新する。
 *       主要な在庫情報に変化がない商品は処理をスキップし、過去の更新日時を維持する。
 *
 * 引数:
 *   - json_data (JSONB): ネクストエンジンの在庫データオブジェクトの配列
 *                        [{"商品コード": "AAA", "在庫数": 10, "商品名": "商品A", ...}, ...]
 *
 * 戻り値: 
 *   - VOID (なし)
 *
 * 修正日: 2026-05-24 (欠品数の変動検知を追加)
 *******************************************************************************/
CREATE OR REPLACE FUNCTION public.upsert_ne_inventory_data(json_data JSONB)
RETURNS VOID AS $$
BEGIN
    -- 1. 送られてきたJSON配列を、日本語の列名に合わせてテーブル形式に展開し挿入
    INSERT INTO public."NE_InventoryData" (
        "商品コード", "商品名", "在庫数", "引当数", "フリー在庫数", 
        "予約在庫数", "予約引当数", "予約フリー在庫数", "不良在庫数", 
        "発注残数", "欠品数", "JANコード", "更新日時"
    )
    SELECT 
        "商品コード", "商品名", "在庫数", "引当数", "フリー在庫数", 
        "予約在庫数", "予約引当数", "予約フリー在庫数", "不良在庫数", 
        "発注残数", "欠品数", "JANコード", NOW() -- 更新日時は現在の時刻をセット
    FROM jsonb_to_recordset(json_data) AS x(
        "商品コード" TEXT, "商品名" TEXT, "在庫数" INTEGER, "引当数" INTEGER, "フリー在庫数" INTEGER, 
        "予約在庫数" INTEGER, "予約引当数" INTEGER, "予約フリー在庫数" INTEGER, "不良在庫数" INTEGER, 
        "発注残数" INTEGER, "欠品数" INTEGER, "JANコード" TEXT
    )
    
    -- 2. 商品コードが既に存在していた場合の書き換え処理
    ON CONFLICT ("商品コード")
    DO UPDATE SET
        "商品名" = EXCLUDED."商品名",
        "在庫数" = EXCLUDED."在庫数",
        "引当数" = EXCLUDED."引当数",
        "フリー在庫数" = EXCLUDED."フリー在庫数",
        "予約在庫数" = EXCLUDED."予約在庫数",
        "予約引当数" = EXCLUDED."予約引当数",
        "予約フリー在庫数" = EXCLUDED."予約フリー在庫数",
        "不良在庫数" = EXCLUDED."不良在庫数",
        "発注残数" = EXCLUDED."発注残数",
        "欠品数" = EXCLUDED."欠品数",
        "JANコード" = EXCLUDED."JANコード",
        "更新日時" = NOW() -- 条件に合致した場合のみ、ここも現在時刻に更新される
        
    -- 3. 【最重要】在庫数、引当数、フリー在庫数、欠品数のいずれかが「以前と違う場合のみ」実行
    WHERE 
        public."NE_InventoryData"."在庫数" IS DISTINCT FROM EXCLUDED."在庫数" OR
        public."NE_InventoryData"."引当数" IS DISTINCT FROM EXCLUDED."引当数" OR
        public."NE_InventoryData"."フリー在庫数" IS DISTINCT FROM EXCLUDED."フリー在庫数" OR
        -- 【追加】欠品数が前回のデータから変動しているかチェック
        public."NE_InventoryData"."欠品数" IS DISTINCT FROM EXCLUDED."欠品数";
END;
$$ LANGUAGE plpgsql;