import React, { useEffect, useState } from "react";
import type {
  KNNPartitionProps,
  KNNPartitionType,
} from "@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor";
import type { CheckedState } from "@radix-ui/react-checkbox";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { HelperIcon } from "./helper-icon";
import {
  isCrossValidationEnabled as computeIsCrossValidationEnabled,
  isSeedUnavailable,
  enforcePartitionRules,
  applyCrossValidationDefaults,
} from "@/components/Modals/Analyze/Classify/nearest-neighbor/hooks/useNearestNeighborPartitionRules";

const helperText = {
  trainingAndHoldoutPartition:
    "Split the data into training and holdout sets for model building and evaluation.",
  crossValidationFolds:
    "V-fold cross-validations is performed if you choose automatic k selection but do not choose feature selection.",
  setSeedForMersenneTwister:
    "Use a fixed Mersenne Twister seed to produce repeatable random results.",
};

const partitionFields: (keyof KNNPartitionType)[] = [
  "PartitioningVariable",
  "UseRandomly",
  "UseVariable",
  "VFoldPartitioningVariable",
  "VFoldUseRandomly",
  "VFoldUsePartitioningVar",
  "TrainingNumber",
  "NumPartition",
  "SetSeed",
  "Seed",
];

const normalizePartitionState = (
  data: KNNPartitionType,
): KNNPartitionType => ({
  ...data,
  UseRandomly: data.UseRandomly ?? true,
  UseVariable: data.UseVariable ?? false,
});

const partitionStatesEqual = (
  left: KNNPartitionType,
  right: KNNPartitionType,
) => partitionFields.every((field) => Object.is(left[field], right[field]));

