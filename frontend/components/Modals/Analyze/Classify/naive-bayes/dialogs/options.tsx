"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
    NaiveBayesNumericLikelihood,
    NaiveBayesOptionsType,
    NaiveBayesTextLikelihood,
} from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";

/** Nilai yang boleh dikirim ke `updateFormData` (v2 menambah objek override per variabel). */
export type NaiveBayesOptionsValue =
    | number
    | string
    | Record<string, NaiveBayesNumericLikelihood>;

type OptionsTabProps = {
    data: NaiveBayesOptionsType;
    updateFormData: (field: keyof NaiveBayesOptionsType, value: NaiveBayesOptionsValue) => void;
    /** v2 (AGENTS_V2 §3.6): nama variabel Numeric efektif untuk tabel override. */
    numericVariables?: string[];
    /** v2: true bila Text Features terisi (blok Text aktif). */
    hasTextFeatures?: boolean;
    /** v2: true bila ada predictor Numeric/Categorical efektif (Complement dinonaktifkan). */
    hasOtherPredictors?: boolean;
};

// Bila variabel Numeric lebih banyak dari ini, tabel override menampilkan kotak filter (§3.6).
export const OVERRIDE_FILTER_THRESHOLD = 50;

const GROUP_DEFAULT = "default";

const NUMERIC_LIKELIHOOD_LABELS: Record<NaiveBayesNumericLikelihood, string> = {
    gaussian: "Gaussian",
    gaussian_minstd: "Gaussian (Weka min. std)",
};

const TEXT_LIKELIHOOD_LABELS: Record<NaiveBayesTextLikelihood, string> = {
    multinomial: "Multinomial",
    bernoulli: "Bernoulli",
    complement: "Complement",
};

const COMPLEMENT_DISABLED_REASON =
    "Complement is only available when the model contains Text Features only (no numeric or categorical variables).";

/** Mengembalikan `value` bila termasuk `allowed`, selain itu undefined (pengganti cast). */
function pickAllowed<T extends string>(allowed: readonly T[], value: string): T | undefined {
    return allowed.find((a) => a === value);
}

const NUMERIC_LIKELIHOODS: readonly NaiveBayesNumericLikelihood[] = ["gaussian", "gaussian_minstd"];
const TEXT_LIKELIHOODS: readonly NaiveBayesTextLikelihood[] = ["multinomial", "bernoulli", "complement"];

/**
 * Membuang override yang menunjuk variabel yang tidak lagi Numeric efektif
 * (AGENTS_V2 §3.6). Fungsi murni; mengembalikan objek yang SAMA bila tidak ada
 * yang dibuang supaya pemanggil bisa membandingkan referensi.
 */
export function pruneNumericOverrides(
    overrides: Record<string, NaiveBayesNumericLikelihood> | undefined,
    numericVariables: readonly string[]
): Record<string, NaiveBayesNumericLikelihood> {
    const current = overrides ?? {};
    const allowed = new Set(numericVariables);
    const keys = Object.keys(current);
    if (keys.every((key) => allowed.has(key))) return current;
    const next: Record<string, NaiveBayesNumericLikelihood> = {};
    for (const key of keys) {
        if (allowed.has(key)) next[key] = current[key];
    }
    return next;
}

