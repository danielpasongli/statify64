"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useModal } from "@/hooks/useModal";
import { useVariableStore } from "@/stores/useVariableStore";
import { useDataStore } from "@/stores/useDataStore";
import { getSlicedData } from "@/hooks/useVariable";
import { saveFormData, getFormData, clearFormData } from "@/hooks/useIndexedDB";
import type {
    NaiveBayesContainerProps,
    NaiveBayesType,
} from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";
import { NaiveBayesDefault } from "@/components/Modals/Analyze/Classify/naive-bayes/constants/naive-bayes-default";
import VariablesTab from "@/components/Modals/Analyze/Classify/naive-bayes/components/variables-tab";
import OptionsTab from "@/components/Modals/Analyze/Classify/naive-bayes/dialogs/options";
import ValidationTab from "@/components/Modals/Analyze/Classify/naive-bayes/dialogs/validation";
import OutputTab from "@/components/Modals/Analyze/Classify/naive-bayes/dialogs/output";
import { useNaiveBayesValidation, getEffectivePredictors } from "@/components/Modals/Analyze/Classify/naive-bayes/hooks/useNaiveBayesValidation";
import { analyzeNaiveBayes } from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis";
import { getUserFriendlyNaiveBayesError } from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-error-messages";
import type { Variable } from "@/types/Variable";
import { toast } from "sonner";

const NAIVE_BAYES_VALIDATION_ERROR_TOAST_ID = "naive-bayes-validation-error";
const NAIVE_BAYES_SETTINGS_LOAD_ERROR_TOAST_ID = "naive-bayes-settings-load-error";
const NAIVE_BAYES_SETTINGS_RESET_ERROR_TOAST_ID = "naive-bayes-settings-reset-error";

const cloneNaiveBayesDefault = (): NaiveBayesType => ({
    main: { ...NaiveBayesDefault.main },
    options: { ...NaiveBayesDefault.options },
    validation: { ...NaiveBayesDefault.validation },
    output: { ...NaiveBayesDefault.output },
});

/**
 * Fingerprint ringan dari daftar variabel dataset, dipakai untuk mendeteksi
 * "dataset berubah" (AGENTS.md §4.5) baik saat panel masih terbuka (lewat
 * efek yang mengamati `variables`) maupun setelah panel ditutup-buka lagi
 * (lewat perbandingan terhadap fingerprint yang ikut disimpan ke
 * IndexedDB). Mencakup name+type+measure karena ketiganya menentukan
 * apakah suatu variabel eligible dan factor/covariate — bukan field
 * kosmetik seperti label/width. Definisi cakupan "berubah" ini adalah
 * judgment call Fase 5, lihat catatan di laporan implementasi.
 */
const getVariablesFingerprint = (vars: Variable[]): string =>
    vars
        .map((v) => `${v.name}|${v.type ?? ""}|${v.measure}`)
        .sort()
        .join(";");

type PersistedNaiveBayesForm = NaiveBayesType & {
    _variablesFingerprint?: string;
};

