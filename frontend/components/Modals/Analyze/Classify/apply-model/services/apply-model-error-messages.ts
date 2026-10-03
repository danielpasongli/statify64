// AGENTS.md §4.5 & §6.6 — menerjemahkan pesan error mesin Apply Model menjadi
// pesan pengguna (bahasa Indonesia). Dipakai sebagai callback `error` pada
// `toast.promise` (pola NB/services/naive-bayes-error-messages.ts).

import {
  APPLY_MODEL_MESSAGES,
  type ApplyModelErrorCode,
} from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";

// Pesan dari Rust selalu berbentuk "AM_E_XXX: <detail bebas>" (§4.5). Prefix
// "Error:" (hasil `String(error)` / `Error.toString()`) ikut ditoleransi.
const ERROR_CODE_PATTERN = /^\s*(?:Error:\s*)?(AM_E_[A-Z_]+)\s*(?::\s*([\s\S]*))?$/;

const GENERIC_ERROR_MESSAGE =
  "Penerapan model tidak dapat diselesaikan. Periksa kembali model, pemetaan variabel, dan pengaturan yang dipilih, lalu coba lagi.";

function isErrorCode(code: string): code is ApplyModelErrorCode {
  return Object.prototype.hasOwnProperty.call(APPLY_MODEL_MESSAGES, code);
}

export const getUserFriendlyApplyModelError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error ?? "");

  // 1. Pesan berkode "AM_E_XXX: detail" -> APPLY_MODEL_MESSAGES.
  const match = ERROR_CODE_PATTERN.exec(message);
  if (match) {
    const code = match[1];
    if (isErrorCode(code)) {
      const detail = (match[2] ?? "").trim();
      return APPLY_MODEL_MESSAGES[code].replace(/\{detail\}/g, detail);
    }
  }

  // 2. Kegagalan memuat worker / modul WASM -> AM_E_WORKER.
  const normalizedMessage = message.toLowerCase();
  if (
    normalizedMessage.includes("worker") ||
    normalizedMessage.includes("wasm") ||
    normalizedMessage.includes("module")
  ) {
    return APPLY_MODEL_MESSAGES.AM_E_WORKER;
  }

  // 3. Fallback generik.
  return GENERIC_ERROR_MESSAGE;
};