export const OptionsTab = ({
    data,
    updateFormData,
    numericVariables = [],
    hasTextFeatures = false,
    hasOtherPredictors = false,
}: OptionsTabProps) => {
    const [optionsState, setOptionsState] = useState<NaiveBayesOptionsType>({ ...data });
    const [error, setError] = useState<string | null>(null);
    const [textAlphaError, setTextAlphaError] = useState<string | null>(null);
    const [overrideFilter, setOverrideFilter] = useState("");

    useEffect(() => {
        setOptionsState({ ...data });
    }, [data]);

    const validateAlpha = useCallback((value: number): string | null => {
        if (value <= 0) return "Smoothing Alpha must be greater than 0";
        if (value > 999) return "Smoothing Alpha must not exceed 999";
        return null;
    }, []);

    const validateTextAlpha = useCallback((value: number): string | null => {
        if (!Number.isFinite(value) || value <= 0) return "Text Alpha must be greater than 0";
        if (value > 999) return "Text Alpha must not exceed 999";
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

    const handleTextAlphaChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const numValue = Number(e.target.value);

            setOptionsState((prev) => ({ ...prev, TextAlpha: numValue }));

            const validationError = validateTextAlpha(numValue);
            setTextAlphaError(validationError);

            if (!validationError) {
                updateFormData("TextAlpha", numValue);
            }
        },
        [updateFormData, validateTextAlpha]
    );

    const overrides = useMemo(
        () => optionsState.NumericLikelihoodOverrides ?? {},
        [optionsState.NumericLikelihoodOverrides]
    );

    const handleOverrideChange = useCallback(
        (variable: string, value: string) => {
            const next = { ...overrides };
            const picked = pickAllowed(NUMERIC_LIKELIHOODS, value);
            if (picked === undefined) {
                // "Group default": hapus override agar variabel mengikuti default kelompok.
                delete next[variable];
            } else {
                next[variable] = picked;
            }
            updateFormData("NumericLikelihoodOverrides", next);
        },
        [overrides, updateFormData]
    );

    const filteredNumericVariables = useMemo(() => {
        const keyword = overrideFilter.trim().toLowerCase();
        if (!keyword) return numericVariables;
        return numericVariables.filter((name) => name.toLowerCase().includes(keyword));
    }, [numericVariables, overrideFilter]);

    const showOverrideFilter = numericVariables.length > OVERRIDE_FILTER_THRESHOLD;
    const textLikelihood = optionsState.TextLikelihood ?? "multinomial";
    const complementDisabled = hasOtherPredictors;
    // Pilihan tersimpan "complement" tetapi kini ada predictor lain: tampilkan galat (OK diblokir validasi).
    const complementConflict = hasTextFeatures && textLikelihood === "complement" && hasOtherPredictors;

    return (
        <TooltipProvider delayDuration={100}>
            <div className="flex flex-col gap-4">
                {/* Blok Numeric (AGENTS_V2 §3.6) */}
                <section className="rounded-lg border p-4" aria-label="Numeric likelihood">
                    <div className="flex flex-col gap-3">
                        <Label className="font-semibold">Numeric</Label>
                        <p className="text-sm text-muted-foreground">
                            Default likelihood for all numeric variables (Covariates). You can change it for
                            individual variables in the table below.
                        </p>
                        <RadioGroup
                            value={optionsState.NumericLikelihood ?? "gaussian"}
                            onValueChange={(value) => {
                                const picked = pickAllowed(NUMERIC_LIKELIHOODS, value);
                                if (picked !== undefined) updateFormData("NumericLikelihood", picked);
                            }}
                            className="flex flex-col gap-2"
                        >
                            {NUMERIC_LIKELIHOODS.map((value) => (
                                <div key={value} className="flex items-center space-x-2">
                                    <RadioGroupItem value={value} id={`numeric-likelihood-${value}`} />
                                    <Label
                                        htmlFor={`numeric-likelihood-${value}`}
                                        className="cursor-pointer text-sm font-normal"
                                    >
                                        {NUMERIC_LIKELIHOOD_LABELS[value]}
                                    </Label>
                                </div>
                            ))}
                        </RadioGroup>

                        {numericVariables.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                There are no numeric variables in the current model.
                            </p>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {showOverrideFilter && (
                                    <Input
                                        type="text"
                                        placeholder="Filter variables..."
                                        aria-label="Filter numeric variables"
                                        className="w-[240px]"
                                        value={overrideFilter}
                                        onChange={(e) => setOverrideFilter(e.target.value)}
                                    />
                                )}
                                <div className="max-h-64 overflow-auto rounded-md border">
                                    <table className="w-full text-sm">
                                        <thead className="sticky top-0 bg-muted">
                                            <tr>
                                                <th className="px-3 py-2 text-left font-medium">Variable</th>
                                                <th className="px-3 py-2 text-left font-medium">Likelihood</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredNumericVariables.map((name) => (
                                                <tr key={name} className="border-t">
                                                    <td className="px-3 py-1.5">{name}</td>
                                                    <td className="px-3 py-1.5">
                                                        <select
                                                            aria-label={`Likelihood for ${name}`}
                                                            className="h-8 rounded-md border bg-background px-2 text-sm"
                                                            value={overrides[name] ?? GROUP_DEFAULT}
                                                            onChange={(e) =>
                                                                handleOverrideChange(name, e.target.value)
                                                            }
                                                        >
                                                            <option value={GROUP_DEFAULT}>Group default</option>
                                                            {NUMERIC_LIKELIHOODS.map((value) => (
                                                                <option key={value} value={value}>
                                                                    {NUMERIC_LIKELIHOOD_LABELS[value]}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                </section>

                {/* Blok Categorical (field v1 SmoothingAlpha dipertahankan) */}
                <section className="rounded-lg border p-4" aria-label="Categorical likelihood">
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                            <p className="text-sm font-semibold">Categorical</p>
                            <p className="text-sm text-muted-foreground">Likelihood: Categorical</p>
                            <Label htmlFor="smoothing-alpha" className="font-semibold">
                                Smoothing Alpha
                            </Label>
                            <p className="text-sm text-muted-foreground">
                                Laplace smoothing for categorical probabilities. Accepted values are above 0, up
                                to 999.
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
                            {error && <p className="text-sm text-destructive">{error}</p>}
                        </div>
                    </div>
                </section>

                {/* Blok Text (aktif bila Text Features terisi) */}
                <section
                    className={`rounded-lg border p-4 ${hasTextFeatures ? "" : "opacity-60"}`}
                    aria-label="Text likelihood"
                >
                    <div className="flex flex-col gap-3">
                        <Label className="font-semibold">Text</Label>
                        {!hasTextFeatures && (
                            <p className="text-sm text-muted-foreground">
                                Available when a Raw Text Variable or Word-Vector Variables are set on the Variables tab.
                            </p>
                        )}
                        <RadioGroup
                            value={textLikelihood}
                            disabled={!hasTextFeatures}
                            onValueChange={(value) => {
                                const picked = pickAllowed(TEXT_LIKELIHOODS, value);
                                if (picked !== undefined) updateFormData("TextLikelihood", picked);
                            }}
                            className="flex flex-col gap-2"
                        >
                            {TEXT_LIKELIHOODS.map((value) => {
                                const isComplement = value === "complement";
                                const disabled = !hasTextFeatures || (isComplement && complementDisabled);
                                const item = (
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem
                                            value={value}
                                            id={`text-likelihood-${value}`}
                                            disabled={disabled}
                                        />
                                        <Label
                                            htmlFor={`text-likelihood-${value}`}
                                            className={`text-sm font-normal ${disabled ? "" : "cursor-pointer"}`}
                                        >
                                            {TEXT_LIKELIHOOD_LABELS[value]}
                                        </Label>
                                    </div>
                                );
                                if (isComplement && hasTextFeatures && complementDisabled) {
                                    return (
                                        <Tooltip key={value}>
                                            <TooltipTrigger asChild>
                                                <span tabIndex={0} className="w-fit">
                                                    {item}
                                                </span>
                                            </TooltipTrigger>
                                            <TooltipContent>{COMPLEMENT_DISABLED_REASON}</TooltipContent>
                                        </Tooltip>
                                    );
                                }
                                return <React.Fragment key={value}>{item}</React.Fragment>;
                            })}
                        </RadioGroup>
                        {hasTextFeatures && complementDisabled && (
                            <p className="text-xs text-muted-foreground">{COMPLEMENT_DISABLED_REASON}</p>
                        )}
                        {complementConflict && (
                            <p className="text-sm text-destructive" role="alert">
                                Complement is selected, but the model also contains numeric or categorical variables.
                                Choose Multinomial or Bernoulli.
                            </p>
                        )}

                        <div className="flex flex-col gap-2">
                            <Label htmlFor="text-alpha" className="font-semibold">
                                Text Alpha (smoothing)
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                Smoothing parameter for the text likelihood. Accepted values are above 0, up to
                                999.
                            </p>
                            <Input
                                id="text-alpha"
                                type="number"
                                min={0.01}
                                max={999}
                                step={0.1}
                                className="w-[120px]"
                                disabled={!hasTextFeatures}
                                value={optionsState.TextAlpha ?? ""}
                                onChange={handleTextAlphaChange}
                            />
                            {textAlphaError && <p className="text-sm text-destructive">{textAlphaError}</p>}
                        </div>
                    </div>
                </section>
            </div>
        </TooltipProvider>
    );
};

export default OptionsTab;
