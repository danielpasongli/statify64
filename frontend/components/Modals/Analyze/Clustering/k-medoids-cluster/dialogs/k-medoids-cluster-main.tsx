"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    TooltipProvider,
    Tooltip,
    TooltipTrigger,
    TooltipContent,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HelpCircle } from "lucide-react";
import { KMedoidsClusterDefault, PAM_HARD_MAX_ROWS, PAM_WARN_ROWS } from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/constants/k-medoids-cluster-default";
import type {
    KMedoidsClusterContainerProps,
    KMedoidsClusterMainType,
    KMedoidsClusterType,
} from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/types/k-medoids-cluster";
import { ClusterMode, KMedoidsMethod, MissingValueMethod } from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/types/k-medoids-cluster";
import { KMedoidsClusterDialog } from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/dialogs/dialog";
import { KMedoidsClusterIterate } from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/dialogs/iterate";
import { KMedoidsClusterResults } from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/dialogs/results";
import { KMedoidsClusterEvaluation } from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/dialogs/evaluation";
import { KMedoidsClusterSave } from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/dialogs/save";
import { KMedoidsClusterOptions } from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/dialogs/options";
import { useModal } from "@/hooks/useModal";
import { useVariableStore } from "@/stores/useVariableStore";
import { useDataStore } from "@/stores/useDataStore";
import {
    analyzeKMedoidsCluster,
    warmupKMedoidsRuntime,
} from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/services/k-medoids-cluster-analysis";
import { clearFormData, getFormData, saveFormData } from "@/hooks/useIndexedDB";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const TAB_ORDER = ["variables", "iterate", "results", "evaluation", "save", "options"] as const;

