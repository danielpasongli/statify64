// Fase 11 — Skeleton container Apply Model (4 tab: Model, Variables, Save, Output).
// Fase 12 — Tab Model terpasang; tab Variables/Save/Output disabled selama
// ModelJson === null (AGENTS.md §6.1).
// Fase 13 — Tab Variables (mapping, AGENTS.md §6.4) terpasang.
// Fase 14 — Tab Save & Output (AGENTS.md §3.5, §6.5) terpasang.
// Fase 15 — Validasi terpusat (§6.5), OK/Reset/Cancel/Help, persistensi
// IndexedDB "ApplyModel" dan reset parsial saat dataset berubah (§6.1).
// Fase 17 — OK menjalankan pipeline penuh lewat `applyModel`
// (services/apply-model-analysis.ts: worker -> Output Viewer -> kolom
// dataset); galat toast lewat `getUserFriendlyApplyModelError` (§6.6).

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useModal } from "@/hooks/useModal";
import { clearFormData, getFormData, saveFormData } from "@/hooks/useIndexedDB";
import { useDataStore } from "@/stores/useDataStore";
import { useVariableStore } from "@/stores/useVariableStore";
import type { BaseModalProps } from "@/types/modalTypes";
import type { Variable } from "@/types/Variable";
import { getModelAdapter, validateAnyModel } from "@/components/Modals/Analyze/Classify/apply-model/adapters/registry";
import { APPLY_MODEL_MESSAGES } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import { ApplyModelDefault } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-default";
import { autoMapFeatures } from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelMappingRules";
import {
    computeApplyModelValidation,
    useApplyModelValidation,
} from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelValidation";
import {
    applyModel,
    type ApplyModelRunSummary,
} from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-analysis";
import { getUserFriendlyApplyModelError } from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-error-messages";
import type { ModelLoadSuccess } from "@/components/Modals/Analyze/Classify/apply-model/services/model-loader";
import type {
    ApplyModelOutputTabType,
    ApplyModelSaveTabType,
    ApplyModelSourceKind,
    ApplyModelType,
    ApplyModelVariablesTabType,
} from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import ModelTab from "@/components/Modals/Analyze/Classify/apply-model/dialogs/model-tab";
import VariablesTab from "@/components/Modals/Analyze/Classify/apply-model/dialogs/variables-tab";
import SaveTab from "@/components/Modals/Analyze/Classify/apply-model/dialogs/save-tab";
import OutputTab from "@/components/Modals/Analyze/Classify/apply-model/dialogs/output-tab";

export const cloneApplyModelDefault = (): ApplyModelType =>
    JSON.parse(JSON.stringify(ApplyModelDefault)) as ApplyModelType;

/**
 * AGENTS.md §6.1 "Saat model baru berhasil dimuat": `model` diisi dari hasil
 * muat, `variables` direset lalu auto-map terhadap dataset aktif, `save`
 * direset ke default, `output` dipertahankan.
 */
export function applyLoadedModel(
    prev: ApplyModelType,
    loaded: ModelLoadSuccess,
    sourceKind: ApplyModelSourceKind,
    variables: Variable[]
): ApplyModelType {
    const mapped = autoMapFeatures(loaded.descriptor, variables);
    return {
        model: {
            SourceKind: sourceKind,
            SourceRef: loaded.sourceRef,
            SourceLabel: loaded.sourceLabel,
            ModelJson: loaded.model,
        },
        variables: {
            FeatureMapping: mapped.FeatureMapping,
            ActualTargetVar: mapped.ActualTargetVar,
        },
        save: cloneApplyModelDefault().save,
        output: prev.output,
    };
}

const VALIDATION_ERROR_TOAST_ID = "apply-model-validation-error";

const DATASET_CHANGED_MESSAGE =
    "Dataset berubah — pemetaan variabel Apply Model disusun ulang.";

