"use client";

import React from "react";
import type { CheckedState } from "@radix-ui/react-checkbox";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { NaiveBayesOutputType } from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";

type OutputTabProps = {
    data: NaiveBayesOutputType;
    updateFormData: (field: keyof NaiveBayesOutputType, value: boolean | number) => void;
    /** v2 (AGENTS_V2 §3.7): true bila Text Features terisi; tanpa itu opsi Text Feature Table nonaktif. */
    hasTextFeatures?: boolean;
};

// Batas Top-k (AGENTS_V2 §3.7): bilangan bulat 1-1000.
const TEXT_TOP_K_MIN = 1;
const TEXT_TOP_K_MAX = 1000;

/**
 * Aturan checkbox tab Output: status "indeterminate" atau belum terdefinisi
 * selalu dianggap tidak tercentang (false) — pola yang sama dipakai
 * normalizeOutputCheckboxValue di modul Nearest Neighbor.
 */
function normalizeOutputCheckboxValue(value: CheckedState | undefined): boolean {
    if (value === "indeterminate" || typeof value === "undefined") return false;
    return value;
}

const viewerOutputOptions: Array<{
    field: keyof NaiveBayesOutputType;
    label: string;
    description: string;
}> = [
    {
        field: "CaseProcessingSummary",
        label: "Case Processing Summary",
        description:
            "Summary of the total, valid, and excluded cases (rows with a missing target value).",
    },
    {
        field: "AttributeDistributionTable",
        label: "Attribute Distribution Table",
        description: "Distribution of each attribute within each target class.",
    },
    {
        field: "ModelEvaluationMetrics",
        label: "Model Evaluation Metrics",
        description:
            "Accuracy, precision, recall, and F1 score per class, with macro, weighted, and micro averages, overall accuracy, and Cohen's Kappa.",
    },
    {
        field: "ConfusionMatrix",
        label: "Confusion Matrix",
        description: "Confusion matrix (actual vs. predicted) with counts, totals, and percentages.",
    },
];

export const OutputTab = ({ data, updateFormData, hasTextFeatures = false }: OutputTabProps) => {
    const handleChange = (field: keyof NaiveBayesOutputType, checked: CheckedState) => {
        updateFormData(field, normalizeOutputCheckboxValue(checked));
    };

    // Input Top-k disimpan sebagai teks lokal agar pengguna bisa mengetik sementara nilai tak sah;
    // hanya nilai bilangan bulat 1-1000 yang diteruskan ke form (nilai lain menampilkan galat).
    const [topKText, setTopKText] = React.useState(String(data.TextTopK ?? ""));
    React.useEffect(() => {
        setTopKText(String(data.TextTopK ?? ""));
    }, [data.TextTopK]);

    const topKError = React.useMemo(() => {
        const n = Number(topKText);
        if (topKText.trim() === "" || !Number.isInteger(n) || n < TEXT_TOP_K_MIN || n > TEXT_TOP_K_MAX) {
            return `Top-k must be a whole number between ${TEXT_TOP_K_MIN} and ${TEXT_TOP_K_MAX}.`;
        }
        return null;
    }, [topKText]);

    const handleTopKChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        setTopKText(raw);
        const n = Number(raw);
        if (raw.trim() !== "" && Number.isInteger(n) && n >= TEXT_TOP_K_MIN && n <= TEXT_TOP_K_MAX) {
            updateFormData("TextTopK", n);
        }
    };

    const textTableEnabled = hasTextFeatures;

    return (
        <div className="flex flex-col h-full min-h-0 w-full overflow-hidden">
            <div className="flex-1 min-h-0 w-full overflow-y-auto">
                <div className="flex flex-col items-start gap-2 p-4 w-full">
                    <div className="w-full max-w-xl rounded-lg border md:min-w-[200px]">
                        <section className="flex flex-col gap-3 p-4">
                            <Label className="font-bold">Viewer Output</Label>
                            {viewerOutputOptions.map(({ field, label, description }) => (
                                <div key={field} className="flex flex-col gap-1">
                                    <div className="flex items-center space-x-2">
                                        <Checkbox
                                            id={field}
                                            checked={Boolean(data[field])}
                                            onCheckedChange={(checked) => handleChange(field, checked)}
                                        />
                                        <label
                                            htmlFor={field}
                                            className="text-sm font-medium leading-none"
                                        >
                                            {label}
                                        </label>
                                    </div>
                                    <p className="pl-6 text-xs text-muted-foreground">{description}</p>
                                </div>
                            ))}
                        </section>
                    </div>

                    {/* v2 (AGENTS_V2 §3.7): Text Feature Table + Top-k */}
                    <div className="w-full max-w-xl rounded-lg border md:min-w-[200px]">
                        <section className="flex flex-col gap-3 p-4">
                            <Label className="font-bold">Text Features</Label>
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id="TextFeatureTable"
                                        checked={textTableEnabled && Boolean(data.TextFeatureTable)}
                                        disabled={!textTableEnabled}
                                        onCheckedChange={(checked) => handleChange("TextFeatureTable", checked)}
                                    />
                                    <label
                                        htmlFor="TextFeatureTable"
                                        className="text-sm font-medium leading-none"
                                    >
                                        Text Feature Table
                                    </label>
                                </div>
                                <p className="pl-6 text-xs text-muted-foreground">
                                    {textTableEnabled
                                        ? "Table of the most influential terms per class (top-k), with Download CSV and Copy actions."
                                        : "Available when a Raw Text Variable or Word-Vector Variables are set on the Variables tab."}
                                </p>
                            </div>
                            <div className="flex flex-col gap-1 pl-6">
                                <Label htmlFor="text-top-k" className="text-sm">
                                    Top-k terms per class
                                </Label>
                                <Input
                                    id="text-top-k"
                                    type="number"
                                    min={TEXT_TOP_K_MIN}
                                    max={TEXT_TOP_K_MAX}
                                    step={1}
                                    className="w-[120px]"
                                    disabled={!textTableEnabled || !data.TextFeatureTable}
                                    value={topKText}
                                    onChange={handleTopKChange}
                                />
                                {textTableEnabled && data.TextFeatureTable && topKError && (
                                    <p className="text-sm text-destructive">{topKError}</p>
                                )}
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OutputTab;
