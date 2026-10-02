/* eslint-disable no-console */
/**
 * Pengukuran performa pipeline KNN di browser.
 *
 * Titik ukur di main thread (performance.now):
 *   start           -> analyzeKNN dipanggil (sebelum slicing data)
 *   workerPosted    -> data selesai disiapkan & dikirim ke worker
 *   workerResponded -> pesan hasil diterima dari worker
 *   finished        -> hasil diformat, disimpan ke output & data viewer
 *
 * Titik ukur di worker (dikirim sebagai `timing`):
 *   wasmInitMs  -> memuat & meng-compile WASM
 *   analysisMs  -> konstruktor KNNAnalysis (parsing input + run_analysis)
 *   formatMs    -> get_formatted_results + get_all_errors
 *   totalMs     -> seluruh handler onmessage di worker
 *
 * Padanan "Elapsed Time" pada tabel Notes SPSS adalah analysisMs + formatMs
 * (eksekusi prosedur hingga tabel output terbentuk), tanpa init WASM,
 * transfer antar-thread, dan render.
 *
 * Setiap run disimpan di window.__knnPerfRuns agar bisa diekspor setelah
 * pengulangan, mis. di DevTools: copy(JSON.stringify(__knnPerfRuns)).
 */

export type KnnWorkerTiming = {
  wasmInitMs: number;
  analysisMs: number;
  formatMs: number;
  totalMs: number;
};

export type KnnPerformanceRun = {
  timestamp: string;
  rows: number;
  features: number;
  preprocessingMs: number;
  workerRoundTripMs: number;
  wasmInitMs: number | null;
  analysisMs: number | null;
  formatMs: number | null;
  workerTotalMs: number | null;
  spssComparableMs: number | null;
  postProcessingMs: number;
  totalPipelineMs: number;
};

type PerformanceWindow = Window & { __knnPerfRuns?: KnnPerformanceRun[] };

const formatMs = (value: number | null) =>
  value === null ? "-" : `${value.toFixed(2)} ms`;

const isWorkerTiming = (timing: unknown): timing is KnnWorkerTiming =>
  typeof timing === "object" &&
  timing !== null &&
  typeof (timing as KnnWorkerTiming).analysisMs === "number";

const countRows = (slicedData: unknown[][]) => slicedData[0]?.length ?? 0;

export function createKnnPerformanceTracker() {
  const start = performance.now();
  let workerPosted = start;
  let workerResponded = start;
  let rows = 0;
  let features = 0;

  return {
    markWorkerPosted(slicedFeatures: unknown[][]) {
      workerPosted = performance.now();
      rows = countRows(slicedFeatures);
      features = slicedFeatures.length;
    },

    markWorkerResponded() {
      workerResponded = performance.now();
    },

    report(timing: unknown): KnnPerformanceRun {
      const finished = performance.now();
      const workerTiming = isWorkerTiming(timing) ? timing : null;

      const run: KnnPerformanceRun = {
        timestamp: new Date().toISOString(),
        rows,
        features,
        preprocessingMs: workerPosted - start,
        workerRoundTripMs: workerResponded - workerPosted,
        wasmInitMs: workerTiming?.wasmInitMs ?? null,
        analysisMs: workerTiming?.analysisMs ?? null,
        formatMs: workerTiming?.formatMs ?? null,
        workerTotalMs: workerTiming?.totalMs ?? null,
        spssComparableMs: workerTiming
          ? workerTiming.analysisMs + workerTiming.formatMs
          : null,
        postProcessingMs: finished - workerResponded,
        totalPipelineMs: finished - start,
      };

      if (typeof window !== "undefined") {
        const perfWindow = window as PerformanceWindow;
        perfWindow.__knnPerfRuns ??= [];
        perfWindow.__knnPerfRuns.push(run);
      }

      console.groupCollapsed(
        `[KNN] Laporan Performa — ${run.rows} baris, ${run.features} fitur`,
      );
      console.table({
        "Preprocessing (slicing data, main thread)": formatMs(run.preprocessingMs),
        "WASM init": formatMs(run.wasmInitMs),
        "Komputasi KNN (konstruktor)": formatMs(run.analysisMs),
        "Format hasil": formatMs(run.formatMs),
        "Total dalam worker": formatMs(run.workerTotalMs),
        "Worker round-trip (UI -> Worker -> UI)": formatMs(run.workerRoundTripMs),
        "Post-processing (format + simpan output)": formatMs(run.postProcessingMs),
        "Total pipeline end-to-end": formatMs(run.totalPipelineMs),
      });
      console.log(
        `Padanan SPSS Elapsed Time (komputasi + format): ${formatMs(run.spssComparableMs)}`,
      );
      console.groupEnd();

      return run;
    },
  };
}
