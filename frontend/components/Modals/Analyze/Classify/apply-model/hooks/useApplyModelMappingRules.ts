// AGENTS.md §3.4 — aturan pemetaan fitur model -> variabel dataset (Fase 3).
// Fungsi murni: tanpa React, tanpa akses store. Hook React (bila perlu)
// membungkusnya di fase UI berikutnya.

import type {
  FeatureRole,
  ModelDescriptor,
} from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import type { ApplyModelIssue } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import type { ApplyModelVariablesTabType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import type { Variable } from "@/types/Variable";

export type FeatureMapping = ApplyModelVariablesTabType["FeatureMapping"];

// v2 (AGENTS_V2.md §10.2): pemetaan fitur Text. Hanya ada pada hasil auto-map
// bila model memuat blok `text` (raw -> RawTextVar, vector -> VectorMapping).
export type TextMapping = {
  RawTextVar?: string | null;
  VectorMapping?: Record<string, string | null>;
};

export type AutoMapResult = {
  FeatureMapping: FeatureMapping;
  ActualTargetVar: string | null;
} & TextMapping;

// Pemetaan peran <-> measure (satu-satunya aturan, AGENTS.md §3.4):
// nominal/ordinal <-> categorical; scale <-> numerical.
function isCategoricalMeasure(measure: Variable["measure"]): boolean {
  return measure === "nominal" || measure === "ordinal";
}

function measureMatchesRole(
  role: FeatureRole,
  measure: Variable["measure"]
): boolean {
  return role === "categorical"
    ? isCategoricalMeasure(measure)
    : measure === "scale";
}

// Cari variabel: nama persis dulu; bila tidak ada, nama case-insensitive
// yang unik (0 atau >1 kandidat -> null).
function findVariableByName(
  name: string,
  variables: Variable[]
): Variable | null {
  const exact = variables.find((v) => v.name === name);
  if (exact) {
    return exact;
  }
  const lowered = name.toLowerCase();
  const candidates = variables.filter((v) => v.name.toLowerCase() === lowered);
  return candidates.length === 1 ? candidates[0] : null;
}

// Indeks nama variabel untuk pencarian massal (kolom vektor bisa ribuan).
// Semantik sama dengan `findVariableByName`: persis dulu, lalu case-insensitive unik.
type VariableNameIndex = {
  exact: Map<string, Variable>;
  lower: Map<string, Variable[]>;
};

function buildVariableNameIndex(variables: Variable[]): VariableNameIndex {
  const exact = new Map<string, Variable>();
  const lower = new Map<string, Variable[]>();
  variables.forEach((v) => {
    if (!exact.has(v.name)) {
      exact.set(v.name, v);
    }
    const key = v.name.toLowerCase();
    const list = lower.get(key);
    if (list) {
      list.push(v);
    } else {
      lower.set(key, [v]);
    }
  });
  return { exact, lower };
}

function findVariableInIndex(
  name: string,
  index: VariableNameIndex
): Variable | null {
  const exact = index.exact.get(name);
  if (exact) {
    return exact;
  }
  const candidates = index.lower.get(name.toLowerCase());
  return candidates && candidates.length === 1 ? candidates[0] : null;
}

function mappedVariableNames(
  mapping: FeatureMapping,
  textMapping?: TextMapping
): Set<string> {
  const names = new Set<string>();
  Object.values(mapping).forEach((variableName) => {
    if (variableName !== null && variableName !== undefined) {
      names.add(variableName);
    }
  });
  // v2: variabel yang dipakai fitur Text juga bukan kandidat actual target.
  if (textMapping?.RawTextVar) {
    names.add(textMapping.RawTextVar);
  }
  if (textMapping?.VectorMapping) {
    Object.values(textMapping.VectorMapping).forEach((variableName) => {
      if (variableName !== null && variableName !== undefined) {
        names.add(variableName);
      }
    });
  }
  return names;
}

/**
 * AGENTS.md §3.4 "Auto-map", langkah 1–5. Measure variabel TIDAK diperiksa
 * untuk fitur (langkah 3), tetapi diperiksa untuk ActualTargetVar (langkah 5).
 */
export function autoMapFeatures(
  descriptor: ModelDescriptor,
  variables: Variable[]
): AutoMapResult {
  const featureMapping: FeatureMapping = {};
  const used = new Set<string>();

  descriptor.features.forEach((feature) => {
    const found = findVariableByName(feature.name, variables);
    // Langkah 4: satu variabel tidak boleh dipakai dua fitur; fitur kedua
    // dan seterusnya menjadi null.
    if (found && !used.has(found.name)) {
      featureMapping[feature.name] = found.name;
      used.add(found.name);
    } else {
      featureMapping[feature.name] = null;
    }
  });

  // v2: fitur Text. Variabel yang sudah dipakai fitur lain tidak dipakai ulang
  // (aturan langkah 4 yang sama).
  let textMapping: TextMapping = {};
  const text = descriptor.text;
  if (text && text.source === "raw") {
    const found =
      text.rawVariable !== null
        ? findVariableByName(text.rawVariable, variables)
        : null;
    if (found && !used.has(found.name)) {
      used.add(found.name);
      textMapping = { RawTextVar: found.name };
    } else {
      textMapping = { RawTextVar: null };
    }
  } else if (text && text.source === "vector") {
    const index = buildVariableNameIndex(variables);
    const vectorMapping: Record<string, string | null> = {};
    text.columns.forEach((column) => {
      const found = findVariableInIndex(column, index);
      // Kolom tidak ditemukan = null (akan diisi 0); bukan error (V10).
      if (found && !used.has(found.name)) {
        vectorMapping[column] = found.name;
        used.add(found.name);
      } else {
        vectorMapping[column] = null;
      }
    });
    textMapping = { VectorMapping: vectorMapping };
  }

  const actualCandidate = findVariableByName(descriptor.targetName, variables);
  const actualTargetVar =
    actualCandidate &&
    isCategoricalMeasure(actualCandidate.measure) &&
    !used.has(actualCandidate.name)
      ? actualCandidate.name
      : null;

  return {
    FeatureMapping: featureMapping,
    ActualTargetVar: actualTargetVar,
    ...textMapping,
  };
}

/** v2: ringkasan pemetaan kolom vektor (AGENTS_V2.md §10.2). */
export type VectorMappingSummary = {
  total: number; // jumlah kolom vektor pada model
  mapped: number; // kolom yang punya variabel dataset
  zeroFilled: string[]; // nama kolom model yang tidak terpetakan (diisi 0)
};

export function summarizeVectorMapping(
  descriptor: ModelDescriptor,
  vectorMapping: Record<string, string | null> | undefined
): VectorMappingSummary {
  const columns =
    descriptor.text && descriptor.text.source === "vector"
      ? descriptor.text.columns
      : [];
  const zeroFilled = columns.filter((c) => (vectorMapping?.[c] ?? null) === null);
  return {
    total: columns.length,
    mapped: columns.length - zeroFilled.length,
    zeroFilled,
  };
}

/** v2: teks ringkasan untuk UI, mis. "3 of 5 vector columns found; 2 treated as 0." */
export function formatVectorMappingSummary(summary: VectorMappingSummary): string {
  return `${summary.mapped} of ${summary.total} vector columns found; ${summary.zeroFilled.length} treated as 0.`;
}

function makeError(
  code: ApplyModelIssue["code"],
  detail: string
): ApplyModelIssue {
  return { code, severity: "error", detail };
}

/**
 * AGENTS.md §3.4 "Validasi mapping". `detail` = nama fitur
 * (AM_E_MAP_UNMAPPED, AM_E_MAP_ROLE_MISMATCH, AM_E_MAP_NUMERIC_TYPE) atau nama
 * variabel (kode lainnya).
 */
export function validateMapping(
  descriptor: ModelDescriptor,
  mapping: FeatureMapping,
  actualTargetVar: string | null,
  variables: Variable[],
  textMapping?: TextMapping
): ApplyModelIssue[] {
  const issues: ApplyModelIssue[] = [];
  const text = descriptor.text;
  const rawTextVar =
    text && text.source === "raw" ? textMapping?.RawTextVar ?? null : null;
  const vectorMapping =
    text && text.source === "vector" ? textMapping?.VectorMapping ?? {} : {};

  // Hitung pemakaian tiap variabel oleh fitur model (untuk AM_E_MAP_DUPLICATE).
  const usageCount = new Map<string, number>();
  const countUse = (variableName: string | null) => {
    if (variableName !== null) {
      usageCount.set(variableName, (usageCount.get(variableName) ?? 0) + 1);
    }
  };
  descriptor.features.forEach((feature) => {
    countUse(mapping[feature.name] ?? null);
  });
  // v2: variabel fitur Text ikut dihitung agar bentrok dengan fitur lain terdeteksi.
  countUse(rawTextVar);
  Object.values(vectorMapping).forEach((variableName) => {
    countUse(variableName ?? null);
  });
  const duplicateReported = new Set<string>();

  descriptor.features.forEach((feature) => {
    const variableName = mapping[feature.name] ?? null;
    if (variableName === null) {
      issues.push(makeError("AM_E_MAP_UNMAPPED", feature.name));
      return;
    }

    const variable = variables.find((v) => v.name === variableName);
    if (!variable) {
      issues.push(makeError("AM_E_MAP_VAR_NOT_FOUND", variableName));
      return;
    }

    if (
      (usageCount.get(variableName) ?? 0) > 1 &&
      !duplicateReported.has(variableName)
    ) {
      duplicateReported.add(variableName);
      issues.push(makeError("AM_E_MAP_DUPLICATE", variableName));
    }

    if (variable.measure === "unknown") {
      issues.push(makeError("AM_E_MAP_MEASURE_UNKNOWN", variableName));
      return;
    }

    if (!measureMatchesRole(feature.role, variable.measure)) {
      issues.push(makeError("AM_E_MAP_ROLE_MISMATCH", feature.name));
      return;
    }

    if (feature.role === "numerical" && variable.type === "STRING") {
      issues.push(makeError("AM_E_MAP_NUMERIC_TYPE", feature.name));
    }
  });

  // --- v2: fitur Text (AGENTS_V2.md §10.2) ---
  if (text && text.source === "raw") {
    // `detail` = nama variabel teks di model (pola v1: nama fitur).
    const featureName = text.rawVariable ?? "";
    if (rawTextVar === null) {
      issues.push(makeError("AM_E_MAP_RAW_TEXT_UNMAPPED", featureName));
    } else {
      const variable = variables.find((v) => v.name === rawTextVar);
      if (!variable) {
        issues.push(makeError("AM_E_MAP_VAR_NOT_FOUND", rawTextVar));
      } else {
        if (
          (usageCount.get(rawTextVar) ?? 0) > 1 &&
          !duplicateReported.has(rawTextVar)
        ) {
          duplicateReported.add(rawTextVar);
          issues.push(makeError("AM_E_MAP_DUPLICATE", rawTextVar));
        }
        if (variable.type !== "STRING") {
          issues.push(makeError("AM_E_MAP_RAW_TEXT_TYPE", featureName));
        }
      }
    }
  } else if (text && text.source === "vector") {
    const index = buildVariableNameIndex(variables);
    let zeroFilled = 0;
    text.columns.forEach((column) => {
      const variableName = vectorMapping[column] ?? null;
      if (variableName === null) {
        // Kolom tidak ditemukan: diisi 0, hanya info (V10), tidak memblokir.
        zeroFilled += 1;
        return;
      }
      const variable = index.exact.get(variableName);
      if (!variable) {
        issues.push(makeError("AM_E_MAP_VAR_NOT_FOUND", variableName));
        return;
      }
      if (
        (usageCount.get(variableName) ?? 0) > 1 &&
        !duplicateReported.has(variableName)
      ) {
        duplicateReported.add(variableName);
        issues.push(makeError("AM_E_MAP_DUPLICATE", variableName));
      }
      if (variable.type === "STRING") {
        // detail = nama kolom model (pola v1: nama fitur).
        issues.push(makeError("AM_E_MAP_NUMERIC_TYPE", column));
      }
    });
    // Semua kolom vektor tak terpetakan dan tidak ada fitur lain: seluruh baris
    // akan NotScored. Tidak memblokir (V10), hanya peringatan.
    if (
      zeroFilled > 0 &&
      zeroFilled === text.columns.length &&
      descriptor.features.length === 0
    ) {
      issues.push({ code: "AM_W_TEXT_ALL_ZERO_FILLED", severity: "warning" });
    }
    if (zeroFilled > 0) {
      issues.push({
        code: "AM_I_TEXT_ZERO_FILLED",
        severity: "info",
        detail: String(zeroFilled),
      });
    }
  }

  if (actualTargetVar !== null) {
    const actual = variables.find((v) => v.name === actualTargetVar);
    if (!actual) {
      issues.push(makeError("AM_E_ACTUAL_NOT_FOUND", actualTargetVar));
    } else {
      if (!isCategoricalMeasure(actual.measure)) {
        issues.push(makeError("AM_E_ACTUAL_MEASURE", actualTargetVar));
      }
      if (mappedVariableNames(mapping, textMapping).has(actualTargetVar)) {
        issues.push(makeError("AM_E_ACTUAL_IS_PREDICTOR", actualTargetVar));
      }
    }
  }

  return issues;
}

/**
 * Opsi dropdown "Dataset variable" (AGENTS.md §6.4): variabel yang measure-nya
 * cocok dengan role fitur. Variabel bertipe STRING untuk fitur numerical tetap
 * muncul; ia ditandai lewat validateMapping (AM_E_MAP_NUMERIC_TYPE).
 */
export function getEligibleVariablesForFeature(
  role: FeatureRole,
  variables: Variable[]
): Variable[] {
  return variables.filter((v) => measureMatchesRole(role, v.measure));
}

/**
 * Opsi dropdown "Actual target" (AGENTS.md §6.4): variabel nominal/ordinal
 * yang tidak dipakai sebagai prediktor.
 */
export function getEligibleActualTargetVariables(
  mapping: FeatureMapping,
  variables: Variable[],
  textMapping?: TextMapping
): Variable[] {
  const used = mappedVariableNames(mapping, textMapping);
  return variables.filter(
    (v) => isCategoricalMeasure(v.measure) && !used.has(v.name)
  );
}
