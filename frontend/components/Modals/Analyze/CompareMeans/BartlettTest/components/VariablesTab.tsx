import type { FC } from "react";
import React, { useCallback } from "react";
import type { TargetListConfig } from '@/components/Common/VariableListManager';
import VariableListManager from '@/components/Common/VariableListManager';
import { ActiveElementHighlight } from "@/components/Common/TourComponents";
import type { Variable } from "@/types/Variable";
import type { TourStep } from "../types";

interface VariablesTabProps {
    availableVariables: Variable[];
    testVariables: Variable[];
    factorVariable: Variable | null;
    highlightedVariable: { tempId: string, source: string } | null;
    setHighlightedVariable: (value: { tempId: string, source: string } | null) => void;
    moveToTestVariables: (variable: Variable, targetIndex?: number) => void;
    moveToFactorVariable: (variable: Variable) => void;
    moveToAvailableVariables: (variable: Variable, source: 'test' | 'factor') => void;
    reorderVariables: (fromIndex: number, toIndex: number) => void;
    tourActive?: boolean;
    currentStep?: number;
    tourSteps?: TourStep[];
}

const VariablesTab: FC<VariablesTabProps> = ({
    availableVariables,
    testVariables,
    factorVariable,
    highlightedVariable,
    setHighlightedVariable,
    moveToTestVariables,
    moveToFactorVariable,
    moveToAvailableVariables,
    reorderVariables,
    tourActive = false,
    currentStep = 0,
    tourSteps = [],
}) => {
    const variableIdKeyToUse: keyof Variable = 'tempId';

    const getDisplayName = (variable: Variable) => {
        if (!variable.label) return variable.name;
        return `${variable.label} [${variable.name}]`;
    };

    /**
     * Menentukan apakah variabel di-disable (tidak bisa dipilih)
     *
     * @param variable - Variabel yang dicek
     * @param targetList - Daftar tujuan: 'test' untuk variabel uji, 'factor' untuk variabel pengelompokan
     * @returns true jika variabel harus di-disable
     */
    const isVariableDisabled = useCallback((variable: Variable, targetList?: string): boolean => {
        // Variabel uji harus berskala numerik atau kontinu
        if (targetList === 'test') {
            // Jika skala pengukuran tidak diketahui, gunakan pemeriksaan tipe; hanya NUMERIC yang diizinkan
            if (!variable.measure || variable.measure === 'unknown') {
                return variable.type !== 'NUMERIC';
            }
            // Jika measure sudah didefinisikan, harus scale
            return variable.measure !== 'scale';
        }

        // Variabel pengelompokan dapat berskala nominal, ordinal, atau scale untuk kode numerik
        if (!targetList || targetList === 'factor') {
            // Jika measure unknown, izinkan STRING dan NUMERIC
            if (!variable.measure || variable.measure === 'unknown') {
                return !['STRING', 'NUMERIC'].includes(variable.type || '');
            }
            // Jika measure didefinisikan, izinkan nominal, ordinal, atau scale
            // Scale diizinkan karena variabel pengelompokan dapat berupa kode numerik (1,2,3)
            return !['nominal', 'ordinal', 'scale'].includes(variable.measure || '');
        }

        return false;
    }, []);

    const handleDoubleClick = (variable: Variable, sourceListId: string) => {
        if (sourceListId === 'available') {
            // Jika variabel disabled, tidak lakukan apa-apa
            if (isVariableDisabled(variable)) {
                return;
            }

            // Untuk measure unknown, tentukan berdasarkan tipe
            if (!variable.measure || variable.measure === 'unknown') {
                // Tipe STRING kemungkinan kategorik sehingga menjadi variabel pengelompokan
                if (variable.type === 'STRING' && !factorVariable) {
                    moveToFactorVariable(variable);
                } else if (variable.type === 'NUMERIC') {
                    // NUMERIC dengan skala pengukuran tidak diketahui menjadi variabel uji
                    moveToTestVariables(variable);
                }
                return;
            }

            // Untuk skala yang ditentukan: scale menjadi variabel uji, nominal/ordinal menjadi faktor
            if (variable.measure === 'scale') {
                moveToTestVariables(variable);
            } else if (['nominal', 'ordinal'].includes(variable.measure)) {
                if (!factorVariable) {
                    moveToFactorVariable(variable);
                } else {
                    // Factor sudah terisi, tidak bisa tambah
                    return;
                }
            }
            return;
        }

        if (sourceListId === 'test') {
            moveToAvailableVariables(variable, 'test');
        } else if (sourceListId === 'factor') {
            moveToAvailableVariables(variable, 'factor');
        }
    };

    const targetLists: TargetListConfig[] = [
        {
            id: 'test',
            title: 'Test Variable(s):',
            variables: testVariables,
            height: '200px'
        },
        {
            id: 'factor',
            title: 'Grouping Variable:',
            variables: factorVariable ? [factorVariable] : [],
            height: '80px'
        }
    ];

    const managerHighlightedVariable = highlightedVariable
        ? { id: highlightedVariable.tempId, source: highlightedVariable.source }
        : null;

    const setManagerHighlightedVariable = useCallback((value: { id: string, source: string } | null) => {
        if (value && ['available', 'test', 'factor'].includes(value.source)) {
            setHighlightedVariable({ tempId: value.id, source: value.source });
        } else {
            setHighlightedVariable(null);
        }
    }, [setHighlightedVariable]);

    const handleMoveVariable = useCallback((variable: Variable, fromListId: string, toListId: string, targetIndex?: number) => {
        // Cek apakah variabel disabled untuk target list
        if (toListId !== 'available' && isVariableDisabled(variable, toListId)) {
            return;
        }

        if (toListId === 'test') {
            moveToTestVariables(variable, targetIndex);
        } else if (toListId === 'factor') {
            moveToFactorVariable(variable);
        } else if (toListId === 'available') {
            if (fromListId === 'test') {
                moveToAvailableVariables(variable, 'test');
            } else if (fromListId === 'factor') {
                moveToAvailableVariables(variable, 'factor');
            }
        }
    }, [moveToTestVariables, moveToFactorVariable, moveToAvailableVariables, isVariableDisabled]);

    const handleReorderVariables = useCallback((listId: string, variables: Variable[]) => {
        if (listId === 'test') {
            // Hitung reorder berdasarkan posisi variabel
            const oldPositions = testVariables.map(v => v.tempId);
            const newPositions = variables.map(v => v.tempId);

            for (let i = 0; i < newPositions.length; i++) {
                if (oldPositions[i] !== newPositions[i]) {
                    const fromIndex = oldPositions.indexOf(newPositions[i]);
                    reorderVariables(fromIndex, i);
                    break;
                }
            }
        }
    }, [testVariables, reorderVariables]);

    return (
        <div className="space-y-4">
            <div className="relative">
                <VariableListManager
                    availableVariables={availableVariables}
                    targetLists={targetLists}
                    variableIdKey={variableIdKeyToUse}
                    highlightedVariable={managerHighlightedVariable}
                    setHighlightedVariable={setManagerHighlightedVariable}
                    onMoveVariable={handleMoveVariable}
                    onReorderVariable={handleReorderVariables}
                    onVariableDoubleClick={handleDoubleClick}
                    getDisplayName={getDisplayName}
                    isVariableDisabled={isVariableDisabled}
                />

                {/* Tour Guide Highlight Overlays */}
                <div id="bartlett-test-available-variables" className="absolute top-0 left-0 w-[48%] h-full pointer-events-none rounded-md">
                    <ActiveElementHighlight active={tourActive && currentStep === tourSteps.findIndex(step => step.targetId === 'bartlett-test-available-variables')} />
                </div>
                <div id="bartlett-test-test-variables" className="absolute top-0 right-0 w-[48%] h-[65%] pointer-events-none rounded-md">
                    <ActiveElementHighlight active={tourActive && currentStep === tourSteps.findIndex(step => step.targetId === 'bartlett-test-test-variables')} />
                </div>
                <div id="factor-variable-section" className="absolute top-[68%] right-0 w-[48%] h-[30%] pointer-events-none rounded-md">
                    <ActiveElementHighlight active={tourActive && currentStep === tourSteps.findIndex(step => step.targetId === 'factor-variable-section')} />
                </div>
            </div>
        </div>
    );
};

export default VariablesTab;
