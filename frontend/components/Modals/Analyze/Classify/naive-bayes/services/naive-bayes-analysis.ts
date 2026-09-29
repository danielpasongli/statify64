// naive-bayes-analysis.ts
//
// Orkestrator analisis Naive Bayes (pola `nearest-neighbor-analysis.ts`).
//
// PLAN.md Fase 17 ("Sambungkan wasm asli ke worker & service, ganti dummy
// Fase 8"): Worker/WASM sudah disambungkan sejak Fase 8 (`analyzeNaiveBayes`
// di bawah TIDAK berubah struktur sejak saat itu — tetap
// Worker(NAIVE_BAYES_WORKER_URL) + postMessage payload yang sama). Yang
// berubah di Fase 17 adalah ISI wasm yang dimuat worker itu: sebelumnya
// crate DUMMY (`get_formatted_results()` di sisi Rust mengembalikan
// struktur hardcoded identik stub JSON Fase 7.1), sekarang crate SUNGGUHAN
// (Fase 9-16, `naive-bayes/rust/src/wasm/function.rs::run_analysis`) yang
// menghitung statistik nyata dari data yang dikirim. Bentuk JSON yang
// dikembalikan Rust dirancang PERSIS sama field-nya dengan
// `NaiveBayesRawResult` (lihat `naive-bayes-analysis-formatter.ts`) sejak
// awal Fase 16, jadi `analyzeNaiveBayes`/`transformNaiveBayesResult` di
// bawah TIDAK perlu perubahan field-mapping — lihat laporan implementasi
// Fase 16/17 untuk audit field-per-field yang membuktikan ini.
//
// CATATAN PENTING (lihat juga laporan implementasi Fase 17): `pkg/` di
// bawah `public/workers/Classify/NaiveBayes/` HARUS diisi ulang secara
// MANUAL dari hasil `wasm-pack build --target web --release` terbaru atas
// `naive-bayes/rust` SEBELUM baris di atas ("wasm sungguhan") benar-benar
// berlaku di browser — build itu didelegasikan ke pemilik produk (agent
// tidak punya akses jaringan crates.io / toolchain Rust lokal untuk
// menjalankannya sendiri).
import { getVarDefs } from "@/hooks/useVariable";
import { getEffectivePredictors } from "@/components/Modals/Analyze/Classify/naive-bayes/hooks/useNaiveBayesValidation";
import { transformNaiveBayesResult } from "./naive-bayes-analysis-formatter";
import type { NaiveBayesRawResult } from "./naive-bayes-analysis-formatter";
import { resultNaiveBayes } from "./naive-bayes-analysis-output";
import type { NaiveBayesType } from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";
import type { Variable } from "@/types/Variable";

/**
 * Query-string cache-busting, mengikuti pola KNN
 * (`?v=knn-focal-positive-20260925`) supaya browser tidak nyangkut pada
 * wasm lama saat development. WAJIB di-bump lagi setiap kali `pkg/` di
 * bawah `public/workers/Classify/NaiveBayes/` di-copy ulang dari hasil
 * `wasm-pack build` yang baru (lihat PLAN.md, "Risiko Teknis") — termasuk
 * build PERTAMA yang menggantikan dummy Fase 8 (lihat catatan di kepala
 * file ini soal `pkg/` yang masih perlu diisi ulang manual oleh pemilik
 * produk).
 */
const NAIVE_BAYES_WASM_VERSION = "naive-bayes-real-20260928a";
const NAIVE_BAYES_WORKER_URL = `/workers/Classify/NaiveBayes/naive-bayes.worker.js?v=${NAIVE_BAYES_WASM_VERSION}`;

export type NaiveBayesAnalysisPayload = {
  configData: NaiveBayesType;
  /**
   * Data yang SUDAH di-slice per variabel lewat `getSlicedData` di level
   * container (`naive-bayes-main.tsx`): array berurutan
   * `[targetColumn?, ...predictorColumns]`, satu entri per nama variabel,
   * urutan SAMA dengan `[TargetVar, ...getEffectivePredictors(main, variables)]`
   * — `getEffectivePredictors` (dari `useNaiveBayesValidation.ts`) adalah
   * satu-satunya sumber kebenaran predictor efektif, dipakai identik oleh
   * container saat membangun array ini DAN oleh `analyzeNaiveBayes` di
   * bawah saat memisah ulang target vs predictors. Konsisten untuk kedua
   * mode `AGENTS.md §3.3 (Exclude maupun Candidate Factors/Covariates).
   *
   * Fungsi ini hanya memisah ULANG array yang sudah jadi ini menjadi
   * bagian target vs predictors — TIDAK memanggil `getSlicedData` lagi.
   */
  dataVariables: unknown;
  variables: Variable[];
};

/**
 * Menjalankan analisis Naive Bayes lewat Worker + WASM (engine sungguhan
 * sejak Fase 16/17 — lihat catatan di kepala file soal `pkg/` yang perlu
 * di-build ulang manual sebelum ini benar-benar aktif di browser).
 */
export async function analyzeNaiveBayes({
  configData,
  dataVariables,
  variables,
}: NaiveBayesAnalysisPayload): Promise<NaiveBayesRawResult> {
  const targetName = configData.main.TargetVar;
  const targetNames = targetName ? [targetName] : [];
  // Predictor efektif dihitung lewat `getEffectivePredictors` — satu-satunya
  // sumber kebenaran (dipakai juga oleh `useNaiveBayesValidation` untuk
  // tombol OK dan oleh `naive-bayes-main.tsx` saat membangun `dataVariables`
  // di atas), supaya urutan & isi predictor SELALU konsisten dengan apa yang
  // benar-benar dikirim container, termasuk mode `ExcludedVar` (AGENTS.md
  // §3.3) — sebelumnya fungsi lokal di sini hanya tahu
  // CandidateFactors/CandidateCovariates, jadi mode Exclude selalu terkirim
  // sebagai predictor kosong (bug, sudah diperbaiki).
  const predictorNames = getEffectivePredictors(configData.main, variables);

  const slicedColumns = Array.isArray(dataVariables) ? dataVariables : [];
  const targetSlices = slicedColumns.slice(0, targetNames.length);
  const predictorSlices = slicedColumns.slice(
    targetNames.length,
    targetNames.length + predictorNames.length,
  );

  const targetDefs = getVarDefs(variables, targetNames);
  const predictorsDefs = getVarDefs(variables, predictorNames);

  const worker = new Worker(NAIVE_BAYES_WORKER_URL, { type: "module" });

  const rawResult = await new Promise<NaiveBayesRawResult>((resolve, reject) => {
    worker.postMessage({
      target: targetSlices,
      predictors: predictorSlices,
      targetDefs,
      predictorsDefs,
      config: configData,
    });

    worker.onmessage = (e) => {
      try {
        if (!e.data.success) {
          reject(new Error(e.data.error ?? "Naive Bayes worker failed."));
          return;
        }
        resolve(e.data.data as NaiveBayesRawResult);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        worker.terminate();
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || "Naive Bayes worker error."));
    };
  });

  const formattedResult = transformNaiveBayesResult(rawResult, configData.output);

  await resultNaiveBayes({
    formattedResult,
    rawResult,
    configData,
  });

  return rawResult;
}
