/**
 * @file 15_SpreadsheetRepository.gs
 * @description データ永続化（スプレッドシート操作）モジュール。
 * スプレッドシートへのすべての書き込み操作を担当します。
 * 在庫データの更新、エラーログ・リトライログの記録、実行タイムスタンプの保存を一元管理します。
 * データの取得・整形は行わず、受け取ったデータを書き込む責務に特化しています。
 *
 * ### 依存関係
 * - **参照元**: 10_Main.gs (updateBatchInventoryData, logErrorsToSheet, logRetryStatsToSheet, recordExecutionTimestamp)
 * - **参照先**:
 *   - 11_Config.gs (COLUMNS, getSpreadsheetConfig)
 *   - 12_Logger.gs (logWithLevel, logError, retryStats)
 *
 * ### 管理するシート
 * - **対象シート (SHEET_NAME)**: 在庫データの更新先（メインシート）
 * - **エラーログシート**: 処理中のエラーを蓄積記録（自動生成）
 * - **リトライログシート**: リトライ発生時の統計を蓄積記録（自動生成）
 * - **LOG_SHEETシート**: 実行タイムスタンプ記録先
 *
 * ### 一括更新の最適化 (updateBatchInventoryData)
 * 連続した行をグループ化して1回の `setValues()` で複数行を一括書き込みします。
 * これにより `SpreadsheetApp` への呼び出し回数を最小化し処理速度を向上させています。
 *
 * @version 2.1
 * @see updateBatchInventoryData
 * @see updateRowWithInventoryData
 * @see logErrorsToSheet
 * @see logRetryStatsToSheet
 * @see recordExecutionTimestamp
 */

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

/**
 * リトライ統計をスプレッドシートに記録
 */
function logRetryStatsToSheet() {
    // 【記録スキップ条件】
    // 条件1: リトライ総回数が0回（正常完了）
    if (retryStats.totalRetries === 0) {
        logWithLevel(LOG_LEVEL.DETAILED, 'リトライ0回: ログ記録スキップ');
        return;
    }

    try {
        const { SPREADSHEET_ID } = getSpreadsheetConfig();
        const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
        let retryLogSheet = spreadsheet.getSheetByName('リトライログ');

        if (!retryLogSheet) {
            retryLogSheet = spreadsheet.insertSheet('リトライログ');
            const headers = [
                '実行日時', '総リトライ回数', 'リトライ発生バッチ数',
                '最大リトライ回数', 'リトライ発生率(%)', '備考'
            ];
            retryLogSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
            retryLogSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
            retryLogSheet.getRange(1, 1, 1, headers.length).setBackground('#f3f3f3');
        }

        const totalBatches = retryStats.retriesByBatch.length;
        const retryRate = totalBatches > 0
            ? (retryStats.batchesWithRetry / totalBatches * 100).toFixed(1)
            : 0;

        // ★★★ 条件2: リトライ発生率が0% ★★★
        // 【記録スキップ条件】
        // 条件2: リトライ発生率が0%（統計上意味のないデータを蓄積しない）
        if (parseFloat(retryRate) === 0) {
            logWithLevel(LOG_LEVEL.DETAILED, 'リトライ発生率0%: ログ記録スキップ');
            return;
        }

        let note = '';
        if (retryRate > 10) {
            note = 'リトライ率高（要確認）';
        } else if (retryStats.totalRetries > 0) {
            note = '正常（軽微なリトライ）';
        }

        const logRow = [
            new Date(),
            retryStats.totalRetries,
            retryStats.batchesWithRetry,
            retryStats.maxRetriesUsed,
            retryRate,
            note
        ];

        const lastRow = retryLogSheet.getLastRow();
        retryLogSheet.getRange(lastRow + 1, 1, 1, 6).setValues([logRow]);
        retryLogSheet.getRange(lastRow + 1, 1, 1, 1).setNumberFormat('yyyy/mm/dd hh:mm:ss');

        logWithLevel(LOG_LEVEL.SUMMARY, 'リトライ統計をシートに記録しました');

    } catch (error) {
        logError('リトライログ記録エラー:', error.message);
    }
}

/**
 * 実行完了日時を記録
 */
