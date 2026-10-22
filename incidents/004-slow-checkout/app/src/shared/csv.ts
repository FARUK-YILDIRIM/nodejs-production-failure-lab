const NEEDS_QUOTING = /[",\r\n]/;

function escapeCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return NEEDS_QUOTING.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180 CSV with a header row and a trailing newline. */
export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [header.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  return `${lines.join('\n')}\n`;
}
