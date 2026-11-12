type BarItem = {
  label: string;
  value: number;
  color?: string;
};

type Props = {
  title: string;
  items: BarItem[];
  emptyText?: string;
  /** When true, each value is annotated with its share of the total. */
  showShareOfTotal?: boolean;
};

export default function SimpleBarChart({ title, items, emptyText = "No data yet.", showShareOfTotal = false }: Props) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const hasData = items.some((item) => item.value > 0);

  return (
    <section className="analytics-panel">
      <h3 className="font-[var(--font-heading)] text-lg text-[#24362f]">{title}</h3>
      {!hasData ? (
        <p className="mt-3 text-sm text-[#5d736a]">{emptyText}</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {items.map((item) => (
            <div
              key={item.label}
              className="grid grid-cols-[92px_1fr_52px] items-center gap-3 text-xs md:text-sm sm:grid-cols-[150px_1fr_64px]"
            >
              <span className="truncate font-semibold text-[#496359]" title={item.label}>
                {item.label}
              </span>
              <div className="h-3 rounded-full bg-[#d5dfdb]">
                <div
                  className="h-3 rounded-full"
                  style={{
                    width: `${(item.value / maxValue) * 100}%`,
                    background: item.color ?? "#385b4f"
                  }}
                />
              </div>
              <span className="whitespace-nowrap text-right font-semibold text-[#315349]">
                {item.value}
                {showShareOfTotal && total > 0 && item.value > 0 ? (
                  <span className="ml-1 text-[10px] font-normal text-[#6a7e76]">
                    {Math.round((item.value / total) * 1000) / 10}%
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