function recordExecutionTimestamp() {
    try {
        const properties = PropertiesService.getScriptProperties();
        const spreadsheetId = properties.getProperty('SPREADSHEET_ID');
        const sheetName = properties.getProperty('LOG_SHEET_NAME');

        if (!spreadsheetId || !sheetName) {
            throw new Error('スクリプトプロパティ SPREADSHEET_ID または LOG_SHEET_NAME が設定されていません。');
        }

        const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
        const sheet = spreadsheet.getSheetByName(sheetName);

        if (!sheet) {
            console.error(`シート "${sheetName}" が見つかりません。日時の記録をスキップします。`);
            return;
        }

        // 実行完了日時をA1セルに上書き保存する
        // このセルを他の用途に使用すると日時が上書きされるため注意
        sheet.getRange(1, 1).setValue(
            Utilities.formatDate(new Date(), 'JST', 'MM月dd日HH時mm分ss秒')
        );
        console.log(`実行日時をシート "${sheetName}" のA1セルに記録しました。`);

    } catch (error) {
        console.error('実行日時の記録中にエラーが発生しました:', error.message);
    }
}

/**
 * リトライログの動作テスト
 */
function testRetryLogging() {
    console.log('=== リトライログ動作テスト ===\n');

    // ケース1: リトライ0回の場合
    console.log('【ケース1】リトライ0回');
    resetRetryStats();
    logRetryStatsToSheet();
    console.log('→ ログに記録されましたか？(シートを確認)\n');

    // ケース2: リトライ1回の場合
    console.log('【ケース2】リトライ1回');
    resetRetryStats();
    recordRetryAttempt(1, 2);  // バッチ1で2回目の試行
    showRetryStats();
    logRetryStatsToSheet();
    console.log('→ ログに記録されましたか？(シートを確認)\n');

    // ケース3: 現在のリトライログシートの状態確認
    console.log('【ケース3】現在のログ確認');
    const { SPREADSHEET_ID } = getSpreadsheetConfig();
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const retryLogSheet = spreadsheet.getSheetByName('リトライログ');

    if (retryLogSheet) {
        const lastRow = retryLogSheet.getLastRow();
        console.log(`リトライログ行数: ${lastRow}行`);

        if (lastRow > 1) {
            const lastData = retryLogSheet.getRange(lastRow, 1, 1, 6).getValues()[0];
            console.log('\n最新行:');
            console.log(`  実行日時: ${lastData[0]}`);
            console.log(`  総リトライ回数: ${lastData[1]}`);
            console.log(`  リトライ発生バッチ数: ${lastData[2]}`);
            console.log(`  最大リトライ回数: ${lastData[3]}`);
            console.log(`  リトライ発生率: ${lastData[4]}%`);
            console.log(`  備考: ${lastData[5]}`);
        }
    } else {
        console.log('リトライログシートが存在しません');
    }
}

/**
 * リトライ機能の最終動作確認
 */
function finalRetryTest() {
    console.log('=== リトライ機能 最終動作確認 ===\n');

    // テスト1: リトライなしの場合
    console.log('【テスト1】リトライなし');
    resetRetryStats();

    // 正常なAPI呼び出しをシミュレート(バッチ4個)
    // recordRetryAttemptは呼ばれない想定

    showRetryStats();
    console.log('期待結果: リトライ統計情報が表示されない\n');

    logRetryStatsToSheet();
    console.log('期待結果: 「リトライ0回: ログ記録スキップ」と表示される\n\n');


    // テスト2: リトライ発生の場合
    console.log('【テスト2】リトライ発生');
    resetRetryStats();

    // バッチ1: 2回目の試行で成功(リトライ1回)
    recordRetryAttempt(0, 2);

    // バッチ2-4: 1回目で成功(リトライなし)
    // recordRetryAttemptは呼ばれない

    // retriesByBatchに要素を追加(バッチ総数をシミュレート)
    retryStats.retriesByBatch[0] = 2;
    retryStats.retriesByBatch[1] = 1;
    retryStats.retriesByBatch[2] = 1;
    retryStats.retriesByBatch[3] = 1;

    showRetryStats();
    console.log('期待結果:');
    console.log('  総リトライ回数: 1回');
    console.log('  リトライ発生バッチ: 1個');
    console.log('  最大リトライ回数: 2回');
    console.log('  リトライ発生率: 25.0%\n');

    logRetryStatsToSheet();
    console.log('期待結果: シートに記録される\n\n');


    // テスト3: リトライログシート確認
    console.log('【テスト3】リトライログシート確認');
    const { SPREADSHEET_ID } = getSpreadsheetConfig();
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const retryLogSheet = spreadsheet.getSheetByName('リトライログ');

    if (retryLogSheet) {
        const lastRow = retryLogSheet.getLastRow();
        console.log(`総行数: ${lastRow}行`);

        if (lastRow > 1) {
            console.log('\n最新の5件:');
            const startRow = Math.max(2, lastRow - 4);
            const data = retryLogSheet.getRange(startRow, 1, lastRow - startRow + 1, 6).getValues();

            data.forEach((row, index) => {
                const actualRow = startRow + index;
                const retryRate = parseFloat(row[4]);

                console.log(`\n[行${actualRow}]`);
                console.log(`  実行日時: ${Utilities.formatDate(row[0], 'JST', 'MM/dd HH:mm:ss')}`);
                console.log(`  総リトライ回数: ${row[1]}`);
                console.log(`  リトライ発生バッチ数: ${row[2]}`);
                console.log(`  リトライ発生率: ${row[4]}%`);
                console.log(`  備考: ${row[5]}`);

                // 検証
                if (retryRate === 0) {
                    console.log('  ⚠️ 警告: リトライ発生率0%の行が残っています');
                } else {
                    console.log('  ✓ OK');
                }
            });
        }

        console.log('\n期待結果: リトライ発生率0%の行が存在しない');
    } else {
        console.log('リトライログシートが存在しません');
    }

    console.log('\n=== テスト完了 ===');
}

