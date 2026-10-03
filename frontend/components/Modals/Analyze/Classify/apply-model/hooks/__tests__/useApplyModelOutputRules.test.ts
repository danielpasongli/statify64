// AGENTS.md §6.5 — test aturan tab Output (Fase 4).

import {
  getEffectiveOutputFlags,
  normalizeCheckboxValue,
} from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelOutputRules";
import { ApplyModelOutputDefault } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-default";
import type { ApplyModelOutputTabType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";

describe("normalizeCheckboxValue", () => {
  it('"indeterminate" → false', () => {
    expect(normalizeCheckboxValue("indeterminate")).toBe(false);
  });

  it("undefined → false", () => {
    expect(normalizeCheckboxValue(undefined)).toBe(false);
  });

  it("true dan false dipertahankan", () => {
    expect(normalizeCheckboxValue(true)).toBe(true);
    expect(normalizeCheckboxValue(false)).toBe(false);
  });

  it("null dipertahankan", () => {
    expect(normalizeCheckboxValue(null)).toBeNull();
  });
});

describe("getEffectiveOutputFlags", () => {
  const allOn: ApplyModelOutputTabType = { ...ApplyModelOutputDefault };

  it("tanpa actual target → Evaluation & Confusion false, flag lain tetap", () => {
    expect(getEffectiveOutputFlags(allOn, false)).toEqual({
      ModelSummary: true,
      CaseProcessingSummary: true,
      PredictionDistribution: true,
      EvaluationMetrics: false,
      ConfusionMatrix: false,
    });
  });

  it("dengan actual target → flag dipertahankan", () => {
    expect(getEffectiveOutputFlags(allOn, true)).toEqual(allOn);
  });

  it("dengan actual target, flag yang dimatikan pengguna tetap false", () => {
    const flags = getEffectiveOutputFlags({ ...allOn, EvaluationMetrics: false }, true);
    expect(flags.EvaluationMetrics).toBe(false);
    expect(flags.ConfusionMatrix).toBe(true);
  });

  it("tidak memutasi objek input", () => {
    const input: ApplyModelOutputTabType = { ...allOn };
    getEffectiveOutputFlags(input, false);
    expect(input).toEqual(allOn);
  });
});
