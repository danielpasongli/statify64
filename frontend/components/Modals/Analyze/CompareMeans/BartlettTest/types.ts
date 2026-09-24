import type { Variable } from "@/types/Variable";
import type { Dispatch, SetStateAction } from "react";
import type { TourStep as BaseTourStep } from '@/types/tourTypes';
import type { BaseModalProps } from "@/types/modalTypes";

// ---------------------------------
// Constants
// ---------------------------------

/**
 * Konstanta tab untuk Bartlett Test
 */
export const TABS = {
    VARIABLES: 'variables' as const,
    OPTIONS: 'options' as const,
};

// ---------------------------------
// Types
// ---------------------------------

/**
 * Tipe tab untuk modal Bartlett Test
 */
export type TabType = typeof TABS.VARIABLES | typeof TABS.OPTIONS;

/**
 * Tipe TourStep untuk Bartlett Test
 * Extends BaseTourStep dengan properti tab yang diperlukan
 */
export type TourStep = BaseTourStep & {
    requiredTab?: TabType | string;
    forceChangeTab?: boolean;
};

/**
 * Tipe variabel yang di-highlight
 */
export type HighlightedVariable = {
    tempId: string;
    source: 'available' | 'test' | 'factor';
};

// ---------------------------------
// Options
// ---------------------------------

/**
 * Opsi Bartlett Test
 */
export interface BartlettTestOptions {
    confidenceLevel: number; // misalnya 0.95 untuk 95% confidence
    includeDescriptives: boolean;
}

// ---------------------------------
// Props
// ---------------------------------

/**
 * Props kontrol tab untuk navigasi
 */
export interface TabControlProps {
    setActiveTab: (tab: 'variables' | 'options') => void;
    currentActiveTab: TabType;
}

/**
 * Props untuk VariablesTab
 */
export interface VariablesTabProps {
    availableVariables: Variable[];
    testVariables: Variable[];
    factorVariable: Variable | null;
    highlightedVariable: HighlightedVariable | null;
    setHighlightedVariable: Dispatch<SetStateAction<HighlightedVariable | null>>;
    moveToAvailableVariables: (variable: Variable, source: 'test' | 'factor') => void;
    moveToTestVariables: (variable: Variable, targetIndex?: number) => void;
    moveToFactorVariable: (variable: Variable) => void;
    reorderVariables: (source: 'available' | 'test', variables: Variable[]) => void;
}

/**
 * Props untuk OptionsTab
 */
export interface OptionsTabProps {
    options: BartlettTestOptions;
    updateOption: <K extends keyof BartlettTestOptions>(
        key: K,
        value: BartlettTestOptions[K]
    ) => void;
}

/**
 * Props untuk useTestSettings
 */
export interface TestSettingsProps {
    initialOptions?: Partial<BartlettTestOptions>;
}

/**
 * Props untuk useVariableSelection
 */
export interface VariableSelectionProps {
    initialVariables?: Variable[];
}

/**
 * Props untuk useBartlettAnalysis
 */
export interface BartlettAnalysisProps extends Pick<BaseModalProps, 'onClose'> {
    testVariables: Variable[];
    factorVariable: Variable | null;
    options: BartlettTestOptions;
}

// ---------------------------------
// Results
// ---------------------------------

/**
 * Hasil hook useTourGuide
 */
export interface UseTourGuideResult {
    tourActive: boolean;
    currentStep: number;
    tourSteps: TourStep[];
    currentTargetElement: HTMLElement | null;
    startTour: () => void;
    nextStep: () => void;
    prevStep: () => void;
    endTour: () => void;
}

/**
 * Hasil Bartlett Test untuk satu variabel
 */
export interface BartlettTestResult {
    variable: Variable;
    factorVariable: Variable;
    statistic?: number;
    df?: number;
    pValue?: number;
    pooledVariance?: number;
    groupVariances?: number[];
    groupNames?: string[];
    groupSizes?: number[];
    totalSampleSize?: number;
    numberOfGroups?: number;
    M?: number;
    C?: number;
    error?: string;
    insufficientType?: string;
}

/**
 * Statistik deskriptif untuk setiap kelompok
 */
export interface GroupDescriptives {
    groupName: string;
    n: number;
    variance: number;
}

// ---------------------------------
// Table Types
// ---------------------------------

/**
 * Header kolom tabel
 */
export interface TableColumnHeader {
    header: string;
    key: string;
    children?: TableColumnHeader[];
}

/**
 * Baris tabel
 */
export interface TableRow {
    [key: string]: any;
    rowHeader?: any[];
}

/**
 * Struktur tabel Bartlett Test
 */
export interface BartlettTestTable {
    title: string;
    subtitle?: string;
    columnHeaders: TableColumnHeader[];
    rows: TableRow[];
    footer?: string | string[];  // Compatible with DataTableRenderer
    description?: string[];
    note?: string;  // Sudah tidak dianjurkan, gunakan footer
}
