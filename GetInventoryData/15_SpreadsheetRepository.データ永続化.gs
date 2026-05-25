/**
 * バッチ単位でスプレッドシートを一括更新
 * 連続する行をグループ化して setValues() の呼び出し回数を最小化する
 *
 * @param {Sheet}  sheet           - 対象シートオブジェクト
 * @param {Array}  batch           - 更新対象の商品コードリスト
 * @param {Map}    inventoryDataMap - 在庫データマップ（14_InventoryLogic.gsで生成）
 *                                   key: 商品コード, value: inventoryData オブジェクト
 * @param {Map}    rowIndexMap     - 行番号マップ
 *                                   key: 商品コード, value: スプレッドシートの行番号
 * @return {Object} { updated: number, results: Array }
 *   updated : 更新成功件数
 *   results : 各商品の処理結果
 *             { goodsCode, status: 'success'|'error'|'no_data', stock?, error? }
 */
function updateBatchInventoryData(sheet, batch, inventoryDataMap, rowIndexMap) {
    const updateData = [];
    const results = [];

    // ステップ1: 行番号でソートして連続した範囲を特定
    const sortedItems = [];

    for (const goodsCode of batch) {
        const inventoryData = inventoryDataMap.get(goodsCode);
        const rowIndex = rowIndexMap.get(goodsCode);

        if (inventoryData && rowIndex) {
            sortedItems.push({
                goodsCode: goodsCode,
                rowIndex: rowIndex,
                inventoryData: inventoryData
            });
        } else {
            // データが見つからなかった場合の結果記録
            results.push({
                goodsCode: goodsCode,
                status: 'no_data'
            });
        }
    }

    // 行番号昇順にソートすることで連続行のグループ化を可能にする
    // ソートなしでは連続行の判定が正確に行えない
    sortedItems.sort((a, b) => a.rowIndex - b.rowIndex);

    // ステップ2: 連続した範囲をグループ化
    // 連続した行番号をグループにまとめる
    // 前のアイテムの行番号 + 1 = 現在の行番号 であれば同じグループに追加
    // 例）行2・3・4 → 1グループ、行6・7 → 1グループ（合計2グループ）
    const rangeGroups = [];
    let currentGroup = null;

    for (const item of sortedItems) {
        if (!currentGroup || item.rowIndex !== currentGroup.endRow + 1) {
            if (currentGroup) {
                rangeGroups.push(currentGroup);
            }
            currentGroup = {
                startRow: item.rowIndex,
                endRow: item.rowIndex,
                items: [item]
            };
        } else {
            currentGroup.endRow = item.rowIndex;
            currentGroup.items.push(item);
        }
    }

    if (currentGroup) {
        rangeGroups.push(currentGroup);
    }

    // ステップ3: 各グループごとに一括更新
    let totalUpdated = 0;

    for (const group of rangeGroups) {
        try {
            // COLUMNS.STOCK_QTY(C列)から9列分を一括書き込み
            // 列順序は 11_Config.gs の COLUMNS 定義に準拠
            const updateValues = group.items.map(item => [
                item.inventoryData.stock_quantity || 0,                          // C列: 在庫数
                item.inventoryData.stock_allocated_quantity || 0,                // D列: 引当数
                item.inventoryData.stock_free_quantity || 0,                     // E列: フリー在庫数
                item.inventoryData.stock_advance_order_quantity || 0,            // F列: 予約在庫数
                item.inventoryData.stock_advance_order_allocation_quantity || 0, // G列: 予約引当数
                item.inventoryData.stock_advance_order_free_quantity || 0,       // H列: 予約フリー在庫数
                item.inventoryData.stock_defective_quantity || 0,                // I列: 不良在庫数
                item.inventoryData.stock_remaining_order_quantity || 0,          // J列: 発注残数
                item.inventoryData.stock_out_quantity || 0                       // K列: 欠品数
                // ※COLUMNS定義とAPIフィールドに合わせて調整が必要な場合はここを修正
                // 現状のconfig/logicに合わせています
            ]);

            const range = sheet.getRange(
                group.startRow,
                COLUMNS.STOCK_QTY + 1,
                updateValues.length,
                9
            );
            range.setValues(updateValues);

            totalUpdated += group.items.length;

            for (const item of group.items) {
                results.push({
                    goodsCode: item.goodsCode,
                    status: 'success',
                    stock: item.inventoryData.stock_quantity
                });
            }

        } catch (error) {
            for (const item of group.items) {
                results.push({
                    goodsCode: item.goodsCode,
                    status: 'error',
                    error: error.message
                });
            }

            logError(`グループ更新エラー (行 ${group.startRow}-${group.endRow}): ${error.message}`);
        }
    }

    return {
        updated: totalUpdated,
        results: results
    };
}

/**
 * 単一行の在庫データを更新（個別更新用）
 */
function updateRowWithInventoryData(sheet, rowIndex, inventoryData) {
    const updateValues = [
        inventoryData.stock_quantity || 0,
        inventoryData.stock_allocated_quantity || 0,
        inventoryData.stock_free_quantity || 0,
        inventoryData.stock_advance_order_quantity || 0,
        inventoryData.stock_advance_order_allocation_quantity || 0,
        inventoryData.stock_advance_order_free_quantity || 0,
        inventoryData.stock_defective_quantity || 0,
        inventoryData.stock_remaining_order_quantity || 0,
        inventoryData.stock_out_quantity || 0
    ];

    // C列(3)からK列(11)まで更新
    // COLUMNS.STOCK_QTY は 2 (0始まり) -> getRangeの列番号は 3
    const range = sheet.getRange(rowIndex, COLUMNS.STOCK_QTY + 1, 1, updateValues.length);
    range.setValues([updateValues]);
}

/**
 * エラーログをスプレッドシートに記録
 */
function logErrorsToSheet(errorDetails) {
    try {
        const { SPREADSHEET_ID } = getSpreadsheetConfig();
        const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
        let errorSheet = spreadsheet.getSheetByName('エラーログ');

        // エラーログシートが存在しない場合は自動生成してヘッダー行を設定する
        // 2回目以降は既存シートの末尾に追記する
        if (!errorSheet) {
            errorSheet = spreadsheet.insertSheet('エラーログ');
            const headers = [
                '発生日時', '商品コード', 'エラー種別',
                'エラー内容', 'バッチ番号', '処理日時'
            ];
            errorSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
            errorSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
        }

        const errorRows = errorDetails.map(error => [
            error.timestamp,
            error.goodsCode,
            error.errorType,
            error.errorMessage,
            error.batchNumber,
            new Date()
        ]);

        if (errorRows.length > 0) {
            const lastRow = errorSheet.getLastRow();
            const range = errorSheet.getRange(lastRow + 1, 1, errorRows.length, 6);
            range.setValues(errorRows);

            errorSheet.getRange(lastRow + 1, 1, errorRows.length, 1)
                .setNumberFormat('yyyy/mm/dd hh:mm:ss');
            errorSheet.getRange(lastRow + 1, 6, errorRows.length, 1)
                .setNumberFormat('yyyy/mm/dd hh:mm:ss');
        }

        console.log(`エラーログに${errorRows.length}件を記録しました`);

    } catch (error) {
        console.error('エラーログ記録中にエラーが発生:', error.message);
    }
}
