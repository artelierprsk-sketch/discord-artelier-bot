// utils/shiftDate.js
export function isWithinCollectPeriod(dateStr, now = new Date()) {
    const date = new Date(`${dateStr}T00:00:00+09:00`);
  
    const start = new Date(date);
    start.setDate(start.getDate() - 10);
    start.setHours(0, 0, 0, 0);
  
    const end = new Date(date);
    end.setHours(0, 0, 0, 0); // 当日0時は含めない
  
    return now >= start && now < end;
  }
  