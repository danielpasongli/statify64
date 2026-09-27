import type { Log } from "@/types/Result";

/**
 * Timing instrumentation for an Analyze module's OK-click -> worker -> render
 * pipeline. Everything is built on performance.mark/performance.measure so
 * entries surface in DevTools' "Timings" track.
 *
 * Two metrics:
 * - Procedure time: OK click -> result data ready (no IndexedDB, no render).
 *   Comparable to SPSS's Elapsed Time.
 * - End-to-end response time: OK click -> last result table painted.
 *   Not comparable to SPSS.
 *
 * A worker's performance.now() has a different timeOrigin than the main
 * thread's, so durations are always computed inside their own thread first;
 * only plain duration numbers (never raw timestamps) cross postMessage, and
 * get re-anchored to a main-thread mark via performance.measure(name, { end, duration }).
 */

export interface AnalysisRunContext {
  runId: string;
  moduleLabel: string;
  okClickMark: string;
  workerResponseMark?: string;
  workerTiming?: WorkerTiming;
}

export interface WorkerTiming {
  workerTotalMs: number;
  computeMs: number;
  wasmInitMs: number;
}

const runCounters = new Map<string, number>();

export function startAnalysisRun(moduleLabel: string): AnalysisRunContext {
  const n = (runCounters.get(moduleLabel) ?? 0) + 1;
  runCounters.set(moduleLabel, n);

  const runId = `${moduleLabel}#${n}`;
  const okClickMark = `statify:${runId}:ok-click`;
  performance.mark(okClickMark);

  return { runId, moduleLabel, okClickMark };
}

export function markDispatch(ctx: AnalysisRunContext): void {
  performance.mark(`statify:${ctx.runId}:dispatch`);
}

export function markWorkerResponse(ctx: AnalysisRunContext): void {
  ctx.workerResponseMark = `statify:${ctx.runId}:worker-response`;
  performance.mark(ctx.workerResponseMark);
}

export function markProcedureEnd(
  ctx: AnalysisRunContext,
  workerTiming?: WorkerTiming
): { procedureMs: number } {
  const procedureEndMark = `statify:${ctx.runId}:procedure-end`;
  performance.mark(procedureEndMark);

  const procedureMeasure = performance.measure(
    `Statify Procedure — ${ctx.runId}`,
    ctx.okClickMark,
    procedureEndMark
  );
  const procedureMs = procedureMeasure.duration;

  if (workerTiming) {
    // Synthetic sub-measure: anchored on OUR OWN mark, built only from the
    // plain duration number the worker measured on its own timeline. Never
    // subtract a worker performance.now() from a main-thread one directly.
    performance.measure(`Statify Worker Compute — ${ctx.runId}`, {
      end: ctx.workerResponseMark ?? procedureEndMark,
      duration: workerTiming.computeMs,
    });
  }

  console.groupCollapsed(`[Statify] ${ctx.moduleLabel} timing — ${ctx.runId}`);
  console.log(
    `Procedure time (compare to SPSS Elapsed Time): ${procedureMs.toFixed(1)} ms`
  );
  if (workerTiming) {
    console.log(`  Worker compute time (detail): ${workerTiming.computeMs.toFixed(1)} ms`);
    console.log(`  Worker total incl. wasm init: ${workerTiming.workerTotalMs.toFixed(1)} ms`);
    console.log(`  Wasm module init: ${workerTiming.wasmInitMs.toFixed(1)} ms`);
  }
  console.groupEnd();

  return { procedureMs };
}

interface RenderTarget {
  ctx: AnalysisRunContext;
  analyticId: number;
  expectedCount: number;
}

const pendingRenderTargets: RenderTarget[] = [];

export function registerRenderCompletionTarget(
  ctx: AnalysisRunContext,
  analyticId: number,
  expectedCount: number
): void {
  if (expectedCount <= 0) {
    completeRenderTarget(ctx);
    return;
  }
  pendingRenderTargets.push({ ctx, analyticId, expectedCount });
}

export function checkRenderCompletionTargets(logs: Log[]): void {
  if (pendingRenderTargets.length === 0) return;

  for (let i = pendingRenderTargets.length - 1; i >= 0; i--) {
    const target = pendingRenderTargets[i];
    const analytic = logs
      .flatMap((log) => log.analytics ?? [])
      .find((a) => a.id === target.analyticId);

    const count = analytic?.statistics?.length ?? 0;
    if (count >= target.expectedCount) {
      pendingRenderTargets.splice(i, 1);
      completeRenderTarget(target.ctx);
    }
  }
}

function completeRenderTarget(ctx: AnalysisRunContext): void {
  // Double rAF: wait until the browser has actually painted the frame that
  // followed the last state update, not just until React committed it.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const renderCompleteMark = `statify:${ctx.runId}:render-complete`;
      performance.mark(renderCompleteMark);
      const measure = performance.measure(
        `Statify End-to-End — ${ctx.runId}`,
        ctx.okClickMark,
        renderCompleteMark
      );
      console.log(
        `[Statify] ${ctx.moduleLabel} end-to-end response time (not compared to SPSS): ${measure.duration.toFixed(1)} ms`
      );
    });
  });
}
