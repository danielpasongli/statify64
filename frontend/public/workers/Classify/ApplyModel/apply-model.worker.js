// Worker module Apply Model — meniru persis pola
// `public/workers/Classify/NaiveBayes/naive-bayes.worker.js`.
//
// PLAN.md Fase 10 — worker produksi: `pkg/` di folder ini berisi hasil
// `wasm-pack build --target web --release` dari `apply-model/rust/` (disalin
// manual oleh pemilik produk). Constructor `ApplyModelAnalysis` menjalankan
// scoring + evaluasi (AGENTS.md §5, §7.1) dan melempar error berkode
// `"AM_E_XXX: detail"` bila model/payload tidak valid.
//
// Respons mengikuti AGENTS.md §3.6 (pola NB):
//   { success: true, data: ApplyModelRawResult, errors: string }
//   { success: false, error: string }
//
// Versi cache (`?v=...`) WAJIB di-bump setiap kali `pkg/` diganti (lihat
// `apply-model-analysis.ts`, konstanta `APPLY_MODEL_WASM_VERSION`).
const APPLY_MODEL_WASM_VERSION = "apply-model-20261003a";

let wasmModulePromise = null;

async function loadWasmModule() {
  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      const mod = await import(`./pkg/wasm.js?v=${APPLY_MODEL_WASM_VERSION}`);
      await mod.default(`./pkg/wasm_bg.wasm?v=${APPLY_MODEL_WASM_VERSION}`);
      return mod;
    })();
  }
  return wasmModulePromise;
}

self.onmessage = async function (e) {
  try {
    const {
      predictors,
      predictorDefs,
      mapping,
      actual,
      actualDefs,
      model,
    } = e.data;

    const wasm = await loadWasmModule();
    const analysis = new wasm.ApplyModelAnalysis(
      predictors,
      predictorDefs,
      mapping,
      actual,
      actualDefs,
      model
    );

    const result = analysis.get_formatted_results();
    const errors = analysis.get_all_errors();

    self.postMessage({
      success: true,
      data: result,
      errors
    });

  } catch (err) {
    self.postMessage({
      success: false,
      error: err instanceof Error ? err.message : String(err)
    });
  }
};
