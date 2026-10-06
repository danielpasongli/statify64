"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useModal } from "@/hooks/useModal";
import { useVariableStore } from "@/stores/useVariableStore";
import { useDataStore } from "@/stores/useDataStore";
import { getSlicedData } from "@/hooks/useVariable";
import { saveFormData, getFormData, clearFormData } from "@/hooks/useIndexedDB";
import type {
    NaiveBayesContainerProps,
    NaiveBayesMainType,
    NaiveBayesType,
} from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";
import { NaiveBayesDefault, mergeWithDefaults } from "@/components/Modals/Analyze/Classify/naive-bayes/constants/naive-bayes-default";
import { validateStwvConfig, type StwvConfig } from "@/components/Modals/Transform/StringToWordVector/config";
import VariablesTab from "@/components/Modals/Analyze/Classify/naive-bayes/components/variables-tab";
import OptionsTab, { pruneNumericOverrides, type NaiveBayesOptionsValue } from "@/components/Modals/Analyze/Classify/naive-bayes/dialogs/options";
import TextPreprocessingTab from "@/components/Modals/Analyze/Classify/naive-bayes/dialogs/text-preprocessing";
import ValidationTab from "@/components/Modals/Analyze/Classify/naive-bayes/dialogs/validation";
import OutputTab from "@/components/Modals/Analyze/Classify/naive-bayes/dialogs/output";
import {
    useNaiveBayesValidation,
    getEffectivePredictors,
    getEffectiveTextSource,
    getNumericInputError,
    getTextColumnNames,
} from "@/components/Modals/Analyze/Classify/naive-bayes/hooks/useNaiveBayesValidation";
import { analyzeNaiveBayes } from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis";
import { getUserFriendlyNaiveBayesError } from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-error-messages";
import type { Variable } from "@/types/Variable";
import { toast } from "sonner";

const NAIVE_BAYES_VALIDATION_ERROR_TOAST_ID = "naive-bayes-validation-error";
const NAIVE_BAYES_SETTINGS_LOAD_ERROR_TOAST_ID = "naive-bayes-settings-load-error";
const NAIVE_BAYES_SETTINGS_RESET_ERROR_TOAST_ID = "naive-bayes-settings-reset-error";

// v2: salinan dalam default termasuk `text` (StwvConfig) dan override per variabel,
// sehingga state form tidak pernah berbagi referensi dengan konstanta default.
const cloneNaiveBayesDefault = (): NaiveBayesType => mergeWithDefaults(null);

/**
 * Variabel Numeric efektif (AGENTS_V2 §3.6) untuk tabel override Options.
 * Mode candidates: `CandidateCovariates`. Mode exclude: predictor efektif
 * ber-measure `scale` dan bukan STRING (peran dari `measure`, seperti v1).
 */
export function getEffectiveNumericPredictors(
    main: NaiveBayesMainType,
    variables: Variable[]
): string[] {
    if ((main.SpecificationMode ?? "exclude") === "candidates") {
        return [...(main.CandidateCovariates ?? [])];
    }
    const byName = new Map(variables.map((v) => [v.name, v]));
    return getEffectivePredictors(main, variables).filter((name) => {
        const v = byName.get(name);
        return !!v && v.measure === "scale" && v.type !== "STRING";
    });
}

/**
 * Nama variabel yang di-slice lewat `getSlicedData`: `[target, ...predictor]`
 * ditambah kolom Word-Vector (hanya jalur vector). Kolom Raw Text SENGAJA tidak
 * ikut (N5-fix): `getSlicedData` memakai parseFloat sehingga "3 kucing lucu"
 * berubah menjadi 3; teks mentah dikirim lewat `rawTextValues`.
 */
export function getNaiveBayesSelectedVariables(
    main: NaiveBayesMainType,
    variables: Variable[]
): string[] {
    if (!main.TargetVar) return [];
    const vectorColumns = getEffectiveTextSource(main) === "vector" ? getTextColumnNames(main) : [];
    return [main.TargetVar, ...getEffectivePredictors(main, variables), ...vectorColumns];
}

