type BarItem = {
  label: string;
  value: number;
  color?: string;
};

type Props = {
  title: string;
  items: BarItem[];
  emptyText?: string;
};

export default function SimpleBarChart({ title, items, emptyText = "No data yet." }: Props) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  const hasData = items.some((item) => item.value > 0);

  return (
    <section className="analytics-panel">
      <h3 className="font-[var(--font-heading)] text-lg font-semibold text-[#24362f]">{title}</h3>
      {!hasData ? (
        <p className="mt-3 text-sm text-[#5d736a]">{emptyText}</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {items.map((item) => (
            <div key={item.label} className="grid grid-cols-[88px_1fr_36px] items-center gap-3 text-xs md:text-sm">
              <span className="font-semibold text-[#496359]">{item.label}</span>
              <div className="h-3 rounded-full bg-[#d5dfdb]">
                <div
                  className="h-3 rounded-full"
                  style={{
                    width: `${(item.value / maxValue) * 100}%`,
                    background: item.color ?? "#385b4f"
                  }}
                />
              </div>
              <span className="text-right font-semibold text-[#315349]">{item.value}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