/**
 * =============================================================================
 * Phase 4: 全件データ書き込み関数
 * =============================================================================
 *
 * 【追加内容】
 * - writeAllInventoryData() : ヘッダー行を書き込んだ後、
 *                             全商品データをA〜L列に一括書き込みする
 * - testPhase4_WriteTest()  : テスト用スプレッドシートで書き込み動作を確認する
 *
 * 【既存コードへの影響】
 * 追記のみのため既存関数への影響はありません
 *
 * 【書き込み仕様】
 * - 1行目: ヘッダー行（固定）を毎回上書き
 * - 2行目以降: 既存データを全削除してから全件書き込み
 * - setValues() を2回（ヘッダー1回＋データ1回）で完結させる設計
 *   → SpreadsheetApp への呼び出し回数を最小化して処理速度を向上
 * =============================================================================
 */

// ----------------------------------------------------------------------------
// 定数定義
// ----------------------------------------------------------------------------

// スプレッドシートのヘッダー行（1行目）
// COLUMNS 定義（11_Config.gs）の列順序と対応
const INVENTORY_SHEET_HEADERS = [
    '商品コード',       // A列
    '商品名',           // B列
    '在庫数',           // C列
    '引当数',           // D列
    'フリー在庫数',     // E列
    '予約在庫数',       // F列
    '予約引当数',       // G列
    '予約フリー在庫数', // H列
    '不良在庫数',       // I列
    '発注残数',         // J列
    '欠品数',           // K列
    'JANコード'         // L列
];

// ----------------------------------------------------------------------------
// 公開関数
// ----------------------------------------------------------------------------

/**
 * 全商品データをスプレッドシートに一括書き込み
 *
 * 【処理フロー】
 * 1. シートの2行目以降を全削除（既存データをクリア）
 * 2. 1行目にヘッダー行を書き込み
 * 3. 2行目以降にデータを一括書き込み（setValues() 1回で完結）
 *
 * 【削除範囲について】
 * deleteRows() ではなく clearContents() を使用する
 * deleteRows() は行数が多い場合に処理が遅くなるため
 * clearContents() で内容のみ削除してから上書きする方式を採用
 *
 * @param {Sheet}  sheet - 書き込み対象のシートオブジェクト
 * @param {Array}  rows  - buildInventoryDataRows() の返却値（2次元配列）
 * @return {Object}      - { headerWritten: boolean, dataRows: number }
 */
function writeAllInventoryData(sheet, rows) {
    logWithLevel(LOG_LEVEL.SUMMARY, `シート書き込み開始: ${rows.length}行`);

    // Step 1: 2行目以降の既存データをクリア
    // getLastRow() が1以下の場合（データなし）はクリア不要
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, 12).clear({ contentsOnly: true });
        logWithLevel(LOG_LEVEL.SUMMARY, `既存データ削除完了: ${lastRow - 1}行`);
    }

    // Step 2: ヘッダー行を1行目に書き込み
    sheet.getRange(1, 1, 1, INVENTORY_SHEET_HEADERS.length)
        .setValues([INVENTORY_SHEET_HEADERS]);
    logWithLevel(LOG_LEVEL.SUMMARY, 'ヘッダー行書き込み完了');

    // Step 3: データを2行目以降に一括書き込み
    // データが0件の場合は書き込みをスキップ
    if (rows.length === 0) {
        logWithLevel(LOG_LEVEL.SUMMARY, 'データが0件のため書き込みをスキップ');
        return { headerWritten: true, dataRows: 0 };
    }

    sheet.getRange(2, 1, rows.length, INVENTORY_SHEET_HEADERS.length)
        .setValues(rows);

    logWithLevel(LOG_LEVEL.SUMMARY, `データ書き込み完了: ${rows.length}行`);

    return {
        headerWritten: true,
        dataRows: rows.length
    };
}

