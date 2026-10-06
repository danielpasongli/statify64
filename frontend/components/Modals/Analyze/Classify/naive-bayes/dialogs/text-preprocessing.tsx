"use client";

import React, { useMemo } from "react";
import { OptionsTab as StwvOptionsTab } from "@/components/Modals/Transform/StringToWordVector/OptionsTab";
import {
    validateStwvConfig,
    type StwvConfig,
} from "@/components/Modals/Transform/StringToWordVector/config";

type TextPreprocessingTabProps = {
    config: StwvConfig;
    /** Pola `setState`: menerima nilai baru atau fungsi pembaruan (dipakai OptionsTab STWV). */
    setConfig: React.Dispatch<React.SetStateAction<StwvConfig>>;
};

/**
 * Tab "Text Preprocessing" (AGENTS_V2 §3.5): memakai ulang komponen
 * `STWV/OptionsTab` dan validasi `validateStwvConfig` (impor read-only, TIDAK
 * disalin). Bagian "Vector Column Name" tidak dirender karena `columnPrefix`
 * tidak diberikan (tidak relevan untuk Naive Bayes). State disimpan di
 * `formData.text` oleh container.
 */
export const TextPreprocessingTab = ({ config, setConfig }: TextPreprocessingTabProps) => {
    const errors = useMemo(() => validateStwvConfig(config), [config]);

    return (
        <div className="flex h-full flex-col gap-2">
            <p className="text-sm text-muted-foreground">
                These settings convert the Raw Text Variable into word vectors. With holdout or k-fold
                validation, the vocabulary is learned from the training data only.
            </p>
            <StwvOptionsTab config={config} setConfig={setConfig} />
            {errors.length > 0 && (
                <ul
                    className="list-disc space-y-1 pl-5 text-sm text-destructive"
                    data-testid="text-preprocessing-errors"
                >
                    {errors.map((message) => (
                        <li key={message}>{message}</li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default TextPreprocessingTab;
