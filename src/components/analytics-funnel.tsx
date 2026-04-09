type FunnelStep = {
  label: string;
  value: number;
  color?: string;
};

type Props = {
  title: string;
  steps: FunnelStep[];
  emptyText?: string;
};

export default function AnalyticsFunnel({ title, steps, emptyText = "No funnel data yet." }: Props) {
  const top = Math.max(steps[0]?.value ?? 0, 1);
  const hasData = steps.some((step) => step.value > 0);

  return (
    <section className="analytics-panel">
      <h3 className="text-lg font-semibold text-[#24362f]">{title}</h3>
      {!hasData ? (
        <p className="mt-3 text-sm text-[#5d736a]">{emptyText}</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {steps.map((step) => {
            const width = (step.value / top) * 100;
            return (
              <div key={step.label} className="grid grid-cols-[1fr_52px] items-center gap-3 text-sm">
                <div className="rounded-xl border border-[#ced9d4] bg-[#f6faf8] px-3 py-2">
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.08em] text-[#516a61]">
                    <span>{step.label}</span>
                    <span>{Math.round((step.value / top) * 100)}%</span>
                  </div>
                  <div className="h-3 rounded-full bg-[#d5dfdb]">
                    <div
                      className="h-3 rounded-full"
                      style={{
                        width: `${Math.max(width, 2)}%`,
                        backgroundColor: step.color ?? "#385b4f"
                      }}
                    />
                  </div>
                </div>
                <div className="text-right font-semibold text-[#315349]">{step.value}</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}