"use client";

// Shared member attendance ranking table (P8).
// Extracted from the Lifegroup "Member Attendance Comparison" panel so the
// Lifegroup and Members analytics modules show the same table.

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
  onSelectRow
}: {
  title: string;
  note?: string;
  summary?: string;
  rows: MemberRankingRow[];
  showRank: boolean;
  emptyText: string;
  selectedUserId?: string | null;
  onSelectRow?: (row: MemberRankingRow) => void;
}) {
  const columnCount = showRank ? 7 : 6;

  return (
    <section className="analytics-panel">
      <h2 className="font-[var(--font-heading)] text-lg text-[#23332d]">{title}</h2>
      {summary ? <p className="mt-1 text-sm text-[#5d7269]">{summary}</p> : null}
      {note ? <p className="mt-1 text-[11px] text-[#71847c]">{note}</p> : null}

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-[#4f675e]">{emptyText}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[840px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#d6e1dd] text-[10px] uppercase tracking-[0.08em] text-[#71847c]">
                {showRank ? <th className="px-2 py-2">Rank</th> : null}
                <th className="px-2 py-2">Member</th>
                <th className="px-2 py-2 text-right">Attended</th>
                <th className="px-2 py-2 text-right">Eligible (since joined)</th>
                <th className="px-2 py-2 text-right">Attendance %</th>
                <th className="px-2 py-2 text-right">Last Attended</th>
                <th className="px-2 py-2">Share of period</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const selected = selectedUserId === row.userId;
                return (
                  <tr
                    key={row.userId}
                    onClick={() => onSelectRow?.(row)}
                    className={`border-b border-[#edf2ef] last:border-0 ${
                      onSelectRow ? "cursor-pointer hover:bg-[#f3f8f6]" : ""
                    } ${selected ? "bg-[#eef4f1]" : ""}`}
                    title={onSelectRow ? "Click to see attended activities" : undefined}
                  >
                    {showRank ? <td className="px-2 py-2.5 font-semibold text-[#315349]">#{index + 1}</td> : null}
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
                      <div className="h-2 w-full min-w-[120px] overflow-hidden rounded-full bg-[#e8f0ec]">
                        <div
                          className="h-full rounded-full bg-[#385b4f] transition-[width] duration-300"
                          style={{ width: `${row.percent ?? 0}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-2 py-6 text-center text-sm text-[#71847c]">
                    {emptyText}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
