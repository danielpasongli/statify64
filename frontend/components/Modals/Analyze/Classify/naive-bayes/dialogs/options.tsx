"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { NaiveBayesOptionsType } from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";

type OptionsTabProps = {
    data: NaiveBayesOptionsType;
    updateFormData: (field: keyof NaiveBayesOptionsType, value: number | string) => void;
};

export const OptionsTab = ({ data, updateFormData }: OptionsTabProps) => {
    const [optionsState, setOptionsState] = useState<NaiveBayesOptionsType>({ ...data });
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setOptionsState({ ...data });
    }, [data]);

    const validateAlpha = useCallback((value: number): string | null => {
        if (value <= 0) return "Smoothing Alpha harus > 0";
        if (value > 999) return "Smoothing Alpha maksimum 999";
        return null;
    }, []);

    const handleAlphaChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const rawValue = e.target.value;
            const numValue = Number(rawValue);

            setOptionsState((prev) => ({ ...prev, SmoothingAlpha: numValue }));

            const validationError = validateAlpha(numValue);
            setError(validationError);

            if (!validationError) {
                updateFormData("SmoothingAlpha", numValue);
            }
        },
        [updateFormData, validateAlpha]
    );

    return (
        <section className="rounded-lg border p-4">
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <Label htmlFor="smoothing-alpha" className="font-semibold">
                        Smoothing Alpha
                    </Label>
                    <p className="text-sm text-muted-foreground">
                        Laplace smoothing parameter untuk probabilitas kategorik. Nilai harus lebih besar dari 0 dan maksimum 999.
                    </p>
                    <div className="flex items-center gap-2">
                        <Input
                            id="smoothing-alpha"
                            type="number"
                            min={0.01}
                            max={999}
                            step={0.1}
                            className="w-[120px]"
                            value={optionsState.SmoothingAlpha ?? ""}
                            onChange={handleAlphaChange}
                        />
                    </div>
                    {error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}
                </div>
            </div>
        </section>
    );
};

export default OptionsTab;
