// AGENTS.md §6.5 — validasi terpusat form Apply Model (Fase 15).
// `computeApplyModelValidation` adalah fungsi murni (bisa dites tanpa React);
// `useApplyModelValidation` hanya membungkusnya dengan `useMemo`
// (AGENTS.md §8). Tidak ada akses store di sini: daftar variabel dikirim
// pemanggil.

import { useMemo } from "react";
import {
  getModelAdapter,
  validateAnyModel,
} from "@/components/Modals/Analyze/Classify/apply-model/adapters/registry";
import type { ModelValidationResult } from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import { APPLY_MODEL_MESSAGES } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import type { ApplyModelIssue } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import { validateMapping } from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelMappingRules";
import {
  getOutputColumnSpecs,
  validateCustomOutputNames,
  validateNamePrefix,
} from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelSaveRules";
import type { ApplyModelType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import type { Variable } from "@/types/Variable";

export type ApplyModelValidationResult = {
  isValid: boolean;
  issues: ApplyModelIssue[];
};

export type ApplyModelValidationOutput = {
  validation: ApplyModelValidationResult;
  /** Pesan (bahasa Indonesia) dari issue error pertama; null bila valid. */
  firstErrorMessage: string | null;
};

/** Ganti placeholder `{detail}` pada pesan (AGENTS.md §4.5). */
export function formatApplyModelIssueMessage(issue: ApplyModelIssue): string {
  return APPLY_MODEL_MESSAGES[issue.code].replace(
    /\{detail\}/g,
    issue.detail ?? ""
  );
}

function buildValidation(
  formData: ApplyModelType,
  variables: Variable[],
  modelValidation: ModelValidationResult | null
): ApplyModelValidationOutput {
  const issues: ApplyModelIssue[] = [];

  if (formData.model.ModelJson === null || modelValidation === null) {
    // Belum ada model: tab lain disabled, OK tidak boleh aktif (§6.1).
    issues.push({ code: "AM_E_NO_MODEL", severity: "error" });
  } else if (!modelValidation.ok) {
    issues.push(...modelValidation.errors);
  } else {
    const { descriptor } = modelValidation;

    issues.push(
      ...validateMapping(
        descriptor,
        formData.variables.FeatureMapping,
        formData.variables.ActualTargetVar,
        variables
      )
    );

    issues.push(...validateNamePrefix(formData.save.NamePrefix));

    if (formData.save.UseCustomNames) {
      const adapter = getModelAdapter(descriptor.modelType);
      if (adapter === null) {
        issues.push({
          code: "AM_E_MODEL_TYPE_UNSUPPORTED",
          severity: "error",
          detail: descriptor.modelType,
        });
      } else {
        const specs = getOutputColumnSpecs(descriptor, formData.save, adapter);
        issues.push(...validateCustomOutputNames(specs));
      }
    }
  }

  const firstError = issues.find((issue) => issue.severity === "error");
  return {
    validation: { isValid: firstError === undefined, issues },
    firstErrorMessage:
      firstError === undefined ? null : formatApplyModelIssueMessage(firstError),
  };
}

/**
 * `isValid` = `ModelJson !== null` DAN tidak ada issue `severity: "error"`
 * dari: `validateAnyModel`, `validateMapping`, `validateCustomOutputNames`
 * (hanya bila `UseCustomNames`), dan validasi `NamePrefix` (AGENTS.md §6.5).
 */
export function computeApplyModelValidation(
  formData: ApplyModelType,
  variables: Variable[]
): ApplyModelValidationOutput {
  const modelValidation =
    formData.model.ModelJson === null
      ? null
      : validateAnyModel(formData.model.ModelJson);
  return buildValidation(formData, variables, modelValidation);
}

export function useApplyModelValidation(
  formData: ApplyModelType,
  variables: Variable[]
): ApplyModelValidationOutput {
  const modelJson = formData.model.ModelJson;

  // Validasi model bisa mahal untuk model besar, jadi hanya dihitung ulang
  // saat model berubah (bukan pada tiap perubahan form).
  const modelValidation = useMemo(
    () => (modelJson === null ? null : validateAnyModel(modelJson)),
    [modelJson]
  );

  return useMemo(
    () => buildValidation(formData, variables, modelValidation),
    [formData, variables, modelValidation]
  );
}
