"use client";

import React, { useCallback, useMemo, useState } from "react";
import { AlertTriangle, ArrowBigLeft, ArrowBigRight, MoveHorizontal } from "lucide-react";
import type { Variable } from "@/types/Variable";
import { useDataStore } from "@/stores/useDataStore";
import DatasetVariableList, {
    NAIVE_BAYES_DRAG_MIME,
} from "@/components/Modals/Analyze/Classify/naive-bayes/components/dataset-variable-list";
import type { NaiveBayesDragPayload } from "@/components/Modals/Analyze/Classify/naive-bayes/components/dataset-variable-list";
import { useNaiveBayesTextWarnings } from "@/components/Modals/Analyze/Classify/naive-bayes/hooks/useNaiveBayesTextRules";
import type {
    NaiveBayesMainType,
    NaiveBayesSpecificationMode,
} from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";

type VariablesTabProps = {
    allVariables: Variable[];
    formData: NaiveBayesMainType;
    onChange: (update: Partial<NaiveBayesMainType>) => void;
    /**
     * v2 (N6): dipertahankan hanya demi kompatibilitas pemanggil lama
     * (`naive-bayes-main.tsx`). State sorotan kini LOKAL dan multi-pilih
     * (Select All (filtered)), sehingga kedua prop ini tidak lagi dipakai.
     */
    highlightedVariables?: { id: string; source: string } | null;
    setHighlightedVariables?: (value: { id: string; source: string } | null) => void;
};

/**
 * Implementasi AGENTS.md §3.3 (Temuan 2, laporan regresi Fase 18): dua mode
 * Variable Specification Method ("exclude" vs "candidates") kini SALING
 * EKSKLUSIF lewat satu field diskriminator `SpecificationMode`, bukan lagi
 * empat array independen yang bisa terisi bersamaan.
 *
 * REVISI PENTING (setelah percobaan pertama, atas instruksi eksplisit
 * pemilik produk): percobaan pertama memakai `TargetListConfig.droppable`
 * milik `VariableListManager` untuk membuat blok mode tidak aktif tampil
 * abu-abu. Ternyata `droppable: false` di `VariableListManager` MEMBLOKIR
 * DROP SEPENUHNYA (bukan cuma visual) -- karena mode default adalah
 * "exclude", blok Candidate Factors/Covariates jadi `droppable:false`
 * SEJAK AWAL dan tidak pernah bisa menerima drop pertama untuk
 * mengaktifkannya sama sekali (deadlock). Setelah didiskusikan, pemilik
 * produk memutuskan: TIDAK PERLU tampilan abu-abu sama sekali (menyimpang
 * dari AGENTS.md §3.3 poin 1 & 4 secara sengaja -- lihat laporan
 * implementasi untuk catatan bahwa AGENTS.md sendiri sebaiknya direvisi
 * menyesuaikan). Aturan yang dipakai sekarang, murni fungsional tanpa
 * gating `droppable`:
 * - Kedua blok (Exclude & Candidate Factors/Covariates) SELALU bisa
 *   menerima drop sejak awal (tidak ada blok yang dikunci).
 * - Begitu blok Exclude berisi >=1 variabel, isi blok Candidate
 *   Factors/Covariates (jika ada) dikembalikan ke "available", TAPI blok
 *   itu tetap bisa menerima drop lagi kapan saja (yang lalu akan
 *   mengembalikan Exclude ke available, dst -- saling eksklusif, bukan
 *   saling mengunci).
 * - Sebaliknya juga berlaku (drop ke Factors/Covariates mengosongkan &
 *   mengembalikan isi Exclude ke available, blok Exclude tetap bisa
 *   menerima drop lagi).
 *
 * CATATAN KETERBATASAN YANG DIWARISI (bukan diperkenalkan oleh perbaikan
 * ini, dilaporkan untuk diskusi, bukan diam-diam "diperbaiki" di luar
 * lingkup Temuan 2):
 * - AGENTS.md §3.3 poin 5 meminta "peringatan" eksplisit saat drop
 *   measurement-mismatch ditolak di mode candidates (mis. variabel
 *   `scale` ke Candidate Factors). `VariableListManager.handleDrop`/
 *   `handleDragOver` menolak drop semacam itu SEBELUM memanggil callback
 *   apa pun milik parent (`onMoveVariable`), jadi tidak ada hook yang
 *   bisa dipakai dari sini untuk memunculkan toast peringatan tanpa
 *   mengubah `VariableListManager.tsx` (dilarang §7). Drop ditolak
 *   secara senyap (cursor drag "not-allowed") -- sama seperti modul
 *   Classify lain yang memakai `allowedMeasurements` (mis. Nearest
 *   Neighbor), bukan regresi baru dari perbaikan ini.
 * - Daftar "Variables to Exclude" masih tanpa `allowedMeasurements`
 *   (variabel `measure === "unknown"` masih bisa masuk ke sana), sudah
 *   dicatat terpisah sebagai Temuan 4 di laporan regresi Fase 18 --
 *   sengaja TIDAK ikut diperbaiki di sini.
 */
