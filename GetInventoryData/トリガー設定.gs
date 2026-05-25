/**
 * =============================================================================
 * 【トリガー設定スクリプト 改良版】 当日/翌日選択可能なスケジュール管理
 * ステップ1：トリガー作成を try-catch で個別にラップ
 * =============================================================================
 *
 * 【目的】
 * スクリプトプロパティで指定された関数を、
 * 指定した時間に自動で実行するための時間ベースのトリガー（スケジュール）を
 * 当日または翌日に設定できるように管理します。
 * 
 * 【主な機能】
 * - 実行前に、既存の同名関数に紐づくトリガーのみを安全に削除します。
 * - TRIGGER_MODE に応じて、当日または翌日にトリガーを設定します。
 *   - TODAY: 現在時刻より後の時刻を当日に設定
 *   - TOMORROW: すべての時刻を翌日に設定
 * - 【改修】各トリガー作成を try-catch で個別に保護し、
 *   1つの失敗が他のトリガー作成に影響しないようにしました。
 * - 失敗したトリガー情報を個別に記録します。
 * 
 * 【スクリプトプロパティの設定方法】
 * 1. GASエディタで「プロジェクトの設定」を開く（歯車のアイコン）
 * 2. 「スクリプトプロパティ」セクションまでスクロール
 * 3. 「スクリプトプロパティの追加」をクリックし、以下のキーと値を設定
 * 
 * キー                     | 値
 * -------------------------|------------------------------------
 * TRIGGER_FUNCTION_NAME    | 実行したい関数名（例: updateStock）
 * TRIGGER_MODE             | TODAY または TOMORROW
 * 
 * 【TRIGGER_MODE の説明】
 * - TODAY: このスクリプト実行時刻より後の時刻のみ、当日に実行するトリガーを作成
 *   例）9:00に setTrigger() を実行した場合
 *       → 8:00はスキップ、10:00以降は当日に設定
 * 
 * - TOMORROW: すべての時刻を翌日に実行するトリガーとして作成
 *   例）23:00に setTrigger() を実行した場合
 *       → 8:00, 10:00... すべて翌日の時刻に設定
 * 
 * 【推奨運用】
 * - TODAY モード: 毎日早朝（例:0:30）に実行
 * - TOMORROW モード: 毎日夜（例:23:00）に実行
 * 
 * 【改修内容（ステップ1）】
 * - 各トリガー作成を try-catch で個別に保護
 * - 失敗したトリガー情報を配列に記録
 * - 失敗の詳細情報（時刻、エラーメッセージ、スケジュール時刻）をログ出力
 * - 成功/失敗の統計情報を最終ログで表示
 */

// スクリプトプロパティのキー定義
const PROPERTY_KEY_FUNCTION = 'TRIGGER_FUNCTION_NAME';
const PROPERTY_KEY_MODE = 'TRIGGER_MODE';

