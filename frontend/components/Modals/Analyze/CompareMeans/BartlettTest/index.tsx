"use client";

import type { FC } from "react";
import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { HelpCircle, InfoIcon, Loader2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger
} from "@/components/ui/tabs";
import {
    TooltipProvider,
    Tooltip,
    TooltipTrigger,
    TooltipContent,
} from "@/components/ui/tooltip";
import { TourPopup } from "@/components/Common/TourComponents";
import { useVariableStore } from "@/stores/useVariableStore";
import type { BaseModalProps } from "@/types/modalTypes";
import { toast } from "sonner";
import {
    useVariableSelection,
    useTestSettings,
    useBartlettAnalysis,
    useTourGuide,
    baseTourSteps,
} from "./hooks";
import type { TabType, TabControlProps } from "./types";

import VariablesTab from "./components/VariablesTab";
import OptionsTab from "./components/OptionsTab";

/**
 * Komponen konten utama Bartlett Test
 *
 * Mengelola state dan logika untuk:
 * - Pemilihan variabel test dan faktor
 * - Opsi analisis (descriptives, confidence level)
 * - Eksekusi analisis melalui Web Worker
 * - Tour guide interaktif
 */
const BartlettTestContent: FC<Omit<BaseModalProps, 'containerType'> & { containerType?: "dialog" | "sidebar" }> = ({ onClose, containerType = "dialog" }) => {
    const [activeTab, setActiveTab] = useState<TabType>("variables");
    const router = useRouter();
    const isVariablesLoading = useVariableStore((state: any) => state.isLoading);
    const variablesError = useVariableStore((state: any) => state.error);

    // Hook untuk pemilihan variabel
    const {
        availableVariables,
        testVariables,
        factorVariable,
        highlightedVariable,
        setHighlightedVariable,
        moveToTestVariables,
        moveToFactorVariable,
        moveToAvailableVariables,
        reorderVariables,
        resetVariableSelection,
    } = useVariableSelection();

    // Hook untuk opsi/pengaturan
    const {
        options,
        updateOption,
        resetSettings,
    } = useTestSettings();

    // Wrapper onClose yang navigasi ke result
    const handleCloseWithNavigation = useCallback(() => {
        onClose();
        // Navigate ke result page setelah modal ditutup
        router.push('/dashboard/result');
    }, [onClose, router]);

    // Hook untuk menjalankan analisis
    const { isCalculating, errorMsg, runAnalysis, cancelCalculation } =
        useBartlettAnalysis({
            testVariables,
            factorVariable,
            options,
            onClose: handleCloseWithNavigation, // Gunakan wrapper yang navigasi
        });

    // Tab control untuk tour guide
    const tabControl = useMemo(
        (): TabControlProps => ({
            setActiveTab: (tab: string) => {
                setActiveTab(tab as TabType);
            },
            currentActiveTab: activeTab,
        }),
        [activeTab]
    );

    // Hook untuk tour guide
    const {
        tourActive,
        currentStep,
        tourSteps,
        currentTargetElement,
        startTour,
        nextStep,
        prevStep,
        endTour,
    } = useTourGuide(baseTourSteps, containerType, tabControl);

    /**
     * Handler untuk klik tombol OK
     * Melakukan validasi sebelum menjalankan analisis
     */
    const handleOkClick = useCallback(() => {
        // Validasi
        if (testVariables.length === 0) {
            toast.error('Please select at least one test variable');
            return;
        }

        if (!factorVariable) {
            toast.error('Please select a grouping variable');
            return;
        }

        runAnalysis();
    }, [testVariables.length, factorVariable, runAnalysis]);

    /**
     * Handler untuk reset semua settings ke default
     */
    const handleResetClick = useCallback(() => {
        resetVariableSelection();
        resetSettings();
        cancelCalculation();
        toast.info('Settings reset to defaults');
    }, [resetVariableSelection, resetSettings, cancelCalculation]);

    /**
     * Handler untuk cancel dan tutup modal
     */
    const handleCancelClick = useCallback(() => {
        if (isCalculating) {
            cancelCalculation();
        }
        onClose();
    }, [isCalculating, cancelCalculation, onClose]);

    /**
     * Handler untuk perubahan tab
     */
    const handleTabChange = useCallback(
        (value: string) => {
            if (value === "variables" || value === "options") {
                setActiveTab(value);
            }
        },
        [setActiveTab]
    );

    // Cleanup saat unmount
    useEffect(() => {
        return () => {
            cancelCalculation();
        };
    }, [cancelCalculation]);

    if (isVariablesLoading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2">Loading variables...</span>
            </div>
        );
    }

    if (variablesError) {
        return (
            <div className="text-center py-8 text-destructive">
                <p>Error loading variables: {variablesError}</p>
            </div>
        );
    }

    return (
        <>
            {/* Tour Guide Popup */}
            <AnimatePresence>
                {tourActive &&
                    tourSteps.length > 0 &&
                    currentStep < tourSteps.length && (
                        <TourPopup
                            step={tourSteps[currentStep]}
                            currentStep={currentStep}
                            totalSteps={tourSteps.length}
                            onNext={nextStep}
                            onPrev={prevStep}
                            onClose={endTour}
                            targetElement={currentTargetElement}
                        />
                    )}
            </AnimatePresence>

            <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full flex flex-col flex-grow overflow-hidden">
                <div className="border-b border-border flex-shrink-0">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger id="variables-tab-trigger" value="variables">Variables</TabsTrigger>
                        <TabsTrigger id="options-tab-trigger" value="options">Options</TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="variables" className="p-6 overflow-y-auto flex-grow">
                    <VariablesTab
                        availableVariables={availableVariables}
                        testVariables={testVariables}
                        factorVariable={factorVariable}
                        highlightedVariable={highlightedVariable}
                        setHighlightedVariable={setHighlightedVariable}
                        moveToTestVariables={moveToTestVariables}
                        moveToFactorVariable={moveToFactorVariable}
                        moveToAvailableVariables={moveToAvailableVariables}
                        reorderVariables={reorderVariables}
                        tourActive={tourActive}
                        currentStep={currentStep}
                        tourSteps={tourSteps}
                    />
                </TabsContent>

                <TabsContent value="options" className="p-6 overflow-y-auto flex-grow">
                    <OptionsTab
                        options={options}
                        updateOption={updateOption}
                        tourActive={tourActive}
                        currentStep={currentStep}
                        tourSteps={tourSteps}
                    />
                </TabsContent>
            </Tabs>

            {errorMsg && (
                <div className="px-6 py-2 text-destructive">{errorMsg}</div>
            )}

            <div className="px-6 py-3 border-t border-border flex items-center justify-between bg-secondary flex-shrink-0">
                {/* Tombol Help untuk Tour Guide */}
                <div className="flex items-center text-muted-foreground">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={startTour}
                                    className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary"
                                >
                                    <HelpCircle className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                <p className="text-xs">Start feature tour</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>

                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        onClick={handleResetClick}
                        disabled={isCalculating}
                    >
                        Reset
                    </Button>
                    <Button
                        variant="outline"
                        onClick={handleCancelClick}
                        disabled={isCalculating}
                    >
                        Cancel
                    </Button>
                    <Button
                        id="bartlett-test-ok-button"
                        onClick={handleOkClick}
                        disabled={isCalculating || testVariables.length === 0 || !factorVariable}
                    >
                        {isCalculating ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Calculating...
                            </>
                        ) : (
                            'OK'
                        )}
                    </Button>
                </div>
            </div>
        </>
    );
};

