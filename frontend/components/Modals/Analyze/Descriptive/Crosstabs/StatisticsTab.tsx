import type { FC } from "react";
import React from "react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { StatisticsTabProps } from "./types";
import { ActiveElementHighlight } from "@/components/Common/TourComponents";
import { InfoIcon } from "lucide-react";

const StatisticsTab: FC<StatisticsTabProps> = ({
    options,
    setOptions,
    tourActive = false,
    currentStep = 0,
    tourSteps = [],
}) => {
    const getStepIndex = (targetId: string) => tourSteps.findIndex(step => step.targetId === targetId);
    const chiSquareStep = getStepIndex('crosstabs-statistics-chi-square-section');

    const chiSquareChecked = options.statistics?.chiSquare ?? false;

    const handleChiSquareChange = (checked: boolean) => {
        setOptions(prev => ({
            ...prev,
            statistics: {
                ...(prev.statistics || { chiSquare: false }),
                chiSquare: checked,
            }
        }));
    };

    return (
        <div className="p-6 space-y-6" data-testid="crosstabs-statistics-tab-content">
            <div
                id="crosstabs-statistics-chi-square-section"
                className="bg-card border border-border rounded-md p-4 relative"
                data-testid="crosstabs-statistics-chi-square-section"
            >
                <div className="flex items-center gap-1 mb-3">
                    <div className="text-sm font-medium">Chi-Square</div>
                    <TooltipProvider delayDuration={100}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="Informasi penggunaan Chi-Square"
                                    className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                                >
                                    <InfoIcon className="h-4 w-4" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs text-xs">
                                Uji asosiasi untuk proporsi lebih dari dua populasi (binomial/multinomial) melalui tabel kontingensi.
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <div className="space-y-2">
                    <div className="flex items-center">
                        <Checkbox
                            id="pearsonChiSquare"
                            checked={chiSquareChecked}
                            onCheckedChange={(checked) => handleChiSquareChange(!!checked)}
                            className="mr-2"
                            data-testid="crosstabs-chi-square-checkbox"
                        />
                        <Label htmlFor="pearsonChiSquare" className="text-sm cursor-pointer">
                            Pearson Chi-Square
                        </Label>
                    </div>
                </div>
                <ActiveElementHighlight active={tourActive && currentStep === chiSquareStep} />
            </div>
        </div>
    );
};

export default StatisticsTab;
