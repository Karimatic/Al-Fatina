/**
 * One CSV cell for a spreadsheet (Excel, Google Sheets). Text typed by customers (a name, an
 * address) that starts with = + - @ (or a tab / return) would run as a formula when the file is
 * opened: it gets a leading quote so it stays plain text.
 */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
