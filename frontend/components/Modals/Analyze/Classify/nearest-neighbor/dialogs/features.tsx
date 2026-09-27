import React, { useEffect, useState } from "react";
import type {
  KNNFeaturesProps,
  KNNFeaturesType,
} from "@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor";
import type { CheckedState } from "@radix-ui/react-checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HelperIcon } from "./helper-icon";

const helperText = {
  performFeatureSelection:
    "Automatically select the most useful features before building the final KNN model.",
  forwardSelection: "Forward Selection is used to evaluate featires for inclusion",
  forcedEntry: "Move features to force into the model prior to forward selection.",
  stoppingCriterion:
    "Define when the forward feature selection process should stop.",
};

export const KNNFeatures = ({
  updateFormData,
  data,
  hasTarget,
  showFieldHelp = false,
}: KNNFeaturesProps) => {
  const [availableVariables, setAvailableVariables] = useState<string[]>([]);

  useEffect(() => {
    const usedVariables = [...(data.ForcedEntryVar ?? [])].filter(Boolean);

    const updatedVariables = (data.ForwardSelection ?? []).filter(
      (variable) => !usedVariables.includes(variable),
    );

    setAvailableVariables(updatedVariables);
  }, [data.ForwardSelection, data.ForcedEntryVar]);

  useEffect(() => {
    const forcedCount = (data.ForcedEntryVar ?? []).length;
    const forwardCount = (data.ForwardSelection ?? []).filter(
      (variable) => !(data.ForcedEntryVar ?? []).includes(variable),
    ).length;

    if (data.FeaturesToEvaluate !== forwardCount) {
      updateFormData("FeaturesToEvaluate", forwardCount);
    }

    if (data.ForcedFeatures !== forcedCount) {
      updateFormData("ForcedFeatures", forcedCount);
    }
  }, [
    data.ForwardSelection,
    data.ForcedEntryVar,
    data.FeaturesToEvaluate,
    data.ForcedFeatures,
    updateFormData,
  ]);

  const handleChange = (
    field: keyof KNNFeaturesType,
    value: CheckedState | number | boolean | string | null,
  ) => {
    updateFormData(field, value);
  };

  const handleDrop = (target: string, variable: string) => {
    if (!variable || (data.ForcedEntryVar ?? []).includes(variable)) return;

    updateFormData("ForcedEntryVar", [
      ...(data.ForcedEntryVar ?? []),
      variable,
    ]);
  };

  const handleRemoveVariable = (target: string, variable?: string) => {
    if (target === "ForcedEntryVar") {
      const updated = (data.ForcedEntryVar ?? []).filter(
        (item) => item !== variable,
      );

      updateFormData("ForcedEntryVar", updated);
    }
  };

  const handleCriterionGrp = (value: string) => {
    updateFormData("MaxReached", value === "MaxReached");
    updateFormData("BelowMin", value === "BelowMin");
  };

  const canUseFeatureSelection =
    hasTarget && (data.ForwardSelection ?? []).length > 0;

  const isSelectionActive = data.PerformSelection && canUseFeatureSelection;

  const forwardCount = availableVariables.length;
  const forcedCount = (data.ForcedEntryVar ?? []).length;
  // SPSS default when the number to select is left blank:
  // J_add = max(min(20, P) - J_forced, 0), with P the total number of features.
  const automaticNumberToSelect = Math.max(
    Math.min(20, forwardCount + forcedCount) - forcedCount,
    0,
  );

  return (
    <div className="flex flex-col h-full min-h-0 w-full overflow-hidden">
      <div className="flex-1 min-h-0 w-full overflow-y-auto">
        <div className="flex flex-col items-start gap-2 p-4 w-full">
          <div className="w-full max-w-2xl rounded-lg border md:min-w-[200px]">
            <section className="border-b">
              <div className="flex flex-col gap-2 p-2 w-full">
                <div className="flex flex-row items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="PerformSelection"
                      checked={data.PerformSelection}
                      disabled={!canUseFeatureSelection}
                      onCheckedChange={(checked) =>
                        handleChange("PerformSelection", checked)
                      }
                    />
                    <label
                      htmlFor="PerformSelection"
                      className="text-sm font-bold leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Perform Feature Selection
                    </label>
                  </div>
                  {showFieldHelp ? (
                    <HelperIcon text={helperText.performFeatureSelection} />
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex min-w-0 flex-col gap-2">
                      <div className="flex w-full items-center gap-2">
                        <Label className="font-bold">Forward Selection:</Label>
                        {showFieldHelp ? (
                          <HelperIcon text={helperText.forwardSelection} />
                        ) : null}
                      </div>
                      <div className="w-full h-[150px] p-2 border rounded overflow-hidden">
                        <ScrollArea>
                          <div className="flex flex-col h-[130px] gap-1 justify-start items-start">
                            {availableVariables.map(
                              (variable: string, index: number) => (
                                <Badge
                                  key={index}
                                  className="w-full text-start text-sm font-light p-2 cursor-pointer"
                                  variant="outline"
                                  draggable={isSelectionActive}
                                  onDragStart={(e) =>
                                    e.dataTransfer.setData("text", variable)
                                  }
                                >
                                  {variable}
                                </Badge>
                              ),
                            )}
                          </div>
                        </ScrollArea>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Features to evaluate: {forwardCount}
                      </p>
                    </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <div
                      className="flex flex-col w-full gap-2"
                      onDragOver={(e) => {
                        if (!isSelectionActive) return;
                        e.preventDefault();
                      }}
                      onDrop={(e) => {
                        if (!isSelectionActive) return;
                        const variable = e.dataTransfer.getData("text");
                        handleDrop("ForcedEntryVar", variable);
                      }}
                    >
                      <div className="flex w-full items-center gap-2">
                        <Label className="font-bold">Forced Entry:</Label>
                        {showFieldHelp ? (
                          <HelperIcon text={helperText.forcedEntry} />
                        ) : null}
                      </div>
                      <div className="w-full h-[150px] p-2 border rounded overflow-hidden">
                        <ScrollArea>
                          <div className="w-full h-[130px]">
                            {data.ForcedEntryVar &&
                            data.ForcedEntryVar.length > 0 ? (
                              <div className="flex flex-col gap-1">
                                {data.ForcedEntryVar.map((variable, index) => (
                                  <Badge
                                    key={index}
                                    className="text-start text-sm font-light p-2 cursor-pointer"
                                    variant="outline"
                                    onClick={() => {
                                      if (!isSelectionActive) return;
                                      handleRemoveVariable(
                                        "ForcedEntryVar",
                                        variable,
                                      );
                                    }}
                                  >
                                    {variable}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-sm font-light text-gray-500">
                                Drop variables here.
                              </span>
                            )}
                          </div>
                        </ScrollArea>
                      </div>
                      <input
                        type="hidden"
                        value={data.ForcedEntryVar ?? ""}
                        name="Independents"
                      />
                      <p className="text-sm text-muted-foreground">
                        Features to force: {forcedCount}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <RadioGroup
                value={data.BelowMin ? "BelowMin" : "MaxReached"}
                disabled={!data.PerformSelection}
                onValueChange={handleCriterionGrp}
              >
                <div className="flex flex-col gap-2 p-2">
                  <div className="flex w-full items-center gap-2">
                    <Label className="font-bold">Stopping Criterion</Label>
                    {showFieldHelp ? (
                      <HelperIcon text={helperText.stoppingCriterion} />
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="MaxReached" id="MaxReached" />
                      <Label htmlFor="MaxReached">
                        Stop when the specified number of features is reached
                      </Label>
                    </div>
                    <div className="flex flex-col space-x-2 pl-4">
                      <div className="flex items-center space-x-2 pl-2">
                        <Label className="w-[150px]">Number to Select:</Label>
                        <div className="w-[75px]">
                          <Input
                            id="MaxToSelect"
                            type="number"
                            placeholder="Auto"
                            value={data.MaxToSelect ?? ""}
                            disabled={!data.MaxReached || data.BelowMin}
                            onChange={(e) =>
                              handleChange(
                                "MaxToSelect",
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                              )
                            }
                          />
                        </div>
                      </div>
                      <p className="pl-2 text-xs text-muted-foreground">
                        Leave blank to select automatically ({automaticNumberToSelect}{" "}
                        {automaticNumberToSelect === 1 ? "feature" : "features"}).
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="BelowMin" id="BelowMin" />
                      <Label htmlFor="BelowMin">
                        Stop when the change in the absolute error ratio is less
                        than or equal to minimum
                      </Label>
                    </div>
                    <div className="flex flex-col space-x-2 pl-4 gap-1">
                      <div className="flex items-center space-x-2 pl-2">
                        <Label className="w-[150px]">Minimum Change:</Label>
                        <div className="w-[75px]">
                          <Input
                            id="MinChange"
                            type="number"
                            placeholder=""
                            value={data.MinChange ?? ""}
                            disabled={!data.BelowMin}
                            onChange={(e) =>
                              handleChange("MinChange", Number(e.target.value))
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </RadioGroup>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
