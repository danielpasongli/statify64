"use client";

import React, { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Sesuai AGENTS.md §4.3 / §5.10: nama file default saat pertama kali tombol
 * Export Model dipasang, bisa diubah pengguna sebelum file JSON diunduh.
 */
export const DEFAULT_NAIVE_BAYES_EXPORT_FILE_NAME = "Naive_Bayes_Model_Export.json";

/**
 * Bentuk model terlatih belum final (baru dirinci penuh di Fase 16 — lihat
 * PLAN.md skema §5.10 AGENTS.md), jadi tipe di sini sengaja longgar
 * (`Record<string, unknown> | null`), bukan `NaiveBayesTrainedModel` yang
 * dikunci ketat. `onExport` yang men-serialisasi field-field wajib §5.10
 * akan diimplementasikan sesungguhnya saat komponen ini disambungkan ke
 * output viewer di Fase 7 — di fase ini (Fase 4) komponen hanya diuji
 * terisolasi dengan `trainedModel` dummy.
 */
export type NaiveBayesTrainedModelLike = Record<string, unknown> | null;

export type ExportModelActionProps = {
    trainedModel: NaiveBayesTrainedModelLike;
    onExport: (fileName: string, trainedModel: NaiveBayesTrainedModelLike) => void;
};

export const ExportModelAction = ({ trainedModel, onExport }: ExportModelActionProps) => {
    const [fileName, setFileName] = useState(DEFAULT_NAIVE_BAYES_EXPORT_FILE_NAME);

    const handleFileNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setFileName(e.target.value);
    }, []);

    const handleExportClick = useCallback(() => {
        const finalFileName = fileName.trim() || DEFAULT_NAIVE_BAYES_EXPORT_FILE_NAME;
        onExport(finalFileName, trainedModel);
    }, [fileName, trainedModel, onExport]);

    return (
        <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
                <Label
                    htmlFor="naive-bayes-export-file-name"
                    className="text-xs text-muted-foreground"
                >
                    Nama file
                </Label>
                <Input
                    id="naive-bayes-export-file-name"
                    type="text"
                    value={fileName}
                    onChange={handleFileNameChange}
                    className="w-[260px]"
                />
            </div>
            <Button
                type="button"
                variant="default"
                disabled={!trainedModel}
                onClick={handleExportClick}
            >
                Export Model
            </Button>
        </div>
    );
};

export default ExportModelAction;