/**
 * Teks mentah per baris untuk Raw Text Variable, diambil LANGSUNG dari sel asli
 * `data[row][columnIndex]` (tanpa parseFloat). Panjang = `rowCount` (jumlah baris
 * kolom target hasil `getSlicedData`) agar sejajar baris target. Mengembalikan
 * `undefined` bila bukan jalur raw atau variabelnya tidak ditemukan.
 */
export function buildRawTextValues(
    main: NaiveBayesMainType,
    variables: Variable[],
    data: ReadonlyArray<ReadonlyArray<string | number | null>>,
    rowCount: number
): (string | number | null)[] | undefined {
    if (getEffectiveTextSource(main) !== "raw" || !main.RawTextVar) return undefined;
    const column = variables.find((v) => v.name === main.RawTextVar)?.columnIndex;
    if (column === undefined || column < 0) return undefined;
    const values: (string | number | null)[] = [];
    for (let i = 0; i < rowCount; i++) {
        values.push(data[i]?.[column] ?? null);
    }
    return values;
}

/**
 * Galat yang menahan pengguna MENINGGALKAN tab (AGENTS.md §5 pola KNN, diperluas v2).
 * Hanya galat milik tab itu sendiri yang menahan (probe: seksi lain diganti default
 * yang sah), supaya pengguna tidak terjebak: galat Output/Options tetap bisa
 * diperbaiki dengan berpindah ke tab itu. Tab Variables tidak pernah menahan.
 */