/**
 * Fingerprint ringan dari daftar variabel dataset (name+type+measure), untuk
 * mendeteksi "dataset berubah" (AGENTS.md §6.1). DISALIN dari
 * NB/dialogs/naive-bayes-main.tsx:48-52 (bukan di-import).
 */
export const getVariablesFingerprint = (vars: Variable[]): string =>
    vars
        .map((v) => `${v.name}|${v.type ?? ""}|${v.measure}`)
        .sort()
        .join(";");

/** Bentuk yang disimpan ke IndexedDB "ApplyModel" (AGENTS.md §6.1). */
export type PersistedApplyModelForm = ApplyModelType & {
    _variablesFingerprint?: string;
};

/**
 * Gabungkan data tersimpan dengan default per section (pola NB). Bila
 * `ModelJson` tersimpan tidak lagi lolos `validateAnyModel`, model beserta
 * mapping & save dibuang (invarian: ModelJson non-null selalu valid).
 */
export function mergeWithDefaults(
    saved: Partial<ApplyModelType> | null | undefined
): ApplyModelType {
    const defaults = cloneApplyModelDefault();
    if (!saved) return defaults;

    const model = { ...defaults.model, ...(saved.model ?? {}) };
    if (model.ModelJson !== null && !validateAnyModel(model.ModelJson).ok) {
        return {
            ...defaults,
            output: { ...defaults.output, ...(saved.output ?? {}) },
        };
    }

    return {
        model,
        variables: { ...defaults.variables, ...(saved.variables ?? {}) },
        save: {
            ...defaults.save,
            ...(saved.save ?? {}),
            CustomNames: {
                ...defaults.save.CustomNames,
                ...(saved.save?.CustomNames ?? {}),
            },
        },
        output: { ...defaults.output, ...(saved.output ?? {}) },
    };
}

/**
 * AGENTS.md §6.1 "Dataset berubah": HANYA `variables` dan `save.CustomNames`
 * direset ke default, lalu auto-map dijalankan ulang terhadap model yang
 * masih dimuat. `model` dan `output` (serta sisa `save`) dipertahankan.
 */
export function reconcileForDatasetChange(
    prev: ApplyModelType,
    variables: Variable[]
): ApplyModelType {
    const defaults = cloneApplyModelDefault();
    const validation =
        prev.model.ModelJson === null
            ? null
            : validateAnyModel(prev.model.ModelJson);
    const mapped =
        validation?.ok
            ? autoMapFeatures(validation.descriptor, variables)
            : null;

    return {
        model: prev.model,
        variables:
            mapped === null
                ? defaults.variables
                : {
                      FeatureMapping: mapped.FeatureMapping,
                      ActualTargetVar: mapped.ActualTargetVar,
                  },
        save: { ...prev.save, CustomNames: defaults.save.CustomNames },
        output: prev.output,
    };
}

export type { ApplyModelRunSummary };

/** Teks toast sukses (AGENTS.md §6.1). */
export function formatApplyModelSuccessMessage(
    summary: ApplyModelRunSummary
): string {
    return `Prediksi selesai: ${summary.scoredRows} baris diprediksi. Kolom baru: ${summary.finalNames.join(", ")}.`;
}

