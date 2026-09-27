import React, { useEffect, useState } from "react";
import type {
  KNNSaveProps,
  KNNSaveType,
} from "@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor";
import type { CheckedState } from "@radix-ui/react-checkbox";
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { FieldHelp } from "./field-help";
import {
  computeSaveCapabilities,
  DEFAULT_SAVED_VARIABLE_NAMES,
  parseMaxCatsToSaveInput,
  type SavedVariableNameField,
} from "@/components/Modals/Analyze/Classify/nearest-neighbor/hooks/useNearestNeighborSaveRules";

const withSaveDefaults = (data: KNNSaveType): KNNSaveType => ({
  ...data,
  MaxCatsToSave: data.MaxCatsToSave ?? 25,
  PredictedValueName:
    data.PredictedValueName ?? DEFAULT_SAVED_VARIABLE_NAMES.PredictedValueName,
  ProbabilityName:
    data.ProbabilityName ?? DEFAULT_SAVED_VARIABLE_NAMES.ProbabilityName,
  PartitionName: data.PartitionName ?? DEFAULT_SAVED_VARIABLE_NAMES.PartitionName,
  FoldName: data.FoldName ?? DEFAULT_SAVED_VARIABLE_NAMES.FoldName,
});

export const KNNSave = ({
  updateFormData,
  data,
  hasTarget,
  targetType,
  isAutoK,
  isFeatureSelectionActive,
  isUsingPartitionVariable,
  isUsingFoldVariable,
  showFieldHelp = false,
}: KNNSaveProps) => {
  const [saveState, setSaveState] = useState<KNNSaveType>(() =>
    withSaveDefaults(data),
  );

  useEffect(() => {
    setSaveState((previous) => {
      if (JSON.stringify(data) === JSON.stringify(previous)) return previous;
      return withSaveDefaults(data);
    });
  }, [data]);

  useEffect(() => {
    if (JSON.stringify(saveState) === JSON.stringify(data)) return;
    Object.entries(saveState).forEach(([key, value]) => {
      updateFormData(key as keyof KNNSaveType, value);
    });
  }, [data, saveState, updateFormData]);

  const { canPredict, canProbability, canFold, canSavePartition, canSaveFold } =
    computeSaveCapabilities({
      hasTarget,
      targetType,
      isAutoK,
      isFeatureSelectionActive,
      isUsingPartitionVariable,
      isUsingFoldVariable,
    });
  const canEditMaxCatsToSave = canProbability && saveState.IsCateTargetVar;

  // Predictions need a target; probabilities only apply to categorical targets.

  useEffect(() => {
    setSaveState((prev) => ({
      ...prev,
      HasTargetVar: canPredict ? prev.HasTargetVar : false,
      IsCateTargetVar: canProbability ? prev.IsCateTargetVar : false,
      RandomAssignToPartition: canSavePartition
        ? prev.RandomAssignToPartition
        : false,
      RandomAssignToFold: canSaveFold ? prev.RandomAssignToFold : false,
    }));
  }, [canPredict, canProbability, canSavePartition, canSaveFold]);

  const handleChange = (
    field: keyof KNNSaveType,
    value: CheckedState | number | boolean | string | null,
  ) => {
    setSaveState((prevState) => ({
      ...prevState,
      [field]: value,
    }));
  };

  const handleSavedGrp = (value: string) => {
    setSaveState((prevState) => ({
      ...prevState,
      AutoName: value === "AutoName",
      CustomName: value === "CustomName",
    }));
  };

  const getNameInputValue = (field: SavedVariableNameField) =>
    saveState.AutoName
      ? DEFAULT_SAVED_VARIABLE_NAMES[field]
      : (saveState[field] ?? "");

  const handleMaxCatsToSaveChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const parsed = parseMaxCatsToSaveInput(event.target.value);
    if (parsed === undefined) return;

    handleChange("MaxCatsToSave", parsed);
  };

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      <div className="flex-1 min-h-0 w-full">
        <div className="h-full min-h-0 overflow-y-auto">
          <div className="flex flex-col items-start gap-2 p-4">
            <ResizablePanelGroup
              direction="vertical"
              className="min-h-[250px] w-full rounded-lg border md:min-w-[200px]"
            >
              <ResizablePanel defaultSize={100}>
                <RadioGroup
                  value={saveState.AutoName ? "AutoName" : "CustomName"}
                  onValueChange={handleSavedGrp}
                >
                  <div className="flex flex-col gap-2 p-2">
                    <Label className="font-bold">
                      Names of Saved Variables
                    </Label>
                    <FieldHelp
                      show={showFieldHelp}
                      text="Menentukan bagaimana nama variabel hasil KNN dibuat di dataset."
                    />
                    <div className="flex flex-row gap-2">
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="AutoName" id="AutoName" />
                        <Label htmlFor="AutoName">
                          Automatically generate unique names
                        </Label>
                        <FieldHelp
                          show={showFieldHelp}
                          text="Sistem membuat nama variabel output yang unik secara otomatis."
                        />
                      </div>
                    </div>
                    <div className="pl-6">
                      <p className="text-sm text-justify">
                        Select this option if you want to add a new set of saved
                        variables to your dataset each time you run a model.
                      </p>
                    </div>
                    <div className="flex flex-row gap-1">
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="CustomName" id="CustomName" />
                        <Label htmlFor="CustomName">Use custom names</Label>
                        <FieldHelp
                          show={showFieldHelp}
                          text="Gunakan nama variabel output yang ditentukan sendiri."
                        />
                      </div>
                    </div>
                    <div className="pl-6">
                      <p className="text-sm text-justify">
                        Specify names for the variables. If you select this
                        option, any existing variables with the same name or root
                        name are replaced each time you run a model.
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
          <div className="flex flex-col gap-2 p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px] text-center">Save</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Variable Name</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
              <TableRow>
                <TableCell className="text-center">
                  <Checkbox
                    id="HasTargetVar"
                    checked={saveState.HasTargetVar}
                    disabled={!canPredict}
                    onCheckedChange={(checked) =>
                      handleChange("HasTargetVar", checked)
                    }
                  />
                </TableCell>
                <TableCell>
                  <label
                    htmlFor="HasTargetVar"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Predicted Value or Category
                  </label>
                  <FieldHelp
                    show={showFieldHelp}
                    text="Menyimpan hasil prediksi nilai atau kategori target untuk setiap kasus."
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label="Predicted value or category variable name"
                    value={getNameInputValue("PredictedValueName")}
                    onChange={(e) =>
                      handleChange("PredictedValueName", e.target.value)
                    }
                    disabled={
                      saveState.AutoName ||
                      !canPredict ||
                      !saveState.HasTargetVar
                    }
                  />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-center">
                  <Checkbox
                    id="IsCateTargetVar"
                    checked={saveState.IsCateTargetVar}
                    disabled={!canProbability}
                    onCheckedChange={(checked) =>
                      handleChange("IsCateTargetVar", checked)
                    }
                  />
                </TableCell>
                <TableCell>
                  <label
                    htmlFor="IsCateTargetVar"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Predicted Probability (Category Target)
                  </label>
                  <FieldHelp
                    show={showFieldHelp}
                    text="Menyimpan probabilitas prediksi untuk target kategorikal."
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label="Predicted probability variable name prefix"
                    title="The category name is appended to this name, e.g. KNN_Probability_A."
                    value={getNameInputValue("ProbabilityName")}
                    onChange={(e) =>
                      handleChange("ProbabilityName", e.target.value)
                    }
                    disabled={
                      saveState.AutoName ||
                      !canProbability ||
                      !saveState.IsCateTargetVar
                    }
                  />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-center">
                  <Checkbox
                    id="RandomAssignToPartition"
                    checked={saveState.RandomAssignToPartition}
                    disabled={!canSavePartition}
                    onCheckedChange={(checked) =>
                      handleChange("RandomAssignToPartition", checked)
                    }
                  />
                </TableCell>
                <TableCell>
                  <label
                    htmlFor="RandomAssignToPartition"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Training/Holdout Partition Variable
                  </label>
                  <FieldHelp
                    show={showFieldHelp}
                    text="Menyimpan penanda kasus masuk training atau holdout."
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label="Partition variable name"
                    value={getNameInputValue("PartitionName")}
                    onChange={(e) =>
                      handleChange("PartitionName", e.target.value)
                    }
                    disabled={
                      saveState.AutoName ||
                      !canSavePartition ||
                      !saveState.RandomAssignToPartition
                    }
                  />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-center">
                  <Checkbox
                    id="RandomAssignToFold"
                    checked={saveState.RandomAssignToFold}
                    disabled={!canSaveFold}
                    onCheckedChange={(checked) =>
                      handleChange("RandomAssignToFold", checked)
                    }
                  />
                </TableCell>
                <TableCell>
                  <label
                    htmlFor="RandomAssignToFold"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Cross-Validation Fold Variable
                  </label>
                  <FieldHelp
                    show={showFieldHelp}
                    text="Menyimpan nomor fold validasi silang untuk setiap kasus."
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label="Fold variable name"
                    value={getNameInputValue("FoldName")}
                    onChange={(e) => handleChange("FoldName", e.target.value)}
                    disabled={
                      saveState.AutoName ||
                      !canSaveFold ||
                      !saveState.RandomAssignToFold
                    }
                  />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <div className="flex flex-row items-center gap-2">
            <Label className="w-[275px]" htmlFor="MaxCatsToSave">
              Maximum Number of Categories to Save:
            </Label>
            <FieldHelp
              show={showFieldHelp}
              text="Batas jumlah kategori target yang probabilitasnya disimpan."
            />
            <Input
              id="MaxCatsToSave"
              type="number"
              min={1}
              step={1}
              className="w-[75px]"
              disabled={!canEditMaxCatsToSave}
              value={saveState.MaxCatsToSave ?? ""}
              onChange={handleMaxCatsToSaveChange}
            />
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};