const NaiveBayesContainer = ({ onClose }: NaiveBayesContainerProps) => {
    const { closeModal } = useModal();
    const variables = useVariableStore((s) => s.variables);
    const dataVariables = useDataStore((s) => s.data);

    const [formData, setFormData] = useState<NaiveBayesType>(cloneNaiveBayesDefault);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState("variables");
    const [highlightedVariables, setHighlightedVariables] = useState<{ id: string; source: string } | null>(null);

    // Baseline dataset yang dipakai untuk mendeteksi perubahan SELAGI panel
    // terbuka. Ditetapkan begitu hydration awal (load dari IndexedDB) selesai,
    // supaya nilai `variables` yang sudah ada saat mount tidak dianggap
    // "perubahan". Lihat AGENTS.md §4.5 — berbeda dari pola KNN (yang hanya
    // membersihkan referensi variabel yang hilang), Naive Bayes me-reset
    // SELURUH form.
    const hasHydratedRef = useRef(false);
    const variablesBaselineRef = useRef<Variable[] | null>(null);

    useEffect(() => {
        let isActive = true;

        const loadFormData = async () => {
            try {
                const saved = (await getFormData("NaiveBayes")) as PersistedNaiveBayesForm | null;
                if (!isActive) return;

                const currentFingerprint = getVariablesFingerprint(variables);
                const datasetMatches =
                    !!saved && saved._variablesFingerprint === currentFingerprint;

                if (saved && !datasetMatches) {
                    // Dataset sudah berubah sejak konfigurasi terakhir disimpan —
                    // seluruh form direset ke default (AGENTS.md §4.5), bukan
                    // hanya membersihkan referensi variabel yang hilang.
                    setFormData(cloneNaiveBayesDefault());
                    await clearFormData("NaiveBayes");
                } else if (saved) {
                    setFormData({
                        main: { ...NaiveBayesDefault.main, ...(saved.main ?? {}) },
                        options: { ...NaiveBayesDefault.options, ...(saved.options ?? {}) },
                        validation: { ...NaiveBayesDefault.validation, ...(saved.validation ?? {}) },
                        output: { ...NaiveBayesDefault.output, ...(saved.output ?? {}) },
                    });
                } else {
                    setFormData(cloneNaiveBayesDefault());
                }
            } catch {
                if (!isActive) return;
                toast.error(
                    "Konfigurasi Naive Bayes tersimpan gagal dimuat. Pengaturan default akan dipakai.",
                    { id: NAIVE_BAYES_SETTINGS_LOAD_ERROR_TOAST_ID }
                );
                setFormData(cloneNaiveBayesDefault());
            } finally {
                if (isActive) {
                    // Baseline ditetapkan di sini (bukan lebih awal) supaya
                    // efek pengamat dataset di bawah tidak salah anggap
                    // hydration awal sebagai "perubahan dataset".
                    variablesBaselineRef.current = variables;
                    hasHydratedRef.current = true;
                    setIsLoading(false);
                }
            }
        };

        void loadFormData();

        return () => {
            isActive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Reset total form SELAGI panel terbuka, begitu daftar variabel dataset
    // berubah di tempat lain pada aplikasi (AGENTS.md §4.5).
    useEffect(() => {
        if (!hasHydratedRef.current) return;
        if (variablesBaselineRef.current === null) {
            variablesBaselineRef.current = variables;
            return;
        }
        if (variablesBaselineRef.current === variables) return;

        variablesBaselineRef.current = variables;
        setFormData(cloneNaiveBayesDefault());
        setActiveTab("variables");
        void clearFormData("NaiveBayes");
        toast.info("Dataset berubah — konfigurasi Naive Bayes direset ke default.");
    }, [variables]);

    const handleHighlight = useCallback((value: { id: string; source: string } | null) => {
        setHighlightedVariables(value);
    }, []);

    const handleMainChange = useCallback((update: Partial<NaiveBayesType["main"]>) => {
        setFormData((prev) => ({
            ...prev,
            main: { ...prev.main, ...update },
        }));
    }, []);

    const handleOptionsChange = useCallback((field: keyof NaiveBayesType["options"], value: number | string) => {
        setFormData((prev) => ({
            ...prev,
            options: { ...prev.options, [field]: value },
        }));
    }, []);

    const handleValidationChange = useCallback((field: keyof NaiveBayesType["validation"], value: string | number | null) => {
        setFormData((prev) => ({
            ...prev,
            validation: { ...prev.validation, [field]: value },
        }));
    }, []);

    const handleOutputChange = useCallback((field: keyof NaiveBayesType["output"], value: boolean) => {
        setFormData((prev) => ({
            ...prev,
            output: { ...prev.output, [field]: value },
        }));
    }, []);

    // Predictor efektif dihitung lewat `getEffectivePredictors` (satu-satunya
    // sumber kebenaran, sama persis dipakai `useNaiveBayesValidation` untuk
    // menentukan tombol OK aktif/tidak) — BUKAN sekadar CandidateFactors +
    // CandidateCovariates. Sebelum perbaikan ini, fungsi ini hanya
    // menggabungkan dua field itu, jadi mode "Exclude" (AGENTS.md §3.3)
    // selalu terkirim sebagai predictor kosong walau tombol OK sudah
    // dianggap valid oleh `useNaiveBayesValidation` — ditemukan & diperbaiki
    // setelah verifikasi manual Fase 8.
    const slicedData = useMemo(() => {
        const targetName = formData.main.TargetVar;
        if (!targetName) return [];
        const predictorNames = getEffectivePredictors(formData.main, variables);
        const allNames = [targetName, ...predictorNames];
        return getSlicedData({
            dataVariables: dataVariables as unknown as string[][],
            variables,
            selectedVariables: allNames,
        });
    }, [dataVariables, variables, formData.main]);

    const { validation, validateNumericInputs } = useNaiveBayesValidation(formData, variables);

    const renderTabContent = () => {
        return (
            <>
                <TabsContent value="variables" className="mt-0 h-full">
                    <VariablesTab
                        allVariables={variables}
                        formData={formData.main}
                        onChange={handleMainChange}
                        highlightedVariables={highlightedVariables}
                        setHighlightedVariables={handleHighlight}
                    />
                </TabsContent>

                <TabsContent value="options" className="mt-0">
                    <OptionsTab
                        data={formData.options}
                        updateFormData={handleOptionsChange}
                    />
                </TabsContent>

                <TabsContent value="validation" className="mt-0">
                    <ValidationTab
                        data={formData.validation}
                        updateFormData={handleValidationChange}
                    />
                </TabsContent>

                <TabsContent value="output" className="mt-0 h-full">
                    <OutputTab
                        data={formData.output}
                        updateFormData={handleOutputChange}
                    />
                </TabsContent>
            </>
        );
    };

    const handleOK = useCallback(async () => {
        const numericError = validateNumericInputs();
        if (numericError) {
            toast.error(numericError, { id: NAIVE_BAYES_VALIDATION_ERROR_TOAST_ID });
            return;
        }
        if (!validation.isValid) {
            const message = validation.errors[0] ?? "Konfigurasi Naive Bayes belum lengkap.";
            toast.error(message, { id: NAIVE_BAYES_VALIDATION_ERROR_TOAST_ID });
            return;
        }

        closeModal();
        onClose();

        const promise = async () => {
            const payload: PersistedNaiveBayesForm = {
                ...formData,
                _variablesFingerprint: getVariablesFingerprint(variables),
            };
            await saveFormData("NaiveBayes", payload);

            // Fase 7 (Bagian A, worker stub — PLAN.md): belum ada
            // Worker/WASM sungguhan, hasil berasal dari stub JSON statis.
            // `slicedData` dikirim untuk kesiapan Fase 8 (worker asli),
            // meskipun belum dipakai secara internal oleh stub.
            await analyzeNaiveBayes({
                configData: formData,
                dataVariables: slicedData,
                variables,
            });
        };

        toast.promise(promise(), {
            loading: "Menjalankan analisis Naive Bayes...",
            success: "Analisis Naive Bayes selesai. Lihat hasil di Output Viewer.",
            error: getUserFriendlyNaiveBayesError,
        });
    }, [closeModal, onClose, formData, validation, validateNumericInputs, variables, slicedData]);

    const handleReset = useCallback(async () => {
        try {
            setFormData(cloneNaiveBayesDefault());
            setActiveTab("variables");
            await clearFormData("NaiveBayes");
            toast.success("Pengaturan Naive Bayes telah direset.");
        } catch {
            toast.error(
                "Pengaturan Naive Bayes gagal direset. Coba lagi.",
                { id: NAIVE_BAYES_SETTINGS_RESET_ERROR_TOAST_ID }
            );
        }
    }, []);

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <span>Memuat...</span>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-lg font-semibold">Naive Bayes</h2>
                <Button variant="ghost" size="icon" onClick={() => { closeModal(); onClose(); }}>
                    <CircleHelp className="h-5 w-5" />
                </Button>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
                <div className="border-b px-4">
                    <TabsList className="w-full justify-start">
                        <TabsTrigger value="variables" className="min-w-0">
                            <span className="truncate block w-full">Variables</span>
                        </TabsTrigger>
                        <TabsTrigger value="options" className="min-w-0">
                            <span className="truncate block w-full">Options</span>
                        </TabsTrigger>
                        <TabsTrigger value="validation" className="min-w-0">
                            <span className="truncate block w-full">Validation</span>
                        </TabsTrigger>
                        <TabsTrigger value="output" className="min-w-0">
                            <span className="truncate block w-full">Output</span>
                        </TabsTrigger>
                    </TabsList>
                </div>

                <div className="flex-1 overflow-auto p-4">
                    {renderTabContent()}
                </div>
            </Tabs>

            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
                <Button
                    variant="default"
                    disabled={!validation.isValid}
                    onClick={handleOK}
                >
                    OK
                </Button>
                <Button variant="outline" onClick={handleReset}>
                    Reset
                </Button>
                <Button
                    variant="outline"
                    onClick={() => {
                        closeModal();
                        onClose();
                    }}
                >
                    Cancel
                </Button>
            </div>
        </div>
    );
};

export default NaiveBayesContainer;
