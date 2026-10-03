// AGENTS.md §4.1, §6.3, §6.6, §6.7 — pemuat model Apply Model dari tiga sumber
// (file, Output Viewer / result store, katalog bawaan). Semua sumber berakhir
// di `validateAnyModel` yang sama (§4.1). Tidak ada komponen React dan tidak
// ada penulisan ke store (hanya membaca `logs`, plus `loadResults()` sekali
// bila `logs` masih kosong).

import type { ApplyModelIssue } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import type { ModelDescriptor } from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import {
  CLASSIFIER_MODEL_ADAPTERS,
  validateAnyModel,
} from "@/components/Modals/Analyze/Classify/apply-model/adapters/registry";
import { BUILTIN_MODELS } from "@/components/Modals/Analyze/Classify/apply-model/constants/builtin-models";
import { useResultStore } from "@/stores/useResultStore";
import type { Log, Statistic } from "@/types/Result";

// ---------------------------------------------------------------------------
// Tipe publik (§6.6)
// ---------------------------------------------------------------------------

export type ModelLoadSuccess = {
  ok: true;
  model: unknown;
  descriptor: ModelDescriptor;
  sourceRef: string;
  sourceLabel: string;
};

export type ModelLoadFailure = {
  ok: false;
  errors: ApplyModelIssue[];
};

export type ModelLoadResult = ModelLoadSuccess | ModelLoadFailure;

export type ResultStoreModelItem = {
  statisticId: number;
  label: string; // "<log.log> › <analytic.title> — <trained_at>" (§6.2)
  modelType: string;
  trainedAt: string | null;
};

/** Batas ukuran file model (§4.1): 10 MB. */
export const MAX_MODEL_FILE_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Helper internal
// ---------------------------------------------------------------------------

