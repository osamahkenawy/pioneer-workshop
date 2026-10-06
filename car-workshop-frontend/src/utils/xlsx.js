/**
 * xlsx.js — one Excel writer for every export in the app.
 *
 * csv.js exists because each export had hand-rolled its own CSV and each was
 * wrong differently. This is the same idea for .xlsx: build sheets from plain
 * arrays, hand them here, get a real workbook.
 *
 * Why a real workbook and not CSV. A CSV holds one table, so a pack of five
 * tables becomes five titled blocks separated by blank lines in a single
 * sheet — readable, but not something anyone can pivot or chart without
 * cutting it apart first. A CSV also carries no types: dates arrive as text
 * in whatever locale the reader's Excel guesses, numbers with a thousands
 * separator stop being numbers, and a leading-zero phone number loses its
 * zero. The pack is a monthly management document, so it is worth the
 * typed cells and the tabs.
 *
 * csv.js stays. CSV is still the right answer for feeding another system,
 * and both export buttons offer it alongside this.
 *
 * The library is loaded on demand. It is around 1.8 MB unpacked and only
 * matters the moment somebody clicks Export, so it must not sit in the main
 * bundle — hence the dynamic import rather than a top-level one.
 */

/** Header cell: bold on the same navy the dashboards use. */
export const th = value => ({
  value,
  fontWeight: 'bold',
  color: '#ffffff',
  backgroundColor: '#1e3a5f',
  align: 'center',
  alignVertical: 'center',
  wrap: true,
});

/** Section title inside a sheet. */
export const title = value => ({
  value,
  fontWeight: 'bold',
  color: '#1e3a5f',
  fontSize: 12,
});

/** A note or caveat — the small italic grey line under a title. */
export const note = value => ({ value, fontSize: 9, italic: true, color: '#8b5000' });

/**
 * An empty cell.
 *
 * A `format` on a cell with no value is rejected outright by the writer —
 * it cannot infer a type from null, and a format without a type throws and
 * takes the whole workbook with it. So every helper below must drop its
 * format when it has nothing to format. This is not hypothetical: response
 * rate is null whenever a period has no invites, and a question average is
 * null until someone answers it.
 */
const EMPTY = { value: null };

/** Percentages and averages want a fixed number of decimals, not Excel's guess. */
export const num = (value, decimals = 0) => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isFinite(n)) return EMPTY;
  return {
    value: n,
    format: decimals ? `0.${'0'.repeat(decimals)}` : '0',
    align: 'center',
  };
};

/** A signed integer, for NPS — "+41" reads better than "41" on a -100..100 scale. */
export const signed = value => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isFinite(n)) return EMPTY;
  return { value: n, format: '+0;-0;0', align: 'center' };
};

/**
 * A date-time cell that stays a date in Excel rather than becoming text.
 *
 * The writer turns a Date into an Excel serial straight off getTime(), which
 * is the UTC wall clock. An Excel date cell carries no timezone, so a job
 * logged at 09:15 in Dubai (UTC+4) would land in the sheet as 05:15 — and
 * anything before 04:00 would move to the previous day. The app shows local
 * time everywhere else, so the export has to agree with it: shift the instant
 * by the local offset first, making the UTC fields read as the local ones.
 */
export const dt = value => {
  if (!value) return EMPTY;
  const d = value instanceof Date ? value : new Date(value);
  // An unparseable date falls back to the raw text, with no format on it —
  // better to show what was there than to drop it silently.
  if (Number.isNaN(d.getTime())) return { value: String(value) };
  const asLocalWallClock = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return { value: asLocalWallClock, format: 'yyyy-mm-dd hh:mm' };
};

/** A money cell; blank rather than 0.00 when there is no amount. */
export const money = value => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isFinite(n)) return EMPTY;
  return { value: n, format: '#,##0.00', align: 'right' };
};

/**
 * Write a workbook and hand it to the browser as a download.
 *
 * sheets: [{ name, rows, columns? }]
 *   rows    — array of rows; each row an array of cell values or cell objects.
 *             A `null` row is emitted as a blank spacer line.
 *   columns — optional [{ width }] in characters, matching the row arrays.
 *
 * Rows are normalised here rather than at the call sites: the library wants
 * every cell to be an object, and requiring that of callers is how the
 * per-export drift this module exists to prevent would start again.
 */
export async function downloadXlsx(filename, sheets) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');

  const payload = sheets.map(s => ({
    sheet: sheetName(s.name),
    data: (s.rows || []).map(row =>
      row === null || row === undefined
        ? []
        : row.map(cell =>
            cell !== null && typeof cell === 'object' && !(cell instanceof Date)
              ? cell
              : { value: cell === '' || cell === undefined ? null : cell }
          )
    ),
    ...(s.columns ? { columns: s.columns } : {}),
    stickyRowsCount: s.stickyRows ?? 0,
  }));

  await writeXlsxFile(payload).toFile(filename);
}

/**
 * Excel rejects a sheet name over 31 characters or containing : \ / ? * [ ],
 * and fails on the whole workbook rather than the one tab — so a branch name
 * used as a tab title must be sanitised, not trusted.
 */
function sheetName(name) {
  const clean = String(name || 'Sheet').replace(/[:\\/?*[\]]/g, '-').trim();
  return (clean.length > 31 ? clean.slice(0, 31) : clean) || 'Sheet';
}

export default downloadXlsx;
