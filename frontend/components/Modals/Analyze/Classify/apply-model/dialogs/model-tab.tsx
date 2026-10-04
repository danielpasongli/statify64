// AGENTS.md §6.2 (Tab Model), §6.3 (SourceLabel), §6.7 (katalog bawaan) — Fase 12.
// Komponen terkontrol: state model ada di container (`data`); tab hanya memuat
// model lewat loader (§6.6) lalu melapor lewat `onModelLoaded`. Tidak ada
// pemetaan variabel dan tidak ada pemanggilan worker di sini.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { validateAnyModel } from "@/components/Modals/Analyze/Classify/apply-model/adapters/registry";
import { APPLY_MODEL_MESSAGES } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import type { ApplyModelIssue } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import { BUILTIN_MODELS } from "@/components/Modals/Analyze/Classify/apply-model/constants/builtin-models";
import {
  listResultStoreModels,
  loadBuiltinModel,
  loadModelFromFile,
  loadModelFromResultStore,
} from "@/components/Modals/Analyze/Classify/apply-model/services/model-loader";
import type {
  ModelLoadResult,
  ModelLoadSuccess,
  ResultStoreModelItem,
} from "@/components/Modals/Analyze/Classify/apply-model/services/model-loader";
import type {
  ApplyModelModelTabType,
  ApplyModelSourceKind,
} from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";

export type ModelTabLoadedHandler = (
  result: ModelLoadSuccess,
  sourceKind: ApplyModelSourceKind
) => void;

export type ModelTabProps = {
  data: ApplyModelModelTabType;
  onModelLoaded: ModelTabLoadedHandler;
  showFieldHelp: boolean;
};

// Teks bantuan (bahasa Inggris, AGENTS.md §6.1) — tampil bila showFieldHelp.
const MODEL_TAB_HELP = {
  source:
    "Choose where the trained model comes from: a JSON file exported from Naive Bayes, a model saved in the Output Viewer, or a model bundled with Statify.",
  file: "Only .json files up to 10 MB are accepted. A new file replaces the current model only if it is valid.",
  resultStore:
    "Lists models exported by earlier Naive Bayes runs that are still in the Output Viewer, newest first.",
  builtin:
    "Models shipped with Statify. The catalog is currently empty.",
  summary:
    "Review the target, classes and features of the loaded model before mapping variables.",
} as const;

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

