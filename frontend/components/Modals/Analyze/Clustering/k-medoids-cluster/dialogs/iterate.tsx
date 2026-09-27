"use client";

import React, { useEffect, useState } from "react";
import type {
    KMedoidsClusterIterateProps,
    KMedoidsClusterIterateType,
} from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/types/k-medoids-cluster";
import {
    KMedoidsMethod,
    type SeedMode,
} from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/types/k-medoids-cluster";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { 
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { HelpCircle, Lightbulb, TriangleAlert } from "lucide-react";
import { PAM_HARD_MAX_ROWS, PAM_WARN_ROWS } from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/constants/k-medoids-cluster-default";
import {
    TooltipProvider,
    Tooltip,
    TooltipTrigger,
    TooltipContent,
} from "@/components/ui/tooltip";

/**
 * ========================================
 * ITERATE DIALOG
 * ========================================
 * Konfigurasi parameter algoritma K-Medoids:
 * - Metode (PAM/CLARA/CLARANS)
 * - Initial medoids strategy
 * - Iteration & convergence parameters
 */
export const KMedoidsClusterIterate = ({
    updateFormData,
    data,
    mainData,
    validRowCount = 0,
}: KMedoidsClusterIterateProps) => {
    const [iterateState, setIterateState] = useState<KMedoidsClusterIterateType>({
        ...data,
        SeedMode: data.SeedMode ?? (data.RandomSeed == null ? "default" : "custom"),
    });
    
    const normalizedMethod = String(iterateState.Method ?? "").trim().toUpperCase();
    const isPam = normalizedMethod === "PAM";
    const isClara = normalizedMethod === "CLARA";
    const isClarans = normalizedMethod === "CLARANS";

    // Rekomendasi metode berdasarkan jumlah baris valid. PAM dan CLARANS sama-sama membangun
    // matriks jarak n×n; di atas PAM_WARN_ROWS pengguna hanya diperingatkan (boleh memaksa PAM),
    // dan CLARA (sampling) yang direkomendasikan. Di atas PAM_HARD_MAX_ROWS PAM ditolak.
    const hasRowCount = validRowCount > 0;
    const pamTooLarge = hasRowCount && validRowCount > PAM_WARN_ROWS;
    const pamBlocked = hasRowCount && validRowCount > PAM_HARD_MAX_ROWS;
    const isAutomaticK = mainData.ClusterMode === "automatic";
    const matrixMb = Math.round((validRowCount ** 2 * 8) / 1_048_576);

    // Calculate maximum k possible based on clustering mode
    const maxK = mainData.ClusterMode === "automatic" 
        ? (mainData.AutoKMax ?? 10) 
        : (mainData.Cluster ?? 2);
    // CLARA requires sample_size > k.
    const minSampleSize = maxK + 1;

    useEffect(() => {
        setIterateState({
            ...data,
            SeedMode: data.SeedMode ?? (data.RandomSeed == null ? "default" : "custom"),
        });
    }, [data]);

    const handleChange = (
        field: keyof KMedoidsClusterIterateType,
        value: number | boolean | string | null
    ) => {
        setIterateState((prevState) => ({
            ...prevState,
            [field]: value,
        }));
        // Keep parent form state in sync so Execute uses the latest iterate config.
        updateFormData(field, value);
    };

    const handleSeedModeChange = (value: SeedMode) => {
        setIterateState((prevState) => {
            const nextSeed = value === "custom" ? prevState.RandomSeed : null;
            return {
                ...prevState,
                SeedMode: value,
                RandomSeed: nextSeed,
            };
        });

        updateFormData("SeedMode", value);
        updateFormData("RandomSeed", value === "custom" ? iterateState.RandomSeed : null);
    };

    return (
        <div className="h-full overflow-y-auto p-6">
            <div className="space-y-6">
                {/* ========== K-MEDOIDS METHOD ========== */}
                <div className="flex flex-col gap-2 border-b pb-4">
                    <div className="flex items-center gap-2">
                        <Label className="font-bold">K-Medoids Method</Label>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger>
                                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                    <p className="text-xs">
                                        <strong>PAM:</strong> Optimal quality, O(n²), small data<br/>
                                        <strong>CLARA:</strong> Sampling, faster, large data<br/>
                                        <strong>CLARANS:</strong> Hybrid approach
                                    </p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <Select
                        value={iterateState.Method}
                        onValueChange={(value) =>
                            handleChange("Method", value as KMedoidsMethod)
                        }
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Select method" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={KMedoidsMethod.PAM} disabled={pamBlocked}>
                                PAM (Partitioning Around Medoids)
                                {hasRowCount && (
                                    pamBlocked
                                        ? " - too large for this data"
                                        : pamTooLarge
                                            ? " - heavy for this data"
                                            : " - recommended"
                                )}
                            </SelectItem>
                            <SelectItem value={KMedoidsMethod.CLARA}>
                                CLARA (Large Datasets)
                                {pamTooLarge && " - recommended"}
                            </SelectItem>
                            <SelectItem value={KMedoidsMethod.CLARANS}>
                                CLARANS (Randomized Search)
                            </SelectItem>
                        </SelectContent>
                    </Select>

                    {hasRowCount && (
                        pamTooLarge ? (
                            <div
                                role="alert"
                                className={`flex items-start gap-2 rounded-md border p-3 text-xs ${
                                    isPam || isAutomaticK
                                        ? "border-destructive/50 bg-destructive/10 text-destructive"
                                        : "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                }`}
                            >
                                <TriangleAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                <div className="space-y-1">
                                    <p>
                                        Your data has <strong>{validRowCount.toLocaleString()}</strong> valid rows.
                                        PAM needs a ~{matrixMb} MB distance matrix, which can be slow and may crash the
                                        browser tab on low-memory devices (comfortable up to {PAM_WARN_ROWS.toLocaleString()} rows).
                                        {!pamBlocked && " You can still run PAM, but you will be asked to confirm."}
                                    </p>
                                    <p>
                                        <strong>Recommended: CLARA</strong> — it clusters samples of the data, so memory stays small.
                                        {isClarans && " CLARANS also builds the full n×n matrix, so it is not advised at this size."}
                                    </p>
                                    {isAutomaticK && (
                                        <p>
                                            Automatic k selection always finishes with PAM on the full data.
                                            {pamBlocked
                                                ? ` It cannot be used above ${PAM_HARD_MAX_ROWS.toLocaleString()} rows; use manual cluster mode with CLARA.`
                                                : " To use CLARA, switch to manual cluster mode."}
                                        </p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                                <Lightbulb className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                <p>
                                    Your data has <strong>{validRowCount.toLocaleString()}</strong> valid rows.
                                    <strong> Recommended: PAM</strong> — it gives the best-quality result for data up to {PAM_WARN_ROWS.toLocaleString()} rows.
                                </p>
                            </div>
                        )
                    )}
                </div>

                {/* ========== GENERAL ITERATION PARAMETERS ========== */}
                <div className="flex flex-col gap-3 border-b pb-4">
                    <div className="flex items-center gap-2">
                        <Label className="font-bold">Iteration Parameters</Label>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger>
                                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-sm">
                                    <p className="text-xs">
                                        Control how the algorithm iterates and converges to a solution.
                                    </p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                            <Label>Maximum Iterations:</Label>
                            <Input
                                type="number"
                                value={iterateState.MaximumIterations || ""}
                                min={1}
                                placeholder="300"
                                onChange={(e) =>
                                    handleChange("MaximumIterations", Number(e.target.value))
                                }
                            />
                            <p className="text-xs text-muted-foreground">
                                Max iterations before stopping (default: 300)
                            </p>
                        </div>

                        {isPam && (
                            <div className="flex flex-col gap-2">
                                <Label>Convergence Tolerance:</Label>
                                <Input
                                    type="number"
                                    value={iterateState.ConvergenceCriterion ?? ""}
                                    min={0}
                                    step={0.0001}
                                    placeholder="0"
                                    onChange={(e) =>
                                        handleChange("ConvergenceCriterion", Number(e.target.value))
                                    }
                                />
                                <p className="text-xs text-muted-foreground">
                                    Stop if cost change &lt; threshold (default: 0)
                                </p>
                            </div>
                        )}

                        <div className="flex flex-col gap-2">
                            <Label>Seed Mode:</Label>
                            <Select
                                value={iterateState.SeedMode}
                                onValueChange={(value) => handleSeedModeChange(value as SeedMode)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Default" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="default">Default</SelectItem>
                                    <SelectItem value="random">Random</SelectItem>
                                    <SelectItem value="custom">Custom</SelectItem>
                                </SelectContent>
                            </Select>
                            {iterateState.SeedMode === "custom" && (
                                <Input
                                    type="number"
                                    value={iterateState.RandomSeed ?? ""}
                                    placeholder="Default"
                                    onChange={(e) => {
                                        const nextValue = e.target.value === "" ? null : Number(e.target.value);
                                        if (nextValue == null) {
                                            handleSeedModeChange("default");
                                            return;
                                        }
                                        handleChange("RandomSeed", nextValue);
                                    }}
                                />
                            )}
                            <p className="text-xs text-muted-foreground">
                                Default: use the BUILD phase (deterministic). Random: random initialization on every run. Custom: use a seed for consistent results.
                            </p>
                        </div>

                        {isPam && (
                            <div className="flex flex-col gap-2">
                                <Label>Number of Initializations:</Label>
                                <Input
                                    type="number"
                                    value={iterateState.NumberOfInitializations || ""}
                                    min={1}
                                    placeholder="10"
                                    onChange={(e) =>
                                        handleChange("NumberOfInitializations", Number(e.target.value))
                                    }
                                />
                                <p className="text-xs text-muted-foreground">
                                    Run multiple times, keep best result (default: 10). Higher values = better results but slower. Use 1-3 for large datasets.
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* ========== CLARA-SPECIFIC PARAMETERS ========== */}
                {isClara && (
                    <div className="flex flex-col gap-3 border-b pb-4 bg-muted/30 p-3 rounded">
                        <Label className="font-bold">CLARA Parameters</Label>
                        
                        <div className="flex flex-col gap-2">
                            <Label>Sample Size:</Label>
                            <Input
                                type="number"
                                value={iterateState.SampleSize || ""}
                                min={minSampleSize}
                                placeholder={`Auto: 40 + 2k`}
                                onChange={(e) => {
                                    const val = Number(e.target.value);
                                    if (e.target.value === "") {
                                        handleChange("SampleSize", null);
                                    } else {
                                        handleChange("SampleSize", val);
                                    }
                                }}
                            />
                            {iterateState.SampleSize !== null && iterateState.SampleSize <= maxK && (
                                <p className="text-xs text-red-500 font-medium">
                                    Error: Sample size must be greater than number of clusters (k={maxK}).
                                </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                                Size of random sample (leave empty for auto: 40 + 2k, min: {minSampleSize})
                            </p>
                        </div>
                        
                        <div className="flex flex-col gap-2">
                            <Label>Number of Samples:</Label>
                            <Input
                                type="number"
                                value={iterateState.NumSamples || ""}
                                min={1}
                                max={20}
                                onChange={(e) =>
                                    handleChange("NumSamples", Number(e.target.value))
                                }
                            />
                            <p className="text-xs text-muted-foreground">
                                How many sampling iterations (default: 5)
                            </p>
                        </div>
                    </div>
                )}

                {/* ========== CLARANS-SPECIFIC PARAMETERS ========== */}
                {isClarans && (
                    <div className="flex flex-col gap-3 border-b pb-4 bg-muted/30 p-3 rounded">
                        <div className="flex items-center gap-2">
                            <Label className="font-bold">CLARANS Parameters</Label>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <HelpCircle className="h-4 w-4 text-muted-foreground" />
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-sm">
                                        <p className="text-xs">
                                            CLARANS uses randomized local search to find optimal clustering.
                                            Higher values improve quality but increase computation time.
                                        </p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                        
                        <div className="flex flex-col gap-2">
                            <Label>Number of Local Minima:</Label>
                            <Input
                                type="number"
                                value={iterateState.NumLocal || ""}
                                min={1}
                                placeholder="2"
                                onChange={(e) =>
                                    handleChange("NumLocal", Number(e.target.value))
                                }
                            />
                            <p className="text-xs text-muted-foreground">
                                Number of local minima to search (default: 2)
                            </p>
                        </div>
                        
                        <div className="flex flex-col gap-2">
                            <Label>Maximum Neighbors:</Label>
                            <Input
                                type="number"
                                value={iterateState.MaxNeighbor ?? ""}
                                min={1}
                                placeholder="Auto: max(250, 1.25% of n×(k-1))"
                                onChange={(e) =>
                                    handleChange("MaxNeighbor", e.target.value === "" ? null : Number(e.target.value))
                                }
                            />
                            <p className="text-xs text-muted-foreground">
                                Max neighbors to check per search (leave empty for auto calculation)
                            </p>
                        </div>
                    </div>
                )}
            </div>
            

        </div>
    );
};
