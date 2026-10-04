// AGENTS.md §3.3 (ApplyModelOutputTabType) dan §6.5 (Tab Output) — Fase 14.
// Komponen terkontrol: lima checkbox Output Viewer. "Evaluation metrics" dan
// "Confusion matrix" tetap terlihat tetapi disabled bila tidak ada actual
// target. Tidak menulis ke dataset, tidak memanggil worker.

"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  getEffectiveOutputFlags,
  normalizeCheckboxValue,
} from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelOutputRules";
import type { ApplyModelOutputTabType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";

export type OutputTabProps = {
  data: ApplyModelOutputTabType;
  hasActualTarget: boolean;
  onChange: (next: ApplyModelOutputTabType) => void;
  showFieldHelp: boolean;
};

type OutputOption = {
  field: keyof ApplyModelOutputTabType;
  label: string;
  help: string; // teks bantuan bahasa Inggris (AGENTS.md §6.1)
  requiresActual: boolean;
};

const OUTPUT_OPTIONS: readonly OutputOption[] = [
  {
    field: "ModelSummary",
    label: "Model summary",
    help: "Shows the algorithm, target, classes and feature mapping of the applied model.",
    requiresActual: false,
  },
  {
    field: "CaseProcessingSummary",
    label: "Case processing summary",
    help: "Shows how many rows were scored and how many could not be scored.",
    requiresActual: false,
  },
  {
    field: "PredictionDistribution",
    label: "Prediction distribution",
    help: "Shows how many rows were predicted into each class.",
    requiresActual: false,
  },
  {
    field: "EvaluationMetrics",
    label: "Evaluation metrics",
    help: "Shows accuracy and related metrics by comparing predictions with the actual target.",
    requiresActual: true,
  },
  {
    field: "ConfusionMatrix",
    label: "Confusion matrix",
    help: "Shows predicted versus actual classes in a table.",
    requiresActual: true,
  },
];

const REQUIRES_ACTUAL_TEXT =
  "Requires an actual target variable (Variables tab).";

export function OutputTab({
  data,
  hasActualTarget,
  onChange,
  showFieldHelp,
}: OutputTabProps) {
  // Nilai yang ditampilkan = flag efektif; nilai tersimpan tidak diubah
  // sehingga pilihan pengguna kembali bila actual target diisi lagi.
  const effective = getEffectiveOutputFlags(data, hasActualTarget);

  return (
    <div className="flex flex-col gap-3">
      <Label className="font-semibold">Output Viewer</Label>
      {OUTPUT_OPTIONS.map((option) => {
        const disabled = option.requiresActual && !hasActualTarget;
        const id = `output-${option.field}`;

        return (
          <div key={option.field} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={effective[option.field]}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onChange({
                    ...data,
                    [option.field]: normalizeCheckboxValue(checked) === true,
                  })
                }
              />
              <Label htmlFor={id}>{option.label}</Label>
            </div>
            {disabled && (
              <p className="text-xs text-muted-foreground">
                {REQUIRES_ACTUAL_TEXT}
              </p>
            )}
            {showFieldHelp && (
              <p className="text-xs text-muted-foreground">{option.help}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default OutputTab;
