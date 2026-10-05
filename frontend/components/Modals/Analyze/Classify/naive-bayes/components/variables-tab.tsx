"use client";

import React, { useMemo } from "react";
import VariableListManager from "@/components/Common/VariableListManager";
import type { TargetListConfig } from "@/components/Common/VariableListManager";
import type { Variable } from "@/types/Variable";
import type {
    NaiveBayesMainType,
    NaiveBayesSpecificationMode,
} from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";

type VariablesTabProps = {
    allVariables: Variable[];
    formData: NaiveBayesMainType;
    onChange: (update: Partial<NaiveBayesMainType>) => void;
    highlightedVariables: { id: string; source: string } | null;
    setHighlightedVariables: (value: { id: string; source: string } | null) => void;
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
export const VariablesTab = ({
    allVariables,
    formData,
    onChange,
    highlightedVariables,
    setHighlightedVariables,
}: VariablesTabProps) => {
    const variableMap = useMemo(
        () => new Map(allVariables.map((v) => [v.name, v])),
        [allVariables]
    );

    // Fallback "exclude" untuk state lama (mis. data tersimpan di
    // IndexedDB dari sebelum field ini ada) -- lihat juga default baru di
    // `constants/naive-bayes-default.ts`.
    const mode: NaiveBayesSpecificationMode = formData.SpecificationMode ?? "exclude";

    const targetVar = useMemo(
        () => (formData.TargetVar ? [formData.TargetVar] : []),
        [formData.TargetVar]
    );

    // Guard tampilan (bukan pembatas interaksi -- kedua blok TETAP selalu
    // bisa menerima drop, lihat komentar di kepala file): isi blok mode
    // yang sedang tidak aktif seharusnya SELALU sudah kosong di formData
    // (dikosongkan tuntas oleh `handleMoveVariable` begitu mode
    // berpindah). Filter ini hanya jaring pengaman tambahan untuk state
    // lama/tidak konsisten (mis. data tersimpan dari sebelum
    // SpecificationMode ada, saat kedua kelompok array bisa saja terisi
    // bersamaan) supaya tidak tampil dobel sebelum interaksi berikutnya
    // "membersihkan"-nya.
    const excludedVars = useMemo(
        () => (mode === "exclude" ? formData.ExcludedVar ?? [] : []),
        [mode, formData.ExcludedVar]
    );

    const candidateFactors = useMemo(
        () => (mode === "candidates" ? formData.CandidateFactors ?? [] : []),
        [mode, formData.CandidateFactors]
    );

    const candidateCovariates = useMemo(
        () => (mode === "candidates" ? formData.CandidateCovariates ?? [] : []),
        [mode, formData.CandidateCovariates]
    );

    const mapToVariables = (names: string[]): Variable[] =>
        names
            .map((name) => variableMap.get(name))
            .filter((v): v is Variable => v !== undefined);

    const availableVars = useMemo(() => {
        const used = new Set([
            ...targetVar,
            ...excludedVars,
            ...candidateFactors,
            ...candidateCovariates,
        ]);
        return allVariables.filter((v) => !used.has(v.name));
    }, [allVariables, targetVar, excludedVars, candidateFactors, candidateCovariates]);

    const targetLists: TargetListConfig[] = useMemo(
        () => [
            {
                id: "target",
                title: "Target / Label",
                variables: mapToVariables(targetVar),
                height: "60px",
                maxItems: 1,
                allowedMeasurements: ["nominal", "ordinal"],
            },
            {
                id: "excluded",
                title: "Variables to Exclude",
                variables: mapToVariables(excludedVars),
                height: "120px",
                // Sengaja TIDAK diberi `droppable: false` kapan pun --
                // blok ini harus selalu bisa menerima drop supaya bisa
                // dipakai kapan saja untuk berpindah balik ke mode
                // "exclude" (lihat komentar di kepala file).
            },
            {
                id: "factors",
                title: "Candidate Factors / Categorical Features",
                variables: mapToVariables(candidateFactors),
                height: "120px",
                allowedMeasurements: ["nominal", "ordinal"],
                // Sengaja selalu droppable, sama seperti "excluded" di atas.
            },
            {
                id: "covariates",
                title: "Candidate Covariates / Numerical Features",
                variables: mapToVariables(candidateCovariates),
                height: "120px",
                allowedMeasurements: ["scale"],
                // Sengaja selalu droppable, sama seperti "excluded" di atas.
            },
        ],
        [targetVar, excludedVars, candidateFactors, candidateCovariates, variableMap]
    );

    const handleMoveVariable = (variable: Variable, fromListId: string, toListId: string, targetIndex?: number) => {
        const name = variable.name;

        // Helper untuk lepas dari suatu daftar.
        const removeFrom = (list: string[], item: string) => list.filter((n) => n !== item);
        // Helper untuk tambah ke suatu daftar pada posisi tertentu.
        const addTo = (list: string[], item: string, idx?: number) => {
            const newList = [...list];
            if (idx !== undefined && idx >= 0 && idx <= newList.length) {
                newList.splice(idx, 0, item);
            } else {
                newList.push(item);
            }
            return newList;
        };

        let newTarget = formData.TargetVar;
        let newMode: NaiveBayesSpecificationMode = mode;
        let newExcluded = [...excludedVars];
        let newFactors = [...candidateFactors];
        let newCovariates = [...candidateCovariates];

        // Lepas dari daftar sumber. "available" tidak perlu penanganan
        // (dihitung sebagai turunan), dan blok mode yang sedang tidak
        // aktif selalu kosong secara logis (lihat useMemo di atas)
        // sehingga secara normal tidak mungkin jadi sumber drag -- tetap
        // ditangani di sini untuk kelengkapan/robustness.
        if (fromListId === "target") newTarget = null;
        else if (fromListId === "excluded") newExcluded = removeFrom(newExcluded, name);
        else if (fromListId === "factors") newFactors = removeFrom(newFactors, name);
        else if (fromListId === "covariates") newCovariates = removeFrom(newCovariates, name);

        // AGENTS.md §3.3 poin 2 & 3 -- Auto-activate: begitu variabel
        // ditempatkan ke blok yang saat itu TIDAK aktif, mode berpindah
        // ke blok tersebut DAN seluruh isi mode sebelumnya dikosongkan
        // (dikembalikan ke pool "available" karena `availableVars`
        // dihitung dari field yang sudah dikosongkan ini -- bukan
        // dihapus permanen dari dataset, bukan pula dipindah otomatis ke
        // mode baru). Kedua blok tetap sama-sama bisa menerima drop
        // kapan pun (lihat komentar di kepala file) -- exclusivity
        // ditegakkan lewat pengosongan ini, BUKAN lewat penguncian drop.
        const movesIntoExcludedBlock = toListId === "excluded";
        const movesIntoCandidatesBlock = toListId === "factors" || toListId === "covariates";

        if (movesIntoExcludedBlock && mode !== "exclude") {
            newMode = "exclude";
            newFactors = [];
            newCovariates = [];
        } else if (movesIntoCandidatesBlock && mode !== "candidates") {
            newMode = "candidates";
            newExcluded = [];
        }

        // Tambah ke daftar tujuan.
        if (toListId === "target") {
            newTarget = name;
        } else if (toListId === "excluded") {
            newExcluded = addTo(newExcluded, name, targetIndex);
        } else if (toListId === "factors") {
            newFactors = addTo(newFactors, name, targetIndex);
        } else if (toListId === "covariates") {
            newCovariates = addTo(newCovariates, name, targetIndex);
        }

        onChange({
            TargetVar: newTarget,
            SpecificationMode: newMode,
            ExcludedVar: newExcluded,
            CandidateFactors: newFactors,
            CandidateCovariates: newCovariates,
        });
    };

    const handleReorderVariable = (listId: string, variables: Variable[]) => {
        const names = variables.map((v) => v.name);
        if (listId === "excluded") {
            onChange({ ExcludedVar: names });
        } else if (listId === "factors") {
            onChange({ CandidateFactors: names });
        } else if (listId === "covariates") {
            onChange({ CandidateCovariates: names });
        }
    };

    const handleVariableDoubleClick = (variable: Variable, sourceListId: string) => {
        const name = variable.name;

        if (sourceListId === "available") {
            if (!formData.TargetVar) {
                onChange({ TargetVar: name });
                return;
            }

            // Double-click dari "available" tidak menunjuk satu blok
            // tujuan eksplisit seperti drag & drop, sehingga tujuannya
            // mengikuti MODE yang sedang aktif -- konsisten dengan
            // AGENTS.md §3.3: mode ditentukan oleh ke blok mana variabel
            // benar-benar diletakkan.
            if (mode === "exclude") {
                onChange({ ExcludedVar: [...excludedVars, name] });
                return;
            }

            // Mode "candidates": tipe statistik tetap murni ditentukan
            // dari `measure` (AGENTS.md §3.3 poin 5), bukan pilihan
            // bebas. Variabel `unknown` seharusnya sudah tidak pernah
            // muncul di "available" (§3.2), tapi tetap dijaga di sini
            // sebagai guard eksplisit alih-alih diam-diam diasumsikan
            // salah satu tipe.
            if (variable.measure === "scale") {
                onChange({ CandidateCovariates: [...candidateCovariates, name] });
            } else if (variable.measure === "nominal" || variable.measure === "ordinal") {
                onChange({ CandidateFactors: [...candidateFactors, name] });
            }
            return;
        }

        // Double-click di salah satu blok tujuan: kembalikan variabel ke
        // available. Tidak memicu perpindahan mode (mengosongkan satu
        // item bukan "berpindah mode", mode-nya tetap sama walau isinya
        // jadi kosong).
        if (sourceListId === "target") {
            onChange({ TargetVar: null });
        } else if (sourceListId === "excluded") {
            onChange({ ExcludedVar: excludedVars.filter((n) => n !== name) });
        } else if (sourceListId === "factors") {
            onChange({ CandidateFactors: candidateFactors.filter((n) => n !== name) });
        } else if (sourceListId === "covariates") {
            onChange({ CandidateCovariates: candidateCovariates.filter((n) => n !== name) });
        }
    };

    return (
        <VariableListManager
            availableVariables={availableVars}
            targetLists={targetLists}
            variableIdKey="name"
            highlightedVariable={highlightedVariables}
            setHighlightedVariable={setHighlightedVariables}
            onMoveVariable={handleMoveVariable}
            onReorderVariable={handleReorderVariable}
            onVariableDoubleClick={handleVariableDoubleClick}
        />
    );
};

export default VariablesTab;
