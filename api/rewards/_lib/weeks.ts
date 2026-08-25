/** ISO timestamp of the Monday 00:00 UTC that starts the week containing `value`. */
export function getWeekStartIso(value: Date) {
  const weekStart = new Date(value);
  const dayOffset = (weekStart.getUTCDay() + 6) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - dayOffset);
  weekStart.setUTCHours(0, 0, 0, 0);
  return weekStart.toISOString();
}