// ----------------------------------------------------------------------------
// テスト関数
// ----------------------------------------------------------------------------

/**
 * Phase 4 書き込み動作確認テスト
 *
 * 【確認内容】
 * 1. テスト用スプレッドシートにヘッダーが正しく書き込まれるか
 * 2. データが正しく書き込まれるか（先頭5件のみ）
 * 3. 既存データが正しくクリアされるか
 *
 * 【注意】
 * テスト用スプレッドシートのIDをスクリプトプロパティ
 * 「TEST_SPREADSHEET_ID」に設定してから実行してください
 * 本番スプレッドシートへの書き込みは行いません
 *
 * 【テスト用スプレッドシートの準備】
 * 1. 本番スプレッドシートをコピーして別のスプレッドシートを作成
 * 2. そのIDをスクリプトプロパティ TEST_SPREADSHEET_ID に設定
 * 3. この関数を実行
 */
function testPhase4_WriteTest() {
    console.log('=== Phase 4 書き込みテスト ===\n');

    try {
        // テスト用スプレッドシートIDの確認
        const properties = PropertiesService.getScriptProperties();
        const testSheetId = properties.getProperty('TEST_SPREADSHEET_ID');

        if (!testSheetId) {
            console.log('❌ TEST_SPREADSHEET_ID が設定されていません');
            console.log('スクリプトプロパティに TEST_SPREADSHEET_ID を設定してください');
            console.log('値: 本番スプレッドシートのコピーのID');
            return;
        }

        // テスト用スプレッドシートへの接続確認
        const testSpreadsheet = SpreadsheetApp.openById(testSheetId);
        const { SHEET_NAME } = getSpreadsheetConfig();
        const testSheet = testSpreadsheet.getSheetByName(SHEET_NAME);

        if (!testSheet) {
            console.log(`❌ テスト用シート "${SHEET_NAME}" が見つかりません`);
            return;
        }

        console.log(`テスト用スプレッドシート: ${testSpreadsheet.getName()}`);
        console.log(`テスト用シート: ${SHEET_NAME}`);
        console.log(`書き込み前の行数: ${testSheet.getLastRow()}行\n`);

        // APIから先頭5件のみ取得（テスト用）
        const tokens = getStoredTokens();
        const { data: sampleData, updatedTokens } = fetchGoodsDataOnePage_(tokens, 5, 0);
        // トークンが更新された場合はスクリプトプロパティに保存する
        if (updatedTokens) {
            updateStoredTokens(updatedTokens.accessToken, updatedTokens.refreshToken);
        }

        // テスト用ダミー Map を構築
        const testMap = new Map();
        sampleData.forEach(item => testMap.set(item.goods_id, item));

        console.log(`テストデータ: ${testMap.size}件\n`);

        // データ整形
        const rows = buildInventoryDataRows(testMap);

        // 書き込み実行
        const result = writeAllInventoryData(testSheet, rows);

        // 結果確認
        console.log('\n【書き込み結果確認】');
        console.log(`ヘッダー書き込み: ${result.headerWritten ? '✓' : '❌'}`);
        console.log(`データ行数: ${result.dataRows}行`);

        // ヘッダー内容確認
        const writtenHeaders = testSheet.getRange(1, 1, 1, INVENTORY_SHEET_HEADERS.length)
            .getValues()[0];
        console.log('\n【ヘッダー確認】');
        INVENTORY_SHEET_HEADERS.forEach((expected, index) => {
            const actual = writtenHeaders[index];
            const isMatch = actual === expected;
            console.log(`  ${String.fromCharCode(65 + index)}列: ${isMatch ? '✓' : '❌'} "${actual}"`);
        });

        // データ内容確認（先頭3行）
        const writtenData = testSheet.getRange(2, 1, Math.min(3, result.dataRows), 12)
            .getValues();
        console.log('\n【データ確認（先頭3件）】');
        writtenData.forEach((row, index) => {
            console.log(`  [${index + 1}] ${row[0]} | ${row[1]} | 在庫:${row[2]} | JANコード:${row[11]}`);
        });

        console.log('\n✓ Phase 4 テスト完了');
        console.log('上記の結果に問題がなければ Phase 5 に進めます');

    } catch (error) {
        console.error(`テストエラー: ${error.message}`);
        console.error(error.stack);
    }
}