/**
 * REVISI v2 (Fase N6, AGENTS_V2 §3.2): tab Variables kini punya
 * - panel kiri `DatasetVariableList` dengan kotak Filter + "Select All
 *   (filtered)" dan sorotan MULTI-pilih (Shift-range, Ctrl-toggle);
 * - blok baru "Text Features": slot `Raw Text Variable` (maks. 1, hanya
 *   STRING) dan `Word-Vector Variables` (tak terbatas, hanya NUMERIC) yang
 *   SALING EKSKLUSIF (mengisi satu slot mengosongkan slot lain);
 * - peringatan non-blokir W-VEC / W-STR / W-LEAK (§3.4) di bawah panel kanan.
 *
 * `VariableListManager` (komponen bersama) hanya mendukung SATU sorotan dan
 * tidak boleh diubah (AGENTS_V2 §12), sehingga tata letak dua panel dibuat
 * di sini sebagai wrapper tipis. Perilaku v1 dipertahankan: mode Exclude vs
 * Candidates saling eksklusif lewat `SpecificationMode`, aturan measurement
 * Target/Factors/Covariates, drag & drop, tombol panah, dan double-click.
 * Keterbatasan v1 (drop yang ditolak berlangsung senyap) tetap berlaku.
 */

export type NaiveBayesZoneId =
    | "target"
    | "excluded"
    | "factors"
    | "covariates"
    | "rawText"
    | "wordVector";

type ZoneRule = {
    id: NaiveBayesZoneId;
    title: string;
    height: string;
    maxItems?: number;
    allowedMeasurements?: string[];
    allowedTypes?: string[];
};

/** Aturan tiap zona panel kanan (urutan = urutan tampil). */
export const NAIVE_BAYES_ZONE_RULES: Record<NaiveBayesZoneId, ZoneRule> = {
    target: {
        id: "target",
        title: "Target / Label",
        height: "60px",
        maxItems: 1,
        allowedMeasurements: ["nominal", "ordinal"],
    },
    excluded: { id: "excluded", title: "Variables to Exclude", height: "120px" },
    factors: {
        id: "factors",
        title: "Candidate Factors / Categorical Features",
        height: "120px",
        allowedMeasurements: ["nominal", "ordinal"],
    },
    covariates: {
        id: "covariates",
        title: "Candidate Covariates / Numerical Features",
        height: "120px",
        allowedMeasurements: ["scale"],
    },
    rawText: {
        id: "rawText",
        title: "Raw Text Variable",
        height: "60px",
        maxItems: 1,
        allowedTypes: ["STRING"],
    },
    wordVector: {
        id: "wordVector",
        title: "Word-Vector Variables",
        height: "120px",
        allowedTypes: ["NUMERIC"],
    },
};

const ZONE_ORDER_V1: NaiveBayesZoneId[] = ["target", "excluded", "factors", "covariates"];
const ZONE_ORDER_TEXT: NaiveBayesZoneId[] = ["rawText", "wordVector"];
const ALL_ZONES: NaiveBayesZoneId[] = [...ZONE_ORDER_V1, ...ZONE_ORDER_TEXT];

export type NaiveBayesZoneLists = Record<NaiveBayesZoneId, string[]>;

