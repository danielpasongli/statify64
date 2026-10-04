// AGENTS.md §3.2, §4.2 — registry adapter & validasi umum `validateAnyModel`.
// Murni TypeScript; tanpa komponen React, tanpa akses store.

import type { ApplyModelIssue } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import type {
  ClassifierModelAdapter,
  ModelValidationResult,
} from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import { naiveBayesModelAdapter } from "@/components/Modals/Analyze/Classify/apply-model/adapters/naive-bayes-adapter";

function makeError(
  code: ApplyModelIssue["code"],
  detail?: string
): ApplyModelIssue {
  return detail !== undefined
    ? { code, severity: "error", detail }
    : { code, severity: "error" };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Isi awal registry: hanya `naive_bayes` (§3.2). Kunci = `adapter.modelType`.
// Menambah algoritma baru = menambah satu baris di sini.
export const CLASSIFIER_MODEL_ADAPTERS: Record<string, ClassifierModelAdapter> = {
  [naiveBayesModelAdapter.modelType]: naiveBayesModelAdapter,
};

/** Ambil adapter berdasarkan `model_type`; `null` bila tidak terdaftar. */
export function getModelAdapter(modelType: string): ClassifierModelAdapter | null {
  // hasOwnProperty: kunci seperti "constructor"/"toString" tidak boleh lolos.
  return Object.prototype.hasOwnProperty.call(CLASSIFIER_MODEL_ADAPTERS, modelType)
    ? CLASSIFIER_MODEL_ADAPTERS[modelType]
    : null;
}

/**
 * Validasi umum (§4.2):
 * 1. Bukan objek JSON → AM_E_NOT_OBJECT.
 * 2. model_type tidak ada / bukan string → AM_E_MODEL_TYPE_MISSING.
 * 3. model_type tidak ada di registry → AM_E_MODEL_TYPE_UNSUPPORTED.
 * 4. Delegasi ke adapter.validate(raw).
 */
export function validateAnyModel(raw: unknown): ModelValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [makeError("AM_E_NOT_OBJECT")] };
  }

  const modelType = raw.model_type;
  if (typeof modelType !== "string") {
    return { ok: false, errors: [makeError("AM_E_MODEL_TYPE_MISSING")] };
  }

  const adapter = getModelAdapter(modelType);
  if (!adapter) {
    return {
      ok: false,
      errors: [makeError("AM_E_MODEL_TYPE_UNSUPPORTED", modelType)],
    };
  }

  return adapter.validate(raw);
}
