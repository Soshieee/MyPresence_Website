// Poll results: donut chart with the total vote count front and center, plus
// a legend where each option's percentage and vote count are prominent.
// Percentages are each option's share of the eligible member population for
// the poll's audience (see the caption); the donut itself shows the share of
// votes cast.

type PollResultSlice = {
  id: string;
  label: string;
  votes: number;
  archived?: boolean;
};

type PollResultsListProps = {
  slices: PollResultSlice[];
  memberCount: number;
  memberLabel: string;
};

const OPTION_COLORS = [
  "#385b4f",
  "#8a3f46",
  "#c98a3c",
  "#4285f4",
  "#6b8e6a",
  "#a45d6b",
  "#7c6a9c",
  "#b08d57",
  "#4f7f8a",
  "#9c6b4a"
];

const SIZE = 190;
const RADIUS = 72;
const STROKE = 24;
const CENTER = SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatPercent(votes: number, memberCount: number) {
  if (memberCount <= 0) return null;
  return `${Math.round((votes / memberCount) * 100)}%`;
}

export default function PollResultsList({ slices, memberCount, memberLabel }: PollResultsListProps) {
  const totalVotes = slices.reduce((sum, slice) => sum + slice.votes, 0);
  const hasVotes = totalVotes > 0;
  const hasMemberCount = memberCount > 0;
  const colorById = new Map(
    slices.map((slice, index) => [slice.id, OPTION_COLORS[index % OPTION_COLORS.length]])
  );

  const segments = slices
    .filter((slice) => slice.votes > 0)
    .reduce<Array<{
      id: string;
      label: string;
      votes: number;
      archived?: boolean;
      color: string;
      dash: number;
      offset: number;
    }>>((accumulator, slice) => {
      const previous = accumulator[accumulator.length - 1];
      const start = previous ? previous.offset + previous.dash : 0;
      const fraction = totalVotes > 0 ? slice.votes / totalVotes : 0;

      return [
        ...accumulator,
        {
          id: slice.id,
          label: slice.label,
          votes: slice.votes,
          archived: slice.archived,
          color: colorById.get(slice.id) ?? OPTION_COLORS[0],
          dash: Math.max(fraction * CIRCUMFERENCE, 0.01),
          offset: start
        }
      ];
    }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img"
            aria-label={`Poll results: ${totalVotes} ${totalVotes === 1 ? "vote" : "votes"} cast${hasMemberCount ? ` by ${memberCount} ${memberLabel}` : ""}`}
          >
            <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="#e6eeea" strokeWidth={STROKE} />
            {segments.map((segment) => (
              <circle
                key={segment.id}
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                stroke={segment.color}
                strokeWidth={STROKE}
                strokeDasharray={`${segment.dash} ${CIRCUMFERENCE - segment.dash}`}
                strokeDashoffset={-segment.offset}
                transform={`rotate(-90 ${CENTER} ${CENTER})`}
              >
                <title>
                  {`${segment.label}${segment.archived ? " (archived)" : ""}: ${segment.votes} ${segment.votes === 1 ? "vote" : "votes"}`}
                </title>
              </circle>
            ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="font-[var(--font-heading)] text-3xl font-bold leading-none text-[#22332d]">
              {totalVotes}
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#527064]">
              {totalVotes === 1 ? "vote" : "votes"}
            </p>
          </div>
        </div>

        <div className="min-w-0 text-center sm:text-left">
          {!hasVotes ? (
            <p className="text-sm font-semibold text-[#6b7d75]">No votes yet.</p>
          ) : null}
          {hasMemberCount ? (
            <p className="text-sm font-semibold text-[#315349]">
              {totalVotes} of {memberCount} active members voted
              {hasVotes ? ` (${Math.round((totalVotes / memberCount) * 100)}% turnout)` : ""}
            </p>
          ) : (
            <p className="text-sm font-semibold text-[#8a3f46]">
              Eligible member count unavailable — showing vote counts only.
            </p>
          )}
          {hasMemberCount && totalVotes > memberCount ? (
            <p className="mt-1 text-xs font-semibold text-[#8a3f46]">
              Votes exceed the eligible member count. Verify the poll audience.
            </p>
          ) : null}
          {hasMemberCount ? (
            <p className="mt-1 max-w-[280px] text-xs text-[#5e766c]">
              The percentage shown for each option is its share of the {memberCount} {memberLabel} eligible
              for this poll.
            </p>
          ) : null}
        </div>
      </div>

      <ul className="space-y-2.5">
        {slices.map((slice) => {
          const color = colorById.get(slice.id) ?? OPTION_COLORS[0];
          const percent = formatPercent(slice.votes, memberCount);
          const barBase = hasMemberCount ? memberCount : totalVotes;
          const width = barBase > 0 ? Math.min(100, Math.round((slice.votes / barBase) * 100)) : 0;

          return (
            <li key={slice.id} className="rounded-xl border border-[#dfe8e4] bg-white px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 break-words text-sm font-semibold text-[#2f4d43]">
                    {slice.label}
                    {slice.archived ? (
                      <span className="ml-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#8a7a6a]">
                        (archived)
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span
                    className="font-[var(--font-heading)] text-lg font-bold leading-none"
                    style={{ color }}
                  >
                    {percent ?? "—"}
                  </span>
                  <span className="rounded-full bg-[#eef4f1] px-2.5 py-1 text-xs font-semibold text-[#315349]">
                    {slice.votes} {slice.votes === 1 ? "vote" : "votes"}
                  </span>
                </span>
              </div>
              <div
                className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[#e8f0ec]"
                role="progressbar"
                aria-valuenow={slice.votes}
                aria-valuemin={0}
                aria-valuemax={Math.max(memberCount, slice.votes)}
                aria-label={`${slice.label}: ${slice.votes} ${slice.votes === 1 ? "vote" : "votes"}${percent ? `, ${percent} of ${memberLabel}` : ""}`}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{ width: `${width}%`, backgroundColor: color }}
                />
              </div>
            </li>
          );
        })}
        {slices.length === 0 ? (
          <li className="rounded-xl border border-dashed border-[#bdcec8] bg-white/70 px-3 py-3 text-center text-sm text-[#5e766c]">
            No active options for this poll.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
