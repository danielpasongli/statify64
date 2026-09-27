"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KNNDialog } from "@/components/Modals/Analyze/Classify/nearest-neighbor/dialogs/dialog";
import { KNNNeighbors } from "@/components/Modals/Analyze/Classify/nearest-neighbor/dialogs/neighbors";
import { KNNFeatures } from "@/components/Modals/Analyze/Classify/nearest-neighbor/dialogs/features";
import { KNNPartition } from "@/components/Modals/Analyze/Classify/nearest-neighbor/dialogs/partition";
import { KNNSave } from "@/components/Modals/Analyze/Classify/nearest-neighbor/dialogs/save";
import { KNNOutput } from "@/components/Modals/Analyze/Classify/nearest-neighbor/dialogs/output";

import type {
  KNNContainerProps,
  KNNType,
} from "@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor";

import { KNNDefault } from "@/components/Modals/Analyze/Classify/nearest-neighbor/constants/nearest-neighbor-default";

import { useModal } from "@/hooks/useModal";
import { useVariableStore } from "@/stores/useVariableStore";
import { useDataStore } from "@/stores/useDataStore";

import { analyzeKNN } from "@/components/Modals/Analyze/Classify/nearest-neighbor/services/nearest-neighbor-analysis";
import { getUserFriendlyKNNError } from "@/components/Modals/Analyze/Classify/nearest-neighbor/services/nearest-neighbor-error-messages";
import { useNearestNeighborValidation } from "@/components/Modals/Analyze/Classify/nearest-neighbor/hooks/useNearestNeighborValidation";
import { validateCustomSavedNames } from "@/components/Modals/Analyze/Classify/nearest-neighbor/hooks/useNearestNeighborSaveRules";
import { clearFormData, getFormData, saveFormData } from "@/hooks/useIndexedDB";

import { toast } from "sonner";

type KNNFormValue = string[] | string | number | boolean | null;

const KNN_SETTINGS_LOAD_ERROR_TOAST_ID = "knn-settings-load-error";
const KNN_VALIDATION_ERROR_TOAST_ID = "knn-validation-error";

const stripRemovedConfig = <T extends object>(
  data: T & { options?: unknown },
): Omit<T, "options"> => {
  const { options: _options, ...config } = data;
  return config as Omit<T, "options">;
};

const createDefaultFormData = (): KNNType => ({
  main: {
    ...KNNDefault.main,
    FeatureVar: KNNDefault.main.FeatureVar
      ? [...KNNDefault.main.FeatureVar]
      : null,
  },
  neighbors: { ...KNNDefault.neighbors },
  features: {
    ...KNNDefault.features,
    ForwardSelection: KNNDefault.features.ForwardSelection
      ? [...KNNDefault.features.ForwardSelection]
      : null,
    ForcedEntryVar: KNNDefault.features.ForcedEntryVar
      ? [...KNNDefault.features.ForcedEntryVar]
      : null,
  },
  partition: { ...KNNDefault.partition },
  save: { ...KNNDefault.save },
  output: { ...KNNDefault.output },
});

const normalizeFormData = (
  data?: Partial<KNNType & { options?: unknown }> | null,
): KNNType => {
  const defaults = createDefaultFormData();
  if (!data) return defaults;

  const config = stripRemovedConfig(data);

  const features = {
    ...defaults.features,
    ...(config.features ?? {}),
    ForwardSelection: config.features?.ForwardSelection
      ? [...config.features.ForwardSelection]
      : defaults.features.ForwardSelection,
    ForcedEntryVar: config.features?.ForcedEntryVar
      ? [...config.features.ForcedEntryVar]
      : defaults.features.ForcedEntryVar,
  };

  if (features.BelowMin) {
    features.MaxReached = false;
  } else {
    features.MaxReached = true;
    features.BelowMin = false;
  }

  return {
    main: {
      ...defaults.main,
      ...(config.main ?? {}),
      FeatureVar: config.main?.FeatureVar
        ? [...config.main.FeatureVar]
        : defaults.main.FeatureVar,
    },
    neighbors: { ...defaults.neighbors, ...(config.neighbors ?? {}) },
    features,
    partition: { ...defaults.partition, ...(config.partition ?? {}) },
    save: { ...defaults.save, ...(config.save ?? {}) },
    output: { ...defaults.output, ...(config.output ?? {}) },
  };
};

