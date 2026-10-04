import type { FC } from "react";
import React from "react";
import type { ChiSquareTestPurpose, StatisticsTabProps } from "./types";
import ChiSquareOptions from "./components/ChiSquareOptions";

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
    const chiSquarePurpose = options.statistics?.purpose ?? 'independence';

    const handleChiSquareChange = (checked: boolean) => {
        setOptions(prev => ({
            ...prev,
            statistics: {
                ...(prev.statistics ?? { chiSquare: false }),
                chiSquare: checked,
                purpose: prev.statistics?.purpose ?? 'independence',
            }
        }));
    };

    const handlePurposeChange = (purpose: ChiSquareTestPurpose) => {
        setOptions(prev => ({
            ...prev,
            statistics: {
                ...(prev.statistics ?? { chiSquare: true }),
                purpose,
            },
        }));
    };

    return (
        <div className="p-6 space-y-6" data-testid="crosstabs-statistics-tab-content">
            <ChiSquareOptions
                checked={chiSquareChecked}
                onCheckedChange={handleChiSquareChange}
                purpose={chiSquarePurpose}
                onPurposeChange={handlePurposeChange}
                highlighted={tourActive && currentStep === chiSquareStep}
            />
        </div>
    );
};

export default StatisticsTab;