export function getTabLeaveError(tab: string, formData: NaiveBayesType): string | null {
    const defaults = NaiveBayesDefault;
    switch (tab) {
        case "text":
            return getEffectiveTextSource(formData.main) === "raw"
                ? (validateStwvConfig(formData.text)[0] ?? null)
                : null;
        case "options":
            return getNumericInputError({
                ...formData,
                validation: defaults.validation,
                output: defaults.output,
            });
        case "validation":
            return getNumericInputError({
                ...formData,
                options: defaults.options,
                output: defaults.output,
            });
        case "output":
            return getNumericInputError({
                ...formData,
                options: defaults.options,
                validation: defaults.validation,
            });
        default:
            return null;
    }
}

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
                    // v2: data lama (tanpa field v2) digabung dalam-dalam dengan default.
                    setFormData(mergeWithDefaults(saved));
                } else {
                    setFormData(cloneNaiveBayesDefault());
                }
            } catch {
                if (!isActive) return;
                toast.error(
                    "The saved Naive Bayes settings could not be loaded. Default settings will be used.",
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
        toast.info("The dataset has changed. The Naive Bayes settings were reset to their defaults.");
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

    const handleOptionsChange = useCallback((field: keyof NaiveBayesType["options"], value: NaiveBayesOptionsValue) => {
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

    const handleOutputChange = useCallback((field: keyof NaiveBayesType["output"], value: boolean | number) => {
        setFormData((prev) => ({
            ...prev,
            output: { ...prev.output, [field]: value },
        }));
    }, []);

    // Pola setState agar `STWV/OptionsTab` dapat dipakai apa adanya (nilai atau fungsi pembaruan).
    const handleTextChange = useCallback((update: SetStateAction<StwvConfig>) => {
        setFormData((prev) => ({
            ...prev,
            text: typeof update === "function" ? update(prev.text) : update,
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
    // v2: kolom Word-Vector ikut di ekor `slicedData`; Raw Text TIDAK (lihat
    // `getNaiveBayesSelectedVariables`) dan dikirim terpisah sebagai `rawTextValues`
    // dari sel asli `useDataStore.data[row][columnIndex]`.
    const slicedData = useMemo(() => {
        const allNames = getNaiveBayesSelectedVariables(formData.main, variables);
        if (allNames.length === 0) return [];
        return getSlicedData({
            dataVariables: dataVariables as unknown as string[][],
            variables,
            selectedVariables: allNames,
        });
    }, [dataVariables, variables, formData.main]);

    const rawTextValues = useMemo(() => {
        const rowCount = Array.isArray(slicedData[0]) ? slicedData[0].length : 0;
        return buildRawTextValues(formData.main, variables, dataVariables, rowCount);
    }, [slicedData, dataVariables, variables, formData.main]);

    const { validation, validateNumericInputs } = useNaiveBayesValidation(formData, variables);

    const textSource = getEffectiveTextSource(formData.main);
    const hasTextFeatures = textSource !== "none";
    const hasRawText = textSource === "raw";
    const hasOtherPredictors = useMemo(
        () => getEffectivePredictors(formData.main, variables).length > 0,
        [formData.main, variables]
    );
    const numericVariables = useMemo(
        () => getEffectiveNumericPredictors(formData.main, variables),
        [formData.main, variables]
    );

    // Override per variabel yang menunjuk variabel yang tidak lagi Numeric dibuang otomatis (§3.6).
    const currentOverrides = formData.options.NumericLikelihoodOverrides;
    useEffect(() => {
        if (pruneNumericOverrides(currentOverrides, numericVariables) === (currentOverrides ?? {})) return;
        setFormData((prev) => ({
            ...prev,
            options: {
                ...prev.options,
                NumericLikelihoodOverrides: pruneNumericOverrides(
                    prev.options.NumericLikelihoodOverrides,
                    numericVariables
                ),
            },
        }));
    }, [currentOverrides, numericVariables]);

    // Tab Text Preprocessing hanya ada gunanya bila Raw Text Variable terisi.
    useEffect(() => {
        if (activeTab === "text" && !hasRawText) setActiveTab("variables");
    }, [activeTab, hasRawText]);

    const handleTabChange = useCallback(
        (next: string) => {
            if (next === activeTab) return;
            const leaveError = getTabLeaveError(activeTab, formData);
            if (leaveError) {
                toast.error(leaveError, { id: NAIVE_BAYES_VALIDATION_ERROR_TOAST_ID });
                return;
            }
            setActiveTab(next);
        },
        [activeTab, formData]
    );

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

                <TabsContent value="text" className="mt-0 h-full">
                    <TextPreprocessingTab
                        config={formData.text}
                        setConfig={handleTextChange}
                    />
                </TabsContent>

                <TabsContent value="options" className="mt-0">
                    <OptionsTab
                        data={formData.options}
                        updateFormData={handleOptionsChange}
                        numericVariables={numericVariables}
                        hasTextFeatures={hasTextFeatures}
                        hasOtherPredictors={hasOtherPredictors}
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
                        hasTextFeatures={hasTextFeatures}
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
            const message = validation.errors[0] ?? "The Naive Bayes settings are incomplete.";
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
                // v2: teks mentah dari sel asli (bukan getSlicedData) agar "3 kucing lucu" tetap utuh.
                rawTextValues,
            });
        };

        toast.promise(promise(), {
            loading: "Running Naive Bayes analysis...",
            success: "Naive Bayes analysis completed. See the results in the Output Viewer.",
            error: getUserFriendlyNaiveBayesError,
        });
    }, [closeModal, onClose, formData, validation, validateNumericInputs, variables, slicedData, rawTextValues]);

    const handleReset = useCallback(async () => {
        try {
            setFormData(cloneNaiveBayesDefault());
            setActiveTab("variables");
            await clearFormData("NaiveBayes");
            toast.success("The Naive Bayes settings have been reset.");
        } catch {
            toast.error(
                "The Naive Bayes settings could not be reset. Please try again.",
                { id: NAIVE_BAYES_SETTINGS_RESET_ERROR_TOAST_ID }
            );
        }
    }, []);

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <span>Loading...</span>
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

            <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-1 flex-col overflow-hidden">
                <div className="border-b px-4">
                    <TabsList className="w-full justify-start">
                        <TabsTrigger value="variables" className="min-w-0">
                            <span className="truncate block w-full">Variables</span>
                        </TabsTrigger>
                        <TooltipProvider delayDuration={100}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span className="min-w-0" tabIndex={hasRawText ? -1 : 0}>
                                        <TabsTrigger value="text" className="min-w-0" disabled={!hasRawText}>
                                            <span className="truncate block w-full">Text Preprocessing</span>
                                        </TabsTrigger>
                                    </span>
                                </TooltipTrigger>
                                {!hasRawText && (
                                    <TooltipContent>
                                        Available when a Raw Text Variable is set on the Variables tab.
                                    </TooltipContent>
                                )}
                            </Tooltip>
                        </TooltipProvider>
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
