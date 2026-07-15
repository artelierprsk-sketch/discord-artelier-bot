/*
 シフトのリアクションを集計し、Googleスプレッドシートに反映する
 */

import cron from "node-cron";
import { collectShift } from "../services/shiftCollector.mjs";

// 定数
// ----------------------------
const STR_CRON = "*/5 * * * *"; //cronの実行間隔
const collectDateSpan = 90; //シフトの集計期間 (当日の何日前から集計を開始するか)
// ----------------------------

// シフトの集計期間内かを判定して返す
function isWithinCollectPeriod(dateString) {
  const now = new Date();

  const eventDate = new Date(dateString);
  eventDate.setHours(23, 0, 0, 0);

  const start = new Date(eventDate);
  start.setDate(start.getDate() - collectDateSpan);

  return ((now >= start) && (now <= eventDate));
}

// 集計 (cronによる定時実行)
export function startShiftCron(client, shiftDefinitions, onComplete) {
  cron.schedule(STR_CRON, async () => {
    console.log("⏰ 定時シフト集計を開始します");

    try {
      const targets = shiftDefinitions.filter(def =>
        isWithinCollectPeriod(def.date)
      );
      console.log(`shiftDefinitions.length = ${shiftDefinitions.length} targets.length = ${targets.length}`);

      for (const def of targets) {
        await collectShift(client, def);
      }

      if (targets.length > 0 && typeof onComplete === "function") {
        await onComplete(targets); // ★ 対象 shift のみ
      }
    } catch (err) {
      console.error("❌ 定時シフト集計中にエラー:", err);
    }
  });
}