function fail(code: ApplyModelIssue["code"], detail?: string): ModelLoadFailure {
  const issue: ApplyModelIssue =
    detail !== undefined
      ? { code, severity: "error", detail }
      : { code, severity: "error" };
  return { ok: false, errors: [issue] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validasi bersama untuk semua sumber (§4.1), lalu lampirkan label sumber. */
function finalizeLoad(
  raw: unknown,
  sourceRef: string,
  sourceLabel: string
): ModelLoadResult {
  const validation = validateAnyModel(raw);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  return {
    ok: true,
    model: validation.model,
    descriptor: validation.descriptor,
    sourceRef,
    sourceLabel,
  };
}

/** Parse string JSON; nilai non-string dikembalikan apa adanya; `{ ok: false }` bila parse gagal. */
function parseJsonLoose(value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof value !== "string") {
    return { ok: true, value };
  }
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Adapter yang `resultStoreSource.componentKey`-nya sama dengan `components` statistic. */
function findAdapterPayloadKey(components: unknown): string | null {
  if (typeof components !== "string") return null;
  for (const adapter of Object.values(CLASSIFIER_MODEL_ADAPTERS)) {
    if (adapter.resultStoreSource?.componentKey === components) {
      return adapter.resultStoreSource.payloadKey;
    }
  }
  return null;
}

/**
 * Ambil model mentah dari satu statistic (§4.1 result store): `output_data`
 * (string JSON di-parse dulu bila perlu) → `payloadKey` (juga di-parse bila
 * berupa string). `null` bila statistic bukan statistic model.
 */
function extractModelFromStatistic(
  statistic: Statistic
): { ok: true; model: unknown } | { ok: false; reason: "not_model" | "parse" } {
  const payloadKey = findAdapterPayloadKey(statistic.components);
  if (payloadKey === null) return { ok: false, reason: "not_model" };

  const outer = parseJsonLoose(statistic.output_data);
  if (!outer.ok) return { ok: false, reason: "parse" };
  if (!isPlainObject(outer.value)) return { ok: false, reason: "parse" };
  if (!Object.prototype.hasOwnProperty.call(outer.value, payloadKey)) {
    return { ok: false, reason: "parse" };
  }

  const inner = parseJsonLoose(outer.value[payloadKey]);
  if (!inner.ok) return { ok: false, reason: "parse" };
  return { ok: true, model: inner.value };
}

/** Baca `logs` dari result store; panggil `loadResults()` tepat sekali bila kosong. */
async function getLogsEnsuringLoaded(): Promise<Log[]> {
  const initial = useResultStore.getState().logs;
  if (initial.length > 0) return initial;
  await useResultStore.getState().loadResults();
  return useResultStore.getState().logs;
}

type StatisticEntry = {
  log: Log;
  analyticTitle: string;
  statistic: Statistic;
  statisticId: number;
};

/** Telusuri `log.analytics[].statistics[]` dan kumpulkan statistic ber-id. */
function collectStatistics(logs: Log[]): StatisticEntry[] {
  const entries: StatisticEntry[] = [];
  for (const log of logs) {
    for (const analytic of log.analytics ?? []) {
      for (const statistic of analytic.statistics ?? []) {
        if (typeof statistic.id !== "number") continue;
        entries.push({
          log,
          analyticTitle: analytic.title,
          statistic,
          statisticId: statistic.id,
        });
      }
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Sumber 1 — file (§4.1, §6.3)
// ---------------------------------------------------------------------------

export async function loadModelFromFile(file: File): Promise<ModelLoadResult> {
  if (!file.name.toLowerCase().endsWith(".json")) {
    return fail("AM_E_PARSE", file.name);
  }
  if (file.size > MAX_MODEL_FILE_BYTES) {
    return fail("AM_E_FILE_TOO_LARGE", file.name);
  }

  let raw: unknown;
  try {
    const text = await file.text();
    raw = JSON.parse(text) as unknown;
  } catch {
    return fail("AM_E_PARSE", file.name);
  }

  return finalizeLoad(raw, file.name, `File: ${file.name}`);
}

// ---------------------------------------------------------------------------
// Sumber 2 — result store / Output Viewer (§4.1, §6.2, §6.6)
// ---------------------------------------------------------------------------

export async function listResultStoreModels(): Promise<ResultStoreModelItem[]> {
  const logs = await getLogsEnsuringLoaded();
  const items: ResultStoreModelItem[] = [];

  for (const entry of collectStatistics(logs)) {
    const extracted = extractModelFromStatistic(entry.statistic);
    // Statistic bukan model, atau gagal parse → dilewati (bukan error).
    if (!extracted.ok) continue;
    if (!isPlainObject(extracted.model)) continue;

    const modelType = extracted.model.model_type;
    if (typeof modelType !== "string") continue;
    const trainedAtRaw = extracted.model.trained_at;
    const trainedAt = typeof trainedAtRaw === "string" ? trainedAtRaw : null;

    items.push({
      statisticId: entry.statisticId,
      label: `${entry.log.log} › ${entry.analyticTitle} — ${trainedAt ?? "-"}`,
      modelType,
      trainedAt,
    });
  }

  // Terbaru dulu: id statistic menurun (§6.6).
  items.sort((a, b) => b.statisticId - a.statisticId);
  return items;
}

export async function loadModelFromResultStore(
  statisticId: number
): Promise<ModelLoadResult> {
  const logs = await getLogsEnsuringLoaded();
  const entry = collectStatistics(logs).find(
    (candidate) => candidate.statisticId === statisticId
  );
  if (!entry) {
    return fail("AM_E_NO_MODEL", String(statisticId));
  }

  const extracted = extractModelFromStatistic(entry.statistic);
  if (!extracted.ok) {
    return extracted.reason === "parse"
      ? fail("AM_E_PARSE", String(statisticId))
      : fail("AM_E_NO_MODEL", String(statisticId));
  }

  return finalizeLoad(
    extracted.model,
    String(entry.statisticId),
    `Output Viewer: ${entry.log.log} › ${entry.analyticTitle} (#${entry.statisticId})`
  );
}

// ---------------------------------------------------------------------------
// Sumber 3 — model bawaan Statify (§4.1, §6.7)
// ---------------------------------------------------------------------------

export async function loadBuiltinModel(entryId: string): Promise<ModelLoadResult> {
  const entry = BUILTIN_MODELS.find((candidate) => candidate.id === entryId);
  if (!entry) {
    return fail("AM_E_BUILTIN_FETCH", entryId);
  }

  let bodyText: string;
  try {
    const response = await fetch(entry.path);
    if (!response.ok) {
      return fail("AM_E_BUILTIN_FETCH", entry.id);
    }
    bodyText = await response.text();
  } catch {
    return fail("AM_E_BUILTIN_FETCH", entry.id);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(bodyText) as unknown;
  } catch {
    return fail("AM_E_PARSE", entry.id);
  }

  const result = finalizeLoad(raw, entry.id, `Built-in: ${entry.label}`);
  if (!result.ok) return result;

  // Katalog menjanjikan `entry.modelType`; isi file harus sama (PLAN.md Fase 5 langkah 4).
  const actualType = isPlainObject(result.model) ? result.model.model_type : undefined;
  if (actualType !== entry.modelType) {
    return fail(
      "AM_E_MODEL_TYPE_UNSUPPORTED",
      typeof actualType === "string" ? actualType : String(actualType)
    );
  }
  return result;
}
