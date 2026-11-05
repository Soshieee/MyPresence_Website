// Printable report + CSV export helpers for the Records page.
// The report is a standalone HTML document opened in a new window so the
// browser's native "Save as PDF" produces a clean, branded document instead
// of a screenshot of the app UI.

export type ReportStat = {
  label: string;
  value: string | number;
};

export type ReportTableRow = Array<string | number>;

export type ReportTable = {
  title: string;
  note?: string;
  columns: string[];
  rows: ReportTableRow[];
  /** Columns at this index and beyond are right-aligned. */
  rightAlignFrom?: number;
  /** Column index holding a 0-100 number rendered as a share bar. */
  barColumn?: number;
};

export type ReportSection = {
  title: string;
  note?: string;
  tables: ReportTable[];
};

export type ReportInput = {
  title: string;
  orientation: "portrait" | "landscape";
  /** Filter/range lines shown under the title, e.g. "Date range: ...". */
  metaRows: string[];
  stats: ReportStat[];
  sections: ReportSection[];
};

function escapeHtml(value: string): string {
  // Entities are assembled from char codes so the source never contains a
  // literal "&..." sequence that tooling could decode into plain text.
  const amp = String.fromCharCode(38);
  return value
    .replace(/&/g, `${amp}amp;`)
    .replace(/</g, `${amp}lt;`)
    .replace(/>/g, `${amp}gt;`)
    .replace(/"/g, `${amp}quot;`)
    .replace(/'/g, `${amp}#39;`);
}

function renderCell(value: string | number, column: number, table: ReportTable): string {
  if (table.barColumn === column && typeof value === "number") {
    const clamped = Math.max(0, Math.min(100, value));
    const shown = Number.isInteger(clamped) ? String(clamped) : clamped.toFixed(1);
    return `<td class="num"><div class="bar-wrap"><div class="bar"><span style="width:${clamped}%"></span></div><span class="bar-label">${shown}%</span></div></td>`;
  }

  const alignClass = table.rightAlignFrom !== undefined && column >= table.rightAlignFrom ? " class=\"num\"" : "";
  return `<td${alignClass}>${escapeHtml(String(value))}</td>`;
}

function renderTable(table: ReportTable): string {
  const head = table.columns
    .map((column, index) => {
      const alignClass = table.rightAlignFrom !== undefined && index >= table.rightAlignFrom ? " class=\"num\"" : "";
      return `<th${alignClass}>${escapeHtml(column)}</th>`;
    })
    .join("");

  const body = table.rows.length
    ? table.rows
        .map((row) => `<tr>${row.map((value, index) => renderCell(value, index, table)).join("")}</tr>`)
        .join("")
    : `<tr><td class="empty" colspan="${table.columns.length}">No data for this section.</td></tr>`;

  const note = table.note ? `<p class="table-note">${escapeHtml(table.note)}</p>` : "";

  return `
    <h3 class="table-title">${escapeHtml(table.title)}</h3>
    ${note}
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function renderReportBody(input: ReportInput): string {
  const generated = new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const meta = input.metaRows
    .map((row) => `<div>${escapeHtml(row)}</div>`)
    .join("");
  const stats = input.stats
    .map(
      (stat) =>
        `<div class="stat"><p class="stat-label">${escapeHtml(stat.label)}</p><p class="stat-value">${escapeHtml(
          String(stat.value)
        )}</p></div>`
    )
    .join("");
  const sections = input.sections
    .map((section) => {
      const note = section.note ? `<p class="table-note">${escapeHtml(section.note)}</p>` : "";
      const tables = section.tables.map(renderTable).join("");
      return `<h2 class="section">${escapeHtml(section.title)}</h2>${note}${tables}`;
    })
    .join("");

  return `
    <div class="toolbar no-print">
      <button type="button" onclick="window.print()">Print / Save as PDF</button>
      <span>Tip: choose "Save as PDF" as the printer destination.</span>
    </div>
    <div class="sheet">
      <header class="head">
        <img src="/logo.png" alt="" onerror="this.style.display='none'" />
        <div>
          <p class="brand">MyPresence</p>
          <p class="tagline">Attendance & Records</p>
        </div>
      </header>
      <h1 class="report-title">${escapeHtml(input.title)}</h1>
      <p class="generated">Generated ${escapeHtml(generated)}</p>
      <div class="meta">${meta}</div>
      <div class="stats">${stats}</div>
      ${sections}
    </div>`;
}

export function buildReportHtml(input: ReportInput): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(input.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: #eef2f0; color: #22332d;
    font-family: "Segoe UI", system-ui, -apple-system, Arial, sans-serif; }
  .sheet { max-width: 1150px; margin: 0 auto; background: #ffffff; padding: 34px 38px;
    border-radius: 14px; box-shadow: 0 12px 44px rgba(34, 51, 45, 0.14); }
  .toolbar { max-width: 1150px; margin: 0 auto 16px; display: flex; align-items: center;
    gap: 14px; background: #e3efe9; border: 1px solid #c8d6d1; border-radius: 10px;
    padding: 10px 14px; font-size: 13px; color: #41564d; }
  .toolbar button { border: 0; cursor: pointer; background: #385b4f; color: #ffffff;
    font-weight: 600; padding: 8px 16px; border-radius: 8px; font-size: 13px; }
  .toolbar button:hover { background: #2c4a40; }
  .head { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #385b4f;
    padding-bottom: 14px; }
  .head img { width: 52px; height: 52px; object-fit: contain; }
  .brand { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.01em; }
  .tagline { margin: 2px 0 0; font-size: 10px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.18em; color: #527064; }
  .report-title { margin: 20px 0 2px; font-size: 26px; }
  .generated { margin: 0 0 16px; font-size: 12px; color: #5d7269; }
  .meta { background: #f2f7f5; border: 1px solid #d6e1dd; border-radius: 10px;
    padding: 12px 16px; margin-bottom: 18px; font-size: 13px; }
  .meta div { padding: 2px 0; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px; margin-bottom: 8px; }
  .stat { border: 1px solid #d6e1dd; border-radius: 10px; padding: 10px 12px; }
  .stat-label { margin: 0; font-size: 10px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.08em; color: #527064; }
  .stat-value { margin: 4px 0 0; font-size: 22px; font-weight: 700; }
  .section { margin: 26px 0 10px; font-size: 18px; border-bottom: 1px solid #dfe8e4;
    padding-bottom: 6px; }
  .table-title { margin: 18px 0 6px; font-size: 14px; }
  .table-note { margin: 0 0 8px; font-size: 12px; color: #71847c; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { background: #eef4f1; border: 1px solid #d6e1dd; padding: 7px 9px; text-align: left;
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #41564d; }
  td { border: 1px solid #e4ece8; padding: 6px 9px; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #f7fbf9; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th.num, td.num { text-align: right; }
  td.empty { text-align: center; color: #71847c; padding: 14px; }
  .bar-wrap { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .bar { position: relative; width: 100%; min-width: 90px; height: 12px;
    background: #e8f0ec; border-radius: 6px; overflow: hidden; }
  .bar span { position: absolute; top: 0; bottom: 0; left: 0; background: #385b4f;
    border-radius: 6px; }
  .bar-label { min-width: 44px; text-align: right; font-size: 11px; color: #41564d; }
  @page { size: A4 ${input.orientation}; margin: 12mm; }
  @media print {
    body { background: #ffffff; padding: 0; }
    .toolbar { display: none; }
    .sheet { box-shadow: none; border-radius: 0; padding: 0; max-width: none; }
  }
</style>
</head>
<body>
${renderReportBody(input)}
<script>
  window.addEventListener("load", function () {
    setTimeout(function () { window.print(); }, 250);
  });
</script>
</body>
</html>`;
}

/** Opens a new window with the report and triggers print. Returns false when pop-ups are blocked. */
export function openReportWindow(input: ReportInput): boolean {
  const reportWindow = window.open("", "_blank");

  if (!reportWindow) return false;

  reportWindow.document.open();
  reportWindow.document.write(buildReportHtml(input));
  reportWindow.document.close();
  reportWindow.focus();
  return true;
}

function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function toCsv(columns: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
