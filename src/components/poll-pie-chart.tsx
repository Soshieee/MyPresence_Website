type PollPieSlice = {
  id: string;
  label: string;
  votes: number;
  archived?: boolean;
};

type PollPieArc = PollPieSlice & {
  color: string;
  startAngle: number;
  endAngle: number;
};

type PollPieChartProps = {
  slices: PollPieSlice[];
  memberCount: number;
  memberLabel: string;
};

const COLORS = [
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

const SIZE = 180;
const CENTER = SIZE / 2;
const RADIUS = 78;
const SLICE_STROKE = 1.5;

function formatPercent(votes: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((votes / total) * 100)}%`;
}

function polarPoint(angleDegrees: number) {
  const radians = ((angleDegrees - 90) * Math.PI) / 180;
  return {
    x: CENTER + RADIUS * Math.cos(radians),
    y: CENTER + RADIUS * Math.sin(radians)
  };
}

function slicePath(startAngle: number, endAngle: number) {
  const start = polarPoint(startAngle);
  const end = polarPoint(endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return `M ${CENTER} ${CENTER} L ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

export default function PollPieChart({ slices, memberCount, memberLabel }: PollPieChartProps) {
  const totalVotes = slices.reduce((sum, slice) => sum + slice.votes, 0);
  const hasVotes = totalVotes > 0;
  const hasMemberCount = memberCount > 0;
  const overflow = hasMemberCount && totalVotes > memberCount;
  const rawTotalAngle = hasMemberCount ? (totalVotes / memberCount) * 360 : 0;
  const angleScale = overflow && rawTotalAngle > 0 ? 360 / rawTotalAngle : 1;
  const colorById = new Map(
    slices.map((slice, index) => [slice.id, COLORS[index % COLORS.length]])
  );

  const arcs = slices
    .filter((slice) => slice.votes > 0)
    .reduce<PollPieArc[]>((accumulator, slice) => {
      const startAngle =
        accumulator.length > 0 ? accumulator[accumulator.length - 1].endAngle : 0;
      const angle = hasMemberCount
        ? (slice.votes / memberCount) * 360 * angleScale
        : 0;

      return [
        ...accumulator,
        {
          ...slice,
          color: colorById.get(slice.id) ?? COLORS[0],
          startAngle,
          endAngle: startAngle + angle
        }
      ];
    }, []);

  const isFullCircle = arcs.length === 1 && arcs[0].endAngle - arcs[0].startAngle >= 359.999;
  const summary = slices
    .map((slice) => {
      const archivedLabel = slice.archived ? " (archived)" : "";
      const percentLabel = hasMemberCount
        ? `, ${formatPercent(slice.votes, memberCount)} of ${memberLabel}`
        : "";
      return `${slice.label}${archivedLabel}: ${slice.votes} votes${percentLabel}`;
    })
    .join("; ");

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <div className="flex shrink-0 flex-col items-center gap-2">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`Poll results: ${summary}`}
        >
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="#e6eeea" />
          {hasVotes && hasMemberCount ? (
            isFullCircle ? (
              <circle cx={CENTER} cy={CENTER} r={RADIUS} fill={arcs[0].color} />
            ) : (
              arcs.map((arc) => (
                <path
                  key={arc.id}
                  d={slicePath(arc.startAngle, arc.endAngle)}
                  fill={arc.color}
                  stroke="#ffffff"
                  strokeWidth={SLICE_STROKE}
                  strokeLinejoin="round"
                >
                  <title>
                    {`${arc.label}${arc.archived ? " (archived)" : ""}: ${arc.votes} votes (${formatPercent(
                      arc.votes,
                      memberCount
                    )} of ${memberLabel})`}
                  </title>
                </path>
              ))
            )
          ) : null}
        </svg>
        {!hasVotes ? (
          <p className="text-xs font-semibold text-[#6b7d75]">No votes yet</p>
        ) : !hasMemberCount ? (
          <p className="text-xs font-semibold text-[#8a3f46]">Member count unavailable</p>
        ) : overflow ? (
          <p className="max-w-[180px] text-center text-[10px] font-semibold text-[#8a3f46]">
            Votes exceed member count
          </p>
        ) : null}
      </div>

      <ul className="min-w-0 flex-1 space-y-2">
        {slices.map((slice) => {
          const color = colorById.get(slice.id) ?? COLORS[0];
          const percent = hasMemberCount ? formatPercent(slice.votes, memberCount) : "—";

          return (
            <li
              key={slice.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-[#2f4d43]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <span className="min-w-0 break-words">
                  {slice.label}
                  {slice.archived ? (
                    <span className="ml-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#8a7a6a]">
                      (archived)
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="shrink-0 text-[#5f6f68]">
                <span className="font-semibold text-[#315349]">
                  {slice.votes} {slice.votes === 1 ? "vote" : "votes"}
                </span>
                {" · "}
                {percent === "—" ? "—" : `${percent} of ${memberLabel}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
