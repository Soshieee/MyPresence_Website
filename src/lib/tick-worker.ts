// Web Workers are NOT throttled by browsers when their tab is hidden or
// inactive, unlike window.setInterval (background tabs get their timers
// slowed to once per second or worse). The attendance console uses this tick
// source so face scanning and kiosk streaming keep running at full speed
// while the operator views the kiosk display in another tab or window.

export type TickWorker = {
  worker: Worker;
  dispose: () => void;
};

export function createTickWorker(intervalMs: number): TickWorker {
  const code = `setInterval(() => postMessage("tick"), ${intervalMs});`;
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  const worker = new Worker(url);
  return {
    worker,
    dispose: () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  };
}
