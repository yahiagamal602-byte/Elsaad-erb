const FORMULA_PREFIX = /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u;

export function encodeCsvCell(value: string | number): string {
  const text = String(value);
  const safeText = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function encodeCsv(rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  return `\uFEFF${rows.map((row) => row.map(encodeCsvCell).join(',')).join('\r\n')}`;
}
