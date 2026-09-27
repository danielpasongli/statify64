// utils/timeseriesWorkerPool.ts
//
// Worker pool khusus TimeSeries. Dipisah dari workerRegistry.ts karena
// TimeSeries worker menggunakan WASM via ES module ({ type: "module" }),
// sedangkan workerRegistry.ts tidak support opsi tersebut.
//
// WASM (~479KB) hanya di-load sekali per sesi, bukan setiap kali analisis.

const WORKER_URL = "/workers/TimeSeries/worker.js?v=garch_v3";
const MAX_POOL = 2;

interface PooledWorker {
  worker: Worker;
  busy: boolean;
}

const pool: PooledWorker[] = [];

function acquireWorker(): Worker {
  const idle = pool.find((p) => !p.busy);
  if (idle) {
    idle.busy = true;
    return idle.worker;
  }

  const worker = new Worker(WORKER_URL, { type: "module" });
  pool.push({ worker, busy: true });

  if (pool.length > MAX_POOL) {
    const [old] = pool.splice(0, 1);
    old.worker.terminate();
  }

  return worker;
}

function releaseWorker(worker: Worker) {
  const entry = pool.find((p) => p.worker === worker);
  if (entry) {
    // Reset handlers agar listener lama tidak terpicu di job berikutnya
    entry.worker.onmessage = null;
    entry.worker.onerror = null;
    entry.busy = false;
  }
}

export interface TimeSeriesWorkerClient {
  post: (message: any) => void;
  onMessage: (handler: (e: MessageEvent) => void) => void;
  onError: (handler: (e: ErrorEvent) => void) => void;
  release: () => void;
}

export function getTimeSeriesWorker(): TimeSeriesWorkerClient {
  const worker = acquireWorker();

  return {
    post: (message) => worker.postMessage(message),
    onMessage: (handler) => { worker.onmessage = handler; },
    onError: (handler) => { worker.onerror = handler as any; },
    release: () => releaseWorker(worker),
  };
}
