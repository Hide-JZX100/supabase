/*******************************************************************************
 * 関数名: upsert_ne_stock_data
 * 説明: GASから受信した在庫マスタデータ配列（複数件）を展開し、
 *       在庫数値列のみを更新する。
 *       商品名・JANコードは更新しない（商品マスタAPIで取得済みの値を保持）。
 *       在庫数・引当数・フリー在庫数・欠品数のいずれかに差分がある場合のみ
 *       更新日時を更新し、差分がない商品はスキップする。
 *
 * 引数:
 *   - json_data (JSONB): 在庫データオブジェクトの配列
 *                        必須キー: 商品コード, 在庫数, 引当数, フリー在庫数,
 *                                  予約在庫数, 予約引当数, 予約フリー在庫数,
 *                                  不良在庫数, 発注残数, 欠品数
 *******************************************************************************/
CREATE OR REPLACE FUNCTION public.upsert_ne_stock_data(json_data JSONB)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public."NE_InventoryData" (
        "商品コード", "在庫数", "引当数", "フリー在庫数",
        "予約在庫数", "予約引当数", "予約フリー在庫数", "不良在庫数",
        "発注残数", "欠品数", "更新日時"
    )
    SELECT
        "商品コード", "在庫数", "引当数", "フリー在庫数",
        "予約在庫数", "予約引当数", "予約フリー在庫数", "不良在庫数",
        "発注残数", "欠品数", NOW()
    FROM jsonb_to_recordset(json_data) AS x(
        "商品コード"       TEXT,
        "在庫数"           INTEGER,
        "引当数"           INTEGER,
        "フリー在庫数"     INTEGER,
        "予約在庫数"       INTEGER,
        "予約引当数"       INTEGER,
        "予約フリー在庫数" INTEGER,
        "不良在庫数"       INTEGER,
        "発注残数"         INTEGER,
        "欠品数"           INTEGER
    )
    ON CONFLICT ("商品コード")
    DO UPDATE SET
        "在庫数"           = EXCLUDED."在庫数",
        "引当数"           = EXCLUDED."引当数",
        "フリー在庫数"     = EXCLUDED."フリー在庫数",
        "予約在庫数"       = EXCLUDED."予約在庫数",
        "予約引当数"       = EXCLUDED."予約引当数",
        "予約フリー在庫数" = EXCLUDED."予約フリー在庫数",
        "不良在庫数"       = EXCLUDED."不良在庫数",
        "発注残数"         = EXCLUDED."発注残数",
        "欠品数"           = EXCLUDED."欠品数",
        "更新日時"         = NOW()
    WHERE
        public."NE_InventoryData"."在庫数"       IS DISTINCT FROM EXCLUDED."在庫数"  OR
        public."NE_InventoryData"."引当数"       IS DISTINCT FROM EXCLUDED."引当数"  OR
        public."NE_InventoryData"."フリー在庫数" IS DISTINCT FROM EXCLUDED."フリー在庫数" OR
        public."NE_InventoryData"."欠品数"       IS DISTINCT FROM EXCLUDED."欠品数";
END;
$$ LANGUAGE plpgsql;