export const KMedoidsClusterContainer = ({
    onClose,
}: KMedoidsClusterContainerProps) => {
    const variables = useVariableStore((state) => state.variables);
    const dataVariables = useDataStore((state) => state.data);

    const [formData, setFormData] = useState<KMedoidsClusterType>({
        ...KMedoidsClusterDefault,
    });
    const [activeTab, setActiveTab] = useState("variables");
    // Peringatan PAM untuk data besar; null = dialog tertutup.
    const [pamWarning, setPamWarning] = useState<{ rows: number; isAutomatic: boolean } | null>(null);

    const { closeModal } = useModal();
    const router = useRouter();

    useEffect(() => {
        const loadFormData = async () => {
            const savedData = await getFormData("KMedoidsCluster");
            if (savedData) {
                const { id: _id, ...formDataWithoutId } = savedData;

                // Migrasi konfigurasi lama: dua checkbox grafik pindah tab agar satu grup
                // dengan tabelnya. Nilai lama di section `options` dibawa ke section barunya
                // supaya preferensi pengguna tidak hilang begitu saja.
                const legacyConvergenceChart = formDataWithoutId.options?.ShowConvergenceChart;
                const legacyOptimalKChart = formDataWithoutId.options?.ShowOptimalKChart;

                setFormData({
                    ...KMedoidsClusterDefault,
                    ...formDataWithoutId,
                    main: {
                        ...KMedoidsClusterDefault.main,
                        ...formDataWithoutId.main,
                    },
                    iterate: {
                        ...KMedoidsClusterDefault.iterate,
                        ...formDataWithoutId.iterate,
                    },
                    results: {
                        ...KMedoidsClusterDefault.results,
                        ...formDataWithoutId.results,
                        ShowConvergenceChart:
                            formDataWithoutId.results?.ShowConvergenceChart ??
                            legacyConvergenceChart ??
                            KMedoidsClusterDefault.results.ShowConvergenceChart,
                    },
                    evaluation: {
                        ...KMedoidsClusterDefault.evaluation,
                        ...formDataWithoutId.evaluation,
                        ShowOptimalKChart:
                            formDataWithoutId.evaluation?.ShowOptimalKChart ??
                            legacyOptimalKChart ??
                            KMedoidsClusterDefault.evaluation.ShowOptimalKChart,
                    },
                    save: {
                        ...KMedoidsClusterDefault.save,
                        ...formDataWithoutId.save,
                    },
                    options: {
                        ...KMedoidsClusterDefault.options,
                        ...formDataWithoutId.options,
                    },
                });
            } else {
                setFormData({ ...KMedoidsClusterDefault });
            }
        };

        loadFormData();

        // Pre-warm worker/WASM so first run does not pay initialization cost.
        void warmupKMedoidsRuntime(true);
    }, []);

    const updateFormData = useCallback(<T extends keyof typeof formData>(
        section: T,
        field: keyof (typeof formData)[T],
        value: unknown
    ) => {
        setFormData((prev) => ({
            ...prev,
            [section]: {
                ...prev[section],
                [field]: value,
            },
        }));
    }, []);

    const executeKMedoidsCluster = async (mainData: KMedoidsClusterMainType) => {
        const selectedVarNames = new Set(mainData.TargetVar || []);
        const selectedVariables = variables.filter((v) => selectedVarNames.has(v.name));

        closeModal();
        onClose();

        const promise = async () => {
            const newFormData = {
                ...formData,
                main: mainData,
            };

            await saveFormData("KMedoidsCluster", newFormData);

            // Add progress tracking
            const n_init = newFormData.iterate.NumberOfInitializations || 10;
            const dataSize = dataVariables.length;
            const progressToast = toast.loading(
                `Initializing clustering... (${dataSize} cases, ${n_init} runs)`
            );

            try {
                const result = await analyzeKMedoidsCluster({
                    configData: newFormData,
                    dataVariables,
                    variables: selectedVariables,
                    allVariables: variables,
                    useWorker: true, // Try to use web worker (auto-fallback to direct if not available)
                    onProgress: (progress) => {
                        // Update toast with progress
                        const statusMsg = progress.stage === "clustering"
                            ? `${progress.message} (running in background)`
                            : progress.message;
                        toast.loading(statusMsg, { id: progressToast });
                    },
                });

                toast.dismiss(progressToast);

                if (result.success) {
                    // Comprehensive result persistence runs in background.
                    // Navigate immediately; the latest result will appear once persisted.
                    router.push("/dashboard/result");
                }
            } catch (error) {
                toast.dismiss(progressToast);
                throw error;
            }
        };

        toast.promise(promise, {
            loading: "Running K-Medoids Cluster analysis...",
            success: () => {
                return "K-Medoids Cluster analysis has been completed successfully.";
            },
            error: (err) => {
                return (
                    <span>
                        An error occurred during K-Medoids Cluster analysis.
                        <br />
                        Error: {String(err)}
                    </span>
                );
            },
        });
    };

    /**
     * Statistik missing value untuk variabel yang sedang dipilih.
     * Ditampilkan sebagai notice inline di tab Options (tepat di atas grup Missing Values)
     * supaya angkanya terlihat saat pengguna memilih strategi listwise/pairwise — bukan
     * sebagai dialog setelah klik OK. Rekap lengkapnya tetap ada di tabel Case Processing
     * Summary pada output.
     */
    const missingStats = useMemo(() => {
        const selectedVarNames = new Set(formData.main.TargetVar || []);
        const selectedVariables = variables.filter((v) => selectedVarNames.has(v.name));

        if (selectedVariables.length === 0 || dataVariables.length === 0) {
            return null;
        }

        const missingByVariable: Record<string, number> = Object.fromEntries(
            selectedVariables.map((v) => [v.name, 0])
        );
        let rowsWithMissing = 0;

        for (const row of dataVariables) {
            let hasMissingInRow = false;

            for (const variable of selectedVariables) {
                const rawValue = row[variable.columnIndex as number];
                const parsedValue =
                    typeof rawValue === "number" ? rawValue : parseFloat(String(rawValue));

                if (!Number.isFinite(parsedValue)) {
                    hasMissingInRow = true;
                    missingByVariable[variable.name] = (missingByVariable[variable.name] || 0) + 1;
                }
            }

            if (hasMissingInRow) {
                rowsWithMissing += 1;
            }
        }

        if (rowsWithMissing === 0) {
            return null;
        }

        const affected = Object.entries(missingByVariable)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1]);

        const topVariables = affected
            .slice(0, 5)
            .map(([name, count]) => `${name} (${count})`)
            .join(", ");

        return {
            rowsWithMissing,
            totalRows: dataVariables.length,
            missingPercent: ((rowsWithMissing / dataVariables.length) * 100).toFixed(1),
            topVariables,
            remainingVariables: Math.max(0, affected.length - 5),
        };
    }, [formData.main.TargetVar, variables, dataVariables]);

    const getValidRowCount = (
        rows: any[],
        selectedVariables: typeof variables,
        missingValueMethod: MissingValueMethod
    ) => {
        if (rows.length === 0 || selectedVariables.length === 0) {
            return 0;
        }

        let validCount = 0;

        for (const row of rows) {
            let hasAnyValid = false;
            let hasAnyMissing = false;

            for (const variable of selectedVariables) {
                const rawValue = row[variable.columnIndex as number];
                const parsedValue =
                    typeof rawValue === "number" ? rawValue : parseFloat(String(rawValue));

                if (Number.isFinite(parsedValue)) {
                    hasAnyValid = true;
                } else {
                    hasAnyMissing = true;
                }
            }

            if (missingValueMethod === MissingValueMethod.Listwise) {
                if (!hasAnyMissing && hasAnyValid) {
                    validCount += 1;
                }
            } else if (hasAnyValid) {
                validCount += 1;
            }
        }

        return validCount;
    };

    // Dipakai tab Iterate untuk rekomendasi metode; dihitung ulang hanya saat pilihan variabel,
    // strategi missing value, atau data berubah.
    const validRowCount = useMemo(() => {
        const selectedVarNames = new Set(formData.main.TargetVar || []);
        const selectedVariables = variables.filter((v) => selectedVarNames.has(v.name));
        return getValidRowCount(
            dataVariables,
            selectedVariables,
            formData.options?.MissingValueMethod ?? MissingValueMethod.Listwise
        );
    }, [formData.main.TargetVar, formData.options?.MissingValueMethod, variables, dataVariables]);

    const handleRun = () => {
        const selectedVarNames = new Set(formData.main.TargetVar || []);
        const selectedVariables = variables.filter((v) => selectedVarNames.has(v.name));

        if (dataVariables.length === 0) {
            toast.error("Dataset is empty. Please load data before running clustering.");
            return;
        }

        if (selectedVariables.length === 0) {
            toast.error("Please select at least one numeric variable for clustering.");
            return;
        }

        const missingValueMethod = formData.options?.MissingValueMethod ?? MissingValueMethod.Listwise;
        const validRows = getValidRowCount(
            dataVariables,
            selectedVariables,
            missingValueMethod
        );

        if (validRows < 2) {
            toast.error(
                "Not enough valid numeric rows for clustering. Check selected variables and missing handling settings."
            );
            return;
        }

        // PAM (dan pemilihan k otomatis, yang berakhir dengan PAM pada seluruh data) membutuhkan
        // matriks jarak n×n. Di atas PAM_WARN_ROWS pengguna diperingatkan tetapi boleh memaksa
        // lanjut; di atas PAM_HARD_MAX_ROWS ditolak karena alokasi memori hampir pasti gagal.
        const isAutomatic = formData.main.ClusterMode === ClusterMode.Automatic;
        const usesFullPam = isAutomatic || String(formData.iterate.Method).toUpperCase() === "PAM";
        if (usesFullPam && validRows > PAM_HARD_MAX_ROWS) {
            toast.error(
                `PAM cannot be used with ${validRows.toLocaleString()} rows (hard limit ${PAM_HARD_MAX_ROWS.toLocaleString()}).`,
                {
                    description: isAutomatic
                        ? "Automatic k selection relies on PAM. Switch to manual cluster mode with the CLARA method, or reduce the data."
                        : "Select the CLARA method in the Iterate tab, or reduce the data.",
                    duration: 8000,
                }
            );
            setActiveTab(isAutomatic ? "variables" : "iterate");
            return;
        }
        if (usesFullPam && validRows > PAM_WARN_ROWS) {
            setPamWarning({ rows: validRows, isAutomatic });
            return;
        }

        // Tidak ada dialog konfirmasi missing value di sini: dampaknya sudah ditampilkan
        // sebagai notice inline di tab Options, dan rekapnya masuk ke Case Processing Summary.
        void executeKMedoidsCluster(formData.main);
    };

    const resetFormData = async () => {
        try {
            setFormData({ ...KMedoidsClusterDefault });
            await clearFormData("KMedoidsCluster");
            toast.success("Form data cleared successfully");
        } catch (error) {
            toast.error("Failed to clear form data:", error ?? "");
        }
    };

    return (
        <div className="flex flex-col h-full bg-background">
            <div className="flex-grow px-6 overflow-y-auto min-h-0">
                <Tabs
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className="w-full h-full flex flex-col"
                >
                    <TabsList
                        className="grid w-full flex-shrink-0"
                        style={{
                            gridTemplateColumns: TAB_ORDER.map((tab) =>
                                tab === activeTab ? "max-content" : "minmax(0,1fr)"
                            ).join(" "),
                        }}
                    >
                        <TabsTrigger value="variables" className="min-w-0">
                            <span className="truncate block w-full">Variables</span>
                        </TabsTrigger>
                        <TabsTrigger value="iterate" className="min-w-0">
                            <span className="truncate block w-full">Iterate</span>
                        </TabsTrigger>
                        <TabsTrigger value="results" className="min-w-0">
                            <span className="truncate block w-full">Results</span>
                        </TabsTrigger>
                        <TabsTrigger value="evaluation" className="min-w-0">
                            <span className="truncate block w-full">Evaluation</span>
                        </TabsTrigger>
                        <TabsTrigger value="save" className="min-w-0">
                            <span className="truncate block w-full">Save</span>
                        </TabsTrigger>
                        <TabsTrigger value="options" className="min-w-0">
                            <span className="truncate block w-full">Options</span>
                        </TabsTrigger>
                    </TabsList>

                    <div className="flex-grow min-h-0 overflow-hidden">
                        <TabsContent
                            value="variables"
                            className="h-full mt-0"
                        >
                            <KMedoidsClusterDialog
                                data={formData.main}
                                globalVariables={variables}
                                updateFormData={(field, value) =>
                                    updateFormData("main", field, value)
                                }
                            />
                        </TabsContent>

                        <TabsContent
                            value="iterate"
                            className="h-full mt-0"
                        >
                            <KMedoidsClusterIterate
                                data={formData.iterate}
                                mainData={formData.main}
                                validRowCount={validRowCount}
                                updateFormData={(field, value) =>
                                    updateFormData("iterate", field, value)
                                }
                            />
                        </TabsContent>

                        <TabsContent
                            value="results"
                            className="h-full mt-0"
                        >
                            <KMedoidsClusterResults
                                data={formData.results}
                                iterateData={formData.iterate}
                                updateFormData={(field, value) =>
                                    updateFormData("results", field, value)
                                }
                            />
                        </TabsContent>

                        <TabsContent
                            value="evaluation"
                            className="h-full mt-0"
                        >
                            <KMedoidsClusterEvaluation
                                data={formData.evaluation}
                                updateFormData={(field, value) =>
                                    updateFormData("evaluation", field, value)
                                }
                            />
                        </TabsContent>

                        <TabsContent
                            value="save"
                            className="h-full mt-0"
                        >
                            <KMedoidsClusterSave
                                data={formData.save}
                                updateFormData={(field, value) =>
                                    updateFormData("save", field, value)
                                }
                            />
                        </TabsContent>

                        <TabsContent
                            value="options"
                            className="h-full mt-0"
                        >
                            <KMedoidsClusterOptions
                                data={formData.options}
                                missingStats={missingStats}
                                updateFormData={(field, value) =>
                                    updateFormData("options", field, value)
                                }
                            />
                        </TabsContent>
                    </div>
                </Tabs>
            </div>

            <div className="px-6 py-3 border-t border-border flex items-center justify-between bg-secondary flex-shrink-0">
                <div className="flex items-center text-muted-foreground">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary"
                                >
                                    <HelpCircle className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                <p className="text-xs">Help</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>

                <div className="flex items-center space-x-4">
                    <Button
                        onClick={handleRun}
                        disabled={
                            !formData.main.TargetVar ||
                            formData.main.TargetVar.length === 0 ||
                            (formData.main.ClusterMode === ClusterMode.Manual && (!formData.main.Cluster || formData.main.Cluster < 2)) ||
                            (formData.main.ClusterMode === ClusterMode.Automatic && (!formData.main.AutoKMin || !formData.main.AutoKMax || formData.main.AutoKMin >= formData.main.AutoKMax)) ||
                            (formData.iterate.Method === "CLARA" && formData.iterate.SampleSize !== null && formData.iterate.SampleSize <= (formData.main.ClusterMode === ClusterMode.Automatic ? (formData.main.AutoKMax ?? 10) : (formData.main.Cluster ?? 2)))
                        }
                    >
                        OK
                    </Button>
                    <Button
                        variant="outline"
                        onClick={resetFormData}
                    >
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

            <AlertDialog
                open={pamWarning !== null}
                onOpenChange={(open) => {
                    if (!open) setPamWarning(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>PAM may be too heavy for this data</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2">
                                <p>
                                    Your data has <strong>{pamWarning?.rows.toLocaleString()}</strong> valid rows.
                                    PAM builds a full distance matrix of about{" "}
                                    <strong>
                                        {pamWarning ? Math.round((pamWarning.rows ** 2 * 8) / 1_048_576) : 0} MB
                                    </strong>
                                    , which can be slow and may crash the browser tab on devices with limited memory
                                    (comfortable up to {PAM_WARN_ROWS.toLocaleString()} rows).
                                </p>
                                <p>
                                    <strong>Recommended:</strong> use CLARA, which clusters samples of the data.
                                    {pamWarning?.isAutomatic &&
                                        " Automatic k selection always uses PAM, so CLARA requires manual cluster mode."}
                                </p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        {pamWarning && !pamWarning.isAutomatic && (
                            <AlertDialogAction
                                onClick={() => {
                                    updateFormData("iterate", "Method", KMedoidsMethod.CLARA);
                                    setActiveTab("iterate");
                                }}
                            >
                                Switch to CLARA
                            </AlertDialogAction>
                        )}
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                void executeKMedoidsCluster(formData.main);
                            }}
                        >
                            Run PAM anyway
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default KMedoidsClusterContainer;