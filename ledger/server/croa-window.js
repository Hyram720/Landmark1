// Conservative CROA cancellation window for self-signup.
// America/New_York. Monday through Friday only. Federal holidays (5 U.S.C. § 6103(a))
// are skipped on both the actual date and the observed date, including observances
// that fall in the previous or next year. CROA does not define "business day";
// this calendar is never shorter than a Sunday-and-holiday-only count.
// Deadline is 11:59:59.999 PM Eastern on the 3rd business day, stored as a UTC instant.

const TZ = 'America/New_York';

export function etParts(instant) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(dtf.formatToParts(instant).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}

export function ymdFromParts(p) {
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function etYmd(instant) {
  return ymdFromParts(etParts(instant instanceof Date ? instant : new Date(instant)));
}

export function addCalendarDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function weekdayUtc(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function nthWeekday(year, monthIndex, weekday, n) {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  let count = 0;
  while (count < n) {
    if (d.getUTCDay() === weekday) count += 1;
    if (count === n) break;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

function lastWeekday(year, monthIndex, weekday) {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0));
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function observe(ymd, into) {
  into.add(ymd);
  const wd = weekdayUtc(ymd);
  if (wd === 6) into.add(addCalendarDays(ymd, -1));
  if (wd === 0) into.add(addCalendarDays(ymd, 1));
}

export function federalHolidayDates(year) {
  const dates = new Set();
  [[1, 1], [6, 19], [7, 4], [11, 11], [12, 25]].forEach(([month, day]) => {
    observe(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, dates);
  });
  [nthWeekday(year, 0, 1, 3), nthWeekday(year, 1, 1, 3), lastWeekday(year, 4, 1), nthWeekday(year, 8, 1, 1), nthWeekday(year, 9, 1, 2), nthWeekday(year, 10, 4, 4)].forEach(d => dates.add(d));
  return dates;
}

export function holidaySetFor(ymd) {
  const year = Number(String(ymd).slice(0, 4));
  const set = new Set();
  for (const y of [year - 1, year, year + 1]) for (const d of federalHolidayDates(y)) set.add(d);
  return set;
}

export function isBusinessDay(ymd, holidays) {
  const wd = weekdayUtc(ymd);
  if (wd === 0 || wd === 6) return false;
  return !holidays.has(ymd);
}

/** 11:59:59.999 PM America/New_York on ymd, as a Date. */
export function etEndInstant(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  for (const offsetHours of [5, 4]) {
    const t = Date.UTC(y, m - 1, d, 23, 59, 59, 999) + offsetHours * 3600 * 1000;
    const p = etParts(new Date(t));
    if (p.year === y && p.month === m && p.day === d && p.hour === 23 && p.minute === 59 && p.second === 59) return new Date(t);
  }
  throw new Error('Could not resolve Eastern end of day ' + ymd);
}

export function signingInstant(value, now = new Date()) {
  if (value instanceof Date) return value;
  const s = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return etEndInstant(s); // date-only: end of that Eastern day is too late for "signed at". Use noon.
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return now;
}

export function noonEt(ymd) {
  const end = etEndInstant(ymd).getTime();
  return new Date(end - (11 * 3600 + 59 * 60 + 59) * 1000 - 999);
}

export function cancellationWindow(signedAt, now = new Date()) {
  const instant = signedAt instanceof Date ? signedAt : (/^\d{4}-\d{2}-\d{2}$/.test(String(signedAt)) ? noonEt(signedAt) : new Date(signedAt));
  const when = Number.isNaN(instant.getTime()) ? now : instant;
  const signingDateEt = etYmd(when);
  const holidays = holidaySetFor(signingDateEt);
  let ymd = signingDateEt;
  let counted = 0;
  while (counted < 3) {
    ymd = addCalendarDays(ymd, 1);
    const around = holidaySetFor(ymd);
    if (isBusinessDay(ymd, around)) counted += 1;
  }
  const deadlineInstant = etEndInstant(ymd);
  return { signingDateEt, deadlineDateEt: ymd, deadlineInstant, open: now.getTime() <= deadlineInstant.getTime() };
}

export function formatDocumentTimeEt(instant) {
  const p = etParts(instant instanceof Date ? instant : new Date(instant));
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const hour24 = p.hour;
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  const hour = hour24 % 12 || 12;
  const minute = String(p.minute).padStart(2, '0');
  return `${months[p.month - 1]} ${p.day}, ${p.year}, ${hour}:${minute} ${ampm} ET`;
}

/** Consumer-facing cancellation date: "Tuesday, December 1, 2026". No clock and no time zone. */
export function formatDeadlineDateEt(instant) {
  const when = instant instanceof Date ? instant : new Date(instant);
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(when);
}

export function formatDeadlineEt(instant) {
  return formatDeadlineDateEt(instant);
}
