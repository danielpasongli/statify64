"use client";

import React, { useMemo } from "react";
import VariableListManager from "@/components/Common/VariableListManager";
import type { TargetListConfig } from "@/components/Common/VariableListManager";
import type { Variable } from "@/types/Variable";
import type { NaiveBayesMainType } from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";

type VariablesTabProps = {
    allVariables: Variable[];
    formData: NaiveBayesMainType;
    onChange: (update: Partial<NaiveBayesMainType>) => void;
    highlightedVariables: { id: string; source: string } | null;
    setHighlightedVariables: (value: { id: string; source: string } | null) => void;
};

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

    const targetVar = useMemo(
        () => (formData.TargetVar ? [formData.TargetVar] : []),
        [formData.TargetVar]
    );

    const excludedVars = useMemo(
        () => formData.ExcludedVar ?? [],
        [formData.ExcludedVar]
    );

    const candidateFactors = useMemo(
        () => formData.CandidateFactors ?? [],
        [formData.CandidateFactors]
    );

    const candidateCovariates = useMemo(
        () => formData.CandidateCovariates ?? [],
        [formData.CandidateCovariates]
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
            },
            {
                id: "factors",
                title: "Candidate Factors / Categorical Features",
                variables: mapToVariables(candidateFactors),
                height: "120px",
                allowedMeasurements: ["nominal", "ordinal"],
            },
            {
                id: "covariates",
                title: "Candidate Covariates / Numerical Features",
                variables: mapToVariables(candidateCovariates),
                height: "120px",
                allowedMeasurements: ["scale"],
            },
        ],
        [targetVar, excludedVars, candidateFactors, candidateCovariates, variableMap]
    );

    const handleMoveVariable = (variable: Variable, fromListId: string, toListId: string, targetIndex?: number) => {
        const name = variable.name;
        console.log("[VariablesTab] handleMoveVariable called:", { name, fromListId, toListId, targetIndex });
        console.log("[VariablesTab] Current formData:", formData);

        // Helper to remove from a list
        const removeFrom = (list: string[], item: string) => list.filter((n) => n !== item);
        // Helper to add to a list
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
        let newExcluded = [...excludedVars];
        let newFactors = [...candidateFactors];
        let newCovariates = [...candidateCovariates];

        // Remove from source
        if (fromListId === "target") newTarget = null;
        else if (fromListId === "excluded") newExcluded = removeFrom(newExcluded, name);
        else if (fromListId === "factors") newFactors = removeFrom(newFactors, name);
        else if (fromListId === "covariates") newCovariates = removeFrom(newCovariates, name);
        // "available" doesn't need removal since it's computed from the others

        // Add to destination
        if (toListId === "target") {
            newTarget = name;
        } else if (toListId === "excluded") {
            newExcluded = addTo(newExcluded, name, targetIndex);
        } else if (toListId === "factors") {
            newFactors = addTo(newFactors, name, targetIndex);
        } else if (toListId === "covariates") {
            newCovariates = addTo(newCovariates, name, targetIndex);
        }
        // "available" doesn't need addition

        console.log("[VariablesTab] Calling onChange with:", {
            TargetVar: newTarget,
            ExcludedVar: newExcluded,
            CandidateFactors: newFactors,
            CandidateCovariates: newCovariates,
        });

        onChange({
            TargetVar: newTarget,
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
            // Double-click di available: pindah ke target jika kosong, else ke factors
            if (!formData.TargetVar) {
                onChange({ TargetVar: name });
            } else {
                onChange({ CandidateFactors: [...candidateFactors, name] });
            }
        } else {
            // Double-click di target list: kembalikan ke available
            if (sourceListId === "target") {
                onChange({ TargetVar: null });
            } else if (sourceListId === "excluded") {
                onChange({ ExcludedVar: excludedVars.filter((n) => n !== name) });
            } else if (sourceListId === "factors") {
                onChange({ CandidateFactors: candidateFactors.filter((n) => n !== name) });
            } else if (sourceListId === "covariates") {
                onChange({ CandidateCovariates: candidateCovariates.filter((n) => n !== name) });
            }
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