export const KNNPartition = ({
  updateFormData,
  data,
  availableVariables,
  isAutoK,
  isFeatureSelectionActive,
  showFieldHelp = false,
}: KNNPartitionProps) => {
  const [partitionState, setPartitionState] = useState<KNNPartitionType>(() =>
    enforcePartitionRules(normalizePartitionState(data)),
  );

  const isCrossValidationEnabled = computeIsCrossValidationEnabled(
    isAutoK,
    isFeatureSelectionActive,
  );

  useEffect(() => {
    const nextState = enforcePartitionRules(normalizePartitionState(data));
    setPartitionState((prev) => {
      if (partitionStatesEqual(prev, nextState)) return prev;
      return nextState;
    });
  }, [data]);

  const partitionMode = partitionState.UseRandomly
    ? "UseRandomly"
    : partitionState.UseVariable
      ? "UseVariable"
      : "UseRandomly";

  const foldMode = partitionState.VFoldUseRandomly
    ? "VFoldUseRandomly"
    : partitionState.VFoldUsePartitioningVar
      ? "VFoldUsePartitioningVar"
      : "VFoldUseRandomly"; // default
  const isSeedDisabled = isSeedUnavailable(partitionState);

  useEffect(() => {
    setPartitionState((prev) => {
      const nextState = applyCrossValidationDefaults(
        prev,
        isCrossValidationEnabled,
        isFeatureSelectionActive,
      );
      if (partitionStatesEqual(prev, nextState)) return prev;
      return nextState;
    });
  }, [isCrossValidationEnabled, isFeatureSelectionActive]);

  useEffect(() => {
    if (!isSeedDisabled) return;

    setPartitionState((prev) => {
      if (!prev.SetSeed) return prev;
      return {
        ...prev,
        SetSeed: false,
      };
    });
  }, [isSeedDisabled]);

  const filteredAvailableVariables = availableVariables.filter(
    (variable) =>
      variable !== partitionState.PartitioningVariable &&
      variable !== partitionState.VFoldPartitioningVariable,
  );

  useEffect(() => {
    for (const field of partitionFields) {
      if (!Object.is(partitionState[field], data[field])) {
        updateFormData(field, partitionState[field]);
      }
    }
  }, [data, partitionState, updateFormData]);

  const handleChange = (
    field: keyof KNNPartitionType,
    value: CheckedState | number | boolean | string | null,
  ) => {
    setPartitionState((prevState) => {
      const newState = enforcePartitionRules({
        ...prevState,
        [field]: value,
      });

      //updateFormData(field, value);

      return newState;
    });
  };

  const handleDrop = (target: string, variable: string) => {
    setPartitionState((prev) => {
      const updatedState = { ...prev };

      if (target === "PartitioningVariable") {
        updatedState.PartitioningVariable = variable;
        //updateFormData("PartitioningVariable", variable);
      }

      if (target === "VFoldPartitioningVariable") {
        updatedState.VFoldPartitioningVariable = variable;
        // updateFormData("VFoldPartitioningVariable", variable);
      }

      return enforcePartitionRules(updatedState);
    });
  };

  const handleRemoveVariable = (target: string) => {
    setPartitionState((prev) => {
      const updatedState = { ...prev };

      if (target === "PartitioningVariable") {
        updatedState.PartitioningVariable = null;
        // updateFormData("PartitioningVariable", null);
      }

      if (target === "VFoldPartitioningVariable") {
        updatedState.VFoldPartitioningVariable = null;
        // updateFormData("VFoldPartitioningVariable", null);
      }

      return enforcePartitionRules(updatedState);
    });
  };

  const handlePartitionGrp = (value: string) => {
    setPartitionState((prev) =>
      enforcePartitionRules({
        ...prev,
        UseRandomly: value === "UseRandomly",
        UseVariable: value === "UseVariable",
        PartitioningVariable:
          value === "UseVariable" ? prev.PartitioningVariable : null,
      }),
    );
  };

  const handleFoldGrp = (value: string) => {
    const newState = {
      VFoldUseRandomly: value === "VFoldUseRandomly",
      VFoldUsePartitioningVar: value === "VFoldUsePartitioningVar",
    };

    setPartitionState((prev) =>
      enforcePartitionRules({
        ...prev,
        ...newState,
      }),
    );

    // updateFormData("VFoldUseRandomly", newState.VFoldUseRandomly);
    // updateFormData("VFoldUsePartitioningVar", newState.VFoldUsePartitioningVar);
  };

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      <div className="flex-1 min-h-0 w-full">
        <div className="flex flex-col items-start gap-2 p-4 h-full min-h-0 w-full">
          <ResizablePanelGroup
            direction="horizontal"
            className="h-full min-h-0 w-full rounded-lg border md:min-w-[200px]"
          >
            <ResizablePanel defaultSize={30} className="min-h-0 min-w-0">
              <div className="h-full min-h-0 overflow-y-auto hide-scrollbar">
                <div className="flex flex-col justify-start items-start gap-1 p-2 min-w-0">
                  {filteredAvailableVariables.map(
                    (variable: string, index: number) => (
                      <Badge
                        key={index}
                        className="block w-full min-w-0 truncate text-start text-sm font-light p-2 cursor-pointer"
                        variant="outline"
                        draggable
                        title={variable}
                        onDragStart={(e) =>
                          e.dataTransfer.setData("text", variable)
                        }
                      >
                        {variable}
                      </Badge>
                    ),
                  )}
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={70} className="min-h-0">
              <div className="h-full min-h-0 overflow-y-auto">
                <div className="flex min-h-full flex-col">
                <section className="border-b">
                  <RadioGroup
                    value={partitionMode}
                    onValueChange={handlePartitionGrp}
                  >
                    <div className="flex flex-col gap-2 p-2">
                      <div className="flex w-full items-center gap-2">
                        <Label className="font-bold">
                          Training and Holdout Partition
                        </Label>
                        {showFieldHelp ? (
                          <HelperIcon text={helperText.trainingAndHoldoutPartition} />
                        ) : null}
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="UseRandomly" id="UseRandomly" />
                        <Label htmlFor="UseRandomly">
                          Randomly assign cases to partition
                        </Label>
                      </div>
                      <div
                        className={`grid grid-cols-3 gap-2 pl-6 ${
                          !partitionState.UseRandomly
                            ? "opacity-50 pointer-events-none"
                            : ""
                        }`}
                      >
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="TrainingNumber">Training %:</Label>
                          <Input
                            id="TrainingNumber"
                            type="number"
                            min={1}
                            max={100}
                            step={1}
                            className="w-full min-w-0"
                            placeholder=""
                            value={partitionState.TrainingNumber ?? 70}
                            disabled={!partitionState.UseRandomly}
                            onChange={(e) =>
                              handleChange(
                                "TrainingNumber",
                                Number(e.target.value),
                              )
                            }
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="HoldoutNumber">Holdout %:</Label>
                          <Input
                            id="HoldoutNumber"
                            type="number"
                            className="w-full min-w-0"
                            placeholder=""
                            value={100 - (partitionState.TrainingNumber ?? 0)}
                            disabled={true}
                            onChange={() => {}}
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="TotalNumber">Total %:</Label>
                          <Input
                            id="TotalNumber"
                            type="number"
                            className="w-full min-w-0"
                            placeholder=""
                            value={100}
                            disabled={true}
                            onChange={() => {}}
                          />
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="UseVariable" id="UseVariable" />
                        <Label htmlFor="UseVariable">
                          Use variable to assign cases
                        </Label>
                      </div>
                      <div className="flex flex-row gap-1 pl-6">
                        <div className="flex flex-col gap-2 w-full">
                          <Label htmlFor="PartitioningVariable">
                            Partition Variable:
                          </Label>
                          <div className="flex w-full min-w-0 items-center space-x-2">
                            <div
                              className={`w-full min-w-0 min-h-[40px] p-2 border rounded ${
                                !partitionState.UseVariable
                                  ? "opacity-50 pointer-events-none"
                                  : ""
                              }`}
                              onDrop={(e) => {
                                handleDrop(
                                  "PartitioningVariable",
                                  e.dataTransfer.getData("text"),
                                );
                              }}
                              onDragOver={(e) => e.preventDefault()}
                            >
                              {partitionState.PartitioningVariable ? (
                                <Badge
                                  className="block max-w-full min-w-0 truncate text-start text-sm font-light p-2 cursor-pointer"
                                  variant="outline"
                                  title={partitionState.PartitioningVariable}
                                  onClick={() =>
                                    handleRemoveVariable("PartitioningVariable")
                                  }
                                >
                                  {partitionState.PartitioningVariable}
                                </Badge>
                              ) : (
                                <span className="text-sm font-light text-gray-500">
                                  Drop variables here.
                                </span>
                              )}
                            </div>
                            <input
                              type="hidden"
                              value={partitionState.PartitioningVariable ?? ""}
                              name="PartitioningVariable"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </RadioGroup>
                </section>
                <section className="border-b">
                  <RadioGroup
                    disabled={!isCrossValidationEnabled}
                    value={foldMode}
                    onValueChange={handleFoldGrp}
                  >
                    <div
                      className={`flex flex-col gap-2 p-2 ${
                        !isCrossValidationEnabled
                          ? "opacity-50 pointer-events-none"
                          : ""
                      }`}
                    >
                      <div className="flex w-full items-center gap-2">
                        <Label className="font-bold">
                          Cross Validation Folds
                        </Label>
                        {showFieldHelp ? (
                          <HelperIcon text={helperText.crossValidationFolds} />
                        ) : null}
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem
                          value="VFoldUseRandomly"
                          id="VFoldUseRandomly"
                        />
                        <Label htmlFor="VFoldUseRandomly">
                          Randomly assign cases to folds
                        </Label>
                      </div>
                      <div className="flex flex-row pl-6 gap-2">
                        <Label htmlFor="TrainingNumber">Number of Folds:</Label>
                        <Input
                          id="NumPartition"
                          type="number"
                          min={2}
                          step={1}
                          className="min-w-2xl w-full"
                          placeholder=""
                          value={partitionState.NumPartition ?? ""}
                          disabled={
                            !isCrossValidationEnabled ||
                            !partitionState.VFoldUseRandomly
                          }
                          onChange={(e) =>
                            handleChange("NumPartition", Number(e.target.value))
                          }
                        />
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem
                          value="VFoldUsePartitioningVar"
                          id="VFoldUsePartitioningVar"
                        />
                        <Label htmlFor="VFoldUsePartitioningVar">
                          Use variable to assign cases
                        </Label>
                      </div>
                      <div className="flex flex-col gap-2 pl-6 w-full">
                        <Label htmlFor="VFoldPartitioningVariable">
                          Fold Variable:
                        </Label>
                        <div className="flex w-full min-w-0 items-center space-x-2">
                          <div
                            className={`w-full min-w-0 min-h-[40px] p-2 border rounded ${
                              !isCrossValidationEnabled ||
                              !partitionState.VFoldUsePartitioningVar
                                ? "opacity-50 pointer-events-none"
                                : ""
                            }`}
                            onDrop={(e) => {
                              handleDrop(
                                "VFoldPartitioningVariable",
                                e.dataTransfer.getData("text"),
                              );
                            }}
                            onDragOver={(e) => e.preventDefault()}
                          >
                            {partitionState.VFoldPartitioningVariable ? (
                              <Badge
                                className="block max-w-full min-w-0 truncate text-start text-sm font-light p-2 cursor-pointer"
                                variant="outline"
                                title={
                                  partitionState.VFoldPartitioningVariable
                                }
                                onClick={() =>
                                  handleRemoveVariable(
                                    "VFoldPartitioningVariable",
                                  )
                                }
                              >
                                {partitionState.VFoldPartitioningVariable}
                              </Badge>
                            ) : (
                              <span className="text-sm font-light text-gray-500">
                                Drop variables here.
                              </span>
                            )}
                          </div>
                          <input
                            type="hidden"
                            value={
                              partitionState.VFoldPartitioningVariable ?? ""
                            }
                            name="VFoldPartitioningVariable"
                          />
                        </div>
                      </div>
                    </div>
                  </RadioGroup>
                </section>
                <section>
                  <div className="flex flex-col gap-2 p-2">
                    <div className="flex items-center gap-2">
                      <Label className="font-bold">Random Number Seed</Label>
                    </div>
                    <div className="flex w-full items-center justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="SetSeed"
                          checked={partitionState.SetSeed}
                          disabled={isSeedDisabled}
                          onCheckedChange={(checked) =>
                            handleChange("SetSeed", checked)
                          }
                        />
                        <label
                          htmlFor="SetSeed"
                          className="text-sm font-bold leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          Set Seed for Mersenne Twister
                        </label>
                      </div>
                      {showFieldHelp ? (
                        <HelperIcon text={helperText.setSeedForMersenneTwister} />
                      ) : null}
                    </div>
                    <div className="flex flex-row items-center gap-2 pl-6 w-full">
                      <Label htmlFor="Seed">Seed:</Label>
                      <Input
                        id="Seed"
                        type="number"
                        min={0}
                        max={4294967295}
                        step={1}
                        className="min-w-2xl w-full"
                        placeholder=""
                        value={partitionState.Seed ?? ""}
                        disabled={isSeedDisabled || !partitionState.SetSeed}
                        onChange={(e) =>
                          handleChange("Seed", Number(e.target.value))
                        }
                      />
                    </div>
                  </div>
                </section>
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
    </div>
  );
};
