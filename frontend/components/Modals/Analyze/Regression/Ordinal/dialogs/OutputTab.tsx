import React from "react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { OrdinalOutputParams } from "../types/ordinal";

interface Props { params: OrdinalOutputParams, onChange: (params: Partial<OrdinalOutputParams>) => void; }
export const OutputTab: React.FC<Props> = ({ params, onChange }) => {
    const handleDisplayChange = (key: keyof typeof params.display, checked: boolean) => {
        onChange({ display: { ...params.display, [key]: checked } });
    };
    const handleSavedChange = (key: keyof typeof params.savedVariables, checked: boolean) => {
        onChange({ savedVariables: { ...params.savedVariables, [key]: checked } });
    };
    const iterationHistoryEnabled = Boolean(
        params.display.printIterationHistory ?? params.display.iterationHistory
    );
    const iterationHistoryEvery = Number(
        params.display.iterationHistoryEvery ?? params.display.iterationHistoryStep ?? 1
    );

    const handleIterationHistoryToggle = (checked: boolean) => {
        onChange({
            display: {
                ...params.display,
                printIterationHistory: checked,
                iterationHistory: checked,
            },
        });
    };

    const handleIterationHistoryEveryChange = (value: string) => {
        const parsed = Number(value);
        const safeValue = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
        onChange({
            display: {
                ...params.display,
                iterationHistoryEvery: safeValue,
                iterationHistoryStep: safeValue,
            },
        });
    };
    return (
        <div className="grid grid-cols-2 gap-8 py-4 h-full overflow-y-auto">
            <div className="space-y-6">
                <h4 className="font-semibold text-sm border-b pb-1 mb-2">
                    Display
                </h4>
                <div className="flex items-center space-x-2">
                    <Checkbox id="gof" checked={params.display.goodnessOfFit} onCheckedChange={(c) => handleDisplayChange('goodnessOfFit', !!c)} />
                    <Label htmlFor="gof">Goodness of fit statistics</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox id="sum" checked={params.display.summaryStatistics} onCheckedChange={(c) => handleDisplayChange('summaryStatistics', !!c)} />
                    <Label htmlFor="sum">Summary statistics</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox id="param" checked={params.display.parameterEstimates} onCheckedChange={(c) => handleDisplayChange('parameterEstimates', !!c)} />
                    <Label htmlFor="param">Parameter estimates</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox id="asymptotic-covariance" checked={params.display.asymptoticCovariance} onCheckedChange={(c) => handleDisplayChange('asymptoticCovariance', !!c)} />
                    <Label htmlFor="asymptotic-covariance">Asymptotic covariances of parameter estimates</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox id="asymptotic-correlation" checked={params.display.asymptoticCorrelation} onCheckedChange={(c) => handleDisplayChange('asymptoticCorrelation', !!c)} />
                    <Label htmlFor="asymptotic-correlation">Asymptotic correlations of parameter estimates</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox id="parallel" checked={params.display.testOfParallelLines} onCheckedChange={(c) => handleDisplayChange('testOfParallelLines', !!c)} />
                    <Label htmlFor="parallel">Test of parallel lines</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox
                        id="iteration-history"
                        checked={iterationHistoryEnabled}
                        onCheckedChange={(c) => handleIterationHistoryToggle(!!c)}
                    />
                    <Label htmlFor="iteration-history">Print iteration history for every</Label>
                    <Input
                        type="number"
                        min={1}
                        value={Number.isFinite(iterationHistoryEvery) ? iterationHistoryEvery : 1}
                        onChange={(event) => handleIterationHistoryEveryChange(event.target.value)}
                        disabled={!iterationHistoryEnabled}
                        className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">step</span>
                </div>
            </div>
            <div className="space-y-6">
                <h4 className="font-semibold text-sm border-b pb-1 mb-2">
                    Saved Variables
                </h4>
                <div className="flex items-center space-x-2">
                    <Checkbox id="predRespCat" checked={params.savedVariables.predictedResponseCategory} onCheckedChange={(c) => handleSavedChange('predictedResponseCategory', !!c)} />
                    <Label htmlFor="predRespCat">Predicted response category</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox id="estRespProb" checked={params.savedVariables.estimatedResponseProbabilities} onCheckedChange={(c) => handleSavedChange('estimatedResponseProbabilities', !!c)} />
                    <Label htmlFor="estRespProb">Estimated response probabilities</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox id="predProb" checked={params.savedVariables.predictedCategoryProbability} onCheckedChange={(c) => handleSavedChange('predictedCategoryProbability', !!c)} />
                    <Label htmlFor="predProb">Predicted category probability</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox id="actProb" checked={params.savedVariables.actualCategoryProbability} onCheckedChange={(c) => handleSavedChange('actualCategoryProbability', !!c)} />
                    <Label htmlFor="actProb">Actual category probability</Label>
                </div>
                <h4 className="font-semibold text-sm border-b pb-1 mb-2">
                    Print Log-Likelihood
                </h4>
                <div className="flex items-center space-x-2">
                    <RadioGroup value={params.printLogLikelihood} onValueChange={(value: any) => onChange({ printLogLikelihood: value })}>
                        <div className="flex items-center space-x-2"><RadioGroupItem value="Including" id="including" /><Label htmlFor="including">Including multinomial constant</Label></div>
                        <div className="flex items-center space-x-2"><RadioGroupItem value="Excluding" id="excluding" /><Label htmlFor="excluding">Excluding multinomial constant</Label></div>
                    </RadioGroup>
                </div>
            </div>
        </div>
    );
};
