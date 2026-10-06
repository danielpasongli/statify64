// AGENTS.md §3.5, §6.6 — menulis kolom output Apply Model ke dataset aktif.
// `buildOutputColumns` murni (tanpa store); `saveApplyModelVariables` memanggil
// `addVariables` SATU kali. Apply Model SELALU membuat variabel baru: tidak
// pernah memanggil `updateCells` pada variabel yang sudah ada.

import type { OutputColumnSpec } from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelSaveRules";
import type { ApplyModelRawResult } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model-worker";
import type { CellUpdate } from "@/stores/useDataStore";
import { useVariableStore } from "@/stores/useVariableStore";
import type { Variable } from "@/types/Variable";

export type BuiltOutputColumns = {
  definitions: Partial<Variable>[];
  updates: CellUpdate[];
};

const CLASS_KEY_PREFIX = "class:";

/** Nilai mentah per baris untuk satu kolom output (panjang = total_rows). */
function resolveColumnValues(
  raw: ApplyModelRawResult,
  spec: Pick<OutputColumnSpec, "key">,
): Array<string | number | null> {
  if (spec.key === "predicted") return raw.predictions.predicted;
  if (spec.key === "maxProbability") return raw.predictions.max_probability;

  const className = spec.key.slice(CLASS_KEY_PREFIX.length);
  const classIndex = raw.model_summary.classes.indexOf(className);
  const values = classIndex < 0 ? undefined : raw.predictions.class_probabilities[classIndex];
  if (values === undefined) {
    throw new Error(`AM_E_PAYLOAD: the probability column for class "${className}" is missing from the result`);
  }
  return values;
}

/** `null` = sel dilewati. NUMERIC predicted: `Number(label)` (§3.5). */
function toCellValue(
  value: string | number | null,
  type: OutputColumnSpec["type"],
): string | number | null {
  if (value === null || value === undefined) return null;
  if (type === "NUMERIC") {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return value;
}

/**
 * Bentuk definisi variabel + `CellUpdate[]` (§3.5). `specs` & `finalNames`
 * sejajar (urutan penulisan tetap). Kolom ke-i ditempatkan di
 * `startColumnIndex + i`. Sel `null` tidak menghasilkan update.
 */
export function buildOutputColumns(
  raw: ApplyModelRawResult,
  specs: readonly OutputColumnSpec[],
  finalNames: readonly string[],
  startColumnIndex: number,
): BuiltOutputColumns {
  if (finalNames.length !== specs.length) {
    throw new Error("AM_E_PAYLOAD: the number of final column names does not match the number of output columns");
  }

  const definitions: Partial<Variable>[] = [];
  const updates: CellUpdate[] = [];

  specs.forEach((spec, index) => {
    const columnIndex = startColumnIndex + index;

    definitions.push({
      name: finalNames[index],
      columnIndex,
      type: spec.type,
      width: spec.width,
      decimals: spec.decimals,
      label: spec.label,
      values: [],
      missing: null,
      columns: 64,
      align: spec.align,
      measure: spec.measure,
      role: "none",
    });

    resolveColumnValues(raw, spec).forEach((value, row) => {
      const cell = toCellValue(value, spec.type);
      if (cell !== null) updates.push({ row, col: columnIndex, value: cell });
    });
  });

  return { definitions, updates };
}

/**
 * Menulis semua kolom output lewat SATU panggilan `addVariables`.
 * `nextColumnIndex = max(columnIndex) + 1` dari variabel store saat ini
 * (0 bila dataset belum punya variabel).
 */
export async function saveApplyModelVariables(
  raw: ApplyModelRawResult,
  specs: readonly OutputColumnSpec[],
  finalNames: readonly string[],
): Promise<void> {
  const store = useVariableStore.getState();
  const startColumnIndex =
    store.variables.length > 0
      ? Math.max(...store.variables.map((variable) => variable.columnIndex)) + 1
      : 0;

  const { definitions, updates } = buildOutputColumns(raw, specs, finalNames, startColumnIndex);
  await store.addVariables(definitions, updates);
}
