import {
  FITNESS_TIME_ZONE,
  type FitnessAppointment,
} from "../../domain/fitness";
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: FITNESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
export function shanghaiParts(value: Date | string) {
  const p = Object.fromEntries(
    formatter.formatToParts(new Date(value)).map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    seconds: p.second,
  };
}
export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function shiftMonth(month: string, offset: number) {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
}
export function monthDays(month: string) {
  const first = `${month}-01`;
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => addDays(first, i - offset));
}
export function localInstant(date: string, time: string) {
  const desired = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(desired)) throw Error("请填写有效日期和时间。");
  let result = desired;
  for (let i = 0; i < 3; i++) {
    const p = shanghaiParts(new Date(result));
    const represented = Date.parse(`${p.date}T${p.time}:${p.seconds}Z`);
    result += desired - represented;
  }
  const p = shanghaiParts(new Date(result));
  if (p.date !== date || p.time !== time)
    throw Error("该时间在上海时区不存在，请调整。");
  return new Date(result).toISOString();
}
export function compareAppointments(
  a: FitnessAppointment,
  b: FitnessAppointment,
) {
  return a.start_at.localeCompare(b.start_at) || a.id.localeCompare(b.id);
}
export function timeLabel(row: FitnessAppointment) {
  if (row.time_kind === "all_day") return "全天";
  return `${shanghaiParts(row.start_at).time}–${shanghaiParts(row.end_at).time}`;
}