/** Apakah variabel boleh masuk zona (aturan measurement/tipe, AGENTS_V2 §3.2). */
export function isAllowedInZone(variable: Variable, zoneId: NaiveBayesZoneId): boolean {
    const rule = NAIVE_BAYES_ZONE_RULES[zoneId];
    if (rule.allowedMeasurements && rule.allowedMeasurements.length > 0) {
        const measure = variable.measure?.toLowerCase();
        if (!measure || !rule.allowedMeasurements.includes(measure)) return false;
    }
    if (rule.allowedTypes && rule.allowedTypes.length > 0) {
        const type = variable.type?.toUpperCase();
        if (!type || !rule.allowedTypes.includes(type)) return false;
    }
    return true;
}

/**
 * Isi tiap zona yang TAMPIL dari `main`. Isi blok mode yang tidak aktif
 * dianggap kosong (jaring pengaman data lama), dan Raw Text menang atas
 * Word-Vector bila keduanya terisi (state tidak konsisten).
 */
export function readZoneLists(main: NaiveBayesMainType): NaiveBayesZoneLists {
    const mode: NaiveBayesSpecificationMode = main.SpecificationMode ?? "exclude";
    const rawText = main.RawTextVar ? [main.RawTextVar] : [];
    return {
        target: main.TargetVar ? [main.TargetVar] : [],
        excluded: mode === "exclude" ? [...(main.ExcludedVar ?? [])] : [],
        factors: mode === "candidates" ? [...(main.CandidateFactors ?? [])] : [],
        covariates: mode === "candidates" ? [...(main.CandidateCovariates ?? [])] : [],
        rawText,
        wordVector: rawText.length > 0 ? [] : [...(main.TextVectorVars ?? [])],
    };
}

function insertAt(list: string[], items: string[], index?: number): string[] {
    const result = [...list];
    if (index !== undefined && index >= 0 && index <= result.length) {
        result.splice(index, 0, ...items);
    } else {
        result.push(...items);
    }
    return result;
}

function listsToUpdate(
    lists: NaiveBayesZoneLists,
    mode: NaiveBayesSpecificationMode
): Partial<NaiveBayesMainType> {
    const rawText = lists.rawText[0] ?? null;
    const vector = lists.wordVector;
    return {
        TargetVar: lists.target[0] ?? null,
        SpecificationMode: mode,
        ExcludedVar: lists.excluded,
        CandidateFactors: lists.factors,
        CandidateCovariates: lists.covariates,
        RawTextVar: rawText,
        TextVectorVars: vector.length > 0 ? vector : null,
        // Nilai efektif tetap diturunkan dari isi slot (getEffectiveTextSource);
        // di sini hanya dijaga konsisten dengan isi slot.
        TextSource: rawText ? "raw" : vector.length > 0 ? "vector" : "none",
    };
}

export type MoveResult = {
    update: Partial<NaiveBayesMainType>;
    /** Nama variabel yang benar-benar dipindah (lolos aturan tipe/measurement). */
    moved: string[];
};

/**
 * Memindahkan `names` ke zona `toId` ("available" = kembali ke daftar kiri).
 * Fungsi murni. Jaminan:
 * - satu variabel hanya berada di SATU tempat (dicabut dari semua zona dulu);
 * - variabel yang tidak lolos aturan zona tujuan diabaikan (tidak dipindah);
 * - zona maxItems=1 (Target, Raw Text) memakai variabel lolos pertama, isi
 *   lama kembali ke Available;
 * - mode Exclude/Candidates saling eksklusif (pola v1);
 * - Raw Text dan Word-Vector saling eksklusif: mengisi salah satu
 *   mengosongkan yang lain (isinya kembali ke Available).
 * Mengembalikan null bila tidak ada yang bisa dipindah.
 */
