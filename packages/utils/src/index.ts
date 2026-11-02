export function percent(correct: number, total: number) {
  return total ? Math.round((correct / total) * 100) : 0;
}
export function shanghaiDay(date: Date | string = new Date()) {
  return new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}
export function formatDate(value: string | Date | null | undefined) {
  return value
    ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    : '未公布';
}
export function csvCell(value: unknown) {
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
