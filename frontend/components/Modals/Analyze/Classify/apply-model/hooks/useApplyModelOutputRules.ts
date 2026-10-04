// AGENTS.md §6.5 — aturan tab Output Apply Model (fungsi murni).

import type { CheckedState } from "@radix-ui/react-checkbox";
import type { ApplyModelOutputTabType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";

/**
 * Status checkbox "indeterminate" atau belum terdefinisi selalu dianggap
 * tidak dicentang (false). Pola: KNN/hooks/useNearestNeighborOutputRules.ts.
 */
export function normalizeCheckboxValue(
  value: CheckedState | undefined | boolean | string | null,
): boolean | string | null {
  if (value === "indeterminate" || typeof value === "undefined") return false;
  return value;
}

/**
 * Flag output efektif: Evaluation metrics & Confusion matrix dipaksa `false`
 * bila tidak ada actual target (§3.3, §6.5). Flag lain tidak berubah.
 */
export function getEffectiveOutputFlags(
  output: ApplyModelOutputTabType,
  hasActualTarget: boolean,
): ApplyModelOutputTabType {
  return {
    ...output,
    EvaluationMetrics: hasActualTarget ? output.EvaluationMetrics : false,
    ConfusionMatrix: hasActualTarget ? output.ConfusionMatrix : false,
  };
}
