// AGENTS.md §3.3 — nilai default per section; pola NB/constants/naive-bayes-default.ts.
// Semua record default kosong ({}), semua `string | null` default null.

import type {
  ApplyModelModelTabType,
  ApplyModelVariablesTabType,
  ApplyModelSaveTabType,
  ApplyModelOutputTabType,
  ApplyModelType,
} from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";

export const ApplyModelModelDefault: ApplyModelModelTabType = {
  SourceKind: "file",
  SourceRef: null,
  SourceLabel: null,
  ModelJson: null,
};

export const ApplyModelVariablesDefault: ApplyModelVariablesTabType = {
  FeatureMapping: {},
  ActualTargetVar: null,
};

export const ApplyModelSaveDefault: ApplyModelSaveTabType = {
  SaveMaxProbability: true,
  SaveClassProbabilities: false,
  NamePrefix: null,
  UseCustomNames: false,
  CustomNames: {
    PredictedValue: null,
    MaxProbability: null,
    ClassProbabilities: {},
  },
};

export const ApplyModelOutputDefault: ApplyModelOutputTabType = {
  ModelSummary: true,
  CaseProcessingSummary: true,
  PredictionDistribution: true,
  EvaluationMetrics: true,
  ConfusionMatrix: true,
};

export const ApplyModelDefault: ApplyModelType = {
  model: ApplyModelModelDefault,
  variables: ApplyModelVariablesDefault,
  save: ApplyModelSaveDefault,
  output: ApplyModelOutputDefault,
};
