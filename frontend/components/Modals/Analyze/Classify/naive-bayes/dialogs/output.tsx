"use client";

import React from "react";
import type { CheckedState } from "@radix-ui/react-checkbox";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { NaiveBayesOutputType } from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";

type OutputTabProps = {
    data: NaiveBayesOutputType;
    updateFormData: (field: keyof NaiveBayesOutputType, value: boolean) => void;
};

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
            "Ringkasan jumlah kasus total, valid, dan yang dibuang karena target missing.",
    },
    {
        field: "AttributeDistributionTable",
        label: "Attribute Distribution Table",
        description: "Tabel distribusi tiap atribut per kelas target.",
    },
    {
        field: "ModelEvaluationMetrics",
        label: "Model Evaluation Metrics",
        description:
            "Accuracy, precision, recall, F1-score per kelas beserta macro/weighted/micro average, overall accuracy, dan Cohen's Kappa.",
    },
    {
        field: "ConfusionMatrix",
        label: "Confusion Matrix",
        description: "Matriks confusion (actual vs predicted) beserta count, total, dan persentase.",
    },
];

export const OutputTab = ({ data, updateFormData }: OutputTabProps) => {
    const handleChange = (field: keyof NaiveBayesOutputType, checked: CheckedState) => {
        updateFormData(field, normalizeOutputCheckboxValue(checked));
    };

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
                </div>
            </div>
        </div>
    );
};

export default OutputTab;
