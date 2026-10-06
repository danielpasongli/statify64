// AGENTS.md §3.4 (aturan mapping) dan §6.4 (Tab Variables) — Fase 13.
// Komponen terkontrol: state mapping ada di container (`data`); tab hanya
// menampilkan tabel pemetaan 1-ke-1 dan melapor lewat `onChange`. Tidak memakai
// VariableListManager, tidak mengubah store variabel, tidak memanggil worker.

"use client";

import { useMemo } from "react";
import { AlertCircle, Check, Info } from "lucide-react";
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
  formatVectorMappingSummary,
  getEligibleActualTargetVariables,
  getEligibleVariablesForFeature,
  summarizeVectorMapping,
  validateMapping,
} from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelMappingRules";
import CollapsibleNameList from "@/components/Modals/Analyze/Classify/apply-model/dialogs/collapsible-name-list";
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
  rawText:
    "This model was trained on raw text. Choose the string variable that holds the text to classify; it is preprocessed with the text preprocessing settings stored in the model.",
  vector:
    "This model was trained on word-vector columns. Columns are matched to dataset variables by name; columns that are not found are treated as 0.",
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
// v2: kode issue yang tampil di blok Text Features (bukan di baris tabel fitur).
const RAW_TEXT_ISSUE_CODES: ReadonlySet<ApplyModelIssue["code"]> = new Set([
  "AM_E_MAP_RAW_TEXT_UNMAPPED",
  "AM_E_MAP_RAW_TEXT_TYPE",
]);
// Batas daftar error kolom vektor yang ditampilkan (model bisa memuat ribuan kolom).
const MAX_VECTOR_ISSUES_SHOWN = 5;

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
  const text = descriptor.text;
  const textMapping = useMemo(
    () => ({ RawTextVar: data.RawTextVar, VectorMapping: data.VectorMapping }),
    [data.RawTextVar, data.VectorMapping]
  );

  const issues = useMemo(
    () =>
      validateMapping(
        descriptor,
        data.FeatureMapping,
        data.ActualTargetVar,
        variables,
        textMapping
      ),
    [descriptor, data.FeatureMapping, data.ActualTargetVar, variables, textMapping]
  );

  // v2: ringkasan kolom vektor (hanya dihitung ulang bila pemetaan berubah).
  const vectorSummary = useMemo(
    () => summarizeVectorMapping(descriptor, data.VectorMapping),
    [descriptor, data.VectorMapping]
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

  const handleRawTextChange = (value: string) => {
    onChange({ ...data, RawTextVar: value === NONE_VALUE ? null : value });
  };

  const handleAutoMap = () => {
    // Menimpa pilihan manual (AGENTS.md §6.4). Model dengan Text: kunci Text
    // (RawTextVar/VectorMapping) ikut ditimpa, sisanya dipertahankan.
    const mapped = autoMapFeatures(descriptor, variables);
    onChange(text ? { ...data, ...mapped } : mapped);
  };

  const actualOptions = withCurrent(
    getEligibleActualTargetVariables(
      data.FeatureMapping,
      variables,
      textMapping
    ).map((v) => v.name),
    data.ActualTargetVar
  );

  // v2: opsi dropdown Raw Text Variable = variabel bertipe STRING.
  const rawTextOptions = withCurrent(
    variables.filter((v) => v.type === "STRING").map((v) => v.name),
    data.RawTextVar ?? null
  );
  const rawTextUsedByFeatures = new Set(
    Object.values(data.FeatureMapping).filter(
      (name): name is string => name !== null && name !== undefined
    )
  );
  const rawTextIssues = issues.filter(
    (issue) =>
      RAW_TEXT_ISSUE_CODES.has(issue.code) ||
      (text?.source === "raw" &&
        VARIABLE_DETAIL_CODES.has(issue.code) &&
        data.RawTextVar != null &&
        issue.detail === data.RawTextVar)
  );
  const vectorColumns = new Set(text?.source === "vector" ? text.columns : []);
  const vectorMappedVariables = new Set(
    Object.values(data.VectorMapping ?? {}).filter(
      (name): name is string => name !== null && name !== undefined
    )
  );
  const vectorIssues =
    text?.source === "vector"
      ? issues.filter(
          (issue) =>
            (issue.code === "AM_E_MAP_NUMERIC_TYPE" &&
              issue.detail !== undefined &&
              vectorColumns.has(issue.detail)) ||
            ((issue.code === "AM_E_MAP_VAR_NOT_FOUND" ||
              issue.code === "AM_E_MAP_DUPLICATE") &&
              issue.detail !== undefined &&
              vectorMappedVariables.has(issue.detail))
        )
      : [];
  const zeroFilledInfo = issues.find((issue) => issue.code === "AM_I_TEXT_ZERO_FILLED");
  const allZeroFilledWarning = issues.find(
    (issue) => issue.code === "AM_W_TEXT_ALL_ZERO_FILLED"
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

        {descriptor.features.length === 0 ? (
          <p
            data-testid="no-numeric-categorical-features"
            className="text-sm text-muted-foreground"
          >
            This model has no numerical or categorical features; it uses text features only.
          </p>
        ) : (
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
        )}
      </section>

      {text?.source === "raw" && (
        <section
          data-testid="raw-text-section"
          className="flex flex-col gap-2"
        >
          <Label className="font-semibold">Raw Text Variable</Label>
          <p className="text-sm text-muted-foreground">
            Model text variable: {text.rawVariable ?? "-"}
          </p>
          <Select
            value={data.RawTextVar ?? NONE_VALUE}
            onValueChange={handleRawTextChange}
          >
            <SelectTrigger aria-label="Raw text variable">
              <SelectValue placeholder={NOT_MAPPED_LABEL} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>{NOT_MAPPED_LABEL}</SelectItem>
              {rawTextOptions.map((name) => (
                <SelectItem
                  key={name}
                  value={name}
                  disabled={rawTextUsedByFeatures.has(name)}
                >
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <HelpText show={showFieldHelp} text={VARIABLES_TAB_HELP.rawText} />
          {rawTextIssues.length > 0 && (
            <div
              data-testid="raw-text-errors"
              className="flex flex-col gap-1 text-sm text-destructive"
            >
              {rawTextIssues.map((issue, index) => (
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
      )}

      {text?.source === "vector" && (
        <section
          data-testid="vector-text-section"
          className="flex flex-col gap-2"
        >
          <Label className="font-semibold">Word-Vector Columns</Label>
          <p
            data-testid="vector-mapping-summary"
            className="flex items-center gap-1 text-sm"
          >
            <Info className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span>{formatVectorMappingSummary(vectorSummary)}</span>
          </p>
          <HelpText show={showFieldHelp} text={VARIABLES_TAB_HELP.vector} />
          {zeroFilledInfo !== undefined && (
            <CollapsibleNameList
              label="Show columns treated as 0"
              names={vectorSummary.zeroFilled}
              testId="vector-zero-filled-list"
            />
          )}
          {allZeroFilledWarning !== undefined && (
            <div
              data-testid="vector-all-zero-filled-warning"
              className="flex items-start gap-2 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{formatIssueMessage(allZeroFilledWarning)}</span>
            </div>
          )}
          {vectorIssues.length > 0 && (
            <div
              data-testid="vector-mapping-errors"
              className="flex flex-col gap-1 text-sm text-destructive"
            >
              {vectorIssues.slice(0, MAX_VECTOR_ISSUES_SHOWN).map((issue, index) => (
                <div
                  key={`${issue.code}-${index}`}
                  className="flex items-start gap-2"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{formatIssueMessage(issue)}</span>
                </div>
              ))}
              {vectorIssues.length > MAX_VECTOR_ISSUES_SHOWN && (
                <span>
                  ...and {vectorIssues.length - MAX_VECTOR_ISSUES_SHOWN} more issue(s).
                </span>
              )}
            </div>
          )}
        </section>
      )}

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
