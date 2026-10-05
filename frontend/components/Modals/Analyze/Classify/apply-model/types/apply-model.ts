// AGENTS.md §3.3 — state form Apply Model.

export type ApplyModelSourceKind = "file" | "resultStore" | "builtin";

export type ApplyModelModelTabType = {
  SourceKind: ApplyModelSourceKind; // default "file"
  SourceRef: string | null; // file: nama file; resultStore: String(statistic.id); builtin: entry.id
  SourceLabel: string | null; // teks tampilan, lihat §6.3
  ModelJson: unknown | null; // model mentah yang SUDAH lolos validate(); null = belum ada model
};

export type ApplyModelVariablesTabType = {
  FeatureMapping: Record<string, string | null>; // nama fitur model -> nama variabel dataset
  ActualTargetVar: string | null; // opsional, untuk evaluasi
};

export type ApplyModelSaveTabType = {
  SaveMaxProbability: boolean; // default true
  SaveClassProbabilities: boolean; // default false
  NamePrefix: string | null; // null = pakai adapter.defaultOutputPrefix
  UseCustomNames: boolean; // default false
  CustomNames: {
    PredictedValue: string | null;
    MaxProbability: string | null;
    ClassProbabilities: Record<string, string | null>; // class -> nama
  };
};

export type ApplyModelOutputTabType = {
  ModelSummary: boolean; // default true
  CaseProcessingSummary: boolean; // default true
  PredictionDistribution: boolean; // default true
  EvaluationMetrics: boolean; // default true, hanya berlaku bila ActualTargetVar terisi
  ConfusionMatrix: boolean; // default true, hanya berlaku bila ActualTargetVar terisi
};

export type ApplyModelType = {
  model: ApplyModelModelTabType;
  variables: ApplyModelVariablesTabType;
  save: ApplyModelSaveTabType;
  output: ApplyModelOutputTabType;
};

export type ApplyModelContainerProps = { onClose: () => void };
