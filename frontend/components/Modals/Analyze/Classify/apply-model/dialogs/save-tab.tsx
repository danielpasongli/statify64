// AGENTS.md §3.5 (kolom output & penamaan) dan §6.5 (Tab Save) — Fase 14.
// Komponen terkontrol: state ada di container (`data`); tab hanya menampilkan
// pilihan kolom output + preview nama dan melapor lewat `onChange`. Tidak
// menulis ke dataset, tidak memanggil worker, tidak membaca store langsung
// (daftar variabel dikirim container lewat props, pola variables-tab.tsx).

"use client";

import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ClassifierModelAdapter,
  ModelDescriptor,
} from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import { APPLY_MODEL_MESSAGES } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import type { ApplyModelIssue } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import {
  getOutputColumnSpecs,
  resolveFinalOutputNames,
  validateCustomOutputNames,
  validateNamePrefix,
} from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelSaveRules";
import type { OutputColumnSpec } from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelSaveRules";
import type { ApplyModelSaveTabType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import type { Variable } from "@/types/Variable";

export type SaveTabProps = {
  data: ApplyModelSaveTabType;
  descriptor: ModelDescriptor;
  adapter: Pick<ClassifierModelAdapter, "defaultOutputPrefix">;
  existingVariables: Variable[];
  onChange: (next: ApplyModelSaveTabType) => void;
  showFieldHelp: boolean;
};

// Teks bantuan (bahasa Inggris, AGENTS.md §6.1) — tampil bila showFieldHelp.
const SAVE_TAB_HELP = {
  columns:
    "Choose which columns are added to the active dataset. The predicted value column is always saved.",
  prefix:
    "Text placed before each default column name. Leave empty to use the algorithm default.",
  customNames:
    "Edit the name of every column to be saved. Empty names are not replaced by defaults.",
  table:
    "Final name is what the column will be called in the dataset. It is adjusted automatically when the name is invalid or already used.",
} as const;

const PREDICTED_VALUE_LABEL = "Predicted value";
const MAX_PROBABILITY_LABEL = "Predicted probability (predicted class)";
const CLASS_PROBABILITIES_LABEL = "Predicted probability for each class";

/** Ganti placeholder `{detail}` pada pesan (AGENTS.md §4.5). */
function formatIssueMessage(issue: ApplyModelIssue): string {
  return APPLY_MODEL_MESSAGES[issue.code].replace(
    /\{detail\}/g,
    issue.detail ?? ""
  );
}

function HelpText({ show, text }: { show: boolean; text: string }) {
  if (!show) return null;
  return <p className="text-xs text-muted-foreground">{text}</p>;
}

/** Nama kolom untuk tampilan tabel, diturunkan dari `spec.key`. */
function getColumnTitle(spec: OutputColumnSpec): string {
  if (spec.key === "predicted") return PREDICTED_VALUE_LABEL;
  if (spec.key === "maxProbability") return "Predicted probability";
  return `Probability of ${spec.key.slice("class:".length)}`;
}

export function SaveTab({
  data,
  descriptor,
  adapter,
  existingVariables,
  onChange,
  showFieldHelp,
}: SaveTabProps) {
  const specs = useMemo(
    () => getOutputColumnSpecs(descriptor, data, adapter),
    [descriptor, data, adapter]
  );

  // Nama default (tanpa nama kustom) hanya untuk placeholder Input.
  const defaultNames = useMemo(
    () =>
      getOutputColumnSpecs(
        descriptor,
        { ...data, UseCustomNames: false },
        adapter
      ).map((spec) => spec.requestedName),
    [descriptor, data, adapter]
  );

  const issues = useMemo(() => {
    const prefixIssues = validateNamePrefix(data.NamePrefix);
    const nameIssues = data.UseCustomNames ? validateCustomOutputNames(specs) : [];
    return [...prefixIssues, ...nameIssues];
  }, [data.NamePrefix, data.UseCustomNames, specs]);

  const prefixInvalid = useMemo(
    () => validateNamePrefix(data.NamePrefix).length > 0,
    [data.NamePrefix]
  );

  const resolved = useMemo(
    () =>
      resolveFinalOutputNames(
        specs.map((spec) => spec.requestedName),
        existingVariables
      ),
    [specs, existingVariables]
  );

  const handlePrefixChange = (value: string) => {
    onChange({ ...data, NamePrefix: value === "" ? null : value });
  };

  const handleCustomNameChange = (key: OutputColumnSpec["key"], value: string) => {
    if (key === "predicted") {
      onChange({
        ...data,
        CustomNames: { ...data.CustomNames, PredictedValue: value },
      });
      return;
    }
    if (key === "maxProbability") {
      onChange({
        ...data,
        CustomNames: { ...data.CustomNames, MaxProbability: value },
      });
      return;
    }
    const className = key.slice("class:".length);
    onChange({
      ...data,
      CustomNames: {
        ...data.CustomNames,
        ClassProbabilities: {
          ...data.CustomNames.ClassProbabilities,
          [className]: value,
        },
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <Label className="font-semibold">Columns to save</Label>
        <HelpText show={showFieldHelp} text={SAVE_TAB_HELP.columns} />

        <div className="flex items-center gap-2">
          <Checkbox id="save-predicted-value" checked disabled />
          <Label htmlFor="save-predicted-value">{PREDICTED_VALUE_LABEL}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="save-max-probability"
            checked={data.SaveMaxProbability}
            onCheckedChange={(checked) =>
              onChange({ ...data, SaveMaxProbability: checked === true })
            }
          />
          <Label htmlFor="save-max-probability">{MAX_PROBABILITY_LABEL}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="save-class-probabilities"
            checked={data.SaveClassProbabilities}
            onCheckedChange={(checked) =>
              onChange({ ...data, SaveClassProbabilities: checked === true })
            }
          />
          <Label htmlFor="save-class-probabilities">
            {CLASS_PROBABILITIES_LABEL}
          </Label>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <Label htmlFor="save-name-prefix" className="font-semibold">
          Name prefix
        </Label>
        <Input
          id="save-name-prefix"
          value={data.NamePrefix ?? ""}
          placeholder={adapter.defaultOutputPrefix}
          aria-invalid={prefixInvalid}
          onChange={(event) => handlePrefixChange(event.target.value)}
        />
        <HelpText show={showFieldHelp} text={SAVE_TAB_HELP.prefix} />
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="save-use-custom-names"
            checked={data.UseCustomNames}
            onCheckedChange={(checked) =>
              onChange({ ...data, UseCustomNames: checked === true })
            }
          />
          <Label htmlFor="save-use-custom-names">Use custom names</Label>
        </div>
        <HelpText show={showFieldHelp} text={SAVE_TAB_HELP.customNames} />

        <table className="w-full text-sm" data-testid="save-names-table">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1 pr-2 font-normal">Column</th>
              <th className="py-1 pr-2 font-normal">Requested name</th>
              <th className="py-1 font-normal">Final name</th>
            </tr>
          </thead>
          <tbody>
            {specs.map((spec, index) => {
              const finalName = resolved.finalNames[index];
              const adjusted = finalName !== spec.requestedName;
              const title = getColumnTitle(spec);

              return (
                <tr
                  key={spec.key}
                  data-testid={`save-row-${spec.key}`}
                  className="border-b last:border-b-0"
                >
                  <td className="py-2 pr-2 align-top">{title}</td>
                  <td className="py-2 pr-2 align-top">
                    {data.UseCustomNames ? (
                      <Input
                        aria-label={`Custom name for ${title}`}
                        value={spec.requestedName}
                        placeholder={defaultNames[index]}
                        onChange={(event) =>
                          handleCustomNameChange(spec.key, event.target.value)
                        }
                      />
                    ) : (
                      <span>{spec.requestedName}</span>
                    )}
                  </td>
                  <td className="py-2 align-top">
                    <div className="flex items-center gap-1">
                      <span data-testid={`final-name-${spec.key}`}>
                        {finalName === "" ? "—" : finalName}
                      </span>
                      {adjusted && (
                        <span
                          data-testid={`name-adjusted-${spec.key}`}
                          role="img"
                          aria-label={APPLY_MODEL_MESSAGES.AM_W_NAME_ADJUSTED}
                          title={APPLY_MODEL_MESSAGES.AM_W_NAME_ADJUSTED}
                          className="text-yellow-700"
                        >
                          <AlertCircle className="h-4 w-4" />
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <HelpText show={showFieldHelp} text={SAVE_TAB_HELP.table} />

        {resolved.adjusted.length > 0 && (
          <div
            data-testid="save-name-adjusted"
            className="flex items-start gap-2 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{APPLY_MODEL_MESSAGES.AM_W_NAME_ADJUSTED}</span>
          </div>
        )}

        {issues.length > 0 && (
          <div
            data-testid="save-name-errors"
            className="flex flex-col gap-1 text-sm text-destructive"
          >
            {issues.map((issue, index) => (
              <div
                key={`${issue.code}-${index}`}
                className="flex items-start gap-2"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{formatIssueMessage(issue)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default SaveTab;