const ApplyModelMain: React.FC<BaseModalProps> = ({ onClose }) => {
    const { closeModal } = useModal();
    const variables = useVariableStore((s) => s.variables);
    const [formData, setFormData] = useState<ApplyModelType>(
        cloneApplyModelDefault
    );
    const [activeTab, setActiveTab] = useState("model");
    const [helperMode, setHelperMode] = useState(false);
    // Dinaikkan saat Reset / pemulihan dari IndexedDB agar state internal
    // Tab Model (radio sumber, pilihan Select) ikut tersinkron (pola KNN).
    const [resetKey, setResetKey] = useState(0);

    // Cermin state terbaru untuk efek/handler async (menghindari efek
    // samping di dalam updater setState).
    const formDataRef = useRef(formData);
    formDataRef.current = formData;
    const variablesRef = useRef(variables);
    variablesRef.current = variables;

    // Baseline fingerprint dataset untuk mendeteksi perubahan SELAGI panel
    // terbuka; ditetapkan setelah hydration awal selesai (pola NB).
    const hasHydratedRef = useRef(false);
    const variablesFingerprintBaselineRef = useRef<string | null>(null);
    // Model yang dimuat pengguna sebelum hydration selesai tidak boleh
    // ditimpa data tersimpan.
    const hasUserLoadedModelRef = useRef(false);

    useEffect(() => {
        let isActive = true;

        const loadFormData = async () => {
            try {
                const saved = (await getFormData(
                    "ApplyModel"
                )) as PersistedApplyModelForm | null;
                if (!isActive || !saved || hasUserLoadedModelRef.current) {
                    return;
                }

                const restored = mergeWithDefaults(saved);
                const datasetMatches =
                    saved._variablesFingerprint ===
                    getVariablesFingerprint(variablesRef.current);

                setResetKey((value) => value + 1);
                if (datasetMatches) {
                    setFormData(restored);
                } else {
                    setFormData(
                        reconcileForDatasetChange(
                            restored,
                            variablesRef.current
                        )
                    );
                    if (restored.model.ModelJson !== null) {
                        toast.info(DATASET_CHANGED_MESSAGE);
                    }
                }
            } catch {
                // Penyimpanan tidak tersedia / rusak: pakai pengaturan default.
            } finally {
                if (isActive) {
                    variablesFingerprintBaselineRef.current =
                        getVariablesFingerprint(variablesRef.current);
                    hasHydratedRef.current = true;
                }
            }
        };

        void loadFormData();

        return () => {
            isActive = false;
        };
    }, []);

    // Dataset berubah SELAGI panel terbuka (AGENTS.md §6.1): reset parsial.
    useEffect(() => {
        if (!hasHydratedRef.current) return;
        const fingerprint = getVariablesFingerprint(variables);
        if (fingerprint === variablesFingerprintBaselineRef.current) return;
        variablesFingerprintBaselineRef.current = fingerprint;

        const hadModel = formDataRef.current.model.ModelJson !== null;
        setFormData((prev) => reconcileForDatasetChange(prev, variables));
        if (hadModel) toast.info(DATASET_CHANGED_MESSAGE);
    }, [variables]);

    const hasModel = formData.model.ModelJson !== null;

    // Descriptor dibangun dari model mentah lewat registry (generik, §2 P2).
    const descriptor = useMemo(() => {
        if (formData.model.ModelJson === null) return null;
        const validation = validateAnyModel(formData.model.ModelJson);
        return validation.ok ? validation.descriptor : null;
    }, [formData.model.ModelJson]);

    // Adapter dicari lewat registry dari descriptor (generik, §2 P2).
    const adapter = useMemo(
        () => (descriptor === null ? null : getModelAdapter(descriptor.modelType)),
        [descriptor]
    );

    const { validation } = useApplyModelValidation(formData, variables);

    const handleVariablesChange = useCallback(
        (next: ApplyModelVariablesTabType) => {
            setFormData((prev) => ({ ...prev, variables: next }));
        },
        []
    );

    const handleSaveChange = useCallback((next: ApplyModelSaveTabType) => {
        setFormData((prev) => ({ ...prev, save: next }));
    }, []);

    const handleOutputChange = useCallback((next: ApplyModelOutputTabType) => {
        setFormData((prev) => ({ ...prev, output: next }));
    }, []);

    const handleModelLoaded = useCallback(
        (loaded: ModelLoadSuccess, sourceKind: ApplyModelSourceKind) => {
            hasUserLoadedModelRef.current = true;
            setFormData((prev) =>
                applyLoadedModel(prev, loaded, sourceKind, variables)
            );
        },
        [variables]
    );

    const handleCancel = useCallback(() => {
        closeModal();
        onClose();
    }, [closeModal, onClose]);

    const handleOK = useCallback(() => {
        // Validasi ulang terhadap state terbaru (AGENTS.md §6.1).
        const { validation: current, firstErrorMessage } =
            computeApplyModelValidation(formData, variables);
        if (!current.isValid) {
            toast.error(firstErrorMessage ?? APPLY_MODEL_MESSAGES.AM_E_NO_MODEL, {
                id: VALIDATION_ERROR_TOAST_ID,
            });
            return;
        }

        closeModal();
        onClose();

        const run = async (): Promise<ApplyModelRunSummary> => {
            const payload: PersistedApplyModelForm = {
                ...formData,
                _variablesFingerprint: getVariablesFingerprint(variables),
            };
            try {
                await saveFormData("ApplyModel", payload);
            } catch {
                // Persistensi bersifat best-effort; tidak boleh menggagalkan run.
            }
            return applyModel({
                formData,
                variables,
                dataVariables: useDataStore.getState().data as unknown as string[][],
            });
        };

        toast.promise(run(), {
            loading: "Menerapkan model ke dataset...",
            success: (summary) => formatApplyModelSuccessMessage(summary),
            error: getUserFriendlyApplyModelError,
        });
    }, [closeModal, onClose, formData, variables]);

    const handleReset = useCallback(async () => {
        setFormData(cloneApplyModelDefault());
        setActiveTab("model");
        setResetKey((value) => value + 1);
        try {
            await clearFormData("ApplyModel");
        } catch {
            // Gagal menghapus data tersimpan: state form tetap sudah direset.
        }
        toast.success("Pengaturan Apply Model telah direset.");
    }, []);

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
                <h2 className="text-sm font-semibold">Apply Model</h2>
            </div>

            {/* Tabs */}
            <div className="flex-1 overflow-auto px-4 py-3">
                <Tabs
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className="w-full"
                >
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="model">Model</TabsTrigger>
                        <TabsTrigger value="variables" disabled={!hasModel}>
                            Variables
                        </TabsTrigger>
                        <TabsTrigger value="save" disabled={!hasModel}>
                            Save
                        </TabsTrigger>
                        <TabsTrigger value="output" disabled={!hasModel}>
                            Output
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="model" className="mt-3">
                        <ModelTab
                            key={`model-${resetKey}`}
                            data={formData.model}
                            onModelLoaded={handleModelLoaded}
                            showFieldHelp={helperMode}
                        />
                    </TabsContent>

                    <TabsContent value="variables" className="mt-3">
                        {descriptor !== null && (
                            <VariablesTab
                                data={formData.variables}
                                descriptor={descriptor}
                                variables={variables}
                                onChange={handleVariablesChange}
                                showFieldHelp={helperMode}
                            />
                        )}
                    </TabsContent>

                    <TabsContent value="save" className="mt-3">
                        {descriptor !== null && adapter !== null && (
                            <SaveTab
                                data={formData.save}
                                descriptor={descriptor}
                                adapter={adapter}
                                existingVariables={variables}
                                onChange={handleSaveChange}
                                showFieldHelp={helperMode}
                            />
                        )}
                    </TabsContent>

                    <TabsContent value="output" className="mt-3">
                        <OutputTab
                            data={formData.output}
                            hasActualTarget={formData.variables.ActualTargetVar !== null}
                            onChange={handleOutputChange}
                            showFieldHelp={helperMode}
                        />
                    </TabsContent>
                </Tabs>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t">
                <Button
                    type="button"
                    variant="ghost"
                    aria-pressed={helperMode}
                    aria-label="Toggle help"
                    onClick={() => setHelperMode((value) => !value)}
                    className={helperMode ? "bg-accent" : undefined}
                >
                    <CircleHelp className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-2">
                    <Button disabled={!validation.isValid} onClick={handleOK}>
                        OK
                    </Button>
                    <Button variant="outline" onClick={handleReset}>
                        Reset
                    </Button>
                    <Button variant="outline" onClick={handleCancel}>
                        Cancel
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ApplyModelMain;
