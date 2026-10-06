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
import {
  getEffectivePredictors,
  getEffectiveTextSource,
  getTextColumnNames,
} from "@/components/Modals/Analyze/Classify/naive-bayes/hooks/useNaiveBayesValidation";
import { toRustConfig, type StwvRustPayload } from "@/components/Modals/Transform/StringToWordVector/config";
import { transformNaiveBayesResult } from "./naive-bayes-analysis-formatter";
import type { NaiveBayesRawResult } from "./naive-bayes-analysis-formatter";
import { resultNaiveBayes } from "./naive-bayes-analysis-output";
import type {
  NaiveBayesMainType,
  NaiveBayesTextPayload,
  NaiveBayesType,
} from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";
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
const NAIVE_BAYES_WASM_VERSION = "naive-bayes-v3-20261005a";
const NAIVE_BAYES_WORKER_URL = `/workers/Classify/NaiveBayes/naive-bayes.worker.js?v=${NAIVE_BAYES_WASM_VERSION}`;

// Batas Top-k (AGENTS_V2 §3.7) dan default-nya; dipakai untuk mengamankan
// nilai yang dikirim ke Rust (`TextTopK` bertipe bilangan bulat tanpa tanda).
const TEXT_TOP_K_MIN = 1;
const TEXT_TOP_K_MAX = 1000;
const TEXT_TOP_K_DEFAULT = 100;

/** Satu kolom hasil `getSlicedData`: satu objek `{ [namaVariabel]: nilai }` per baris. */
type SlicedColumn = ReadonlyArray<Record<string, string | number | null>>;

/** Config JSON yang dikirim ke worker: bentuk form tanpa `text` + `Text` (snake_case, kontrak CORE §3.1). */
export type NaiveBayesWorkerConfig = Omit<NaiveBayesType, "text"> & {
  Text: StwvRustPayload | null;
};

/**
 * Membentuk `config` untuk Rust (AGENTS_V2 §5.1). `text` (StwvConfig UI)
 * dikonversi lewat `toRustConfig` dan dikirim sebagai `Text` HANYA untuk jalur
 * Raw Text; jalur vector/none mengirim `Text: null` supaya konfigurasi
 * preprocessing yang tak terpakai tidak bisa memicu galat di Rust dan payload
 * model setara v1 tetap identik dengan v1 (+ field default v2).
 */
export function buildNaiveBayesWorkerConfig(
  configData: NaiveBayesType,
): NaiveBayesWorkerConfig {
  const { text, ...rest } = configData;
  // TextSource tersimpan bisa basi; nilai efektif diturunkan dari isi slot.
  const effectiveSource = getEffectiveTextSource(rest.main);
  const topK = rest.output.TextTopK;
  const safeTopK =
    Number.isInteger(topK) && topK >= TEXT_TOP_K_MIN && topK <= TEXT_TOP_K_MAX
      ? topK
      : TEXT_TOP_K_DEFAULT;
  return {
    ...rest,
    main: { ...rest.main, TextSource: effectiveSource },
    output: { ...rest.output, TextTopK: safeTopK },
    Text: effectiveSource === "raw" ? toRustConfig(text) : null,
  };
}

/**
 * Membentuk `NaiveBayesTextPayload` (AGENTS_V2 §5.1). Baris SEJAJAR dengan
 * baris target (jumlah baris = `rowCount`; dipotong/diisi null bila perlu).
 * Pembuangan baris target-missing dilakukan di Rust (§5.2).
 * - raw: memakai `rawTextValues` (teks mentah per baris, TANPA `getSlicedData`
 *   dan TANPA parseFloat, sehingga "3 kucing lucu" tetap utuh). null/"" -> null;
 *   selain itu `String(v)`; teks berisi spasi saja juga -> null. Bila `rawTextValues` tidak diberikan, fungsi ini
 *   melempar galat (lebih baik gagal keras daripada diam-diam memotong teks).
 * - vector: dari `textSlices` hasil `getSlicedData` (urutan sama dengan
 *   `getTextColumnNames(main)`); sel non-numerik/non-finite -> null (Rust
 *   mengubahnya menjadi 0).
 */
