// index.tsx
"use client";
import type { FC} from "react";
import React, { useState, useEffect, useMemo } from "react";

import { saveFormData, clearFormData, getFormData } from "@/hooks/useIndexedDB";
import { Button } from "@/components/ui/button";
import {
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger
} from "@/components/ui/tabs";
import { HelpCircle } from "lucide-react";
import { useVariableStore } from "@/stores/useVariableStore";
import { useResultStore } from "@/stores/useResultStore";
import type { BaseModalProps } from "@/types/modalTypes";
import type {
    CrosstabsAnalysisParams,
    VariableHighlight,
} from "./types";
import type { TabType, TabControlProps } from "./hooks/useTourGuide";
import { useTourGuide } from "./hooks/useTourGuide";
import { useCrosstabsAnalysis } from "./hooks/useCrosstabsAnalysis";
import { TourPopup, ActiveElementHighlight } from "@/components/Common/TourComponents";
import { AnimatePresence } from "framer-motion";

// Import tab components
import VariablesTab from "./VariablesTab";
import CellsTab from "./CellsTab";
import StatisticsTab from "@/components/Modals/Analyze/Descriptive/Crosstabs/StatisticsTab";

// Types
import type { Variable } from "@/types/Variable";

// Main content component that's agnostic of container type
const CrosstabsContent: FC<BaseModalProps> = ({ onClose, containerType = "dialog" }) => {
    const [activeTab, setActiveTab] = useState<TabType>("variables");
    const [availableVariables, setAvailableVariables] = useState<Variable[]>([]);
    const [rowVariables, setRowVariables] = useState<Variable[]>([]);
    const [columnVariables, setColumnVariables] = useState<Variable[]>([]);
    const [highlightedVariable, setHighlightedVariable] = useState<VariableHighlight>(null);

  const tabControl = useMemo((): TabControlProps => ({
      setActiveTab,
      currentActiveTab: activeTab,
  }), [activeTab]);


    const {
        tourActive,
        currentStep,
        tourSteps,
        currentTargetElement,
        startTour,
        nextStep,
        prevStep,
        endTour
    } = useTourGuide(containerType, tabControl);

    // State for all options, structured as needed by the analysis hook
    const [options, setOptions] = useState<CrosstabsAnalysisParams['options']>({
        statistics: {
            chiSquare: false,
            purpose: 'independence',
        },
        cells: {
            observed: true,
            expected: false,
            row: false,
            column: false,
            total: false,
            hideSmallCounts: false,
            hideSmallCountsThreshold: 5,
        },
        residuals: {
            unstandardized: false,
            standardized: false,
            adjustedStandardized: false,
        },
        nonintegerWeights: 'noAdjustment',
    });

    const { variables } = useVariableStore();

    // Helper to compute a robust identity key for variables across different contexts
    const getVarKey = (v: Variable) => {
        // Prefer stable unique identifiers when available
        // Access optional id when present at runtime
        if ((v as any).id !== undefined && (v as any).id !== null) return (v as any).id;
        if (v.tempId !== undefined && v.tempId !== null) return v.tempId;
        if (v.columnIndex !== undefined && v.columnIndex !== null) return v.columnIndex;
        return v.name;
    };

    // Load saved Crosstabs data when variables are available
    useEffect(() => {
        (async () => {
            if (!variables || variables.length === 0) return;
            const saved = await getFormData("Crosstabs");
            if (!saved) return;

            const validVars = variables.filter(v => v.name !== "");


            const savedRow: Variable[] = Array.isArray(saved.rowVariables) ? saved.rowVariables : [];
            const savedCol: Variable[] = Array.isArray(saved.columnVariables) ? saved.columnVariables : [];

            setRowVariables(savedRow);
            setColumnVariables(savedCol);

            const selectedKeys = new Set([...savedRow, ...savedCol].map(getVarKey));
            const avail = validVars.filter(v => !selectedKeys.has(getVarKey(v)));
            setAvailableVariables(avail);

            if (saved.options) {
                setOptions(saved.options);
            }

            setHighlightedVariable(null);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [variables]);

    // Analysis Hook
    const { runAnalysis, isCalculating, error } = useCrosstabsAnalysis(
        { rowVariables, columnVariables, options },
        onClose
    );

    // Keep selections in sync with dataset changes and compute available list
    useEffect(() => {
        const validVars = variables.filter(v => v.name !== "");
        const validKeys = new Set(validVars.map(getVarKey));

        const filteredRow = rowVariables.filter(rv => validKeys.has(getVarKey(rv)));
        const filteredColumn = columnVariables.filter(cv => validKeys.has(getVarKey(cv)));

        if (filteredRow.length !== rowVariables.length) {
            setRowVariables(filteredRow);
        }
        if (filteredColumn.length !== columnVariables.length) {
            setColumnVariables(filteredColumn);
        }

        const selectedKeys = new Set([...filteredRow, ...filteredColumn].map(getVarKey));
        const newAvailable = validVars.filter(v => !selectedKeys.has(getVarKey(v)));
        setAvailableVariables(newAvailable);
    }, [variables, rowVariables, columnVariables]);

    const resetAllStates = () => {
        setActiveTab("variables");
        const validVars = variables.filter(v => v.name !== "");
        setAvailableVariables(validVars);
        setRowVariables([]);
        setColumnVariables([]);
        setHighlightedVariable(null);
        setOptions({
            statistics: {
                chiSquare: false,
                purpose: 'independence',
            },
            cells: {
                observed: true,
                expected: false,
                row: false,
                column: false,
                total: false,
                hideSmallCounts: false,
                hideSmallCountsThreshold: 5,
            },
            residuals: {
                unstandardized: false,
                standardized: false,
                adjustedStandardized: false,
            },
            nonintegerWeights: 'noAdjustment',
        });

        // Clear persisted data
        clearFormData("Crosstabs").catch(console.error);
    };

    // Persist Crosstabs state whenever variables or options change
    useEffect(() => {
        const stateToSave = {
            rowVariables,
            columnVariables,
            options,
        };

        const hasSelections = rowVariables.length > 0 || columnVariables.length > 0;

        if (hasSelections) {
            saveFormData("Crosstabs", stateToSave).catch(console.error);
        } else {
            clearFormData("Crosstabs").catch(console.error);
        }
    }, [rowVariables, columnVariables, options]);

    // Variable list management functions
    const moveToRowVariables = (variable: Variable) => {
        setRowVariables(prev => [...prev, variable]);
        const key = getVarKey(variable);
        setAvailableVariables(prev => prev.filter(v => getVarKey(v) !== key));
        setHighlightedVariable(null);
    };

    const moveToColumnVariables = (variable: Variable) => {
        setColumnVariables(prev => [...prev, variable]);
        const key = getVarKey(variable);
        setAvailableVariables(prev => prev.filter(v => getVarKey(v) !== key));
        setHighlightedVariable(null);
    };

    const moveToAvailableVariables = (variable: Variable, source: 'row' | 'column') => {
        setAvailableVariables(prev => [...prev, variable]);
        const key = getVarKey(variable);
        if (source === 'row') setRowVariables(prev => prev.filter(v => getVarKey(v) !== key));
        else if (source === 'column') setColumnVariables(prev => prev.filter(v => getVarKey(v) !== key));
        setHighlightedVariable(null);
    };

    const reorderVariables = (source: 'available' | 'row' | 'column', variablesArg: Variable[]) => {
        if (source === 'available') setAvailableVariables([...variablesArg]);
        else if (source === 'row') setRowVariables([...variablesArg]);
        else if (source === 'column') setColumnVariables([...variablesArg]);
    };

    return (
        <>
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabType)} className="flex-grow flex flex-col overflow-hidden" data-testid="crosstabs-tabs">
                <div className="border-b border-border flex-shrink-0">
                    <TabsList data-testid="crosstabs-tabs-list">
                        <TabsTrigger value="variables" id="crosstabs-variables-tab-trigger" data-testid="crosstabs-variables-tab">Variables</TabsTrigger>
                        <TabsTrigger value="statistics" id="crosstabs-statistics-tab-trigger" data-testid="crosstabs-statistics-tab">Statistics</TabsTrigger>
                        <TabsTrigger value="cells" id="crosstabs-cells-tab-trigger" data-testid="crosstabs-cells-tab">Cells</TabsTrigger>
                    </TabsList>
                </div>

                <div className="flex-grow overflow-y-auto" data-testid="crosstabs-tab-content">
                    <TabsContent value="variables" data-testid="crosstabs-variables-content">
                        <VariablesTab
                            availableVariables={availableVariables}
                            rowVariables={rowVariables}
                            columnVariables={columnVariables}
                            moveToRowVariables={moveToRowVariables}
                            moveToColumnVariables={moveToColumnVariables}
                            moveToAvailableVariables={moveToAvailableVariables}
                            reorderVariables={reorderVariables}
                            highlightedVariable={highlightedVariable}
                            setHighlightedVariable={setHighlightedVariable}
                            containerType={containerType}
                            tourActive={tourActive}
                            currentStep={currentStep}
                            tourSteps={tourSteps}
                        />
                    </TabsContent>
                    <TabsContent value="statistics" data-testid="crosstabs-statistics-content">
                        <StatisticsTab
                            options={options}
                            setOptions={setOptions}
                            containerType={containerType}
                            tourActive={tourActive}
                            currentStep={currentStep}
                            tourSteps={tourSteps}
                        />
                    </TabsContent>
                    <TabsContent value="cells" data-testid="crosstabs-cells-content">
                        <CellsTab
                            options={options}
                            setOptions={setOptions}
                            rowVariables={rowVariables}
                            columnVariables={columnVariables}
                            containerType={containerType}
                            tourActive={tourActive}
                            currentStep={currentStep}
                            tourSteps={tourSteps}
                        />
                    </TabsContent>
                </div>
            </Tabs>

            {error && <div className="px-6 py-2 text-destructive text-sm whitespace-pre-wrap" data-testid="crosstabs-error-message">{error}</div>}

            <div className="px-6 py-3 border-t border-border flex items-center justify-between bg-secondary flex-shrink-0" data-testid="crosstabs-footer">
                <div className="flex items-center text-muted-foreground cursor-pointer hover:text-primary transition-colors">
                    <Button variant="ghost" size="icon" onClick={startTour} className="h-8 w-8" aria-label="help" data-testid="crosstabs-help-button">
                        <HelpCircle size={18} />
                    </Button>
                </div>
                <div data-testid="crosstabs-action-buttons">
                    <Button
                        variant="outline"
                        className="mr-2"
                        onClick={resetAllStates}
                        disabled={isCalculating}
                        data-testid="crosstabs-reset-button"
                    >
                        Reset
                    </Button>
                    <Button
                        variant="outline"
                        className="mr-2"
                        onClick={onClose}
                        disabled={isCalculating}
                        data-testid="crosstabs-cancel-button"
                    >
                        Cancel
                    </Button>
                    <Button
                        id="crosstabs-ok-button"
                        onClick={runAnalysis}
                        disabled={isCalculating}
                        data-testid="crosstabs-ok-button"
                    >
                        {isCalculating ? "Calculating..." : "OK"}
                    </Button>
                </div>
            </div>

            <AnimatePresence>
                {tourActive && currentTargetElement && (
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
        </>
    );
};

// Main component that handles different container types
const Crosstabs: FC<BaseModalProps> = ({ onClose, containerType = "dialog", ...props }) => {
    // If sidebar mode, use a div container
    if (containerType === "sidebar") {
        return (
            <div className="h-full flex flex-col overflow-hidden bg-popover text-popover-foreground" data-testid="crosstabs-sidebar-container">
                <div className="flex-grow flex flex-col overflow-hidden">
                    <CrosstabsContent onClose={onClose} containerType={containerType} {...props} />
                </div>
            </div>
        );
    }

    // For dialog mode, use DialogContent
    return (
        <DialogContent className="max-w-4xl h-[calc(100vh-8rem)] flex flex-col p-0 bg-popover text-popover-foreground" data-testid="crosstabs-dialog-container">
            <DialogHeader className="px-6 py-4 border-b border-border" data-testid="crosstabs-dialog-header">
                <DialogTitle className="text-xl" data-testid="crosstabs-dialog-title">Crosstabs</DialogTitle>
            </DialogHeader>

            <div className="flex-grow flex flex-col overflow-hidden" data-testid="crosstabs-dialog-content">
                <CrosstabsContent onClose={onClose} containerType={containerType} {...props} />
            </div>
        </DialogContent>
    );
};

export default Crosstabs;
