export interface WeekContext {
  monday: Date;
  sunday: Date;
  weekNumber: number;
}

export function getWeekContext(now: Date = new Date()): WeekContext {
  const dayOfWeek = now.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + mondayOffset);
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  const jan1 = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
  const weekNumber = Math.ceil(
    ((monday.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7,
  );

  return { monday, sunday, weekNumber };
}
