// AGENTS.md §3.4 (aturan mapping) dan §6.4 (Tab Variables) — Fase 13.
// Komponen terkontrol: state mapping ada di container (`data`); tab hanya
// menampilkan tabel pemetaan 1-ke-1 dan melapor lewat `onChange`. Tidak memakai
// VariableListManager, tidak mengubah store variabel, tidak memanggil worker.

"use client";

import { useMemo } from "react";
import { AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ModelDescriptor } from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import { APPLY_MODEL_MESSAGES } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import type { ApplyModelIssue } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import {
  autoMapFeatures,
  getEligibleActualTargetVariables,
  getEligibleVariablesForFeature,
  validateMapping,
} from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelMappingRules";
import type { ApplyModelVariablesTabType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import type { Variable } from "@/types/Variable";

export type VariablesTabProps = {
  data: ApplyModelVariablesTabType;
  descriptor: ModelDescriptor;
  variables: Variable[];
  onChange: (next: ApplyModelVariablesTabType) => void;
  showFieldHelp: boolean;
};

// Teks bantuan (bahasa Inggris, AGENTS.md §6.1) — tampil bila showFieldHelp.
const VARIABLES_TAB_HELP = {
  mapping:
    "Every model feature must be mapped to one dataset variable. Categorical features accept nominal or ordinal variables; numerical features accept scale variables.",
  autoMap:
    "Matches features to dataset variables by name (exact first, then case-insensitive if unique). This overwrites your manual choices.",
  actual:
    "Optional. Choose the variable holding the true class to add evaluation metrics and a confusion matrix to the output.",
} as const;

// Radix Select tidak menerima value string kosong, jadi pilihan "kosong"
// memakai sentinel ini.
const NONE_VALUE = "__none__";
const NOT_MAPPED_LABEL = "— Not mapped —";
const NONE_LABEL = "— None —";

// Kode yang `detail`-nya berupa nama fitur vs nama variabel (AGENTS.md §3.4).
const FEATURE_DETAIL_CODES: ReadonlySet<ApplyModelIssue["code"]> = new Set([
  "AM_E_MAP_UNMAPPED",
  "AM_E_MAP_ROLE_MISMATCH",
  "AM_E_MAP_NUMERIC_TYPE",
]);
const VARIABLE_DETAIL_CODES: ReadonlySet<ApplyModelIssue["code"]> = new Set([
  "AM_E_MAP_VAR_NOT_FOUND",
  "AM_E_MAP_DUPLICATE",
  "AM_E_MAP_MEASURE_UNKNOWN",
]);

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

/** Nama opsi dropdown: kandidat sesuai aturan, ditambah pilihan saat ini
 * (agar nilai yang salah tetap tampil dan statusnya menjelaskan kesalahannya). */
function withCurrent(names: string[], current: string | null): string[] {
  if (current !== null && !names.includes(current)) {
    return [...names, current];
  }
  return names;
}

export function VariablesTab({
  data,
  descriptor,
  variables,
  onChange,
  showFieldHelp,
}: VariablesTabProps) {
  const issues = useMemo(
    () =>
      validateMapping(
        descriptor,
        data.FeatureMapping,
        data.ActualTargetVar,
        variables
      ),
    [descriptor, data.FeatureMapping, data.ActualTargetVar, variables]
  );

  const actualIssues = issues.filter((issue) =>
    issue.code.startsWith("AM_E_ACTUAL_")
  );

  const handleFeatureChange = (featureName: string, value: string) => {
    onChange({
      ...data,
      FeatureMapping: {
        ...data.FeatureMapping,
        [featureName]: value === NONE_VALUE ? null : value,
      },
    });
  };

  const handleActualChange = (value: string) => {
    onChange({
      ...data,
      ActualTargetVar: value === NONE_VALUE ? null : value,
    });
  };

  const handleAutoMap = () => {
    // Menimpa pilihan manual (AGENTS.md §6.4).
    onChange(autoMapFeatures(descriptor, variables));
  };

  const actualOptions = withCurrent(
    getEligibleActualTargetVariables(data.FeatureMapping, variables).map(
      (v) => v.name
    ),
    data.ActualTargetVar
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="font-semibold">Variable Mapping</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAutoMap}
          >
            Auto-map by name
          </Button>
        </div>
        <HelpText show={showFieldHelp} text={VARIABLES_TAB_HELP.mapping} />
        <HelpText show={showFieldHelp} text={VARIABLES_TAB_HELP.autoMap} />

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1 pr-2 font-normal">Feature</th>
              <th className="py-1 pr-2 font-normal">Role</th>
              <th className="py-1 pr-2 font-normal">Dataset variable</th>
              <th className="py-1 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {descriptor.features.map((feature) => {
              const mapped = data.FeatureMapping[feature.name] ?? null;
              const options = withCurrent(
                getEligibleVariablesForFeature(feature.role, variables).map(
                  (v) => v.name
                ),
                mapped
              );
              const usedByOthers = new Set(
                Object.entries(data.FeatureMapping)
                  .filter(
                    ([otherFeature, variableName]) =>
                      otherFeature !== feature.name && variableName !== null
                  )
                  .map(([, variableName]) => variableName as string)
              );
              const rowIssues = issues.filter(
                (issue) =>
                  (FEATURE_DETAIL_CODES.has(issue.code) &&
                    issue.detail === feature.name) ||
                  (VARIABLE_DETAIL_CODES.has(issue.code) &&
                    mapped !== null &&
                    issue.detail === mapped)
              );

              return (
                <tr key={feature.name} className="border-b last:border-b-0">
                  <td className="py-2 pr-2 align-top">{feature.name}</td>
                  <td className="py-2 pr-2 align-top">{feature.role}</td>
                  <td className="py-2 pr-2 align-top">
                    <Select
                      value={mapped ?? NONE_VALUE}
                      onValueChange={(value) =>
                        handleFeatureChange(feature.name, value)
                      }
                    >
                      <SelectTrigger
                        aria-label={`Dataset variable for ${feature.name}`}
                      >
                        <SelectValue placeholder={NOT_MAPPED_LABEL} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>
                          {NOT_MAPPED_LABEL}
                        </SelectItem>
                        {options.map((name) => (
                          <SelectItem
                            key={name}
                            value={name}
                            disabled={usedByOthers.has(name)}
                          >
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td
                    className="py-2 align-top"
                    data-testid={`mapping-status-${feature.name}`}
                  >
                    {rowIssues.length === 0 ? (
                      <span
                        className="inline-flex items-center gap-1 text-green-700"
                        title="Mapping is valid"
                      >
                        <Check className="h-4 w-4" />
                        <span aria-hidden="true">✓</span>
                      </span>
                    ) : (
                      <div className="flex flex-col gap-1 text-destructive">
                        {rowIssues.map((issue, index) => (
                          <div
                            key={`${issue.code}-${index}`}
                            className="flex items-start gap-1"
                          >
                            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            <span>{formatIssueMessage(issue)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-2">
        <Label className="font-semibold">Actual target (optional)</Label>
        <Select
          value={data.ActualTargetVar ?? NONE_VALUE}
          onValueChange={handleActualChange}
        >
          <SelectTrigger aria-label="Actual target variable">
            <SelectValue placeholder={NONE_LABEL} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>{NONE_LABEL}</SelectItem>
            {actualOptions.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Evaluation is shown only when this is set.
        </p>
        <HelpText show={showFieldHelp} text={VARIABLES_TAB_HELP.actual} />
        {actualIssues.length > 0 && (
          <div
            data-testid="actual-target-errors"
            className="flex flex-col gap-1 text-sm text-destructive"
          >
            {actualIssues.map((issue, index) => (
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

export default VariablesTab;