export function moveVariables(
    main: NaiveBayesMainType,
    names: string[],
    toId: NaiveBayesZoneId | "available",
    variableMap: Map<string, Variable>,
    targetIndex?: number,
    options?: { skipRuleCheck?: boolean }
): MoveResult | null {
    let movable = Array.from(new Set(names)).filter((n) => variableMap.has(n));
    if (toId !== "available") {
        if (!options?.skipRuleCheck) {
            movable = movable.filter((n) => isAllowedInZone(variableMap.get(n) as Variable, toId));
        }
        const max = NAIVE_BAYES_ZONE_RULES[toId].maxItems;
        if (max) movable = movable.slice(0, max);
    }
    if (movable.length === 0) return null;

    const lists = readZoneLists(main);
    let mode: NaiveBayesSpecificationMode = main.SpecificationMode ?? "exclude";

    const moving = new Set(movable);
    for (const id of ALL_ZONES) {
        lists[id] = lists[id].filter((n) => !moving.has(n));
    }

    if (toId === "excluded" && mode !== "exclude") {
        mode = "exclude";
        lists.factors = [];
        lists.covariates = [];
    } else if ((toId === "factors" || toId === "covariates") && mode !== "candidates") {
        mode = "candidates";
        lists.excluded = [];
    }

    if (toId === "target") {
        lists.target = [movable[0]];
    } else if (toId === "rawText") {
        lists.rawText = [movable[0]];
        lists.wordVector = [];
    } else if (toId === "wordVector") {
        lists.rawText = [];
        lists.wordVector = insertAt(lists.wordVector, movable, targetIndex);
    } else if (toId !== "available") {
        lists[toId] = insertAt(lists[toId], movable, targetIndex);
    }

    return { update: listsToUpdate(lists, mode), moved: movable };
}

/**
 * Menempatkan `names` (yang sudah ada di `list`) pada `index` (indeks pada
 * daftar ASLI, seperti indeks item tujuan drop). Fungsi murni.
 */
export function reorderWithin(list: string[], names: string[], index: number): string[] {
    const moving = new Set(names.filter((n) => list.includes(n)));
    if (moving.size === 0) return list;
    const before = list.slice(0, index).filter((n) => moving.has(n)).length;
    const remaining = list.filter((n) => !moving.has(n));
    const ordered = list.filter((n) => moving.has(n));
    const adjusted = Math.max(0, Math.min(remaining.length, index - before));
    remaining.splice(adjusted, 0, ...ordered);
    return remaining;
}

/** Pembaruan `main` untuk urutan baru sebuah zona (hanya zona yang berdaftar). */
function reorderUpdate(zoneId: NaiveBayesZoneId, names: string[]): Partial<NaiveBayesMainType> | null {
    if (zoneId === "excluded") return { ExcludedVar: names };
    if (zoneId === "factors") return { CandidateFactors: names };
    if (zoneId === "covariates") return { CandidateCovariates: names };
    if (zoneId === "wordVector") return { TextVectorVars: names.length > 0 ? names : null };
    return null;
}

type Selection = { source: string; names: string[] };

