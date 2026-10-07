export const ZONE = 'Asia/Seoul';
export function today(now = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day'].map((k) => p.find((x) => x.type === k)!.value).join('-');
}
export function isFutureOccurrence(
  entry: { date: string; occurredAt?: string },
  now = new Date(),
): boolean {
  return (
    entry.date > today(now) ||
    (entry.occurredAt != null && Date.parse(entry.occurredAt) > now.getTime())
  );
}
export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((+new Date(b + 'T00:00:00Z') - +new Date(a + 'T00:00:00Z')) / 86400000);
}
export function datesInRange(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  if (n < 0 || n > 365) throw new Error('조회 기간은 366일 이내여야 합니다.');
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}
export function ageAt(birth: string, date: string): number {
  return (
    Number(date.slice(0, 4)) - Number(birth.slice(0, 4)) - (date.slice(5) < birth.slice(5) ? 1 : 0)
  );
}
