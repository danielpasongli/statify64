"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ChevronRight, HelpCircle, Loader2, X } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

// Stores & Hooks
import { useVariableStore } from "@/stores/useVariableStore";
import { useModalStore } from "@/stores/useModalStore";
import { useDataStore } from "@/stores/useDataStore";

// Tab panels & sub-dialogs
import { DiscriminantStatistics } from "./statistics";
import { DiscriminantMethod } from "./method";
import { DiscriminantClassify } from "./classify";
import { DiscriminantSave } from "./save";
import { DiscriminantBootstrap } from "./bootstrap";
import { Input } from "@/components/ui/input";
import { DiscriminantAssumptions } from "./assumptions";

// Types
import type { Variable } from "@/types/Variable";
import { useDiscriminantState } from "../hooks/useDiscriminantState";

// Feature tour
import type { TabControlProps } from "@/components/Modals/Analyze/Descriptive/Descriptive/hooks/useTourGuide";
import { useTourGuide } from "@/components/Modals/Analyze/Descriptive/Descriptive/hooks/useTourGuide";
import { TourPopup, ActiveElementHighlight } from "@/components/Common/TourComponents";
import { dialogTourSteps } from "../hooks/tourConfig";
import { validateDefineRange } from "../services/discriminant-validation";
import {
  createSplitVariable,
  DEFAULT_SPLIT_SEED,
  DEFAULT_TRAINING_PERCENT,
  validateSplitOptions,
} from "../services/discriminant-split";

/** Boxes a variable can be moved into on the Variables tab. */
type DropTarget = "GroupingVariable" | "IndependentVariables" | "SelectionVariable";

/** Drag payload: the names of every variable being dragged at once. */
const DRAG_MIME = "application/statify-variable-names";


