export const recordingDay = (at: number | Date) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
export function recordingDayRange(day: string) {
  const date = new Date(`${day}T00:00:00`);
  const from = date.getTime();
  date.setDate(date.getDate() + 1);
  return { from, to: date.getTime() };
}
/** Local midnights, preserving 23/25-hour days at daylight-saving transitions. */
export function recordingMonthBoundaries(month: string) {
  const date = new Date(`${month}-01T00:00:00`);
  const current = date.getMonth();
  const boundaries = [date.getTime()];
  do {
    date.setDate(date.getDate() + 1);
    boundaries.push(date.getTime());
  } while (date.getMonth() === current);
  return boundaries;
}
