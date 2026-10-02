import type { FC } from "react";
import React from "react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ActiveElementHighlight } from "@/components/Common/TourComponents";
import type { BartlettTestOptions, TourStep } from "../types";

interface OptionsTabProps {
    options: BartlettTestOptions;
    updateOption: <K extends keyof BartlettTestOptions>(
        key: K,
        value: BartlettTestOptions[K]
    ) => void;
    tourActive?: boolean;
    currentStep?: number;
    tourSteps?: TourStep[];
}

const OptionsTab: FC<OptionsTabProps> = ({
    options,
    updateOption,
    tourActive = false,
    currentStep = 0,
    tourSteps = [],
}) => {
    return (
        <div className="space-y-6 p-4">
            <div id="statistics-section" className="space-y-4 relative">
                <h3 className="text-sm font-semibold">Statistics</h3>
                <div className="space-y-2 pl-4">
                    <div className="flex items-center">
                        <Checkbox
                            id="include-descriptives"
                            checked={options.includeDescriptives}
                            onCheckedChange={(checked) =>
                                updateOption('includeDescriptives', !!checked)
                            }
                            className="mr-2"
                        />
                        <Label htmlFor="include-descriptives" className="text-sm cursor-pointer">
                            Descriptive statistics
                        </Label>
                    </div>
                </div>
                <ActiveElementHighlight active={tourActive && currentStep === tourSteps.findIndex(step => step.targetId === 'statistics-section')} />
            </div>

            <div id="confidence-level-section" className="p-4 bg-muted/30 rounded-md border relative">
                <h4 className="text-sm font-semibold mb-2">Tentang Uji Homogenitas Bartlett</h4>
                <p className="text-xs text-muted-foreground">
                    Uji Homogenitas Varians Bartlett mengevaluasi kesamaan varians antar kelompok menggunakan distribusi chi-square.
                    Uji ini umum digunakan sebagai pemeriksaan prasyarat sebelum melakukan ANOVA atau uji parametrik lain yang mengasumsikan kesamaan varians.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                    <strong>Hipotesis Nol (H₀):</strong> Semua varians kelompok sama (homogen).
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                    <strong>Hipotesis Alternatif (H₁):</strong> Setidaknya terdapat dua kelompok yang memiliki varians berbeda.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                    Hasil yang signifikan (p &lt; 0,05) menunjukkan bahwa asumsi kesamaan varians tidak terpenuhi.
                </p>
                <p className="text-xs text-muted-foreground mt-2 italic">
                    <strong>Catatan:</strong> Uji ini sensitif terhadap penyimpangan dari normalitas. Untuk data yang tidak berdistribusi normal, pertimbangkan menggunakan Uji Levene.
                </p>
                <ActiveElementHighlight active={tourActive && currentStep === tourSteps.findIndex(step => step.targetId === 'confidence-level-section')} />
            </div>
        </div>
    );
};

export default OptionsTab;
