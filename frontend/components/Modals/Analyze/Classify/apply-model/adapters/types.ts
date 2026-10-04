// AGENTS.md §3.2 — interface adapter & descriptor (hanya tipe; registry ada
// di adapters/registry.ts pada fase berikutnya).

import type {
  ApplyModelIssue,
  ApplyModelWarningCode,
} from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";

export type FeatureRole = "categorical" | "numerical";

export type ModelFeatureDescriptor = {
  name: string; // nama fitur di model
  role: FeatureRole; // menentukan measure variabel dataset yang boleh dipetakan (§3.4)
};

export type ModelDescriptor = {
  modelType: string; // mis. "naive_bayes"
  algorithmLabel: string; // mis. "Naive Bayes"
  schemaVersion: string;
  trainedAt: string | null;
  targetName: string;
  classes: string[];
  features: ModelFeatureDescriptor[]; // urutan = feature_order model
  summaryRows: Array<{ label: string; value: string }>; // baris tambahan untuk Model Summary
  warnings: ApplyModelWarningCode[]; // mis. AM_W_LEGACY_SCHEMA untuk NB 1.0
};

export type ModelValidationResult =
  | { ok: true; model: unknown; descriptor: ModelDescriptor }
  | { ok: false; errors: ApplyModelIssue[] };

export interface ClassifierModelAdapter {
  modelType: string; // kunci registry, sama persis dengan field model_type
  algorithmLabel: string;
  supportedSchemaVersions: readonly string[];
  defaultOutputPrefix: string; // "NB" untuk Naive Bayes
  resultStoreSource?: {
    // bagaimana menemukan model ini di result store
    componentKey: string; // Statistic.components, NB: "Export Model"
    payloadKey: string; // key di output_data, NB: "naiveBayesTrainedModel"
  };
  validate(raw: unknown): ModelValidationResult;
}
