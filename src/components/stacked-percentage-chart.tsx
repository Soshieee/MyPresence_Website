import { GROUP_COLORS, GROUP_SHORT_LABELS } from "@/lib/analytics-colors";

type MixRow = {
  label: string;
  firstService: number;
  secondService: number;
  rooftop: number;
  male: number;
  female: number;
};

type Props = {
  title: string;
  rows: MixRow[];
  emptyText?: string;
};

const SEGMENTS = [
  { key: "firstService", color: GROUP_COLORS.firstService, short: GROUP_SHORT_LABELS.firstService },
  { key: "secondService", color: GROUP_COLORS.secondService, short: GROUP_SHORT_LABELS.secondService },
  { key: "rooftop", color: GROUP_COLORS.rooftop, short: GROUP_SHORT_LABELS.rooftop },
  { key: "male", color: GROUP_COLORS.male, short: GROUP_SHORT_LABELS.male },
  { key: "female", color: GROUP_COLORS.female, short: GROUP_SHORT_LABELS.female }
] as const;

export default function StackedPercentageChart({ title, rows, emptyText = "No composition data yet." }: Props) {
  const hasData = rows.some((row) => row.firstService + row.secondService + row.rooftop + row.male + row.female > 0);

  return (
    <section className="analytics-panel">
      <h3 className="font-[var(--font-heading)] text-lg font-semibold text-[#24362f]">{title}</h3>
      {!hasData ? (
        <p className="mt-3 text-sm text-[#5d736a]">{emptyText}</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#415a52]">
            {SEGMENTS.map((segment) => (
              <span key={segment.key} className="inline-flex items-center gap-1 rounded-full border border-[#c6d4cf] bg-white px-2 py-0.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />
                {segment.short}
              </span>
            ))}
          </div>
          <div className="mt-4 grid gap-3">
            {rows.map((row) => {
              const total = row.firstService + row.secondService + row.rooftop + row.male + row.female;

              return (
                <div key={row.label} className="grid grid-cols-[78px_1fr_38px] items-center gap-2 text-xs md:text-sm">
                  <span className="font-semibold text-[#496359]">{row.label}</span>
                  <div className="flex h-4 overflow-hidden rounded-full bg-[#d5dfdb]">
                    {SEGMENTS.map((segment) => {
                      const value = row[segment.key];
                      if (value <= 0 || total <= 0) return null;
                      const width = (value / total) * 100;
                      return (
                        <div
                          key={segment.key}
                          style={{ width: `${width}%`, backgroundColor: segment.color }}
                          title={`${segment.short}: ${value} (${Math.round((value / total) * 100)}%)`}
                        />
                      );
                    })}
                  </div>
                  <span className="text-right font-semibold text-[#315349]">{total}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}