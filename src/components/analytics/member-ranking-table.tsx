"use client";

// Shared member attendance ranking table (P8).
// Extracted from the Lifegroup "Member Attendance Comparison" panel so the
// Lifegroup and Members analytics modules show the same table.
// Column headers are sortable (click toggles ascending/descending) and the
// table can paginate when a pageSize is passed; the Members module uses both
// for its ranking and absent views.

import { useMemo, useState } from "react";

export type MemberRankingRow = {
  userId: string;
  name: string;
  meta: string;
  attended: number;
  eligible: number;
  percent: number | null;
  lastAttended: string | null;
  joinUnknown?: boolean;
};

type SortKey = "rank" | "member" | "attended" | "eligible" | "percent" | "lastAttended" | "share";
type SortDir = "asc" | "desc";

// Direction applied the first time a column is clicked; clicking it again
// toggles. Numeric/performance columns start descending, names ascending.
const DEFAULT_SORT_DIRS: Record<SortKey, SortDir> = {
  rank: "asc",
  member: "asc",
  attended: "desc",
  eligible: "desc",
  percent: "desc",
  lastAttended: "desc",
  share: "desc"
};

function formatShortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${String(
    date.getFullYear()
  ).slice(-2)}`;
}

export function MemberRankingTable({
  title,
  note,
  summary,
  rows,
  showRank,
  emptyText,
  selectedUserId,
  onSelectRow,
  pageSize,
  absentMode = false
}: {
  title: string;
  note?: string;
  summary?: string;
  rows: MemberRankingRow[];
  showRank: boolean;
  emptyText: string;
  selectedUserId?: string | null;
  onSelectRow?: (row: MemberRankingRow) => void;
  /** Rows per page; omit to render every row at once. */
  pageSize?: number;
  /** Absent view: the share bar fills by the member's absence share (100% − attendance%) instead of attendance. */
  absentMode?: boolean;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  const [page, setPage] = useState(0);
  const [previousRows, setPreviousRows] = useState(rows);
  if (previousRows !== rows) {
    // The module re-computed the filtered set — start over on the first page.
    setPreviousRows(rows);
    setPage(0);
  }

  // Rank is anchored to the order the module computed (best attendance first),
  // so sorting by any other column keeps each member's rank label stable.
  const rankByUser = useMemo(() => {
    const ranks = new Map<string, number>();
    rows.forEach((row, index) => ranks.set(row.userId, index + 1));
    return ranks;
  }, [rows]);

  const sortedRows = useMemo(() => {
    if (!sort || (sort.key === "rank" && !showRank)) return rows;
    const direction = sort.dir === "asc" ? 1 : -1;
    const copy = [...rows];
    copy.sort((a, b) => {
      switch (sort.key) {
        case "rank":
          return direction * ((rankByUser.get(a.userId) ?? 0) - (rankByUser.get(b.userId) ?? 0));
        case "member":
          return direction * a.name.localeCompare(b.name);
        case "attended":
          return direction * (a.attended - b.attended);
        case "eligible":
          return direction * (a.eligible - b.eligible);
        case "percent":
        case "share":
          return direction * ((a.percent ?? -1) - (b.percent ?? -1));
        case "lastAttended":
          return direction * (a.lastAttended ?? "").localeCompare(b.lastAttended ?? "");
        default:
          return 0;
      }
    });
    return copy;
  }, [rankByUser, rows, showRank, sort]);

  const totalPages = pageSize && pageSize > 0 ? Math.max(Math.ceil(sortedRows.length / pageSize), 1) : 1;
  const safePage = Math.min(page, totalPages - 1);
  const visibleRows =
    pageSize && pageSize > 0
      ? sortedRows.slice(safePage * pageSize, safePage * pageSize + pageSize)
      : sortedRows;

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current && current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: DEFAULT_SORT_DIRS[key] }
    );
  };

  const renderSortableHeader = (key: SortKey, label: string, align?: "right") => {
    const activeSort = sort !== null && sort.key === key ? sort : null;
    return (
      <th
        className={`px-2 py-2 ${align === "right" ? "text-right" : ""}`}
        aria-sort={activeSort ? (activeSort.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          onClick={() => toggleSort(key)}
          title={`Sort by ${label}`}
          className={`inline-flex items-center gap-1 uppercase tracking-[0.08em] transition-colors ${
            activeSort ? "text-[#315349]" : "text-[#71847c] hover:text-[#315349]"
          }`}
        >
          {label}
          {activeSort ? (
            <span aria-hidden className="text-[9px]">
              {activeSort.dir === "asc" ? "▲" : "▼"}
            </span>
          ) : null}
        </button>
      </th>
    );
  };

  return (
    <section className="analytics-panel">
      <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">{title}</h2>
      {summary ? <p className="mt-1 text-sm text-[#5d7269]">{summary}</p> : null}
      {note ? <p className="mt-1 text-[11px] text-[#71847c]">{note}</p> : null}

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-[#4f675e]">{emptyText}</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[840px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#d6e1dd] text-[10px] uppercase tracking-[0.08em] text-[#71847c]">
                  {showRank ? renderSortableHeader("rank", "Rank") : null}
                  {renderSortableHeader("member", "Member")}
                  {renderSortableHeader("attended", "Attended", "right")}
                  {renderSortableHeader("eligible", "Eligible (since joined)", "right")}
                  {renderSortableHeader("percent", "Attendance %", "right")}
                  {renderSortableHeader("lastAttended", "Last Attended", "right")}
                  {renderSortableHeader("share", "Share of period")}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const selected = selectedUserId === row.userId;
                  // Absent view: the bar reflects each person's absence —
                  // how much of the period they missed (100% − attendance%).
                  const absenceShare = Math.max(0, Math.min(100, 100 - (row.percent ?? 0)));
                  return (
                    <tr
                      key={row.userId}
                      onClick={() => onSelectRow?.(row)}
                      className={`border-b border-[#edf2ef] last:border-0 ${
                        onSelectRow ? "cursor-pointer hover:bg-[#f3f8f6]" : ""
                      } ${selected ? "bg-[#eef4f1]" : ""}`}
                      title={onSelectRow ? "Click to see attended activities" : undefined}
                    >
                      {showRank ? (
                        <td className="px-2 py-2.5 font-semibold text-[#315349]">
                          #{rankByUser.get(row.userId) ?? 0}
                        </td>
                      ) : null}
                      <td className="px-2 py-2.5">
                        <p className="font-semibold text-[#2f4d43]">{row.name}</p>
                        <p className="text-xs capitalize text-[#5e766c]">
                          {row.meta}
                          {row.joinUnknown ? " • join date unknown" : ""}
                        </p>
                      </td>
                      <td className="px-2 py-2.5 text-right text-[#315349]">{row.attended}</td>
                      <td className="px-2 py-2.5 text-right text-[#5e766c]">{row.eligible}</td>
                      <td className="px-2 py-2.5 text-right font-semibold text-[#315349]">
                        {row.percent === null ? "—" : `${row.percent}%`}
                      </td>
                      <td className="px-2 py-2.5 text-right text-[#5e766c]">
                        {row.lastAttended ? formatShortDate(row.lastAttended) : "Never in range"}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 min-w-[100px] flex-1 overflow-hidden rounded-full bg-[#e8f0ec]">
                            <div
                              className={`h-full rounded-full transition-[width] duration-300 ${
                                absentMode ? "bg-[#c2703d]" : "bg-[#385b4f]"
                              }`}
                              style={{ width: `${absentMode ? absenceShare : (row.percent ?? 0)}%` }}
                            />
                          </div>
                          {absentMode ? (
                            <span className="w-10 shrink-0 text-right text-[11px] font-semibold text-[#a15c2b]">
                              {absenceShare}%
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pageSize && pageSize > 0 && sortedRows.length > pageSize ? (
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setPage(Math.max(safePage - 1, 0))}
                className="btn-ghost px-3 py-1 text-xs"
                disabled={safePage === 0}
              >
                Previous
              </button>
              <span className="text-xs text-[#5a7268]">
                Page {safePage + 1} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage(Math.min(safePage + 1, totalPages - 1))}
                className="btn-ghost px-3 py-1 text-xs"
                disabled={safePage === totalPages - 1}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
