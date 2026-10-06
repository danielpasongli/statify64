"use client";

import React from "react";
import {
    ExportModelAction,
    type NaiveBayesTrainedModelLike,
} from "@/components/Modals/Analyze/Classify/naive-bayes/components/export-model-action";

/**
 * Wrapper yang dipasang di registry output viewer global
 * (`@/components/Output/Statistics/index.tsx`, key "Export Model") supaya
 * `ExportModelAction` (Fase 4.2) benar-benar muncul di output viewer setelah
 * run sukses, sesuai AGENTS.md §4.3 (tombol Export Model bukan checkbox,
 * bukan bagian dari tab Output — hanya muncul di sini).
 *
 * `data` adalah `output_data` statistic ini, berbentuk
 * `{ naiveBayesTrainedModel: <trained model JSON, AGENTS.md §5.10> }`
 * (lihat `services/naive-bayes-analysis-output.ts`).
 */
type ExportModelOutputData = {
    naiveBayesTrainedModel?: NaiveBayesTrainedModelLike;
};

export type ExportModelOutputProps = {
    data: string | ExportModelOutputData;
};

const downloadJson = (fileName: string, model: NaiveBayesTrainedModelLike) => {
    if (!model) return;
    const finalFileName = fileName.endsWith(".json") ? fileName : `${fileName}.json`;
    const blob = new Blob([JSON.stringify(model, null, 2)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = finalFileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};

export const ExportModelOutput = ({ data }: ExportModelOutputProps) => {
    let parsed: ExportModelOutputData | null = null;
    try {
        parsed = typeof data === "string" ? JSON.parse(data) : data;
    } catch {
        return (
            <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                The Naive Bayes model cannot be loaded for export because its data is not valid.
            </div>
        );
    }

    const trainedModel = parsed?.naiveBayesTrainedModel ?? null;

    return (
        <div className="rounded-lg border p-4">
            <p className="mb-3 text-xs text-muted-foreground">
                The trained Naive Bayes model is ready to be exported as a JSON file.
                Note that the file can contain the original category labels and
                terms from your dataset.
            </p>
            <ExportModelAction trainedModel={trainedModel} onExport={downloadJson} />
        </div>
    );
};

export default ExportModelOutput;
