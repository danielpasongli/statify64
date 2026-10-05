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

export type AutoMapResult = {
  FeatureMapping: FeatureMapping;
  ActualTargetVar: string | null;
};

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

function mappedVariableNames(mapping: FeatureMapping): Set<string> {
  const names = new Set<string>();
  Object.values(mapping).forEach((variableName) => {
    if (variableName !== null && variableName !== undefined) {
      names.add(variableName);
    }
  });
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

  const actualCandidate = findVariableByName(descriptor.targetName, variables);
  const actualTargetVar =
    actualCandidate &&
    isCategoricalMeasure(actualCandidate.measure) &&
    !used.has(actualCandidate.name)
      ? actualCandidate.name
      : null;

  return { FeatureMapping: featureMapping, ActualTargetVar: actualTargetVar };
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
  variables: Variable[]
): ApplyModelIssue[] {
  const issues: ApplyModelIssue[] = [];

  // Hitung pemakaian tiap variabel oleh fitur model (untuk AM_E_MAP_DUPLICATE).
  const usageCount = new Map<string, number>();
  descriptor.features.forEach((feature) => {
    const variableName = mapping[feature.name] ?? null;
    if (variableName !== null) {
      usageCount.set(variableName, (usageCount.get(variableName) ?? 0) + 1);
    }
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

  if (actualTargetVar !== null) {
    const actual = variables.find((v) => v.name === actualTargetVar);
    if (!actual) {
      issues.push(makeError("AM_E_ACTUAL_NOT_FOUND", actualTargetVar));
    } else {
      if (!isCategoricalMeasure(actual.measure)) {
        issues.push(makeError("AM_E_ACTUAL_MEASURE", actualTargetVar));
      }
      if (mappedVariableNames(mapping).has(actualTargetVar)) {
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
  variables: Variable[]
): Variable[] {
  const used = mappedVariableNames(mapping);
  return variables.filter(
    (v) => isCategoricalMeasure(v.measure) && !used.has(v.name)
  );
}