export const KNNContainer = ({ onClose }: KNNContainerProps) => {
  const variables = useVariableStore((state) => state.variables);
  const dataVariables = useDataStore((state) => state.data);

  const [formData, setFormData] = useState<KNNType>(createDefaultFormData);
  const [resetKey, setResetKey] = useState(0);

  const [activeTab, setActiveTab] = useState("variables");
  const [helperMode, setHelperMode] = useState(false);

  const { closeModal } = useModal();

  useEffect(() => {
    let isActive = true;

    const loadFormData = async () => {
      try {
        const savedData = await getFormData("NearestNeighbor");
        if (!isActive) return;

        if (savedData) {
          const { id: _id, ...formDataWithoutId } = savedData;
          setFormData(normalizeFormData(formDataWithoutId));
        } else {
          setFormData(createDefaultFormData());
        }
      } catch {
        if (!isActive) return;

        toast.error(
          "Saved KNN settings could not be loaded. Default settings will be used.",
          { id: KNN_SETTINGS_LOAD_ERROR_TOAST_ID },
        );
      }
    };

    void loadFormData();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    const featureVars = formData.main.FeatureVar ?? [];

    setFormData((prev) => ({
      ...prev,
      features: {
        ...prev.features,
        ForwardSelection: featureVars,
      },
    }));
  }, [formData.main.FeatureVar]);

  const updateFormData = useCallback((
    section: keyof KNNType,
    field: string,
    value: KNNFormValue,
  ) => {
    setFormData((prev) => {
      const currentSection = prev[section] as Record<string, KNNFormValue>;
      const nextSection = {
        ...currentSection,
        [field]: value,
        ...(section === "features" && field === "MaxReached" && value === true
          ? { BelowMin: false }
          : {}),
        ...(section === "features" && field === "BelowMin" && value === true
          ? { MaxReached: false }
          : {}),
      };

      const hasChanges = Object.entries(nextSection).some(
        ([key, nextValue]) => !Object.is(currentSection[key], nextValue),
      );
      if (!hasChanges) return prev;

      return {
        ...prev,
        [section]: nextSection,
      };
    });
  }, []);

  const executeKNN = async () => {
    closeModal();
    onClose();

    const promise = async () => {
      const configData = stripRemovedConfig(formData);

      await saveFormData("NearestNeighbor", configData);

      await analyzeKNN({
        configData,
        dataVariables,
        variables,
      });
    };

    toast.promise(promise, {
      loading: "Running KNN analysis...",
      success: "KNN analysis completed successfully.",
      error: getUserFriendlyKNNError,
    });
  };

  const resetFormData = async () => {
    try {
      setResetKey((key) => key + 1);
      setActiveTab("variables");
      setFormData(createDefaultFormData());
      await clearFormData("NearestNeighbor");

      toast.success("KNN settings have been reset.");
    } catch {
      toast.error(
        "KNN settings could not be reset. Please try again.",
        { id: "knn-settings-reset-error" },
      );
    }
  };

  const variableMap = useMemo(() => {
    return new Map(variables.map((v) => [v.name, v]));
  }, [variables]);

  const availableVariables = useMemo(() => {
    const used = new Set([
      formData.main.TargetVar,
      ...(formData.main.FeatureVar ?? []),
      formData.main.FocalCaseIdenVar,
      formData.main.CaseIdenVar,
    ]);

    return variables.filter((v) => !used.has(v.name)).map((v) => v.name);
  }, [variables, formData.main]);

  const targetVariable = formData.main.TargetVar
    ? variableMap.get(formData.main.TargetVar)
    : null;

  const hasTarget = !!targetVariable;

  const targetType =
    targetVariable && targetVariable.measure !== "unknown"
      ? targetVariable.measure // scale | nominal | ordinal
      : null;

  const isAutoK = formData.neighbors.AutoSelection;
  const isFeatureSelectionActive = formData.features.PerformSelection;
  const isUsingPartitionVariable = formData.partition.UseVariable;
  const isUsingFoldVariable = formData.partition.VFoldUsePartitioningVar;

  const { validation, validateFeatureSelection, validateNumericInputs } =
    useNearestNeighborValidation(formData);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-grow px-6 min-h-0 overflow-hidden">
        <Tabs
          value={activeTab}
          onValueChange={(nextTab) => {
            const error = validateFeatureSelection();

            if (error) {
              toast.error(error, { id: KNN_VALIDATION_ERROR_TOAST_ID });
              return;
            }
            setActiveTab(nextTab);
          }}
          className="w-full h-full flex flex-col"
        >
          <TabsList className="grid w-full grid-cols-6 flex-shrink-0">
            <TabsTrigger value="variables" className="min-w-0">
              <span className="truncate block w-full">Variables</span>
            </TabsTrigger>

            <TabsTrigger value="neighbors" className="min-w-0">
              <span className="truncate block w-full">Neighbors</span>
            </TabsTrigger>

            <TabsTrigger value="features" className="min-w-0">
              <span className="truncate block w-full">Features</span>
            </TabsTrigger>

            <TabsTrigger value="partition" className="min-w-0">
              <span className="truncate block w-full">Partition</span>
            </TabsTrigger>

            <TabsTrigger value="save" className="min-w-0">
              <span className="truncate block w-full">Save</span>
            </TabsTrigger>

            <TabsTrigger value="output" className="min-w-0">
              <span className="truncate block w-full">Output</span>
            </TabsTrigger>

          </TabsList>

          <div className="flex-grow min-h-0">
            <TabsContent
              value="variables"
              key={`variables-${resetKey}`}
              className="h-full min-h-0 mt-0 data-[state=active]:flex data-[state=inactive]:hidden flex-col"
            >
              <KNNDialog
                data={formData.main}
                updateFormData={(field, value) =>
                  updateFormData("main", field, value)
                }
                externalErrors={validation.errors}
                showFieldHelp={helperMode}
              />
            </TabsContent>

            <TabsContent
              value="neighbors"
              key={`neighbors-${resetKey}`}
              className="h-full min-h-0 mt-0 data-[state=active]:flex data-[state=inactive]:hidden flex"
            >
              <KNNNeighbors
                data={formData.neighbors}
                updateFormData={(field, value) =>
                  updateFormData("neighbors", field, value)
                }
                hasTarget={hasTarget}
                targetType={targetType}
                showFieldHelp={helperMode}
              />
            </TabsContent>

            <TabsContent
              value="features"
              key={`features-${resetKey}`}
              className="h-full min-h-0 mt-0 data-[state=active]:flex data-[state=inactive]:hidden flex-col"
            >
              <KNNFeatures
                data={formData.features}
                updateFormData={(field, value) =>
                  updateFormData("features", field, value)
                }
                hasTarget={hasTarget}
                showFieldHelp={helperMode}
              />
            </TabsContent>

            <TabsContent
              value="partition"
              key={`partition-${resetKey}`}
              className="h-full min-h-0 mt-0 data-[state=active]:flex data-[state=inactive]:hidden flex-col"
            >
              <KNNPartition
                data={formData.partition}
                updateFormData={(field, value) =>
                  updateFormData("partition", field, value)
                }
                availableVariables={availableVariables}
                isAutoK={isAutoK}
                isFeatureSelectionActive={isFeatureSelectionActive}
                showFieldHelp={helperMode}
              />
            </TabsContent>

            <TabsContent
              value="save"
              key={`save-${resetKey}`}
              className="h-full min-h-0 mt-0 data-[state=active]:flex data-[state=inactive]:hidden flex-col"
            >
              <KNNSave
                data={formData.save}
                updateFormData={(field, value) =>
                  updateFormData("save", field, value)
                }
                hasTarget={hasTarget}
                targetType={targetType}
                isAutoK={isAutoK}
                isFeatureSelectionActive={isFeatureSelectionActive}
                featureCount={(formData.main.FeatureVar ?? []).length}
                isUsingPartitionVariable={isUsingPartitionVariable}
                isUsingFoldVariable={isUsingFoldVariable}
                showFieldHelp={false}
              />
            </TabsContent>

            <TabsContent
              value="output"
              key={`output-${resetKey}`}
              className="h-full min-h-0 mt-0 data-[state=active]:flex data-[state=inactive]:hidden flex-col"
            >
              <KNNOutput
                data={formData.output}
                updateFormData={(field, value) =>
                  updateFormData("output", field, value)
                }
                isAutoK={isAutoK}
                isFeatureSelectionActive={isFeatureSelectionActive}
                showFieldHelp={false}
              />
            </TabsContent>

          </div>
        </Tabs>
      </div>

      <div className="px-6 py-3 border-t border-border flex flex-shrink-0 items-center justify-between gap-4 bg-secondary">
        <Button
          type="button"
          variant="outline"
          aria-pressed={helperMode}
          onClick={() => setHelperMode((value) => !value)}
          className={helperMode ? "bg-accent" : undefined}
        >
          <CircleHelp className="mr-2 h-4 w-4" />
        </Button>

        <div className="flex items-center justify-end gap-4">
        <Button
          onClick={() => {
            const error =
              validateFeatureSelection() ??
              validateNumericInputs() ??
              validateCustomSavedNames(formData.save);

            if (error) {
              toast.error(error, { id: KNN_VALIDATION_ERROR_TOAST_ID });
              return;
            }

            executeKNN();
          }}
          disabled={!validation.isValid}
        >
          OK
        </Button>

        <Button variant="outline" onClick={resetFormData}>
          Reset
        </Button>

        <Button
          variant="outline"
          onClick={() => {
            closeModal();
            onClose();
          }}
        >
          Cancel
        </Button>
        </div>
      </div>
    </div>
  );
};

export default KNNContainer;
