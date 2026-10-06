"use client";

import type { FC } from "react";
import React, { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useVariableStore } from "@/stores/useVariableStore";
import { useDataStore } from "@/stores/useDataStore";
import type { Variable } from "@/types/Variable";
import { useTimeHook } from "@/components/Modals/Analyze/TimeSeries/TimeSeriesTimeHook";
import { useOptionHook } from "@/components/Modals/Analyze/TimeSeries/ECM/hooks/optionHook";
import { useAnalyzeHook } from "@/components/Modals/Analyze/TimeSeries/ECM/hooks/analyzeHook";
import VariablesTab from "@/components/Modals/Analyze/TimeSeries/ECM/VariablesTab";
import TimeTab from "@/components/Modals/Analyze/TimeSeries/TimeSeriesTimeTab";
import OptionTab from "@/components/Modals/Analyze/TimeSeries/ECM/OptionTab";
import { getFormData, clearFormData } from "@/hooks/useIndexedDB";
import { toast } from "sonner";

interface ECMProps {
    onClose: () => void;
    containerType?: string;
}

const ECM: FC<ECMProps> = ({ onClose, containerType }) => {
    const { variables } = useVariableStore();
    const { data } = useDataStore();
        
    const [availableVariables, setAvailableVariables] = useState<Variable[]>([]);
    const [dependentVariable, setDependentVariable] = useState<Variable[]>([]);
    const [independentVariable, setIndependentVariable] = useState<Variable[]>([]);
    const [highlightedVariable, setHighlightedVariable] = useState<{columnIndex: number, source: string} | null>(null);
    const [activeTab, setActiveTab] = useState("variables");
    const [saveLongRun, setSaveLongRun] = useState(false);
    const [saveShortRun, setSaveShortRun] = useState(false);

    const {
        periods,
        selectedPeriod,
        handleSelectedPeriod,
        inputPeriods,
        resetTime,
    } = useTimeHook();

    const {
        maxLagADF,
        handleMaxLagADF,
        resetOptions,
    } = useOptionHook();

    const { errorMsg: analysisError, isCalculating, handleAnalyzes } = useAnalyzeHook(
        dependentVariable,
        independentVariable,
        data,
        selectedPeriod,
        maxLagADF,
        saveLongRun,
        saveShortRun,
        onClose
    );
    
    const combinedError = analysisError;

    useEffect(() => {
        if (combinedError) {
            toast.error(`Error: ${String(combinedError)}`);
        }
    }, [combinedError]);

    useEffect(() => {
        const loadSavedState = async () => {
            try {
                const savedData = await getFormData("ECM", "variables");
                const filteredVariables = variables.filter(v => v.name !== "");

                if (savedData?.prevDataRef) {
                    if (JSON.stringify(savedData.prevDataRef) !== JSON.stringify(data)) {
                        await clearFormData("ECM");
                        setAvailableVariables(filteredVariables);
                        setDependentVariable([]);
                        setIndependentVariable([]);
                        return;
                    }
                }
                
                // Validate saved variables against current variable list to avoid stale state.
                // A variable is valid if its columnIndex exists in the current variables and
                // the name matches (guards against renamed/replaced variables).
                const isVariableValid = (v: Variable) =>
                    filteredVariables.some(
                        fv => fv.columnIndex === v.columnIndex && fv.name === v.name
                    );

                const savedDependent: Variable[] = (savedData?.dependentVariable ?? []).filter(isVariableValid);
                const savedIndependent: Variable[] = (savedData?.independentVariable ?? []).filter(isVariableValid);

                if (savedDependent.length > 0) {
                    setDependentVariable(savedDependent);
                }
                if (savedIndependent.length > 0) {
                    setIndependentVariable(savedIndependent);
                }
                
                const selectedVars = [...savedDependent, ...savedIndependent];
                const remaining = filteredVariables.filter(
                    v => !selectedVars.some((sv: Variable) => sv.columnIndex === v.columnIndex)
                );
                setAvailableVariables(remaining);
            } catch (error) {
                console.error("Error loading saved state:", error);
                const filteredVariables = variables.filter(v => v.name !== "");
                setAvailableVariables(filteredVariables);
                setDependentVariable([]);
                setIndependentVariable([]);
            }
        };

        loadSavedState();
    }, [variables, data]);

    const handleTabChange = (value: string) => {
        setActiveTab(value);
    };

    const handleOk = () => {
        if (dependentVariable.length === 0 || independentVariable.length === 0) {
            toast.error("Please select both dependent and independent variables");
            return;
        }
        handleAnalyzes();
    };

    const handleReset = async () => {
        const filteredVariables = variables.filter(v => v.name !== "");
        setAvailableVariables(filteredVariables);
        setDependentVariable([]);
        setIndependentVariable([]);
        resetTime();
        resetOptions();
        await clearFormData("ECM");
        toast.success("Form reset successfully");
    };

    return (
        <div className="h-full flex flex-col">
            <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 flex flex-col">
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="variables">Variables</TabsTrigger>
                    <TabsTrigger value="time">Time</TabsTrigger>
                    <TabsTrigger value="options">Options</TabsTrigger>
                    <TabsTrigger value="save">Save</TabsTrigger>
                </TabsList>

                <div className="flex-1 overflow-auto">
                    <TabsContent value="variables" className="h-full">
                        <VariablesTab
                            availableVariables={availableVariables}
                            dependentVariable={dependentVariable}
                            independentVariable={independentVariable}
                            highlightedVariable={highlightedVariable}
                            setAvailableVariables={setAvailableVariables}
                            setDependentVariable={setDependentVariable}
                            setIndependentVariable={setIndependentVariable}
                            setHighlightedVariable={setHighlightedVariable}
                            containerType={containerType}
                            data={data}
                        />
                    </TabsContent>

                    <TabsContent value="time" className="h-full">
                        <TimeTab
                            periods={periods}
                            selectedPeriod={selectedPeriod}
                            handleSelectedPeriod={handleSelectedPeriod}
                            inputPeriods={inputPeriods}
                        />
                    </TabsContent>

                    <TabsContent value="options" className="h-full">
                        <OptionTab
                            maxLagADF={maxLagADF}
                            handleMaxLagADF={handleMaxLagADF}
                        />
                    </TabsContent>

                    <TabsContent value="save" className="h-full">
                        <div className="space-y-6 p-6">
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-foreground">Save Analysis Residuals</h3>
                                <p className="text-xs text-muted-foreground">
                                    Choose the residuals series you want to save back to the active dataset columns.
                                </p>
                                
                                <div className="space-y-4 pt-2">
                                    <div className="flex items-start space-x-3">
                                        <Checkbox
                                            id="saveLongRun"
                                            checked={saveLongRun}
                                            onCheckedChange={(checked) => setSaveLongRun(!!checked)}
                                        />
                                        <div className="grid gap-1.5 leading-none">
                                            <label htmlFor="saveLongRun" className="text-sm font-medium leading-none cursor-pointer">
                                                Long-Run Equation Residuals (RES_LR)
                                            </label>
                                            <p className="text-xs text-muted-foreground">
                                                Residuals from the long-run cointegration relationship (equilibrium error).
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-start space-x-3">
                                        <Checkbox
                                            id="saveShortRun"
                                            checked={saveShortRun}
                                            onCheckedChange={(checked) => setSaveShortRun(!!checked)}
                                        />
                                        <div className="grid gap-1.5 leading-none">
                                            <label htmlFor="saveShortRun" className="text-sm font-medium leading-none cursor-pointer">
                                                Short-Run ECM Residuals (RES_SR)
                                            </label>
                                            <p className="text-xs text-muted-foreground">
                                                Residuals from the short-run dynamic error correction model.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </TabsContent>
                </div>
            </Tabs>

            <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={handleReset}>
                    Reset
                </Button>
                <Button variant="outline" onClick={onClose}>
                    Cancel
                </Button>
                <Button 
                    onClick={handleOk} 
                    disabled={isCalculating || dependentVariable.length === 0 || independentVariable.length === 0}
                >
                    {isCalculating ? "Calculating..." : "OK"}
                </Button>
            </div>
        </div>
    );
};

export default ECM;