const BartlettTest: FC<BaseModalProps> = ({
    onClose,
    containerType = "dialog",
    ...props
}) => {
    if (containerType === "sidebar") {
        return (
            <div className="h-full flex flex-col overflow-hidden bg-popover text-popover-foreground">
                <div className="flex-grow flex flex-col overflow-hidden">
                    <BartlettTestContent
                        onClose={onClose}
                        containerType={containerType}
                        {...props}
                    />
                </div>
            </div>
        );
    }

    return (
        <DialogContent className="max-w-[600px] p-0 bg-popover text-popover-foreground border border-border shadow-md rounded-md flex flex-col max-h-[85vh]">
            <DialogHeader className="px-6 py-4 border-b border-border flex-shrink-0">
                <div className="flex items-center gap-1">
                    <DialogTitle className="text-[22px] font-semibold">
                        Bartlett&apos;s Test of Homogeneity of Variances
                    </DialogTitle>
                    <TooltipProvider delayDuration={100}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    aria-label="Syarat penggunaan uji Bartlett"
                                    className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                                >
                                    <InfoIcon className="h-4 w-4" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs space-y-1 text-xs">
                                <p>Gunakan variabel numerik berskala pada dua atau lebih kelompok independen.</p>
                                <p>Data dalam setiap kelompok harus berdistribusi normal.</p>
                                <p>Setiap kelompok memerlukan minimal dua observasi valid dan varians lebih dari nol.</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            </DialogHeader>

            <div className="flex-grow flex flex-col overflow-hidden">
                <BartlettTestContent
                    onClose={onClose}
                    containerType={containerType}
                    {...props}
                />
            </div>
        </DialogContent>
    );
};

export default BartlettTest;
export { BartlettTestContent };