export function buildNaiveBayesTextPayload(
  main: NaiveBayesMainType,
  textSlices: ReadonlyArray<SlicedColumn>,
  rowCount: number,
  rawTextValues?: ReadonlyArray<unknown>,
): NaiveBayesTextPayload {
  const source = getEffectiveTextSource(main);
  const names = getTextColumnNames(main);
  if (source === "none" || names.length === 0) return { source: "none" };

  if (source === "raw") {
    if (!rawTextValues) {
      throw new Error(
        "NB_E_TEXT_RAW_MISSING: The text of the Raw Text Variable was not provided.",
      );
    }
    const values: (string | null)[] = [];
    for (let r = 0; r < rowCount; r++) {
      const v = rawTextValues[r];
      // null/undefined/""/spasi saja -> null (V11: whitespace = missing).
      // Teks bermakna dikirim apa adanya (tidak di-trim) agar tidak mengubah dokumen.
      const teks = v === null || v === undefined ? "" : String(v);
      values.push(teks.trim() === "" ? null : teks);
    }
    return { source: "raw", variable: names[0], values };
  }

  const cell = (col: number, row: number): string | number | null =>
    textSlices[col]?.[row]?.[names[col]] ?? null;

  const values: (number | null)[][] = [];
  for (let r = 0; r < rowCount; r++) {
    const row: (number | null)[] = [];
    for (let c = 0; c < names.length; c++) {
      const v = cell(c, r);
      row.push(typeof v === "number" && Number.isFinite(v) ? v : null);
    }
    values.push(row);
  }
  return { source: "vector", columns: names, values };
}

/** Hasil pemisahan `dataVariables` (lihat `splitNaiveBayesDataVariables`). */
export type NaiveBayesSplitData = {
  targetNames: string[];
  predictorNames: string[];
  /** Nama kolom Text yang dibaca dari ekor `dataVariables` (hanya jalur vector; raw -> kosong). */
  textNames: string[];
  targetSlices: unknown[];
  predictorSlices: unknown[];
  textSlices: SlicedColumn[];
  /** Jumlah baris = panjang kolom target pertama (0 bila tanpa target). */
  rowCount: number;
};

/**
 * Fungsi murni: memisah `dataVariables` menjadi bagian target, predictor, dan
 * Text dengan urutan `[target?, ...getEffectivePredictors, ...textVector?]`.
 * Kolom Raw Text TIDAK ada di `dataVariables` (dikirim lewat `rawTextValues`);
 * hanya Word-Vector Variables yang dibaca dari ekor.
 */
export function splitNaiveBayesDataVariables(
  dataVariables: unknown,
  main: NaiveBayesMainType,
  variables: Variable[],
): NaiveBayesSplitData {
  const targetNames = main.TargetVar ? [main.TargetVar] : [];
  const predictorNames = getEffectivePredictors(main, variables);
  const textNames =
    getEffectiveTextSource(main) === "vector" ? getTextColumnNames(main) : [];

  const columns = Array.isArray(dataVariables) ? dataVariables : [];
  const t = targetNames.length;
  const p = t + predictorNames.length;
  const targetSlices = columns.slice(0, t);
  return {
    targetNames,
    predictorNames,
    textNames,
    targetSlices,
    predictorSlices: columns.slice(t, p),
    textSlices: columns.slice(p, p + textNames.length) as SlicedColumn[],
    rowCount: Array.isArray(targetSlices[0]) ? targetSlices[0].length : 0,
  };
}

export type NaiveBayesAnalysisPayload = {
  configData: NaiveBayesType;
  /**
   * Data yang SUDAH di-slice per variabel lewat `getSlicedData` di level
   * container (`naive-bayes-main.tsx`): array berurutan
   * `[targetColumn?, ...predictorColumns]`, satu entri per nama variabel,
   * urutan SAMA dengan `[TargetVar, ...getEffectivePredictors(main, variables)]`
   * v2: untuk jalur Word-Vector diikuti `...getTextColumnNames(main)` di paling
   * belakang. Kolom Raw Text TIDAK termasuk (lihat `rawTextValues`)
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
  /**
   * Teks mentah per baris untuk Raw Text Variable, sejajar baris target.
   * WAJIB diisi container (N7) dari `useDataStore.data[row][columnIndex]`
   * (nilai asli sel), BUKAN dari `getSlicedData`: `parseCellValue` memakai
   * parseFloat sehingga "3 kucing lucu" berubah menjadi 3. Tidak dipakai untuk
   * jalur vector/none.
   */
  rawTextValues?: ReadonlyArray<unknown>;
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
  rawTextValues,
}: NaiveBayesAnalysisPayload): Promise<NaiveBayesRawResult> {
  // Predictor efektif dihitung lewat `getEffectivePredictors` (satu-satunya
  // sumber kebenaran, dipakai juga oleh `useNaiveBayesValidation` dan container)
  // di dalam `splitNaiveBayesDataVariables`.
  const {
    targetNames,
    predictorNames,
    targetSlices,
    predictorSlices,
    textSlices,
    rowCount,
  } = splitNaiveBayesDataVariables(dataVariables, configData.main, variables);
  const textPayload = buildNaiveBayesTextPayload(
    configData.main,
    textSlices,
    rowCount,
    rawTextValues,
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
      config: buildNaiveBayesWorkerConfig(configData),
      // v2 (AGENTS_V2 §5.1): argumen baru konstruktor NaiveBayesAnalysis.
      // Penerusan di worker adalah milik fase I1.
      text: textPayload,
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
