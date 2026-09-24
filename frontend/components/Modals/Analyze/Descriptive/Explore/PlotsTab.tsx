"use client";
import type { FC } from "react";
import React from "react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { PlotsTabProps } from "./types";
import NormalityOptions from "./components/NormalityOptions";

const PlotsTab: FC<PlotsTabProps> = ({
    boxplotType,
    setBoxplotType,
    showStemAndLeaf,
    setShowStemAndLeaf,
    showHistogram,
    setShowHistogram,
    showNormalityPlots,
    setShowNormalityPlots,
    factorVariablesCount: _factorVariablesCount,
    tourActive: _tourActive = false,
    currentStep: _currentStep = 0,
    tourSteps: _tourSteps = [],
}) => {

    // Silence unused prop warnings
    void _factorVariablesCount;
    void _tourActive;
    void _currentStep;
    void _tourSteps;

    // Boxplot options are always enabled; user can configure before selecting variables.

    return (
        <div data-testid="explore-plots-tab-content" className="space-y-6">
            <div data-testid="explore-boxplots-section" className="p-4 border rounded-md">
                <Label className="text-base font-medium">Boxplots</Label>
                <RadioGroup
                    data-testid="explore-boxplot-radio-group"
                    value={boxplotType}
                    onValueChange={(value) => {

                        setBoxplotType(value as 'none' | 'dependents-together' | 'factor-levels-together' | 'dependents-separately');
                    }}
                    className="mt-2 space-y-1"
                >
                    <div className="flex items-center space-x-2">
                        <RadioGroupItem data-testid="explore-boxplot-none" value="none" id="none" />
                        <Label htmlFor="none" className="font-normal">None</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                        <RadioGroupItem data-testid="explore-boxplot-factor-levels" value="factor-levels-together" id="factor-levels" />
                        <Label htmlFor="factor-levels" className="font-normal">Factor levels together</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                        <RadioGroupItem data-testid="explore-boxplot-dependents" value="dependents-together" id="dependents" />
                        <Label htmlFor="dependents" className="font-normal">Dependents together</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                        <RadioGroupItem data-testid="explore-boxplot-dependents-separately" value="dependents-separately" id="dependents-separately" />
                        <Label htmlFor="dependents-separately" className="font-normal">Dependents separately</Label>
                    </div>
                </RadioGroup>
                {/* Info text removed so user can preconfigure before variable selection */}
            </div>

            <div data-testid="explore-descriptives-plots-section" className="p-4 border rounded-md space-y-3">
                <Label className="text-base font-medium">Descriptives</Label>
                <div className="flex items-center space-x-2">
                    <Checkbox
                        id="stem-and-leaf"
                        data-testid="explore-stem-and-leaf-checkbox"
                        checked={showStemAndLeaf}
                        onCheckedChange={(checked) => {

                            setShowStemAndLeaf(checked as boolean);
                        }}
                    />
                    <Label htmlFor="stem-and-leaf" className="font-normal">Stem-and-leaf</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox
                        id="histogram"
                        data-testid="explore-histogram-checkbox"
                        checked={showHistogram}
                        onCheckedChange={(checked) => {

                            setShowHistogram(checked as boolean);
                        }}
                    />
                    <Label htmlFor="histogram" className="font-normal">Histogram</Label>
                </div>
            </div>
            <NormalityOptions checked={showNormalityPlots} onCheckedChange={setShowNormalityPlots} />
        </div>
    );
};

export default PlotsTab;
