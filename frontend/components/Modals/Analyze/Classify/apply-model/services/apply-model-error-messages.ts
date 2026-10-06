// AGENTS.md §4.5 & §6.6 — menerjemahkan pesan error mesin Apply Model menjadi
// pesan pengguna (bahasa Inggris, kode internal di akhir kalimat). Dipakai sebagai callback `error` pada
// `toast.promise` (pola NB/services/naive-bayes-error-messages.ts).

import {
  APPLY_MODEL_MESSAGES,
  type ApplyModelErrorCode,
} from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";

// Pesan dari Rust selalu berbentuk "AM_E_XXX: <detail bebas>" (§4.5). Prefix
// "Error:" (hasil `String(error)` / `Error.toString()`) ikut ditoleransi.
const ERROR_CODE_PATTERN = /^\s*(?:Error:\s*)?(AM_E_[A-Z0-9_]+)\s*(?::\s*([\s\S]*))?$/;

const GENERIC_ERROR_MESSAGE =
  "The model could not be applied. Check the model, the variable mapping and the selected settings, then try again.";

// Detail AM_E_TEXT_NEGATIVE dari Rust. Format baru (PLAN_V3_UI_EN §3.2):
// "<kolom>" atau "<kolom> (<n> columns affected)". Format lama (WASM yang belum
// di-build ulang): "<kolom>" atau "<kolom> (total <n> kolom bermasalah)".
// Kedua format diterima; nama kolom dan jumlah kolom ditampilkan terpisah.
const TEXT_NEGATIVE_DETAIL_PATTERNS: readonly RegExp[] = [
  /^([\s\S]*?)\s*\((\d+)\s+columns affected\)\s*$/,
  /^([\s\S]*?)\s*\(total\s+(\d+)\s+kolom bermasalah\)\s*$/,
];

function formatErrorDetail(code: ApplyModelErrorCode, detail: string): string {
  if (code !== "AM_E_TEXT_NEGATIVE") return detail;
  let column = detail;
  let total = 1;
  for (const pattern of TEXT_NEGATIVE_DETAIL_PATTERNS) {
    const match = pattern.exec(detail);
    if (match) {
      column = match[1];
      total = Number(match[2]);
      break;
    }
  }
  const quoted = `'${column.trim()}'`;
  return total > 1 ? `${quoted} and ${total - 1} more column(s)` : quoted;
}

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
      const detail = formatErrorDetail(code, (match[2] ?? "").trim());
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
