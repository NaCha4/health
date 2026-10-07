import type { Snapshot } from '../shared/schema';
import { summarize } from '../shared/energy';
import { addDays, daysBetween } from '../shared/dates';
const fmt = (n: number | null, d = 0) =>
  n == null
    ? '미상'
    : n.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });
const short = (d: string) => d.slice(5).replace('-', '.');
export default function TrendExtras({
  snapshot,
  from,
  to,
}: {
  snapshot: Snapshot;
  from: string;
  to: string;
}) {
  const current = summarize(snapshot, from, to),
    count = daysBetween(from, to) + 1,
    beforeTo = addDays(from, -1),
    beforeFrom = addDays(from, -count),
    before = summarize(snapshot, beforeFrom, beforeTo);
  const days = current.days,
    max = Math.max(1, ...days.flatMap((d) => [d.intake.value ?? 0, d.totalExpenditure ?? 0]));
  const w = 640,
    h = 180,
    left = 40,
    right = 10,
    top = 15,
    bottom = 30,
    plot = w - left - right,
    bar = plot / days.length;
  const y = (n: number) => top + (1 - n / max) * (h - top - bottom);
  const weeks = Array.from({ length: Math.ceil(count / 7) }, (_, i) => {
    const group = days.slice(i * 7, i * 7 + 7);
    return {
      from: group[0].date,
      to: group.at(-1)!.date,
      minutes: group.reduce((v, d) => v + d.workoutMinutes, 0),
      complete: group.filter((d) => d.activityComplete).length,
      days: group.length,
    };
  });
  const weeklyMax = Math.max(1, ...weeks.map((w) => w.minutes));
  return (
    <>
      <section className="card trend-card energy-trend">
        <div className="section-line">
          <h2>섭취와 예상 소비의 흐름</h2>
          <div className="chart-legend">
            <span>
              <i />
              기록한 섭취
            </span>
            <span>
              <i />
              예상 소비
            </span>
          </div>
        </div>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label="일별 섭취량과 하루 예상 소비량. 정확한 값과 기록 완성도는 아래 표에서 볼 수 있습니다."
        >
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={left} x2={w - right} y1={y(max * t)} y2={y(max * t)} stroke="#e7eddf" />
              <text x="0" y={y(max * t) + 4}>
                {Math.round(max * t)}
              </text>
            </g>
          ))}
          {days.map((d, i) => (
            <g key={d.date}>
              {d.intake.value != null && (
                <rect
                  x={left + i * bar + bar * 0.12}
                  y={y(d.intake.value)}
                  width={bar * 0.34}
                  height={h - bottom - y(d.intake.value)}
                  fill="#799864"
                  opacity={d.mealsComplete ? 1 : 0.45}
                />
              )}{' '}
              {d.totalExpenditure != null && (
                <rect
                  x={left + i * bar + bar * 0.51}
                  y={y(d.totalExpenditure)}
                  width={bar * 0.34}
                  height={h - bottom - y(d.totalExpenditure)}
                  fill="#c8d7b8"
                />
              )}
            </g>
          ))}
          {[0, Math.floor((days.length - 1) / 2), days.length - 1]
            .filter((v, i, a) => a.indexOf(v) === i)
            .map((i) => (
              <text key={i} x={left + (i + 0.5) * bar} y={h - 6} textAnchor="middle">
                {short(days[i].date)}
              </text>
            ))}
        </svg>
        <p className="help">
          단위 kcal · 옅은 섭취 막대는 미완료 기록이에요. 빈 곳은 미상이며, 두 막대의 차이가 확정
          적자를 뜻하지 않습니다.
        </p>
      </section>
      <div className="extra-trend-grid">
        <section className="card trend-card">
          <h2>7일씩 모아본 움직임</h2>
          <p className="help">선택 기간의 시작일부터 7일 단위 · 완료한 운동</p>
          <div className="weekly-bars">
            {weeks.map((week) => (
              <div key={week.from}>
                <span>
                  {short(week.from)}–{short(week.to)}
                </span>
                <div className="weekly-track">
                  <i style={{ width: (week.minutes / weeklyMax) * 100 + '%' }} />
                </div>
                <strong>{fmt(week.minutes)}분</strong>
                <small>
                  활동 기록 완료 {week.complete}/{week.days}일
                </small>
              </div>
            ))}
          </div>
        </section>
        <section className="card trend-card comparison-card">
          <h2>같은 길이의 이전 기간과 비교</h2>
          <p className="help">
            이전: {short(beforeFrom)}–{short(beforeTo)}
            <br />
            선택: {short(from)}–{short(to)}
          </p>
          {[
            {
              label: '평균 체중',
              a: before.weightAverage,
              b: current.weightAverage,
              unit: 'kg',
              digits: 1,
              detail: `측정 ${before.weightDays}일 → ${current.weightDays}일`,
            },
            {
              label: '기록한 운동 시간',
              a: before.workoutMinutes,
              b: current.workoutMinutes,
              unit: '분',
              digits: 0,
              detail: `운동 ${before.workoutDays}일 → ${current.workoutDays}일`,
            },
            {
              label: '평균 섭취',
              a: before.intakeAverage,
              b: current.intakeAverage,
              unit: 'kcal',
              digits: 0,
              detail: `완료 ${before.completeMealDays}일 → ${current.completeMealDays}일`,
            },
          ].map((m) => (
            <div className="comparison-row" key={m.label}>
              <span>{m.label}</span>
              <strong>
                {fmt(m.a, m.digits)} → {fmt(m.b, m.digits)} {m.unit}
              </strong>
              <small>{m.detail}</small>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