export const DiscriminantMain = () => {
  const { closeModal } = useModalStore();
  const variablesFromStore = useVariableStore((state) => state.variables);
  const { data } = useDataStore();

  const {
    formData,
    updateFormData,
    executeAnalysis,
    validateInput,
    runAssumptions,
    resetFormData,
    isLoading,
    error,
  } = useDiscriminantState(variablesFromStore, data as string[][]);

  const [activeTab, setActiveTab] = useState("variables");

  // --- Feature tour (the "?" button in the footer) ---
  const tabControl = useMemo<TabControlProps>(
    () => ({
      setActiveTab: (tab: string) => setActiveTab(tab),
      currentActiveTab: activeTab,
    }),
    [activeTab]
  );

  const {
    tourActive,
    currentStep,
    tourSteps,
    currentTargetElement,
    startTour,
    nextStep,
    prevStep,
    endTour,
  } = useTourGuide(dialogTourSteps, "dialog", tabControl);

  // Define Range inline panel state
  const [isDefineRangeOpen, setIsDefineRangeOpen] = useState(false);
  const [pendingMinRange, setPendingMinRange] = useState<number | string>("");
  const [pendingMaxRange, setPendingMaxRange] = useState<number | string>("");
  const [defineRangeError, setDefineRangeError] = useState<string | null>(null);

  const handleDefineRangeOpen = () => {
    setPendingMinRange(formData.defineRange?.minRange ?? "");
    setPendingMaxRange(formData.defineRange?.maxRange ?? "");
    setDefineRangeError(null);
    setIsSetValueOpen(false);
    setIsSplitOpen(false);
    setIsDefineRangeOpen(true);
  };

  // Like SPSS, Continue refuses an incomplete, non-integer or inverted range
  // instead of storing a placeholder value.
  const handleDefineRangeContinue = () => {
    const rangeError = validateDefineRange(pendingMinRange, pendingMaxRange);
    if (rangeError) {
      setDefineRangeError(rangeError);
      return;
    }
    updateFormData("defineRange", "minRange", Number(pendingMinRange));
    updateFormData("defineRange", "maxRange", Number(pendingMaxRange));
    setDefineRangeError(null);
    setIsDefineRangeOpen(false);
  };

  const { minRange, maxRange } = formData.defineRange;
  const isRangeDefined = minRange !== null && maxRange !== null;

  // Set Value inline panel state
  const [isSetValueOpen, setIsSetValueOpen] = useState(false);
  const [pendingValue, setPendingValue] = useState<number | string>("");

  const handleSetValueOpen = () => {
    setPendingValue(formData.setValue?.Value ?? "");
    setIsDefineRangeOpen(false);
    setIsSplitOpen(false);
    setIsSetValueOpen(true);
  };

  const handleSetValueContinue = () => {
    updateFormData("setValue", "Value", Number(pendingValue) || 0);
    setIsSetValueOpen(false);
  };

  // Generate Split inline panel: draws a training/testing split into a new variable
  // (1 = training, 0 = testing) and makes it the Selection Variable with Value 1.
  const [isSplitOpen, setIsSplitOpen] = useState(false);
  const [splitPercent, setSplitPercent] = useState<number | string>(DEFAULT_TRAINING_PERCENT);
  const [splitSeed, setSplitSeed] = useState<number | string>(DEFAULT_SPLIT_SEED);
  const [splitStratified, setSplitStratified] = useState(true);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [isSplitting, setIsSplitting] = useState(false);

  const handleSplitOpen = () => {
    setSplitError(null);
    setIsDefineRangeOpen(false);
    setIsSetValueOpen(false);
    setIsSplitOpen(true);
  };

  const handleSplitGenerate = async () => {
    const optionError = validateSplitOptions(splitPercent, splitSeed);
    if (optionError) {
      setSplitError(optionError);
      return;
    }
    // Stratifying needs the grouping variable; without one the split is simple random.
    const stratifyBy =
      splitStratified && formData.main.GroupingVariable ? formData.main.GroupingVariable : null;

    setIsSplitting(true);
    setSplitError(null);
    try {
      const created = await createSplitVariable(data as string[][], variablesFromStore, {
        trainingPercent: Number(splitPercent),
        seed: Number(splitSeed),
        stratifyBy,
      });
      updateFormData("main", "SelectionVariable", created.name);
      updateFormData("setValue", "Value", 1);
      setIsSplitOpen(false);
      toast.success(
        `Created ${created.name}: ${created.training} training and ${created.testing} testing cases. It is now the Selection Variable (Value = 1).`
      );
    } catch (err) {
      setSplitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSplitting(false);
    }
  };

  const mainData = formData.main;

  // Method applies only to the stepwise method; Bootstrap only to "enter
  // independents together". They are mutually exclusive, so only the relevant one
  // is shown, which keeps the single tab row from getting crowded.
  const showMethod = mainData.Stepwise;
  const showBootstrap = !mainData.Stepwise;

  // --- VARIABLE SELECTION ---
  const [availableVariables, setAvailableVariables] = useState<Variable[]>([]);

  // Multi-select in the Available Variables list. Variables are addressed by
  // name because that is what the form stores. Ctrl/Cmd toggles one item,
  // Shift extends the range from the last clicked one, a plain click replaces
  // the selection.
  const [selectedVarNames, setSelectedVarNames] = useState<string[]>([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<DropTarget | null>(null);

  // A variable already assigned to a box leaves the Available list, so a range
  // selection can never sweep the grouping (or selection) variable into the
  // independents by accident.
  useEffect(() => {
    const usedIds = new Set(
      [
        ...(mainData.IndependentVariables || []),
        mainData.GroupingVariable,
        mainData.SelectionVariable,
      ].filter((name): name is string => !!name)
    );
    const filtered = variablesFromStore.filter(
      (v: Variable) => !usedIds.has(v.name)
    );
    setAvailableVariables(filtered as Variable[]);
  }, [
    mainData.IndependentVariables,
    mainData.GroupingVariable,
    mainData.SelectionVariable,
    variablesFromStore,
  ]);

  // Drop anything from the selection that has just left the Available list
  // (moved into a box, or removed from the dataset).
  useEffect(() => {
    setSelectedVarNames((prev) => {
      const stillAvailable = prev.filter((name) =>
        availableVariables.some((v) => v.name === name)
      );
      return stillAvailable.length === prev.length ? prev : stillAvailable;
    });
  }, [availableVariables]);

  // If the active tab gets hidden (Method/Bootstrap toggling with the method
  // choice), fall back to the Variables tab.
  useEffect(() => {
    if (activeTab === "method" && !showMethod) setActiveTab("variables");
    if (activeTab === "bootstrap" && !showBootstrap) setActiveTab("variables");
  }, [activeTab, showMethod, showBootstrap]);

  // Assign a batch of variables to one of the boxes. Grouping and Selection
  // hold a single variable, so only the first of the batch is used there.
  const assignVariables = (target: DropTarget, names: string[]) => {
    if (names.length === 0) return;

    if (target === "GroupingVariable") {
      updateFormData("main", "GroupingVariable", names[0]);
    } else if (target === "SelectionVariable") {
      updateFormData("main", "SelectionVariable", names[0]);
    } else {
      const current = mainData.IndependentVariables || [];
      const added = names.filter((name) => !current.includes(name));
      if (added.length > 0) {
        updateFormData("main", "IndependentVariables", [...current, ...added]);
      }
    }
  };

  const clearSelection = () => {
    setSelectedVarNames([]);
    setLastSelectedIndex(null);
  };

  // Click in the Available Variables list: plain click replaces the selection,
  // Ctrl/Cmd toggles one item, Shift extends the range from the last click.
  const handleSelect = (variable: Variable, e: React.MouseEvent<HTMLDivElement>) => {
    const multiSelect = e.ctrlKey || e.metaKey;
    const currentIndex = availableVariables.findIndex((v) => v.name === variable.name);
    if (currentIndex < 0) return;

    const rangeAnchor =
      lastSelectedIndex !== null && lastSelectedIndex < availableVariables.length
        ? lastSelectedIndex
        : null;

    if (e.shiftKey && rangeAnchor !== null) {
      const start = Math.min(rangeAnchor, currentIndex);
      const end = Math.max(rangeAnchor, currentIndex);
      const rangeNames = availableVariables.slice(start, end + 1).map((v) => v.name);
      setSelectedVarNames((prev) =>
        multiSelect ? Array.from(new Set([...prev, ...rangeNames])) : rangeNames
      );
      setLastSelectedIndex(currentIndex);
      return;
    }

    if (multiSelect) {
      setSelectedVarNames((prev) =>
        prev.includes(variable.name)
          ? prev.filter((name) => name !== variable.name)
          : [...prev, variable.name]
      );
      setLastSelectedIndex(currentIndex);
      return;
    }

    const isOnlySelected =
      selectedVarNames.length === 1 && selectedVarNames[0] === variable.name;
    setSelectedVarNames(isOnlySelected ? [] : [variable.name]);
    setLastSelectedIndex(isOnlySelected ? null : currentIndex);
  };

  // Dragging a selected variable drags the whole selection; dragging an
  // unselected one drags just that variable (and makes it the selection).
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, variable: Variable) => {
    const namesToDrag = selectedVarNames.includes(variable.name)
      ? selectedVarNames
      : [variable.name];

    if (!selectedVarNames.includes(variable.name)) {
      setSelectedVarNames([variable.name]);
      setLastSelectedIndex(
        availableVariables.findIndex((v) => v.name === variable.name)
      );
    }

    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(namesToDrag));
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, target: DropTarget) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTarget(target);
  };

  const handleDragLeave = () => setDragOverTarget(null);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, target: DropTarget) => {
    e.preventDefault();
    setDragOverTarget(null);

    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;

    try {
      const names = JSON.parse(raw) as string[];
      const dropped = availableVariables
        .filter((v) => names.includes(v.name))
        .map((v) => v.name);
      assignVariables(target, dropped);
      clearSelection();
    } catch {
      // Ignore an unreadable payload.
    }
  };

  // The "move" (chevron) buttons: send the current selection to a box.
  const handleMoveSelected = (target: DropTarget) => {
    const names = availableVariables
      .filter((v) => selectedVarNames.includes(v.name))
      .map((v) => v.name);
    assignVariables(target, names);
    clearSelection();
  };

  const hasSelection = selectedVarNames.length > 0;

  const handleRemoveAllIndependents = () => {
    updateFormData("main", "IndependentVariables", []);
  };

  const handleRemoveVariable = (target: string, variable?: string) => {
    if (target === "GroupingVariable") {
      // The range belongs to the removed variable's codes, so clear it too.
      updateFormData("main", "GroupingVariable", null);
      updateFormData("defineRange", "minRange", null);
      updateFormData("defineRange", "maxRange", null);
    } else if (target === "IndependentVariables" && variable) {
      const current = mainData.IndependentVariables || [];
      updateFormData("main", "IndependentVariables", current.filter((v) => v !== variable));
    } else if (target === "SelectionVariable") {
      updateFormData("main", "SelectionVariable", null);
    }
  };

  const handleMethodGrp = (value: string) => {
    const isStepwise = value === "Stepwise";
    updateFormData("main", "Together", !isStepwise);
    updateFormData("main", "Stepwise", isStepwise);
    // Bootstrap only applies to "enter independents together". Switching to the
    // stepwise method unchecks it so it does not run unseen (its tab is hidden under
    // stepwise).
    if (isStepwise && formData.bootstrap?.PerformBootStrapping) {
      updateFormData("bootstrap", "PerformBootStrapping", false);
    }
  };

  // --- ANALYZE ---
  const handleAnalyze = async () => {
    const validationError = validateInput(mainData);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    try {
      await executeAnalysis(mainData);
      closeModal("ModalDiscriminant");
    } catch (err: any) {
      console.error("Discriminant analysis failed:", err);
    }
  };

  // --- RENDER ---
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Feature tour elements */}
      <AnimatePresence>
        {tourActive && tourSteps.length > 0 && currentStep < tourSteps.length && (
          <TourPopup
            step={tourSteps[currentStep]}
            currentStep={currentStep}
            totalSteps={tourSteps.length}
            onNext={nextStep}
            onPrev={prevStep}
            onClose={endTour}
            targetElement={currentTargetElement}
          />
        )}
      </AnimatePresence>
      <ActiveElementHighlight active={tourActive} />

      <div className="flex flex-col flex-grow min-h-0 px-6 py-3">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="w-full flex flex-col flex-grow min-h-0"
        >
          <TabsList className="w-full justify-center gap-1 flex-shrink-0">
            <TabsTrigger value="variables" id="discriminant-variables-tab-trigger">
              Variables
            </TabsTrigger>
            <TabsTrigger value="statistics" id="discriminant-statistics-tab-trigger">
              Statistics
            </TabsTrigger>
            {showMethod && (
              <TabsTrigger value="method" id="discriminant-method-tab-trigger">
                Method
              </TabsTrigger>
            )}
            <TabsTrigger value="classify" id="discriminant-classify-tab-trigger">
              Classify
            </TabsTrigger>
            <TabsTrigger value="save" id="discriminant-save-tab-trigger">
              Save
            </TabsTrigger>
            {showBootstrap && (
              <TabsTrigger value="bootstrap" id="discriminant-bootstrap-tab-trigger">
                Bootstrap
              </TabsTrigger>
            )}
            <TabsTrigger value="assumptions" id="discriminant-assumptions-tab-trigger">
              Assumptions
            </TabsTrigger>
          </TabsList>

          <div className="flex-grow min-h-0 overflow-y-auto">
            {/* === Variables Tab === */}
            <TabsContent value="variables" className="mt-0">
              <div className="flex flex-col gap-4">
                {/* Radio: Together / Stepwise */}
                <div className="flex flex-col gap-1" id="discriminant-method-group">
                  <Label className="font-semibold text-sm">Method</Label>
                  <RadioGroup
                    value={mainData.Together ? "Together" : "Stepwise"}
                    onValueChange={handleMethodGrp}
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="Together" id="Together" />
                      <Label htmlFor="Together">Enter independents together</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="Stepwise" id="Stepwise" />
                      <Label htmlFor="Stepwise">Use stepwise method</Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* Variable Assignment Areas */}
                <div className="flex gap-4 items-start">
                  {/* Left: Available Variables */}
                  <div className="flex flex-col w-1/4 gap-1">
                    <Label className="font-semibold text-sm">Available Variables</Label>
                    <ScrollArea className="h-[260px] border rounded p-2">
                      <div className="flex flex-col gap-1">
                        {availableVariables.map((variable: Variable) => (
                          <div
                            key={variable.name}
                            draggable
                            onDragStart={(e) => handleDragStart(e, variable)}
                            onClick={(e) => handleSelect(variable, e)}
                            title="Click to select (Ctrl/Shift for several), then drag or use the arrow button"
                            className={cn(
                              "w-full select-none rounded border px-2 py-1.5 text-start text-sm font-light",
                              "cursor-pointer transition-colors",
                              selectedVarNames.includes(variable.name)
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
                            )}
                          >
                            <span className="block truncate">
                              {variable.label || variable.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                    <p className="text-xs text-muted-foreground">
                      Ctrl+click to pick several, Shift+click for a range.
                      {hasSelection ? ` ${selectedVarNames.length} selected.` : ""}
                    </p>
                  </div>

                  {/* Center: Assignment Areas */}
                  <div className="flex flex-col flex-grow gap-3">
                    {/* Grouping Variable */}
                    <div className="flex items-start gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="mt-6 h-8 w-8 shrink-0"
                        onClick={() => handleMoveSelected("GroupingVariable")}
                        disabled={!hasSelection || !!mainData.GroupingVariable}
                        title="Move the selected variable to Grouping Variable"
                      >
                        <ChevronRight size={16} />
                      </Button>
                      <div
                        className="flex flex-col flex-grow gap-1"
                        id="discriminant-grouping-variable"
                      >
                        <Label className="font-semibold text-sm">Grouping Variable:</Label>
                        <div
                          className={cn(
                            "min-h-[40px] p-2 border rounded transition-colors",
                            dragOverTarget === "GroupingVariable" &&
                              "border-primary bg-primary/5 ring-1 ring-primary/30"
                          )}
                          onDrop={(e) => handleDrop(e, "GroupingVariable")}
                          onDragOver={(e) => handleDragOver(e, "GroupingVariable")}
                          onDragLeave={handleDragLeave}
                        >
                          <ScrollArea>
                            {mainData.GroupingVariable ? (
                              <Badge
                                className="text-start text-sm font-light p-2 cursor-pointer"
                                variant="outline"
                                onClick={() =>
                                  handleRemoveVariable("GroupingVariable")
                                }
                                title="Click to remove"
                              >
                                {mainData.GroupingVariable}(
                                {isRangeDefined ? `${minRange} ${maxRange}` : "? ?"})
                              </Badge>
                            ) : (
                              <span className="text-sm font-light text-gray-500">
                                Drop grouping variable here.
                              </span>
                            )}
                          </ScrollArea>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleDefineRangeOpen}
                          disabled={!mainData.GroupingVariable}
                        >
                          Define Range...
                        </Button>
                      </div>
                    </div>

                    {/* Independent Variables */}
                    <div className="flex items-start gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="mt-6 h-8 w-8 shrink-0"
                        onClick={() => handleMoveSelected("IndependentVariables")}
                        disabled={!hasSelection}
                        title="Move the selected variables to Independents"
                      >
                        <ChevronRight size={16} />
                      </Button>
                      <div
                        className="flex flex-col flex-grow gap-1"
                        id="discriminant-independent-variables"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Label className="font-semibold text-sm">Independents:</Label>
                          {(mainData.IndependentVariables?.length ?? 0) > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                              onClick={handleRemoveAllIndependents}
                              title="Remove every variable from Independents"
                            >
                              <X className="mr-1 h-3 w-3" />
                              Remove All ({mainData.IndependentVariables?.length ?? 0})
                            </Button>
                          )}
                        </div>
                        <div
                          className={cn(
                            "min-h-[80px] p-2 border rounded transition-colors",
                            dragOverTarget === "IndependentVariables" &&
                              "border-primary bg-primary/5 ring-1 ring-primary/30"
                          )}
                          onDrop={(e) => handleDrop(e, "IndependentVariables")}
                          onDragOver={(e) => handleDragOver(e, "IndependentVariables")}
                          onDragLeave={handleDragLeave}
                        >
                          <ScrollArea>
                            {mainData.IndependentVariables &&
                            mainData.IndependentVariables.length > 0 ? (
                              <div className="flex flex-col gap-1">
                                {mainData.IndependentVariables.map(
                                  (variable, index) => (
                                    <Badge
                                      key={index}
                                      className="text-start text-sm font-light p-2 cursor-pointer"
                                      variant="outline"
                                      onClick={() =>
                                        handleRemoveVariable(
                                          "IndependentVariables",
                                          variable
                                        )
                                      }
                                      title="Click to remove"
                                    >
                                      {variable}
                                    </Badge>
                                  )
                                )}
                              </div>
                            ) : (
                              <span className="text-sm font-light text-gray-500">
                                Drop independent variables here.
                              </span>
                            )}
                          </ScrollArea>
                        </div>
                      </div>
                    </div>

                    {/* Selection Variable */}
                    <div className="flex items-start gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="mt-6 h-8 w-8 shrink-0"
                        onClick={() => handleMoveSelected("SelectionVariable")}
                        disabled={!hasSelection || !!mainData.SelectionVariable}
                        title="Move the selected variable to Selection Variable"
                      >
                        <ChevronRight size={16} />
                      </Button>
                      <div
                        className="flex flex-col flex-grow gap-1"
                        id="discriminant-selection-variable"
                      >
                        <Label className="font-semibold text-sm">Selection Variable:</Label>
                        <div className="flex gap-2">
                          <div
                            className={cn(
                              "flex-grow min-h-[40px] p-2 border rounded transition-colors",
                              dragOverTarget === "SelectionVariable" &&
                                "border-primary bg-primary/5 ring-1 ring-primary/30"
                            )}
                            onDrop={(e) => handleDrop(e, "SelectionVariable")}
                            onDragOver={(e) => handleDragOver(e, "SelectionVariable")}
                            onDragLeave={handleDragLeave}
                          >
                            <ScrollArea>
                              {mainData.SelectionVariable ? (
                                <Badge
                                  className="text-start text-sm font-light p-2 cursor-pointer"
                                  variant="outline"
                                  onClick={() =>
                                    handleRemoveVariable("SelectionVariable")
                                  }
                                  title="Click to remove"
                                >
                                  {mainData.SelectionVariable}
                                </Badge>
                              ) : (
                                <span className="text-sm font-light text-gray-500">
                                  Drop selection variable here.
                                </span>
                              )}
                            </ScrollArea>
                          </div>
                          <div className="flex flex-col gap-1">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={handleSetValueOpen}
                            >
                              Value...
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={handleSplitOpen}
                              title="Create a training/testing split variable and use it as the Selection Variable"
                            >
                              Generate Split...
                            </Button>
                          </div>
                        </div>
                        {mainData.SelectionVariable && (
                          <p className="text-xs text-muted-foreground">
                            {formData.setValue?.Value === null || formData.setValue?.Value === undefined
                              ? "Set a Value: only cases with that value are analysed."
                              : `Analysis uses cases with ${mainData.SelectionVariable} = ${formData.setValue.Value}; the other cases are classified as testing cases.`}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: inline panel (Define Range, Set Value or Generate Split) */}
                  {(isDefineRangeOpen || isSetValueOpen || isSplitOpen) && (
                    <div className="flex flex-col gap-3 w-44 flex-shrink-0 rounded-lg border p-3">
                      {isDefineRangeOpen ? (
                        <>
                          <Label className="font-semibold text-sm">Define Range</Label>
                          <div className="flex flex-col gap-1">
                            <Label className="text-xs text-muted-foreground">Minimum</Label>
                            <Input
                              type="number"
                              step={1}
                              value={pendingMinRange}
                              onChange={(e) => {
                                setPendingMinRange(e.target.value);
                                setDefineRangeError(null);
                              }}
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <Label className="text-xs text-muted-foreground">Maximum</Label>
                            <Input
                              type="number"
                              step={1}
                              value={pendingMaxRange}
                              onChange={(e) => {
                                setPendingMaxRange(e.target.value);
                                setDefineRangeError(null);
                              }}
                            />
                          </div>
                          {defineRangeError && (
                            <p className="text-xs text-destructive">{defineRangeError}</p>
                          )}
                          <div className="flex flex-col gap-2 pt-1">
                            <Button size="sm" onClick={handleDefineRangeContinue}>
                              Continue
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setIsDefineRangeOpen(false)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </>
                      ) : isSplitOpen ? (
                        <>
                          <Label className="font-semibold text-sm">Generate Split</Label>
                          <p className="text-xs text-muted-foreground">
                            Adds a variable (1 = training, 0 = testing) and uses it as the
                            Selection Variable with Value 1.
                          </p>
                          <div className="flex flex-col gap-1">
                            <Label className="text-xs text-muted-foreground">Training (%)</Label>
                            <Input
                              type="number"
                              min={1}
                              max={99}
                              value={splitPercent}
                              onChange={(e) => {
                                setSplitPercent(e.target.value);
                                setSplitError(null);
                              }}
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <Label className="text-xs text-muted-foreground">Seed</Label>
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              value={splitSeed}
                              onChange={(e) => {
                                setSplitSeed(e.target.value);
                                setSplitError(null);
                              }}
                            />
                          </div>
                          <div className="flex items-start gap-2">
                            <Checkbox
                              id="discriminant-split-stratified"
                              checked={splitStratified && !!mainData.GroupingVariable}
                              disabled={!mainData.GroupingVariable}
                              onCheckedChange={(checked) => setSplitStratified(checked === true)}
                            />
                            <Label htmlFor="discriminant-split-stratified" className="text-xs leading-tight">
                              Stratify by grouping variable
                              {!mainData.GroupingVariable && " (select one first)"}
                            </Label>
                          </div>
                          {splitError && (
                            <p className="text-xs text-destructive">{splitError}</p>
                          )}
                          <div className="flex flex-col gap-2 pt-1">
                            <Button size="sm" onClick={handleSplitGenerate} disabled={isSplitting}>
                              {isSplitting ? "Generating..." : "Generate"}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setIsSplitOpen(false)}
                              disabled={isSplitting}
                            >
                              Cancel
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <Label className="font-semibold text-sm">Set Value</Label>
                          <div className="flex flex-col gap-1">
                            <Label className="text-xs text-muted-foreground">Value</Label>
                            <Input
                              type="number"
                              value={pendingValue}
                              onChange={(e) => setPendingValue(e.target.value)}
                            />
                          </div>
                          <div className="flex flex-col gap-2 pt-1">
                            <Button
                              size="sm"
                              disabled={pendingValue === "" || pendingValue === 0}
                              onClick={handleSetValueContinue}
                            >
                              Continue
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setIsSetValueOpen(false)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* === Statistics Tab === */}
            <TabsContent value="statistics" className="mt-0">
              <DiscriminantStatistics
                updateFormData={(field, value) =>
                  updateFormData("statistics", field, value)
                }
                data={formData.statistics}
              />
            </TabsContent>

            {/* === Method Tab (stepwise only) === */}
            <TabsContent value="method" className="mt-0">
              <DiscriminantMethod
                updateFormData={(field, value) =>
                  updateFormData("method", field, value)
                }
                data={formData.method}
              />
            </TabsContent>

            {/* === Classify Tab === */}
            <TabsContent value="classify" className="mt-0">
              <DiscriminantClassify
                updateFormData={(field, value) =>
                  updateFormData("classify", field, value)
                }
                data={formData.classify}
              />
            </TabsContent>

            {/* === Save Tab === */}
            <TabsContent value="save" className="mt-0">
              <DiscriminantSave
                updateFormData={(field, value) =>
                  updateFormData("save", field, value)
                }
                data={formData.save}
              />
            </TabsContent>

            {/* === Bootstrap Tab (together only) === */}
            <TabsContent value="bootstrap" className="mt-0">
              <DiscriminantBootstrap
                updateFormData={(field, value) =>
                  updateFormData("bootstrap", field, value)
                }
                data={formData.bootstrap}
              />
            </TabsContent>

            {/* === Assumptions Tab === */}
            <TabsContent value="assumptions" className="mt-0">
              <DiscriminantAssumptions
                onRunAssumptions={() => runAssumptions(mainData)}
                hasGrouping={!!mainData.GroupingVariable}
                independentCount={mainData.IndependentVariables?.length ?? 0}
              />
            </TabsContent>
          </div>
        </Tabs>

        {error && (
          <div className="mt-4">
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-border flex items-center justify-between bg-secondary flex-shrink-0">
        <div className="flex items-center text-muted-foreground">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  data-testid="discriminant-help-button"
                  variant="ghost"
                  size="icon"
                  onClick={startTour}
                  aria-label="Start feature tour"
                  className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary"
                >
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs">Start feature tour</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center space-x-4">
          <Button
            id="discriminant-ok-button"
            onClick={handleAnalyze}
            disabled={
              isLoading ||
              !mainData.GroupingVariable ||
              !isRangeDefined ||
              !mainData.IndependentVariables ||
              mainData.IndependentVariables.length === 0
            }
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              "OK"
            )}
          </Button>
          <Button
            variant="outline"
            onClick={resetFormData}
            disabled={isLoading}
          >
            Reset
          </Button>
          <Button
            variant="outline"
            onClick={() => closeModal("ModalDiscriminant")}
            disabled={isLoading}
          >
            Cancel
          </Button>
        </div>
      </div>

    </div>
  );
};
