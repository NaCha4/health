import { addDays, datesInRange } from './dates.js';
import { representative } from './energy.js';
import { labels, titleOf, type Entry, type Snapshot } from './schema.js';

export type Medication = Extract<Entry, { kind: 'medication' }>;
export function medicationPlans(entries: Entry[], date: string): Medication[] {
  const plans = entries.filter(
    (e): e is Medication => e.kind === 'medication' && !e.deletedAt && e.date <= date,
  );
  const superseded = new Set(plans.map((e) => e.previousId));
  return plans.filter((e) => !superseded.has(e.id)).sort((a, b) => a.name.localeCompare(b.name));
}
export function timeline(entries: Entry[], from: string, to: string) {
  return entries
    .filter(
      (e) =>
        !e.deletedAt &&
        e.date >= from &&
        e.date <= to &&
        [
          'medication',
          'dose',
          'symptom',
          'sleep',
          'weight',
          'meal',
          'workout',
          'body',
          'checkin',
        ].includes(e.kind),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        Date.parse(b.occurredAt ?? b.date + 'T00:00:00+09:00') -
          Date.parse(a.occurredAt ?? a.date + 'T00:00:00+09:00') ||
        b.createdAt.localeCompare(a.createdAt),
    );
}
export function sleepForDay(entries: Entry[], date: string) {
  const candidates = entries
    .filter(
      (e) =>
        !e.deletedAt &&
        e.date === date &&
        (e.kind === 'sleep' || (e.kind === 'checkin' && e.sleepHours != null)),
    )
    .sort(
      (a, b) =>
        Number(b.kind === 'sleep') - Number(a.kind === 'sleep') ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.id.localeCompare(a.id),
    );
  const entry = candidates[0];
  return entry
    ? {
        entry,
        hours:
          entry.kind === 'sleep' ? entry.hours : entry.kind === 'checkin' ? entry.sleepHours! : 0,
      }
    : null;
}
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export function healthPeriod(snapshot: Snapshot, from: string, to: string) {
  const dates = datesInRange(from, to),
    active = snapshot.entries.filter((e) => !e.deletedAt);
  const rows = active.filter((e) => e.date >= from && e.date <= to);
  const sleeps = dates.flatMap((d) => {
    const s = sleepForDay(active, d);
    return s ? [s] : [];
  });
  const weights = dates.flatMap((d) => {
    const w = representative(active, d);
    return w ? [w] : [];
  });
  const symptoms = rows.filter(
    (e): e is Extract<Entry, { kind: 'symptom' }> => e.kind === 'symptom',
  );
  const doses = rows.filter((e): e is Extract<Entry, { kind: 'dose' }> => e.kind === 'dose');
  const positiveSymptoms = symptoms.filter((e) => e.severity > 0);
  const symptomDates = new Set(positiveSymptoms.map((e) => e.date));
  // Only actual administrations in the selected period or the preceding day can overlap.
  const nearby = active.filter(
    (e) => e.kind === 'dose' && e.status === 'taken' && e.date >= addDays(from, -1) && e.date <= to,
  );
  const overlap = positiveSymptoms.filter((s) =>
    nearby.some((d) => s.date === d.date || s.date === addDays(d.date, 1)),
  );
  return {
    from,
    to,
    days: dates.length,
    version: snapshot.version,
    sleepAverage: mean(sleeps.map((s) => s.hours)),
    sleepDays: sleeps.length,
    weightAverage: mean(weights.map((e) => e.kg)),
    weightDays: weights.length,
    symptomCount: symptoms.length,
    symptomDays: symptomDates.size,
    severityAverage: mean(symptoms.map((e) => e.severity)),
    taken: doses.filter((e) => e.status === 'taken').length,
    skipped: doses.filter((e) => e.status === 'skipped').length,
    overlapDays: new Set(overlap.map((e) => e.date)).size,
    patternEvidence: [
      ...new Set([
        ...overlap.map((e) => e.id),
        ...nearby
          .filter((d) => overlap.some((s) => s.date === d.date || s.date === addDays(d.date, 1)))
          .map((e) => e.id),
      ]),
    ],
    evidenceIds: [
      ...new Set([
        ...sleeps.map((s) => s.entry.id),
        ...weights.map((w) => w.id),
        ...symptoms.map((s) => s.id),
        ...doses.map((d) => d.id),
      ]),
    ],
  };
}
export function compareHealth(snapshot: Snapshot, from: string, to: string) {
  const current = healthPeriod(snapshot, from, to),
    previous = healthPeriod(snapshot, addDays(from, -current.days), addDays(from, -1));
  return {
    current,
    previous,
    sleepDelta:
      current.sleepAverage != null && previous.sleepAverage != null
        ? current.sleepAverage - previous.sleepAverage
        : null,
    weightDelta:
      current.weightAverage != null && previous.weightAverage != null
        ? current.weightAverage - previous.weightAverage
        : null,
  };
}
function csvCell(v: unknown) {
  const s = String(v ?? '');
  return '"' + (/^[\s]*[=+\-@\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"';
}
export function timelineCsv(entries: Entry[], from: string, to: string) {
  const rows = [
    [
      '날짜',
      '한국 시간',
      '종류',
      '제목',
      '처방 기록 ID',
      '처방 용량',
      '처방 일정',
      '실제 투여량',
      '상태',
      '수면 시간',
      '증상 강도',
      '체중 kg',
      '메모',
      'ID',
      '전체 입력 JSON',
    ],
    ...timeline(entries, from, to).map((e) => [
      e.date,
      e.occurredAt
        ? new Date(e.occurredAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul' })
        : '',
      labels[e.kind],
      titleOf(e),
      e.kind === 'dose' ? e.medicationId : e.kind === 'medication' ? e.previousId : '',
      e.kind === 'medication' ? e.dose : '',
      e.kind === 'medication' ? e.schedule : '',
      e.kind === 'dose' ? e.actualDose : '',
      'status' in e ? e.status : '',
      e.kind === 'sleep' ? e.hours : e.kind === 'checkin' ? e.sleepHours : '',
      e.kind === 'symptom' ? e.severity : '',
      e.kind === 'weight' ? e.kg : '',
      e.note,
      e.id,
      JSON.stringify(e),
    ]),
  ];
  return '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}
