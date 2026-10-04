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
import { transformApplyModelResult } from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-formatter";
import { resultApplyModel } from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-output";
import { saveApplyModelVariables } from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-save-variables";
import type { ApplyModelType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import type {
  ApplyModelRawResult,
  ApplyModelWorkerPayload,
} from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model-worker";
import type { Variable } from "@/types/Variable";

/**
 * Versi cache WASM (`?v=`). WAJIB sama dengan konstanta di
 * `public/workers/Classify/ApplyModel/apply-model.worker.js` dan di-bump
 * setiap `pkg/` disalin ulang. Format: `apply-model-YYYYMMDD<huruf>`.
 */
export const APPLY_MODEL_WASM_VERSION = "apply-model-20261003a";
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
  const selectedVariables =
    actualVariable === null ? mappedVariables : [...mappedVariables, actualVariable];

  const slices = getSlicedData({ dataVariables, variables, selectedVariables });
  if (slices.length === 0) throw codedError("AM_E_NO_ROWS");

  const payload: ApplyModelWorkerPayload = {
    predictors: slices.slice(0, mappedVariables.length),
    predictorDefs: getVarDefs(variables, mappedVariables),
    mapping,
    actual: actualVariable === null ? [] : [slices[mappedVariables.length]],
    actualDefs: actualVariable === null ? [] : getVarDefs(variables, [actualVariable]),
    model: formData.model.ModelJson,
  };

  // 4. Worker -> Output Viewer -> kolom dataset (urutan tetap).
  const rawResult = await runWorker(payload);

  const formattedResult = transformApplyModelResult(rawResult, formData.output, {
    sourceLabel: formData.model.SourceLabel ?? "-",
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
