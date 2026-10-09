const p = (n: number) => String(n).padStart(2, "0");

/** `2026-10-09 14:07:21` — local time, ISO-ordered, locale-independent. */
export function fmtDateTime(value: string | number) {
  const d = new Date(value);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** `2026-10-09` */
export function fmtDate(value: string | number) {
  const d = new Date(value);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** `14:07:21` */
export function fmtTime(value: string | number) {
  const d = new Date(value);
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
