// AGENTS.md §3.5 — aturan kolom output (save) Apply Model: spesifikasi kolom,
// tipe kolom predicted, validasi nama kustom/prefix, dan resolusi nama akhir.
// Semua fungsi di file ini murni (tanpa React, tanpa akses store langsung).

import type { ClassifierModelAdapter, ModelDescriptor } from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import type { ApplyModelIssue } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import type { ApplyModelSaveTabType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import { processVariableName } from "@/stores/useVariableStore";
import type { Variable, VariableAlign, VariableMeasure } from "@/types/Variable";

// Konstanta di bawah DISALIN (bukan di-import) dari
// KNN/hooks/useNearestNeighborSaveRules.ts:85-90 (AGENTS.md §3.5, §7.3).
const VARIABLE_NAME_PATTERN = /^[A-Za-z@#$][A-Za-z0-9._@#$]*$/;
const MAX_VARIABLE_NAME_LENGTH = 64;
const RESERVED_VARIABLE_NAMES = new Set([
  "ALL", "AND", "BY", "EQ", "GE", "GT", "LE", "LT", "NE", "NOT", "OR", "TO", "WITH",
]);

const NUMERIC_CLASS_PATTERN = /^-?\d+(\.\d+)?$/;

export type OutputColumnKey = "predicted" | "maxProbability" | `class:${string}`;

export type OutputColumnType = "NUMERIC" | "STRING";

export type OutputColumnSpec = {
  key: OutputColumnKey;
  requestedName: string;
  label: string;
  type: OutputColumnType;
  measure: VariableMeasure;
  decimals: number;
  width: number;
  align: VariableAlign;
};

export type PredictedColumnType = {
  type: OutputColumnType;
  decimals: number;
  width: number;
  align: VariableAlign;
};

/**
 * Tipe kolom predicted (§3.5): NUMERIC bila SETIAP kelas berupa angka
 * (`^-?\d+(\.\d+)?$`), selain itu STRING.
 */
export function resolvePredictedColumnType(classes: readonly string[]): PredictedColumnType {
  const allNumeric = classes.every((c) => NUMERIC_CLASS_PATTERN.test(c));

  if (allNumeric) {
    const decimals = classes.reduce((max, c) => {
      const dot = c.indexOf(".");
      const digits = dot === -1 ? 0 : c.length - dot - 1;
      return Math.max(max, digits);
    }, 0);
    return { type: "NUMERIC", decimals, width: 12, align: "right" };
  }

  return { type: "STRING", decimals: 0, width: 64, align: "left" };
}

/**
 * Daftar kolom yang akan ditulis, urutan tetap (§3.5): predicted, max
 * probability (bila dicentang), lalu satu kolom per kelas (bila dicentang).
 *
 * `UseCustomNames === true` → `requestedName` = nama kustom; field
 * null/kosong TIDAK jatuh ke default, melainkan menjadi "" agar
 * `validateCustomOutputNames` melaporkan `AM_E_NAME_EMPTY`.
 */
export function getOutputColumnSpecs(
  descriptor: ModelDescriptor,
  save: ApplyModelSaveTabType,
  adapter: Pick<ClassifierModelAdapter, "defaultOutputPrefix">,
): OutputColumnSpec[] {
  const prefix = save.NamePrefix ?? adapter.defaultOutputPrefix;
  const custom = save.UseCustomNames;

  const pick = (customValue: string | null | undefined, defaultName: string): string =>
    custom ? (customValue ?? "") : defaultName;

  const predictedType = resolvePredictedColumnType(descriptor.classes);

  const specs: OutputColumnSpec[] = [
    {
      key: "predicted",
      requestedName: pick(save.CustomNames.PredictedValue, `${prefix}_PredictedValue`),
      label: `Predicted value (${descriptor.algorithmLabel}, target ${descriptor.targetName})`,
      type: predictedType.type,
      measure: "nominal",
      decimals: predictedType.decimals,
      width: predictedType.width,
      align: predictedType.align,
    },
  ];

  if (save.SaveMaxProbability) {
    specs.push({
      key: "maxProbability",
      requestedName: pick(save.CustomNames.MaxProbability, `${prefix}_PredictedProbability`),
      label: "Predicted probability of predicted class",
      type: "NUMERIC",
      measure: "scale",
      decimals: 4,
      width: 12,
      align: "right",
    });
  }

  if (save.SaveClassProbabilities) {
    for (const cls of descriptor.classes) {
      specs.push({
        key: `class:${cls}`,
        requestedName: pick(save.CustomNames.ClassProbabilities[cls], `${prefix}_Probability_${cls}`),
        label: `Predicted probability of ${cls}`,
        type: "NUMERIC",
        measure: "scale",
        decimals: 4,
        width: 12,
        align: "right",
      });
    }
  }

  return specs;
}

/**
 * Cek satu nama terhadap aturan §3.5 (urutan tabel): kosong → pola →
 * panjang → kata cadangan. Mengembalikan kode pertama yang gagal, atau null.
 */
function checkSingleName(
  name: string,
): "AM_E_NAME_EMPTY" | "AM_E_NAME_INVALID" | "AM_E_NAME_TOO_LONG" | "AM_E_NAME_RESERVED" | null {
  const trimmed = name.trim();
  if (trimmed === "") return "AM_E_NAME_EMPTY";
  if (!VARIABLE_NAME_PATTERN.test(trimmed)) return "AM_E_NAME_INVALID";
  if (trimmed.length > MAX_VARIABLE_NAME_LENGTH) return "AM_E_NAME_TOO_LONG";
  if (RESERVED_VARIABLE_NAMES.has(trimmed.toUpperCase())) return "AM_E_NAME_RESERVED";
  return null;
}

/**
 * Validasi nama kustom (§3.5) untuk kolom yang akan ditulis. `requestedName`
 * tiap spec diperlakukan sebagai nama kustom. `detail` = nama yang bermasalah
 * (untuk nama kosong: `key` kolom).
 */
export function validateCustomOutputNames(
  specs: ReadonlyArray<Pick<OutputColumnSpec, "key" | "requestedName">>,
): ApplyModelIssue[] {
  const issues: ApplyModelIssue[] = [];
  const used = new Set<string>();

  for (const spec of specs) {
    const name = spec.requestedName.trim();
    const code = checkSingleName(spec.requestedName);

    if (code !== null) {
      issues.push({ code, severity: "error", detail: name === "" ? spec.key : name });
      continue;
    }

    const lower = name.toLowerCase();
    if (used.has(lower)) {
      issues.push({ code: "AM_E_NAME_DUPLICATE", severity: "error", detail: name });
    } else {
      used.add(lower);
    }
  }

  return issues;
}

/**
 * Validasi `NamePrefix` (§3.5): aturan sama dengan nama kustom kecuali
 * `AM_E_NAME_DUPLICATE`. `null` berarti pakai default adapter → tanpa issue.
 */
export function validateNamePrefix(prefix: string | null): ApplyModelIssue[] {
  if (prefix === null) return [];
  const code = checkSingleName(prefix);
  if (code === null) return [];
  return [{ code, severity: "error", detail: prefix.trim() === "" ? "prefix" : prefix.trim() }];
}

export type FinalOutputNames = {
  finalNames: string[];
  adjusted: Array<{ requested: string; final: string }>;
};

/**
 * Resolusi nama akhir (§3.5): identik dengan loop `addVariables`
 * (`FE/stores/useVariableStore.ts:305-330`) — nama diproses satu per satu
 * dengan `processVariableName` terhadap `existingVariables + nama akhir
 * sebelumnya`. `adjusted` berisi pasangan yang namanya berubah.
 */
export function resolveFinalOutputNames(
  requestedNames: readonly string[],
  existingVariables: readonly Variable[],
): FinalOutputNames {
  const combined: Variable[] = [...existingVariables];
  const finalNames: string[] = [];
  const adjusted: FinalOutputNames["adjusted"] = [];

  for (const requested of requestedNames) {
    const result = processVariableName(requested, combined);
    const final = result.processedName ?? requested;

    finalNames.push(final);
    if (final !== requested) adjusted.push({ requested, final });
    // Hanya properti `name` yang dibaca processVariableName.
    combined.push({ name: final } as Variable);
  }

  return { finalNames, adjusted };
}
