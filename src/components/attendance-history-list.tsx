"use client";

import { useState } from "react";

export type AttendanceHistoryEntry = {
  id: string;
  badge?: string | null;
  title: string;
  detail?: string | null;
  meta?: string | null;
};

type AttendanceHistoryListProps = {
  entries: AttendanceHistoryEntry[];
  emptyText: string;
  loading?: boolean;
  loadingText?: string;
  pageSize?: number;
  resetKey?: string;
  ariaLabel?: string;
};

const DEFAULT_PAGE_SIZE = 10;

// Shared attendance history display used by the Events page (Event Attendance)
// and the Members page (Attendance History) so both sections look and behave
// identically: same rows, badges, date formatting, and pagination.
export default function AttendanceHistoryList({
  entries,
  emptyText,
  loading = false,
  loadingText = "Loading attendance...",
  pageSize = DEFAULT_PAGE_SIZE,
  resetKey = "",
  ariaLabel = "Attendance history"
}: AttendanceHistoryListProps) {
  const [page, setPage] = useState(1);
  const [lastResetKey, setLastResetKey] = useState(resetKey);

  // Reset to the first page when the reset key changes (e.g. a different
  // member or event is selected). Adjusting state during render avoids the
  // cascading render that a setState-in-effect would cause.
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setPage(1);
  }

  if (loading) {
    return <p className="text-sm text-[#4f675e]">{loadingText}</p>;
  }

  if (entries.length === 0) {
    return <p className="text-sm text-[#4f675e]">{emptyText}</p>;
  }

  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = entries.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div>
      <ul className="space-y-2" aria-label={ariaLabel}>
        {visible.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-[#cbd8d3] bg-white px-3 py-2.5 text-sm text-[#2f4d43]"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {entry.badge ? (
                <span className="shrink-0 rounded-full border border-[#b9cac3] bg-[#eef4f1] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#406357]">
                  {entry.badge}
                </span>
              ) : null}
              <div className="min-w-0">
                <p className="truncate font-semibold">{entry.title}</p>
                {entry.detail ? (
                  <p className="truncate text-xs text-[#5e766c]">{entry.detail}</p>
                ) : null}
              </div>
            </div>
            {entry.meta ? (
              <p className="shrink-0 text-xs font-semibold text-[#4f675e]">{entry.meta}</p>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold text-[#5e766c]">
          Page {currentPage} of {totalPages} • showing {visible.length} of {entries.length} records
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-ghost px-3 py-1.5 text-xs"
            onClick={() => setPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn-ghost px-3 py-1.5 text-xs"
            onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
