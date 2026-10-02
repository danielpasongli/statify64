// AGENTS.md §3.3 — nilai default form Apply Model.

import {
  ApplyModelDefault,
  ApplyModelModelDefault,
  ApplyModelOutputDefault,
  ApplyModelSaveDefault,
  ApplyModelVariablesDefault,
} from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-default";
import { BUILTIN_MODELS } from "@/components/Modals/Analyze/Classify/apply-model/constants/builtin-models";

describe("Apply Model — default (AGENTS.md §3.3)", () => {
  it("tab Model: sumber file, tanpa model", () => {
    expect(ApplyModelModelDefault.SourceKind).toBe("file");
    expect(ApplyModelModelDefault.SourceRef).toBeNull();
    expect(ApplyModelModelDefault.SourceLabel).toBeNull();
    expect(ApplyModelModelDefault.ModelJson).toBeNull();
  });

  it("tab Variables: mapping kosong, tanpa actual target", () => {
    expect(ApplyModelVariablesDefault.FeatureMapping).toEqual({});
    expect(ApplyModelVariablesDefault.ActualTargetVar).toBeNull();
  });

  it("tab Save: max probability ON, probabilitas per kelas OFF, nama kustom OFF", () => {
    expect(ApplyModelSaveDefault.SaveMaxProbability).toBe(true);
    expect(ApplyModelSaveDefault.SaveClassProbabilities).toBe(false);
    expect(ApplyModelSaveDefault.NamePrefix).toBeNull();
    expect(ApplyModelSaveDefault.UseCustomNames).toBe(false);
    expect(ApplyModelSaveDefault.CustomNames.PredictedValue).toBeNull();
    expect(ApplyModelSaveDefault.CustomNames.MaxProbability).toBeNull();
    expect(ApplyModelSaveDefault.CustomNames.ClassProbabilities).toEqual({});
  });

  it("tab Output: kelima flag true", () => {
    expect(ApplyModelOutputDefault.ModelSummary).toBe(true);
    expect(ApplyModelOutputDefault.CaseProcessingSummary).toBe(true);
    expect(ApplyModelOutputDefault.PredictionDistribution).toBe(true);
    expect(ApplyModelOutputDefault.EvaluationMetrics).toBe(true);
    expect(ApplyModelOutputDefault.ConfusionMatrix).toBe(true);
  });

  it("ApplyModelDefault menggabungkan keempat section", () => {
    expect(ApplyModelDefault.model).toBe(ApplyModelModelDefault);
    expect(ApplyModelDefault.variables).toBe(ApplyModelVariablesDefault);
    expect(ApplyModelDefault.save).toBe(ApplyModelSaveDefault);
    expect(ApplyModelDefault.output).toBe(ApplyModelOutputDefault);
  });

  it("katalog model bawaan kosong (§6.7)", () => {
    expect(BUILTIN_MODELS).toEqual([]);
  });
});
