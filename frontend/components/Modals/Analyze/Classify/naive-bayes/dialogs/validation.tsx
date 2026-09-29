"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { NaiveBayesValidationType } from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";

type ValidationTabProps = {
    data: NaiveBayesValidationType;
    updateFormData: (field: keyof NaiveBayesValidationType, value: string | number | null) => void;
};

export const ValidationTab = ({ data, updateFormData }: ValidationTabProps) => {
    const [validationState, setValidationState] = useState<NaiveBayesValidationType>({ ...data });
    const [useSeed, setUseSeed] = useState(data.RandomSeed !== null);

    useEffect(() => {
        setValidationState({ ...data });
        setUseSeed(data.RandomSeed !== null);
    }, [data]);

    const handleMethodChange = useCallback(
        (value: string) => {
            const method = value as "holdout" | "kfold";
            setValidationState((prev) => ({ ...prev, ValidationMethod: method }));
            updateFormData("ValidationMethod", method);
        },
        [updateFormData]
    );

    const handleTrainingPercentChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const value = Number(e.target.value);
            setValidationState((prev) => ({ ...prev, TrainingPercentage: value }));
            updateFormData("TrainingPercentage", value);
        },
        [updateFormData]
    );

    const handleKFoldsChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const value = Number(e.target.value);
            setValidationState((prev) => ({ ...prev, KFolds: value }));
            updateFormData("KFolds", value);
        },
        [updateFormData]
    );

    const handleSeedToggle = useCallback(
        (checked: boolean) => {
            setUseSeed(checked);
            if (!checked) {
                setValidationState((prev) => ({ ...prev, RandomSeed: null }));
                updateFormData("RandomSeed", null);
            } else {
                const defaultSeed = 2000000;
                setValidationState((prev) => ({ ...prev, RandomSeed: defaultSeed }));
                updateFormData("RandomSeed", defaultSeed);
            }
        },
        [updateFormData]
    );

    const handleSeedChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const value = Number(e.target.value);
            setValidationState((prev) => ({ ...prev, RandomSeed: value }));
            updateFormData("RandomSeed", value);
        },
        [updateFormData]
    );

    const isHoldout = validationState.ValidationMethod === "holdout";
    const isKFold = validationState.ValidationMethod === "kfold";

    return (
        <div className="flex flex-col gap-4">
            {/* Method Selection */}
            <section className="rounded-lg border p-4">
                <Label className="mb-3 block font-semibold">Validation Method</Label>
                <RadioGroup
                    value={validationState.ValidationMethod}
                    onValueChange={handleMethodChange}
                    className="flex flex-col gap-2"
                >
                    <div className="flex items-center space-x-2">
                        <RadioGroupItem value="holdout" id="holdout" />
                        <Label htmlFor="holdout">Training and Holdout Partition</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                        <RadioGroupItem value="kfold" id="kfold" />
                        <Label htmlFor="kfold">Cross-Validation Folds</Label>
                    </div>
                </RadioGroup>
            </section>

            {/* Holdout Settings */}
            <section className={`rounded-lg border p-4 ${!isHoldout ? "opacity-50" : ""}`}>
                <Label className="mb-3 block font-semibold">Holdout Settings</Label>
                <div className="flex items-center gap-2">
                    <Label htmlFor="training-percent" className="w-[140px]">
                        Training Percentage:
                    </Label>
                    <Input
                        id="training-percent"
                        type="number"
                        min={1}
                        max={99}
                        className="w-[80px]"
                        value={isHoldout ? (validationState.TrainingPercentage ?? "") : ""}
                        disabled={!isHoldout}
                        onChange={handleTrainingPercentChange}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                </div>
                {/* Read-only, diturunkan otomatis (AGENTS.md §4.2) - diperbaiki
                    Fase 18 Temuan 1: sebelumnya field ini tidak ada sama sekali,
                    dan input di atas malah diam-diam dipakai sebagai holdout%. */}
                <div className="mt-2 flex items-center gap-2">
                    <Label htmlFor="holdout-percent-readonly" className="w-[140px]">
                        Holdout Percentage:
                    </Label>
                    <Input
                        id="holdout-percent-readonly"
                        type="number"
                        className="w-[80px] bg-muted"
                        value={
                            isHoldout && Number.isFinite(validationState.TrainingPercentage)
                                ? 100 - validationState.TrainingPercentage
                                : ""
                        }
                        disabled
                        readOnly
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                </div>
            </section>

            {/* K-Fold Settings */}
            <section className={`rounded-lg border p-4 ${!isKFold ? "opacity-50" : ""}`}>
                <Label className="mb-3 block font-semibold">Cross-Validation Settings</Label>
                <div className="flex items-center gap-2">
                    <Label htmlFor="k-folds" className="w-[140px]">
                        Number of Folds:
                    </Label>
                    <Input
                        id="k-folds"
                        type="number"
                        min={2}
                        max={25}
                        className="w-[80px]"
                        value={isKFold ? (validationState.KFolds ?? "") : ""}
                        disabled={!isKFold}
                        onChange={handleKFoldsChange}
                    />
                </div>
            </section>

            {/* Random Seed */}
            <section className="rounded-lg border p-4">
                <div className="flex items-center space-x-2">
                    <Checkbox
                        id="use-seed"
                        checked={useSeed}
                        onCheckedChange={handleSeedToggle}
                    />
                    <Label htmlFor="use-seed">Use random seed</Label>
                </div>
                <div className="mt-3 flex items-center gap-2 pl-6">
                    <Label htmlFor="random-seed" className="w-[140px]">
                        Seed:
                    </Label>
                    <Input
                        id="random-seed"
                        type="number"
                        min={0}
                        className="w-[120px]"
                        value={useSeed ? (validationState.RandomSeed ?? "") : ""}
                        disabled={!useSeed}
                        onChange={handleSeedChange}
                    />
                </div>
            </section>
        </div>
    );
};

export default ValidationTab;
