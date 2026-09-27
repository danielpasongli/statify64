import init, { KNNAnalysis } from "/workers/Classify/NearestNeighbor/pkg/wasm.js?v=knn-float-tolerance-20260926";

const WASM_URL =
  "/workers/Classify/NearestNeighbor/pkg/wasm_bg.wasm?v=knn-float-tolerance-20260926";

self.onmessage = async (e) => {
  const {
    target,
    features,
    focal,
    caseData,
    targetDefs,
    featureDefs,
    focalDefs,
    caseDefs,
    config
  } = e.data;

  try {
    const workerStart = performance.now();

    // init WASM (WAJIB kasih path biar ga error)
    await init(WASM_URL);
    const wasmReady = performance.now();

    const knn = new KNNAnalysis(
      target,
      features,
      focal,
      caseData,
      targetDefs,
      featureDefs,
      focalDefs,
      caseDefs,
      config
    );
    const analysisDone = performance.now();

    const result = knn.get_formatted_results();
    const errors = knn.get_all_errors();
    const formatDone = performance.now();

    self.postMessage({
      success: true,
      data: result,
      errors,
      timing: {
        wasmInitMs: wasmReady - workerStart,
        analysisMs: analysisDone - wasmReady,
        formatMs: formatDone - analysisDone,
        totalMs: formatDone - workerStart
      }
    });

  } catch (err) {
    self.postMessage({
      success: false,
      error: err instanceof Error ? err.message : String(err)
    });
  }
};