export function ModelTab({ data, onModelLoaded, showFieldHelp }: ModelTabProps) {
  const [sourceKind, setSourceKind] = useState<ApplyModelSourceKind>(
    data.SourceKind
  );
  const [issues, setIssues] = useState<ApplyModelIssue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [resultStoreItems, setResultStoreItems] = useState<
    ResultStoreModelItem[] | null
  >(null);
  const [selectedStatisticId, setSelectedStatisticId] = useState<string>(
    data.SourceKind === "resultStore" ? (data.SourceRef ?? "") : ""
  );
  const [selectedBuiltinId, setSelectedBuiltinId] = useState<string>(
    data.SourceKind === "builtin" ? (data.SourceRef ?? "") : ""
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ringkasan dibangun dari model mentah lewat registry (generik, §2 P2).
  const descriptor = useMemo(() => {
    if (data.ModelJson === null) return null;
    const validation = validateAnyModel(data.ModelJson);
    return validation.ok ? validation.descriptor : null;
  }, [data.ModelJson]);

  // Daftar model result store dimuat saat radio "From Output Viewer" aktif.
  useEffect(() => {
    let isActive = true;
    if (sourceKind === "resultStore" && resultStoreItems === null) {
      listResultStoreModels()
        .then((items) => {
          if (isActive) setResultStoreItems(items);
        })
        .catch(() => {
          if (isActive) setResultStoreItems([]);
        });
    }
    return () => {
      isActive = false;
    };
  }, [sourceKind, resultStoreItems]);

  const runLoad = useCallback(
    async (
      kind: ApplyModelSourceKind,
      loader: () => Promise<ModelLoadResult>
    ) => {
      setIsLoading(true);
      try {
        const result = await loader();
        if (result.ok) {
          setIssues([]);
          onModelLoaded(result, kind);
        } else {
          // Model lama (bila ada) tidak disentuh (§6.2).
          setIssues(result.errors);
        }
      } catch {
        setIssues([{ code: "AM_E_NO_MODEL", severity: "error" }]);
      } finally {
        setIsLoading(false);
      }
    },
    [onModelLoaded]
  );

  const handleSourceKindChange = useCallback((value: string) => {
    if (value === "file" || value === "resultStore" || value === "builtin") {
      setSourceKind(value);
      setIssues([]);
    }
  }, []);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset agar file yang sama bisa dipilih ulang.
      event.target.value = "";
      if (!file) return;
      void runLoad("file", () => loadModelFromFile(file));
    },
    [runLoad]
  );

  const handleResultStoreSelect = useCallback(
    (value: string) => {
      setSelectedStatisticId(value);
      void runLoad("resultStore", () =>
        loadModelFromResultStore(Number(value))
      );
    },
    [runLoad]
  );

  const handleBuiltinSelect = useCallback(
    (value: string) => {
      setSelectedBuiltinId(value);
      void runLoad("builtin", () => loadBuiltinModel(value));
    },
    [runLoad]
  );

  const builtinEmpty = BUILTIN_MODELS.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <Label className="font-semibold">Model Source</Label>
        <HelpText show={showFieldHelp} text={MODEL_TAB_HELP.source} />
        <RadioGroup
          value={sourceKind}
          onValueChange={handleSourceKindChange}
          aria-label="Model Source"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="file" id="apply-model-source-file" />
            <Label htmlFor="apply-model-source-file">Upload file (.json)</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem
              value="resultStore"
              id="apply-model-source-result-store"
            />
            <Label htmlFor="apply-model-source-result-store">
              From Output Viewer
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="builtin" id="apply-model-source-builtin" />
            <Label htmlFor="apply-model-source-builtin">
              Statify built-in model
            </Label>
          </div>
        </RadioGroup>
      </section>

      {sourceKind === "file" && (
        <section className="flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            data-testid="model-file-input"
            onChange={handleFileChange}
          />
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={isLoading}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose file
            </Button>
          </div>
          <HelpText show={showFieldHelp} text={MODEL_TAB_HELP.file} />
        </section>
      )}

      {sourceKind === "resultStore" && (
        <section className="flex flex-col gap-2">
          {resultStoreItems === null ? (
            <p className="text-sm text-muted-foreground">Loading models...</p>
          ) : resultStoreItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {APPLY_MODEL_MESSAGES.AM_W_NO_RESULT_STORE_MODELS}
            </p>
          ) : (
            <Select
              value={selectedStatisticId}
              onValueChange={handleResultStoreSelect}
              disabled={isLoading}
            >
              <SelectTrigger aria-label="Output Viewer model">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {resultStoreItems.map((item) => (
                  <SelectItem
                    key={item.statisticId}
                    value={String(item.statisticId)}
                  >
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <HelpText show={showFieldHelp} text={MODEL_TAB_HELP.resultStore} />
        </section>
      )}

      {sourceKind === "builtin" && (
        <section className="flex flex-col gap-2">
          <Select
            value={selectedBuiltinId}
            onValueChange={handleBuiltinSelect}
            disabled={builtinEmpty || isLoading}
          >
            <SelectTrigger aria-label="Built-in model">
              <SelectValue placeholder="Select a model" />
            </SelectTrigger>
            <SelectContent>
              {BUILTIN_MODELS.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {builtinEmpty && (
            <p className="text-sm text-muted-foreground">
              {APPLY_MODEL_MESSAGES.AM_W_BUILTIN_EMPTY}
            </p>
          )}
          <HelpText show={showFieldHelp} text={MODEL_TAB_HELP.builtin} />
        </section>
      )}

      {issues.length > 0 && (
        <div
          role="alert"
          data-testid="model-load-errors"
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

      {descriptor !== null && (
        <section
          data-testid="model-summary-card"
          className="flex flex-col gap-3 rounded-lg border p-4"
        >
          <h3 className="text-sm font-semibold">Model Summary</h3>
          <HelpText show={showFieldHelp} text={MODEL_TAB_HELP.summary} />

          {descriptor.warnings.map((code) => (
            <div
              key={code}
              data-testid={`model-warning-${code}`}
              className="flex items-start gap-2 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{APPLY_MODEL_MESSAGES[code]}</span>
            </div>
          ))}

          <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-sm">
            {data.SourceLabel !== null && (
              <>
                <dt className="text-muted-foreground">Source</dt>
                <dd>{data.SourceLabel}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Algorithm</dt>
            <dd>{descriptor.algorithmLabel}</dd>
            <dt className="text-muted-foreground">Schema version</dt>
            <dd>{descriptor.schemaVersion}</dd>
            <dt className="text-muted-foreground">Trained at</dt>
            <dd>{descriptor.trainedAt ?? "-"}</dd>
            <dt className="text-muted-foreground">Target</dt>
            <dd>{descriptor.targetName}</dd>
            <dt className="text-muted-foreground">Classes</dt>
            <dd>{descriptor.classes.join(", ")}</dd>
            {descriptor.summaryRows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Features</span>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-normal">Name</th>
                  <th className="py-1 font-normal">Role</th>
                </tr>
              </thead>
              <tbody>
                {descriptor.features.map((feature) => (
                  <tr key={feature.name} className="border-b last:border-b-0">
                    <td className="py-1 pr-2">{feature.name}</td>
                    <td className="py-1">{feature.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export default ModelTab;