function setTrigger() {

    // スクリプトプロパティから設定を取得
    const properties = PropertiesService.getScriptProperties();
    const functionToTrigger = properties.getProperty(PROPERTY_KEY_FUNCTION);
    const triggerMode = properties.getProperty(PROPERTY_KEY_MODE);

    // 必須プロパティのチェック
    if (!functionToTrigger) {
        Logger.log(`エラー: スクリプトプロパティ '${PROPERTY_KEY_FUNCTION}' が設定されていません。`);
        return;
    }

    if (!triggerMode) {
        Logger.log(`エラー: スクリプトプロパティ '${PROPERTY_KEY_MODE}' が設定されていません。`);
        Logger.log(`'TODAY' または 'TOMORROW' を設定してください。`);
        return;
    }

    // モードの検証
    if (triggerMode !== 'TODAY' && triggerMode !== 'TOMORROW') {
        Logger.log(`エラー: TRIGGER_MODE の値が不正です: '${triggerMode}'`);
        Logger.log(`'TODAY' または 'TOMORROW' を設定してください。`);
        return;
    }

    Logger.log(`=== トリガー設定開始 ===`);
    Logger.log(`実行関数: ${functionToTrigger}`);
    Logger.log(`実行モード: ${triggerMode}`);

    // 既存のトリガーを削除(リトライ機能付き)
    try {
        deleteTriggersForFunction(functionToTrigger, 3, 500);
    } catch (error) {
        Logger.log(`⚠️ 既存トリガー削除で重大なエラー: ${error.message}`);
        Logger.log(`処理を継続しますが、トリガーが重複登録される可能性があります`);
        // エラーを記録するが、新規トリガー作成は続行
    }

    // 実行したい時刻（[時, 分]）の配列
    const executionTimes = [
        [8, 0],     // 8:00
        [10, 0],    // 10:00
        [13, 30],   // 13:30
        [16, 0],    // 16:00
        [19, 0],    // 19:00
        [21, 0],    // 21:00
    ];

    // 現在時刻を取得
    const now = new Date();
    let createdCount = 0;
    let skippedCount = 0;

    // 失敗したトリガー情報を保存する配列
    const failedTriggers = [];

    // 各時刻に対してトリガーを作成
    executionTimes.forEach(function (time) {
        const hour = time[0];
        const minute = time[1];

        // トリガー実行時刻を設定
        const triggerTime = new Date();
        triggerTime.setHours(hour);
        triggerTime.setMinutes(minute);
        triggerTime.setSeconds(0);
        triggerTime.setMilliseconds(0);

        // モードに応じて日付を調整
        if (triggerMode === 'TOMORROW') {
            // 翌日に設定
            triggerTime.setDate(triggerTime.getDate() + 1);
        } else if (triggerMode === 'TODAY') {
            // 現在時刻より前の時刻はスキップ
            if (triggerTime <= now) {
                Logger.log(`  スキップ: ${hour}:${String(minute).padStart(2, '0')} (既に経過)`);
                skippedCount++;
                return;
            }
        }

        // ★【改修】トリガー作成を try-catch で個別に保護
        try {
            ScriptApp.newTrigger(functionToTrigger)
                .timeBased()
                .at(triggerTime)
                .create();

            const dateStr = `${triggerTime.getMonth() + 1}/${triggerTime.getDate()}`;
            const timeStr = `${hour}:${String(minute).padStart(2, '0')}`;
            Logger.log(`  ✓ 作成: ${dateStr} ${timeStr}`);
            createdCount++;

        } catch (error) {
            // ★【改修】失敗情報を個別に記録
            const timeStr = `${hour}:${String(minute).padStart(2, '0')}`;
            const dateStr = `${triggerTime.getMonth() + 1}/${triggerTime.getDate()}`;

            Logger.log(`  ✗ 失敗: ${dateStr} ${timeStr} - ${error.message}`);

            failedTriggers.push({
                time: timeStr,
                date: dateStr,
                scheduledTime: triggerTime,
                errorMessage: error.message
            });
        }
    });

    Logger.log(`=== トリガー設定完了 ===`);
    Logger.log(`作成: ${createdCount} 件`);

    if (skippedCount > 0) {
        Logger.log(`スキップ: ${skippedCount} 件`);
    }

    // ★【改修】失敗したトリガーの統計情報を表示
    if (failedTriggers.length > 0) {
        Logger.log(`失敗: ${failedTriggers.length} 件`);
        failedTriggers.forEach(function (failed, index) {
            Logger.log(`  [失敗${index + 1}] ${failed.date} ${failed.time} - ${failed.errorMessage}`);
        });
    }
}

/**
 * 特定の関数に紐づく既存のトリガーをすべて削除(リトライ機能付き)
 * 
 * 【改修内容(Phase 1)】
 * - 各トリガー削除を個別にリトライ(最大3回)
 * - 削除失敗時は指数バックオフで待機
 * - トリガー間に500msのスリープを挿入(レート制限対策)
 * - 部分的な削除失敗時も処理を継続
 * - 全削除失敗時のみ例外をスロー
 * 
 * @param {string} functionName 削除対象のトリガーが実行する関数名
 * @param {number} maxRetry 最大リトライ回数(デフォルト: 3)
 * @param {number} baseSleepMs トリガー間のスリープ時間(デフォルト: 500ms)
 */
