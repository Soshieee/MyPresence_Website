import { GROUP_COLORS, GROUP_SHORT_LABELS } from "@/lib/analytics-colors";

type TimelineRow = {
  label: string;
  kidsMinistry: number;
  youthMinistry: number;
  youngProfessionals: number;
  mensNetwork: number;
  womensNetwork: number;
};

type Props = {
  title: string;
  rows: TimelineRow[];
  emptyText?: string;
};

const SEGMENT_META = [
  { key: "kidsMinistry", color: GROUP_COLORS.kidsMinistry, short: GROUP_SHORT_LABELS.kidsMinistry },
  { key: "youthMinistry", color: GROUP_COLORS.youthMinistry, short: GROUP_SHORT_LABELS.youthMinistry },
  { key: "youngProfessionals", color: GROUP_COLORS.youngProfessionals, short: GROUP_SHORT_LABELS.youngProfessionals },
  { key: "mensNetwork", color: GROUP_COLORS.mensNetwork, short: GROUP_SHORT_LABELS.mensNetwork },
  { key: "womensNetwork", color: GROUP_COLORS.womensNetwork, short: GROUP_SHORT_LABELS.womensNetwork }
] as const;

export default function StackedGroupTimeline({ title, rows, emptyText = "No grouped timeline data yet." }: Props) {
  const hasData = rows.some(
    (row) => row.kidsMinistry + row.youthMinistry + row.youngProfessionals + row.mensNetwork + row.womensNetwork > 0
  );
  const maxTotal = Math.max(
    ...rows.map((row) => row.kidsMinistry + row.youthMinistry + row.youngProfessionals + row.mensNetwork + row.womensNetwork),
    1
  );

  return (
    <section className="analytics-panel">
      <h3 className="text-lg font-semibold text-[#24362f]">{title}</h3>
      {!hasData ? (
        <p className="mt-3 text-sm text-[#5d736a]">{emptyText}</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#415a52]">
            {SEGMENT_META.map((segment) => (
              <span key={segment.key} className="inline-flex items-center gap-1 rounded-full border border-[#c6d4cf] bg-white px-2 py-0.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />
                {segment.short}
              </span>
            ))}
          </div>
          <div className="mt-4 grid gap-3">
            {rows.map((row) => {
              const total = row.kidsMinistry + row.youthMinistry + row.youngProfessionals + row.mensNetwork + row.womensNetwork;
              return (
                <div key={row.label} className="grid grid-cols-[78px_1fr_38px] items-center gap-2 text-xs md:text-sm">
                  <span className="font-semibold text-[#496359]">{row.label}</span>
                  <div className="flex h-4 overflow-hidden rounded-full bg-[#d5dfdb]">
                    {SEGMENT_META.map((segment) => {
                      const value = row[segment.key];
                      if (value <= 0) return null;
                      const width = (value / maxTotal) * 100;
                      return <div key={segment.key} style={{ width: `${width}%`, backgroundColor: segment.color }} title={`${segment.short}: ${value}`} />;
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