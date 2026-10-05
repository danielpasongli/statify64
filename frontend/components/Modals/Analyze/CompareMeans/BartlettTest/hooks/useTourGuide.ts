/**
 * Hook untuk mengelola tour guide di modal Bartlett Test
 *
 * Hook ini menyediakan fungsionalitas tour interaktif untuk membantu
 * pengguna memahami cara menggunakan modal Bartlett Test.
 *
 * Fitur:
 * - Navigasi langkah demi langkah
 * - Switching tab otomatis saat diperlukan
 * - Tracking elemen target untuk highlight
 * - Responsif terhadap resize window
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { HorizontalPosition } from "@/types/tourTypes";
import type {
    TabControlProps,
    UseTourGuideResult,
    TourStep,
    TabType,
} from "../types";

const TIMEOUT_DELAY = 200;

/**
 * Hook useTourGuide
 *
 * @param initialSteps - Langkah-langkah tour dari tourConfig
 * @param containerType - Tipe container ('dialog' atau 'sidebar')
 * @param tabControl - Props untuk kontrol tab navigasi
 * @returns UseTourGuideResult dengan state dan fungsi kontrol tour
 */
export const useTourGuide = (
    initialSteps: TourStep[],
    containerType: "dialog" | "sidebar" = "dialog",
    tabControl: TabControlProps
): UseTourGuideResult => {
    // State tour
    const [tourActive, setTourActive] = useState(false);
    const [currentStep, setCurrentStep] = useState(0);
    const [targetElements, setTargetElements] = useState<
        Record<string, HTMLElement | null>
    >({});

    // Refs untuk tracking
    const lastTabRef = useRef<string | null>(null);
    const timeoutRef = useRef<number | undefined>(undefined);

    /**
     * Memoized tour steps dengan posisi yang disesuaikan
     * berdasarkan tipe container
     */
    const tourSteps = useMemo(
        () =>
            initialSteps.map((step) => ({
                ...step,
                horizontalPosition:
                    containerType === "sidebar"
                        ? ("left" as HorizontalPosition)
                        : (step.defaultHorizontalPosition as HorizontalPosition | null),
                position:
                    containerType === "sidebar"
                        ? undefined
                        : step.defaultPosition,
            })),
        [initialSteps, containerType]
    );

    /**
     * Cari elemen target berdasarkan ID
     */
    const findTargetElement = useCallback(
        (stepId: string): HTMLElement | null => {
            return document.getElementById(stepId);
        },
        []
    );

    /**
     * Clear timeout yang pending
     */
    const clearTimeout = useCallback(() => {
        if (timeoutRef.current !== undefined) {
            window.clearTimeout(timeoutRef.current);
            timeoutRef.current = undefined;
        }
    }, []);

    /**
     * Refresh semua elemen target
     * Dipanggil saat tour aktif atau tab berubah
     */
    const refreshTargetElements = useCallback(() => {
        if (!tourActive) return;
        const elements: Record<string, HTMLElement | null> = {};
        tourSteps.forEach((step) => {
            elements[step.targetId] = findTargetElement(step.targetId);
        });
        setTargetElements(elements);
    }, [tourActive, tourSteps, findTargetElement]);

    /**
     * Dapatkan tab yang diperlukan untuk langkah tertentu
     */
    const getRequiredTabForStep = useCallback(
        (stepIndex: number): string | undefined => {
            const step = tourSteps[stepIndex];
            return step?.requiredTab;
        },
        [tourSteps]
    );

    /**
     * Pindahkan tab jika diperlukan untuk langkah saat ini
     */
    const switchTabIfNeeded = useCallback(
        (requiredTab?: string | TabType) => {
            if (
                !tabControl ||
                !requiredTab ||
                tabControl.currentActiveTab === requiredTab
            ) {
                return;
            }
            tabControl.setActiveTab(requiredTab as TabType);
            lastTabRef.current = requiredTab;
            clearTimeout();
            timeoutRef.current = window.setTimeout(
                refreshTargetElements,
                TIMEOUT_DELAY
            );
        },
        [tabControl, refreshTargetElements, clearTimeout]
    );

    /**
     * Handler untuk resize window
     */
    const handleResize = useCallback(() => {
        if (tourActive) {
            refreshTargetElements();
        }
    }, [tourActive, refreshTargetElements]);

    /**
     * Mulai tur dari langkah pertama
     */
    const startTour = useCallback(() => {
        setCurrentStep(0);
        setTourActive(true);
        const requiredTab = getRequiredTabForStep(0);
        if (tabControl && tabControl.currentActiveTab !== requiredTab) {
            switchTabIfNeeded(requiredTab);
        }
    }, [getRequiredTabForStep, tabControl, switchTabIfNeeded]);

    /**
     * Akhiri tour dan reset state
     */
    const endTour = useCallback(() => {
        setTourActive(false);
        setCurrentStep(0);
        clearTimeout();
    }, [clearTimeout]);

    /**
     * Pindah ke langkah berikutnya
     */
    const nextStep = useCallback(() => {
        const nextStepIndex = currentStep + 1;
        if (nextStepIndex < tourSteps.length) {
            const step = tourSteps[currentStep];
            if (step.forceChangeTab) {
                const nextStepData = tourSteps[nextStepIndex];
                switchTabIfNeeded(nextStepData.requiredTab);
            }
            setCurrentStep(nextStepIndex);
        } else {
            endTour();
        }
    }, [currentStep, tourSteps, switchTabIfNeeded, endTour]);

    /**
     * Pindah ke langkah sebelumnya
     */
    const prevStep = useCallback(() => {
        const prevStepIndex = currentStep - 1;
        if (prevStepIndex >= 0) {
            const requiredTab = getRequiredTabForStep(prevStepIndex);
            switchTabIfNeeded(requiredTab);
            setCurrentStep(prevStepIndex);
        }
    }, [currentStep, getRequiredTabForStep, switchTabIfNeeded]);

    /**
     * Memoized elemen target saat ini
     */
    const currentTargetElement = useMemo(() => {
        if (!tourActive) return null;
        const currentStepData = tourSteps[currentStep];
        return targetElements[currentStepData.targetId] ?? null;
    }, [tourActive, tourSteps, currentStep, targetElements]);

    /**
     * Efek untuk memperbarui elemen target dan memindahkan tab
     * saat langkah berubah
     */
    useEffect(() => {
        if (tourActive) {
            refreshTargetElements();
            const requiredTab = getRequiredTabForStep(currentStep);
            switchTabIfNeeded(requiredTab);
        }
    }, [
        currentStep,
        tourActive,
        getRequiredTabForStep,
        switchTabIfNeeded,
        refreshTargetElements,
    ]);

    /**
     * Effect untuk event listener resize
     */
    useEffect(() => {
        window.addEventListener("resize", handleResize);
        return () => {
            window.removeEventListener("resize", handleResize);
            clearTimeout();
        };
    }, [handleResize, clearTimeout]);

    return {
        tourActive,
        currentStep,
        tourSteps,
        currentTargetElement,
        startTour,
        nextStep,
        prevStep,
        endTour,
    };
};