function deleteTriggersForFunction(functionName, maxRetry = 3, baseSleepMs = 500) {
    const triggers = ScriptApp.getProjectTriggers();
    const targetTriggers = triggers.filter(t => t.getHandlerFunction() === functionName);

    if (targetTriggers.length === 0) {
        Logger.log(`既存トリガー削除: 0 件 (対象なし)`);
        return;
    }

    Logger.log(`削除対象トリガー: ${targetTriggers.length} 件`);

    let deletedCount = 0;
    let failedCount = 0;
    const failedTriggers = [];

    // 各トリガーを個別に削除(リトライ付き)
    targetTriggers.forEach(function (trigger, index) {
        let success = false;

        for (let attempt = 0; attempt < maxRetry; attempt++) {
            try {
                // リトライ時は指数バックオフで待機
                if (attempt > 0) {
                    const waitTime = baseSleepMs * Math.pow(2, attempt - 1);
                    Logger.log(`  トリガー削除リトライ ${attempt + 1}/${maxRetry} (${waitTime}ms待機)`);
                    Utilities.sleep(waitTime);
                }

                ScriptApp.deleteTrigger(trigger);
                deletedCount++;
                success = true;

                // 削除成功後、次のトリガー削除前に短い待機(レート制限対策)
                if (index < targetTriggers.length - 1) {
                    Utilities.sleep(baseSleepMs);
                }

                break; // 成功したらリトライループを抜ける

            } catch (error) {
                if (attempt === maxRetry - 1) {
                    // 最終リトライでも失敗
                    Logger.log(`  ✗ トリガー削除失敗(${maxRetry}回試行): ${error.message}`);
                    failedCount++;
                    failedTriggers.push({
                        handlerFunction: trigger.getHandlerFunction(),
                        triggerId: trigger.getUniqueId(),
                        errorMessage: error.message
                    });
                }
            }
        }
    });

    Logger.log(`既存トリガー削除: 成功 ${deletedCount} 件, 失敗 ${failedCount} 件`);

    // 失敗があった場合は詳細を記録
    if (failedCount > 0) {
        Logger.log(`⚠️ トリガー削除に失敗したトリガーが ${failedCount} 件あります`);
        failedTriggers.forEach((failed, idx) => {
            Logger.log(`  [失敗${idx + 1}] ID: ${failed.triggerId}, エラー: ${failed.errorMessage}`);
        });

        // 部分的な失敗は処理を継続するが、全失敗の場合は警告
        if (failedCount === targetTriggers.length) {
            throw new Error(`全${targetTriggers.length}件のトリガー削除に失敗しました`);
        }
    }
}

/**
 * updateInventoryDataFromGoodsMaster 専用トリガー設定
 *
 * 【目的】
 * 商品マスタAPI全件取得関数を1日1回（0:10）実行するトリガーを設定する
 * updateInventoryDataBatchWithRetry のトリガーとは独立して管理する
 *
 * 【実行タイミング】
 * 毎日 0:10（在庫更新の最初のサイクルと同じ時刻）
 *
 * 【使用方法】
 * 1. setTriggerForGoodsMaster() を手動実行してトリガーを登録する
 * 2. 以降は自動実行されるため再実行不要
 * 3. トリガーを削除したい場合は deleteTriggerForGoodsMaster() を実行する
 */
function setTriggerForGoodsMaster() {
    const FUNCTION_NAME = 'updateInventoryDataFromGoodsMaster';
    const TRIGGER_HOUR = 0;
    const TRIGGER_MIN = 10;

    Logger.log(`=== ${FUNCTION_NAME} トリガー設定開始 ===`);

    // 既存トリガーを削除(重複登録防止、リトライ機能付き)
    try {
        deleteTriggersForFunction(FUNCTION_NAME, 3, 500);
    } catch (error) {
        Logger.log(`⚠️ 既存トリガー削除で重大なエラー: ${error.message}`);
        Logger.log(`処理を継続しますが、トリガーが重複登録される可能性があります`);
    }

    // 翌日の 0:10 にトリガーを設定
    const triggerTime = new Date();
    triggerTime.setDate(triggerTime.getDate() + 1);
    triggerTime.setHours(TRIGGER_HOUR);
    triggerTime.setMinutes(TRIGGER_MIN);
    triggerTime.setSeconds(0);
    triggerTime.setMilliseconds(0);

    try {
        ScriptApp.newTrigger(FUNCTION_NAME)
            .timeBased()
            .at(triggerTime)
            .create();

        const dateStr = `${triggerTime.getMonth() + 1}/${triggerTime.getDate()}`;
        Logger.log(`✓ トリガー作成: ${dateStr} ${TRIGGER_HOUR}:${String(TRIGGER_MIN).padStart(2, '0')}`);
        Logger.log(`実行関数: ${FUNCTION_NAME}`);
        Logger.log('=== トリガー設定完了 ===');

    } catch (error) {
        Logger.log(`✗ トリガー作成失敗: ${error.message}`);
    }
}

/**
 * updateInventoryDataFromGoodsMaster のトリガーを削除
 *
 * 【使用場面】
 * - トリガーを一時停止したい場合
 * - トリガーを再設定したい場合（削除後に setTriggerForGoodsMaster() を実行）
 */
function deleteTriggerForGoodsMaster() {
    const FUNCTION_NAME = 'updateInventoryDataFromGoodsMaster';

    Logger.log(`=== ${FUNCTION_NAME} トリガー削除 ===`);
    deleteTriggersForFunction(FUNCTION_NAME);
    Logger.log('=== 削除完了 ===');
}