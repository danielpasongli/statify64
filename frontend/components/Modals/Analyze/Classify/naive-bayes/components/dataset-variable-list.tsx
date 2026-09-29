"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { Variable } from "@/types/Variable";

type SortField = "name" | "measurement";
type SortDirection = "asc" | "desc";

type DatasetVariableListProps = {
    variables: Variable[];
    highlightedVariables: Variable[];
    onHighlight: (variables: Variable[]) => void;
    onDoubleClick?: (variable: Variable) => void;
};

const MEASUREMENT_ORDER: Record<string, number> = {
    nominal: 0,
    ordinal: 1,
    scale: 2,
    unknown: 3,
};

export const DatasetVariableList = ({
    variables,
    highlightedVariables,
    onHighlight,
    onDoubleClick,
}: DatasetVariableListProps) => {
    const [sortField, setSortField] = useState<SortField>("name");
    const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

    const sortedVariables = useMemo(() => {
        const list = [...variables];
        list.sort((a, b) => {
            if (sortField === "name") {
                const cmp = (a.name ?? "").localeCompare(b.name ?? "");
                return sortDirection === "asc" ? cmp : -cmp;
            }
            const aOrder = MEASUREMENT_ORDER[a.measure?.toLowerCase() ?? "unknown"] ?? 3;
            const bOrder = MEASUREMENT_ORDER[b.measure?.toLowerCase() ?? "unknown"] ?? 3;
            const cmp = aOrder - bOrder;
            return sortDirection === "asc" ? cmp : -cmp;
        });
        return list;
    }, [variables, sortField, sortDirection]);

    const highlightedSet = useMemo(
        () => new Set(highlightedVariables.map((v) => v.name)),
        [highlightedVariables]
    );

    const handleSortField = useCallback((field: SortField) => {
        setSortField(field);
    }, []);

    const handleToggleDirection = useCallback(() => {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    }, []);

    const handleSelectAll = useCallback(() => {
        onHighlight(sortedVariables);
    }, [onHighlight, sortedVariables]);

    const handleSelectNominal = useCallback(() => {
        onHighlight(sortedVariables.filter((v) => v.measure?.toLowerCase() === "nominal"));
    }, [onHighlight, sortedVariables]);

    const handleSelectContinuous = useCallback(() => {
        onHighlight(sortedVariables.filter((v) => v.measure?.toLowerCase() === "scale"));
    }, [onHighlight, sortedVariables]);

    const handleItemClick = useCallback(
        (variable: Variable, e: React.MouseEvent) => {
            if (e.shiftKey && highlightedVariables.length > 0) {
                // Range select
                const lastHighlighted = highlightedVariables[highlightedVariables.length - 1];
                const lastIdx = sortedVariables.findIndex((v) => v.name === lastHighlighted.name);
                const currIdx = sortedVariables.findIndex((v) => v.name === variable.name);
                if (lastIdx !== -1 && currIdx !== -1) {
                    const start = Math.min(lastIdx, currIdx);
                    const end = Math.max(lastIdx, currIdx);
                    onHighlight(sortedVariables.slice(start, end + 1));
                    return;
                }
            }

            if (e.ctrlKey || e.metaKey) {
                // Toggle individual
                if (highlightedSet.has(variable.name)) {
                    onHighlight(highlightedVariables.filter((v) => v.name !== variable.name));
                } else {
                    onHighlight([...highlightedVariables, variable]);
                }
            } else {
                // Single select
                onHighlight([variable]);
            }
        },
        [highlightedVariables, highlightedSet, onHighlight, sortedVariables]
    );

    const handleItemDoubleClick = useCallback(
        (variable: Variable) => {
            onDoubleClick?.(variable);
        },
        [onDoubleClick]
    );

    const getMeasurementBadge = (measure?: string) => {
        const m = measure?.toLowerCase();
        switch (m) {
            case "nominal":
                return <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] text-blue-800">N</span>;
            case "ordinal":
                return <span className="ml-1 rounded bg-green-100 px-1 text-[10px] text-green-800">O</span>;
            case "scale":
                return <span className="ml-1 rounded bg-purple-100 px-1 text-[10px] text-purple-800">S</span>;
            default:
                return null;
        }
    };

    return (
        <div className="flex h-full flex-col border-r">
            {/* Sort Controls */}
            <div className="flex items-center gap-1 border-b px-2 py-1.5">
                <Button
                    variant={sortField === "name" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => handleSortField("name")}
                >
                    Nama
                </Button>
                <Button
                    variant={sortField === "measurement" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => handleSortField("measurement")}
                >
                    Measurement
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={handleToggleDirection}
                    title={sortDirection === "asc" ? "Ascending" : "Descending"}
                >
                    {sortDirection === "asc" ? (
                        <ArrowUp className="h-3.5 w-3.5" />
                    ) : (
                        <ArrowDown className="h-3.5 w-3.5" />
                    )}
                </Button>
            </div>

            {/* Variable List */}
            <div className="flex-1 overflow-y-auto px-1 py-1">
                {sortedVariables.map((variable) => {
                    const isHighlighted = highlightedSet.has(variable.name);
                    return (
                        <div
                            key={variable.name}
                            role="option"
                            aria-selected={isHighlighted}
                            data-highlighted={isHighlighted}
                            className={`flex cursor-pointer items-center rounded px-2 py-1 text-sm ${
                                isHighlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                            }`}
                            onClick={(e) => handleItemClick(variable, e)}
                            onDoubleClick={() => handleItemDoubleClick(variable)}
                        >
                            <span className="truncate">{variable.label || variable.name}</span>
                            {getMeasurementBadge(variable.measure)}
                        </div>
                    );
                })}
                {sortedVariables.length === 0 && (
                    <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                        Tidak ada variabel tersedia
                    </div>
                )}
            </div>

            {/* Footer Selection Buttons */}
            <div className="flex flex-col gap-1 border-t px-2 py-1.5">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleSelectAll}>
                    Select All
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleSelectNominal}>
                    Select All Nominal
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleSelectContinuous}>
                    Select All Continuous
                </Button>
            </div>
        </div>
    );
};

export default DatasetVariableList;
