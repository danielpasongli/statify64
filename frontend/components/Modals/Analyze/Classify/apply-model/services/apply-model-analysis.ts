// AGENTS.md §6.6 — orkestrator Apply Model (PLAN.md Fase 17).
// Urutan: hitung kolom output & nama akhir -> bangun payload (satu
// `getSlicedData`) -> worker -> `resultApplyModel` -> `saveApplyModelVariables`.
// Pola worker: NB/services/naive-bayes-analysis.ts.

import { getSlicedData, getVarDefs } from "@/hooks/useVariable";
import {
  getModelAdapter,
  validateAnyModel,
} from "@/components/Modals/Analyze/Classify/apply-model/adapters/registry";
import type { ApplyModelErrorCode } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import {
  getOutputColumnSpecs,
  resolveFinalOutputNames,
  type OutputColumnSpec,
} from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelSaveRules";
import {
  transformApplyModelResult,
  type ApplyModelTextMappingInfo,
} from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-formatter";
import { resultApplyModel } from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-output";
import { saveApplyModelVariables } from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-save-variables";
import type { ApplyModelType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import type {
  ApplyModelRawResult,
  ApplyModelTextPayload,
  ApplyModelWorkerPayload,
} from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model-worker";
import type { Variable } from "@/types/Variable";

/**
 * Versi cache WASM (`?v=`). WAJIB sama dengan konstanta di
 * `public/workers/Classify/ApplyModel/apply-model.worker.js` dan di-bump
 * setiap `pkg/` disalin ulang. Format: `apply-model-YYYYMMDD<huruf>`.
 */
export const APPLY_MODEL_WASM_VERSION = "apply-model-v3-20261005a";
export const APPLY_MODEL_WORKER_URL = `/workers/Classify/ApplyModel/apply-model.worker.js?v=${APPLY_MODEL_WASM_VERSION}`;

export type ApplyModelRunSummary = {
  scoredRows: number;
  finalNames: string[];
  warnings: ApplyModelRawResult["warnings"];
};

export type ApplyModelRunParams = {
  formData: ApplyModelType;
  variables: Variable[];
  /** Isi `useDataStore.data` (baris x kolom), dikirim apa adanya ke `getSlicedData`. */
  dataVariables: string[][];
};

type WorkerResponse =
  | { success: true; data: ApplyModelRawResult; errors?: string }
  | { success: false; error?: string };

/** Error berkode "AM_E_XXX: detail" (dipetakan `getUserFriendlyApplyModelError`). */
function codedError(code: ApplyModelErrorCode, detail?: string): Error {
  return new Error(detail ? `${code}: ${detail}` : code);
}

/** Label kolom untuk tabel Saved Variables (kolom "Column"). */
function describeColumn(spec: OutputColumnSpec): string {
  if (spec.key === "predicted") return "Predicted value";
  if (spec.key === "maxProbability") return "Max probability";
  return `Probability of ${spec.key.slice("class:".length)}`;
}

/**
 * v2: membaca kolom teks mentah langsung dari `dataVariables` (TANPA `getSlicedData`
 * dan TANPA parseFloat, agar "3 kucing lucu" tidak menjadi angka 3; pola sama dengan
 * NB/services/naive-bayes-analysis.ts). null/""/spasi saja -> null (V11); teks bermakna
 * dikirim apa adanya. Panjang hasil = max(`minLength`, baris terakhir yang berisi + 1).
 */
export function readRawTextValues(
  dataVariables: string[][],
  columnIndex: number,
  minLength: number,
): (string | null)[] {
  const values: (string | null)[] = [];
  let lastFilled = -1;
  dataVariables.forEach((row, index) => {
    const cell: unknown = row?.[columnIndex];
    const text = cell === null || cell === undefined ? "" : String(cell);
    if (text.trim() === "") {
      values.push(null);
    } else {
      values.push(text);
      lastFilled = index;
    }
  });
  const length = Math.max(minLength, lastFilled + 1);
  values.length = Math.min(values.length, length);
  while (values.length < length) values.push(null);
  return values;
}

/** v2: sel numerik kolom vektor; non-angka/non-finite -> null (Rust: 0). */
function toVectorCell(value: string | number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function runWorker(payload: ApplyModelWorkerPayload): Promise<ApplyModelRawResult> {
  return new Promise<ApplyModelRawResult>((resolve, reject) => {
    const worker = new Worker(APPLY_MODEL_WORKER_URL, { type: "module" });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      worker.terminate();
      const response = event.data;
      if (!response.success) {
        reject(new Error(response.error ?? "AM_E_WORKER"));
        return;
      }
      resolve(response.data);
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Apply Model worker error."));
    };

    worker.postMessage(payload);
  });
}

export async function applyModel({
  formData,
  variables,
  dataVariables,
}: ApplyModelRunParams): Promise<ApplyModelRunSummary> {
  // 1. Model & adapter (generik lewat registry, §2 P2).
  if (formData.model.ModelJson === null) throw codedError("AM_E_NO_MODEL");
  const validation = validateAnyModel(formData.model.ModelJson);
  if (!validation.ok) {
    const [firstIssue] = validation.errors;
    throw codedError(
      (firstIssue?.code ?? "AM_E_NO_MODEL") as ApplyModelErrorCode,
      firstIssue?.detail,
    );
  }
  const { descriptor } = validation;
  const adapter = getModelAdapter(descriptor.modelType);
  if (adapter === null) throw codedError("AM_E_MODEL_TYPE_UNSUPPORTED", descriptor.modelType);

  // 2. Kolom output & nama akhir — dihitung SEBELUM worker (§6.6).
  const specs = getOutputColumnSpecs(descriptor, formData.save, adapter);
  const { finalNames } = resolveFinalOutputNames(
    specs.map((spec) => spec.requestedName),
    variables,
  );

  // 3. Payload (§3.6): satu `getSlicedData` agar panjang baris semua slice identik.
  const mapping = descriptor.features.map((feature) => {
    const variable = formData.variables.FeatureMapping[feature.name] ?? null;
    if (variable === null) throw codedError("AM_E_MAP_UNMAPPED", feature.name);
    return { feature: feature.name, variable };
  });
  const mappedVariables = mapping.map((entry) => entry.variable);
  const actualVariable = formData.variables.ActualTargetVar;

  // v2 (AGENTS_V2.md §10.2–10.3): fitur Text. Raw -> kolom dibaca mentah (bukan lewat
  // getSlicedData); vector -> kolom terpetakan ikut di slice setelah prediktor v1.
  const text = descriptor.text;
  let rawTextColumnIndex: number | null = null;
  const vectorEntries: Array<{ modelIndex: number; variable: string }> = [];
  if (text?.source === "raw") {
    const rawVariable = formData.variables.RawTextVar ?? null;
    if (rawVariable === null) {
      throw codedError("AM_E_MAP_RAW_TEXT_UNMAPPED", text.rawVariable ?? undefined);
    }
    const definition = variables.find((variable) => variable.name === rawVariable);
    if (!definition) throw codedError("AM_E_MAP_VAR_NOT_FOUND", rawVariable);
    rawTextColumnIndex = definition.columnIndex;
  } else if (text?.source === "vector") {
    const vectorMapping = formData.variables.VectorMapping ?? {};
    text.columns.forEach((column, modelIndex) => {
      const variable = vectorMapping[column] ?? null;
      // Kolom tak terpetakan diisi 0 oleh Rust (V10); tidak dikirim.
      if (variable !== null) vectorEntries.push({ modelIndex, variable });
    });
  }
  const vectorVariables = vectorEntries.map((entry) => entry.variable);

  const selectedVariables = [
    ...mappedVariables,
    ...vectorVariables,
    ...(actualVariable === null ? [] : [actualVariable]),
  ];
  // Model vector hanya-Text yang semua kolomnya tak terpetakan: pinjam satu kolom dataset
  // semata-mata untuk mengetahui jumlah baris (semua baris akan NotScored di Rust).
  const rowCarrier =
    selectedVariables.length === 0 && text?.source === "vector"
      ? (variables[0]?.name ?? null)
      : null;
  const slices = getSlicedData({
    dataVariables,
    variables,
    selectedVariables: rowCarrier === null ? selectedVariables : [rowCarrier],
  });
  // Jalur raw tidak memakai slice untuk teks, sehingga boleh tanpa slice sama sekali.
  if (slices.length === 0 && rawTextColumnIndex === null) throw codedError("AM_E_NO_ROWS");
  const sliceRows = slices[0]?.length ?? 0;

  let textPayload: ApplyModelTextPayload | undefined;
  if (text?.source === "raw" && rawTextColumnIndex !== null) {
    const values = readRawTextValues(dataVariables, rawTextColumnIndex, sliceRows);
    if (values.length === 0) throw codedError("AM_E_NO_ROWS");
    textPayload = { source: "raw", values };
  } else if (text?.source === "vector") {
    const vectorSlices = slices.slice(
      mappedVariables.length,
      mappedVariables.length + vectorVariables.length,
    );
    const values: (number | null)[][] = [];
    for (let row = 0; row < sliceRows; row++) {
      values.push(
        vectorEntries.map((entry, column) =>
          toVectorCell(vectorSlices[column]?.[row]?.[entry.variable]),
        ),
      );
    }
    textPayload = {
      source: "vector",
      mapped_columns: vectorEntries.map((entry) => entry.modelIndex),
      values,
    };
  }

  // v2: informasi pemetaan Text untuk baris ringkasan model (sisi TS).
  let textMappingInfo: ApplyModelTextMappingInfo | undefined;
  if (text?.source === "raw") {
    textMappingInfo = {
      source: "raw",
      modelVariable: text.rawVariable,
      datasetVariable: formData.variables.RawTextVar ?? "-",
    };
  } else if (text?.source === "vector") {
    textMappingInfo = {
      source: "vector",
      totalColumns: text.columns.length,
      mappedColumns: vectorEntries.length,
    };
  }

  const actualSliceIndex = mappedVariables.length + vectorVariables.length;
  const payload: ApplyModelWorkerPayload = {
    predictors: slices.slice(0, mappedVariables.length),
    predictorDefs: getVarDefs(variables, mappedVariables),
    mapping,
    actual: actualVariable === null ? [] : [slices[actualSliceIndex]],
    actualDefs: actualVariable === null ? [] : getVarDefs(variables, [actualVariable]),
    model: formData.model.ModelJson,
    // Payload model v1 tidak berubah: key `text` hanya ada bila model memuat fitur Text.
    ...(textPayload === undefined ? {} : { text: textPayload }),
  };

  // 4. Worker -> Output Viewer -> kolom dataset (urutan tetap).
  const rawResult = await runWorker(payload);

  const formattedResult = transformApplyModelResult(rawResult, formData.output, {
    sourceLabel: formData.model.SourceLabel ?? "-",
    ...(textMappingInfo === undefined ? {} : { textMapping: textMappingInfo }),
    savedColumns: specs.map((spec, index) => ({
      column: describeColumn(spec),
      finalName: finalNames[index],
      type: spec.type,
      measure: spec.measure,
    })),
  });

  await resultApplyModel({ formattedResult, rawResult, formData, finalNames });
  await saveApplyModelVariables(rawResult, specs, finalNames);

  return {
    scoredRows: rawResult.case_processing_summary.scored_rows,
    finalNames,
    warnings: rawResult.warnings,
  };
}