export const VariablesTab = ({ allVariables, formData, onChange }: VariablesTabProps) => {
    const variableMap = useMemo(
        () => new Map(allVariables.map((v) => [v.name, v])),
        [allVariables]
    );

    // Fallback "exclude" untuk state lama (mis. data tersimpan di
    // IndexedDB dari sebelum field ini ada) -- lihat juga default baru di
    // `constants/naive-bayes-default.ts`.
    const mode: NaiveBayesSpecificationMode = formData.SpecificationMode ?? "exclude";

    const zoneLists = useMemo(() => readZoneLists(formData), [formData]);

    // Sorotan multi-pilih: satu sumber aktif (panel kiri "available" atau
    // salah satu zona kanan) dengan daftar nama yang disorot.
    const [selection, setSelection] = useState<Selection>({ source: "available", names: [] });

    const availableVars = useMemo(() => {
        const used = new Set<string>();
        for (const id of ALL_ZONES) for (const n of zoneLists[id]) used.add(n);
        return allVariables.filter((v) => !used.has(v.name));
    }, [allVariables, zoneLists]);

    const highlightedAvailable = useMemo(
        () =>
            selection.source === "available"
                ? selection.names
                      .map((n) => variableMap.get(n))
                      .filter((v): v is Variable => v !== undefined)
                : [],
        [selection, variableMap]
    );

    // Peringatan non-blokir §3.4 (useMemo ada di dalam hook).
    const dataRows = useDataStore((s) => s.data);
    const warnings = useNaiveBayesTextWarnings(formData, allVariables, dataRows);

    const applyMove = useCallback(
        (
            names: string[],
            toId: NaiveBayesZoneId | "available",
            targetIndex?: number,
            options?: { skipRuleCheck?: boolean }
        ) => {
            const result = moveVariables(formData, names, toId, variableMap, targetIndex, options);
            if (!result) return;
            onChange(result.update);
            const movedSet = new Set(result.moved);
            setSelection((prev) => ({
                source: prev.source,
                names: prev.names.filter((n) => !movedSet.has(n)),
            }));
        },
        [formData, variableMap, onChange]
    );

    const handleHighlightAvailable = useCallback((variables: Variable[]) => {
        setSelection({ source: "available", names: variables.map((v) => v.name) });
    }, []);

    const handleZoneItemClick = (zoneId: NaiveBayesZoneId, name: string, e: React.MouseEvent) => {
        if ((e.ctrlKey || e.metaKey) && selection.source === zoneId) {
            setSelection({
                source: zoneId,
                names: selection.names.includes(name)
                    ? selection.names.filter((n) => n !== name)
                    : [...selection.names, name],
            });
        } else {
            setSelection({ source: zoneId, names: [name] });
        }
    };

    const handleAvailableDoubleClick = (variable: Variable) => {
        const name = variable.name;
        if (!formData.TargetVar) {
            // Perilaku v1: double-click pertama mengisi Target tanpa cek measurement.
            applyMove([name], "target", undefined, { skipRuleCheck: true });
            return;
        }

        // Double-click dari "available" tidak menunjuk satu blok tujuan
        // eksplisit seperti drag & drop, sehingga tujuannya mengikuti MODE yang
        // sedang aktif -- konsisten dengan AGENTS.md §3.3.
        if (mode === "exclude") {
            applyMove([name], "excluded");
            return;
        }

        // Mode "candidates": tipe statistik murni ditentukan dari `measure`.
        if (variable.measure === "scale") {
            applyMove([name], "covariates");
        } else if (variable.measure === "nominal" || variable.measure === "ordinal") {
            applyMove([name], "factors");
        }
    };

    const parsePayload = (e: React.DragEvent): NaiveBayesDragPayload | null => {
        try {
            const raw = e.dataTransfer.getData(NAIVE_BAYES_DRAG_MIME);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as Partial<NaiveBayesDragPayload>;
            if (typeof parsed.source !== "string" || !Array.isArray(parsed.names)) return null;
            return { source: parsed.source, names: parsed.names.map(String) };
        } catch {
            return null;
        }
    };

    const handleZoneDrop = (e: React.DragEvent, zoneId: NaiveBayesZoneId, index?: number) => {
        e.preventDefault();
        e.stopPropagation();
        const payload = parsePayload(e);
        if (!payload) return;
        if (payload.source === zoneId) {
            // Urut ulang dalam zona yang sama.
            if (index === undefined) return;
            const update = reorderUpdate(zoneId, reorderWithin(zoneLists[zoneId], payload.names, index));
            if (update) onChange(update);
            return;
        }
        applyMove(payload.names, zoneId, index);
    };

    const handleDropToAvailable = (payload: NaiveBayesDragPayload) => {
        applyMove(payload.names, "available");
    };

    const handleZoneDragStart = (e: React.DragEvent, zoneId: NaiveBayesZoneId, name: string) => {
        const names =
            selection.source === zoneId && selection.names.includes(name)
                ? zoneLists[zoneId].filter((n) => selection.names.includes(n))
                : [name];
        const payload: NaiveBayesDragPayload = { source: zoneId, names };
        e.dataTransfer.setData(NAIVE_BAYES_DRAG_MIME, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = "move";
    };

    const renderZone = (zoneId: NaiveBayesZoneId) => {
        const rule = NAIVE_BAYES_ZONE_RULES[zoneId];
        const names = zoneLists[zoneId];
        const selectedHere = selection.source === zoneId ? selection.names : [];

        // Tombol panah masuk: tampil hanya bila ada sorotan di panel kiri yang
        // lolos aturan zona ini.
        const allowedFromAvailable = highlightedAvailable.filter((v) => isAllowedInZone(v, zoneId));
        const showMoveIn = allowedFromAvailable.length > 0;
        const showMoveBack = selectedHere.length > 0;

        return (
            <div
                key={zoneId}
                className="mb-2 flex flex-col"
                data-testid={`nb-zone-${zoneId}`}
            >
                <div className="mb-1.5 flex h-6 items-center px-1 text-sm font-medium">
                    {showMoveIn && (
                        <button
                            type="button"
                            className="mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-border bg-accent/50 p-0.5 hover:border-primary hover:bg-accent"
                            aria-label={`Move selected to ${rule.title}`}
                            data-testid={`nb-move-to-${zoneId}`}
                            onClick={() => applyMove(highlightedAvailable.map((v) => v.name), zoneId)}
                        >
                            <ArrowBigRight size={16} />
                        </button>
                    )}
                    {showMoveBack && (
                        <button
                            type="button"
                            className="mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-border bg-accent/50 p-0.5 hover:border-primary hover:bg-accent"
                            aria-label={`Move selected from ${rule.title} back to Available`}
                            data-testid={`nb-move-back-${zoneId}`}
                            onClick={() => applyMove(selectedHere, "available")}
                        >
                            <ArrowBigLeft size={16} />
                        </button>
                    )}
                    <span className="truncate" title={rule.title}>
                        {rule.title}
                    </span>
                </div>
                <div
                    role="group"
                    aria-label={rule.title}
                    data-testid={`nb-zone-list-${zoneId}`}
                    className="relative w-full overflow-y-auto overflow-x-hidden rounded-md border border-border bg-background p-1"
                    style={{ height: rule.height }}
                    onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => handleZoneDrop(e, zoneId)}
                >
                    {names.length === 0 && (
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-2 text-muted-foreground">
                            <MoveHorizontal size={18} className="mb-1" />
                            <p className="text-center text-xs">
                                {rule.maxItems === 1 ? "Drop one variable here" : "Drop variables here"}
                            </p>
                        </div>
                    )}
                    <div className="space-y-0.5 p-0.5">
                        {names.map((name, index) => {
                            const variable = variableMap.get(name);
                            const isSelected = selectedHere.includes(name);
                            return (
                                <div
                                    key={name}
                                    role="option"
                                    aria-selected={isSelected}
                                    data-testid={`nb-zone-item-${zoneId}-${name}`}
                                    draggable
                                    className={`flex cursor-grab items-center rounded-md border p-1 text-sm hover:bg-accent ${
                                        isSelected ? "border-primary bg-accent" : "border-border"
                                    }`}
                                    onClick={(e) => handleZoneItemClick(zoneId, name, e)}
                                    onDoubleClick={() => applyMove([name], "available")}
                                    onDragStart={(e) => handleZoneDragStart(e, zoneId, name)}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        e.dataTransfer.dropEffect = "move";
                                    }}
                                    onDrop={(e) => handleZoneDrop(e, zoneId, index)}
                                >
                                    <span
                                        className="truncate"
                                        title={variable?.label ? `${variable.label} [${name}]` : name}
                                    >
                                        {variable?.label ? `${variable.label} [${name}]` : name}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="nb-variables-tab">
            <div className="h-[460px] min-h-0 rounded-md border">
                <DatasetVariableList
                    variables={availableVars}
                    highlightedVariables={highlightedAvailable}
                    onHighlight={handleHighlightAvailable}
                    onDoubleClick={handleAvailableDoubleClick}
                    onDropVariables={handleDropToAvailable}
                />
            </div>

            <div className="flex flex-col">
                {ZONE_ORDER_V1.map(renderZone)}

                <div className="mb-1 mt-1 border-t pt-2 text-sm font-semibold" data-testid="nb-text-features-heading">
                    Text Features
                </div>
                <p className="mb-2 px-1 text-xs text-muted-foreground">
                    Raw Text Variable and Word-Vector Variables are mutually exclusive.
                </p>
                {ZONE_ORDER_TEXT.map(renderZone)}

                {warnings.length > 0 && (
                    <div
                        role="status"
                        data-testid="nb-text-warnings"
                        className="mt-1 space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
                    >
                        {warnings.map((message) => (
                            <div key={message} className="flex items-start gap-1.5" data-testid="nb-text-warning">
                                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                                <span>{message}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default VariablesTab;
