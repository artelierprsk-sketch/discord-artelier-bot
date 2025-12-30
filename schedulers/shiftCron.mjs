import cron from "node-cron";
import { collectShift } from "../services/shiftCollector.mjs";

function isWithinCollectPeriod(dateString) {
  const now = new Date();

  const eventDate = new Date(dateString);
  eventDate.setHours(0, 0, 0, 0);

  const start = new Date(eventDate);
  start.setDate(start.getDate() - 10);

  return now >= start && now < eventDate;
}

export function startShiftCron(client, shiftDefinitions, onComplete) {
  cron.schedule("*/5 * * * *", async () => {
    console.log("⏰ 定時シフト集計を開始します");

    try {
      const targets = shiftDefinitions.filter(def =>
        isWithinCollectPeriod(def.date)
      );
      console.log(`targets.length = ${targets.length}`);

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
