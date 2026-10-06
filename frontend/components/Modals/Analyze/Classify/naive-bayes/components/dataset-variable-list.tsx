"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown } from "lucide-react";
import type { Variable } from "@/types/Variable";

type SortField = "name" | "measurement";
type SortDirection = "asc" | "desc";

/** Muatan drag & drop antar panel (dibaca juga oleh `variables-tab.tsx`). */
export type NaiveBayesDragPayload = {
    /** "available" untuk panel kiri, atau id zona di panel kanan. */
    source: string;
    names: string[];
};

/** MIME yang dipakai muatan drag NB v2. */
export const NAIVE_BAYES_DRAG_MIME = "application/json";

type DatasetVariableListProps = {
    variables: Variable[];
    highlightedVariables: Variable[];
    onHighlight: (variables: Variable[]) => void;
    onDoubleClick?: (variable: Variable) => void;
    /**
     * v2 (N6): dipanggil saat variabel dari zona panel kanan dijatuhkan ke
     * panel kiri ini (mengembalikannya ke daftar Available).
     */
    onDropVariables?: (payload: NaiveBayesDragPayload) => void;
};

const MEASUREMENT_ORDER: Record<string, number> = {
    nominal: 0,
    ordinal: 1,
    scale: 2,
    unknown: 3,
};

/**
 * Filter case-insensitive atas nama ATAU label (AGENTS_V2 §3.2). Mencocokkan
 * sebagai substring, sehingga awalan seperti `VEC_` ikut tercocokkan. Teks
 * filter kosong/spasi saja = semua variabel lolos. Fungsi murni (diekspor
 * untuk test).
 */
export function filterVariablesByText(variables: Variable[], filterText: string): Variable[] {
    const needle = filterText.trim().toLowerCase();
    if (needle === "") return variables;
    return variables.filter(
        (v) =>
            (v.name ?? "").toLowerCase().includes(needle) ||
            (v.label ?? "").toLowerCase().includes(needle)
    );
}

export const DatasetVariableList = ({
    variables,
    highlightedVariables,
    onHighlight,
    onDoubleClick,
    onDropVariables,
}: DatasetVariableListProps) => {
    const [sortField, setSortField] = useState<SortField>("name");
    const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
    const [filterText, setFilterText] = useState("");
    const [isDropTarget, setIsDropTarget] = useState(false);

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

    // Daftar yang tampil = hasil sort lalu filter. Semua aksi seleksi
    // (Select All, Shift-range) bekerja pada daftar ini, bukan seluruh variabel.
    const visibleVariables = useMemo(
        () => filterVariablesByText(sortedVariables, filterText),
        [sortedVariables, filterText]
    );

    const highlightedSet = useMemo(
        () => new Set(highlightedVariables.map((v) => v.name)),
        [highlightedVariables]
    );

    // Saat filter berubah, sorotan pada variabel yang tersembunyi dibuang
    // supaya pemindahan sekaligus tidak ikut membawa variabel yang tak terlihat.
    useEffect(() => {
        if (highlightedVariables.length === 0) return;
        const visibleNames = new Set(visibleVariables.map((v) => v.name));
        const kept = highlightedVariables.filter((v) => visibleNames.has(v.name));
        if (kept.length !== highlightedVariables.length) onHighlight(kept);
        // Sengaja hanya bereaksi pada perubahan daftar yang tampil.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleVariables]);

    const handleSortField = useCallback((field: SortField) => {
        setSortField(field);
    }, []);

    const handleToggleDirection = useCallback(() => {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    }, []);

    const handleSelectAllFiltered = useCallback(() => {
        onHighlight(visibleVariables);
    }, [onHighlight, visibleVariables]);

    const handleSelectNominal = useCallback(() => {
        onHighlight(visibleVariables.filter((v) => v.measure?.toLowerCase() === "nominal"));
    }, [onHighlight, visibleVariables]);

    const handleSelectContinuous = useCallback(() => {
        onHighlight(visibleVariables.filter((v) => v.measure?.toLowerCase() === "scale"));
    }, [onHighlight, visibleVariables]);

    const handleItemClick = useCallback(
        (variable: Variable, e: React.MouseEvent) => {
            if (e.shiftKey && highlightedVariables.length > 0) {
                // Range select
                const lastHighlighted = highlightedVariables[highlightedVariables.length - 1];
                const lastIdx = visibleVariables.findIndex((v) => v.name === lastHighlighted.name);
                const currIdx = visibleVariables.findIndex((v) => v.name === variable.name);
                if (lastIdx !== -1 && currIdx !== -1) {
                    const start = Math.min(lastIdx, currIdx);
                    const end = Math.max(lastIdx, currIdx);
                    onHighlight(visibleVariables.slice(start, end + 1));
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
        [highlightedVariables, highlightedSet, onHighlight, visibleVariables]
    );

    const handleItemDoubleClick = useCallback(
        (variable: Variable) => {
            onDoubleClick?.(variable);
        },
        [onDoubleClick]
    );

    // Drag: bila item yang diseret termasuk sorotan, seluruh sorotan ikut
    // (pemindahan multi-variabel); selain itu hanya item itu sendiri.
    const handleItemDragStart = useCallback(
        (variable: Variable, e: React.DragEvent<HTMLDivElement>) => {
            const names = highlightedSet.has(variable.name)
                ? visibleVariables.filter((v) => highlightedSet.has(v.name)).map((v) => v.name)
                : [variable.name];
            const payload: NaiveBayesDragPayload = { source: "available", names };
            e.dataTransfer.setData(NAIVE_BAYES_DRAG_MIME, JSON.stringify(payload));
            e.dataTransfer.effectAllowed = "move";
            if (!highlightedSet.has(variable.name)) onHighlight([variable]);
        },
        [highlightedSet, visibleVariables, onHighlight]
    );

    const handleContainerDragOver = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            if (!onDropVariables) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setIsDropTarget(true);
        },
        [onDropVariables]
    );

    const handleContainerDrop = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            setIsDropTarget(false);
            if (!onDropVariables) return;
            e.preventDefault();
            try {
                const raw = e.dataTransfer.getData(NAIVE_BAYES_DRAG_MIME);
                if (!raw) return;
                const parsed = JSON.parse(raw) as Partial<NaiveBayesDragPayload>;
                if (
                    typeof parsed.source !== "string" ||
                    !Array.isArray(parsed.names) ||
                    parsed.source === "available"
                ) {
                    return;
                }
                onDropVariables({ source: parsed.source, names: parsed.names.map(String) });
            } catch {
                // Muatan drag tidak sah: abaikan senyap.
            }
        },
        [onDropVariables]
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

    const isFiltering = filterText.trim() !== "";

    return (
        <div
            className={`flex h-full flex-col border-r ${isDropTarget ? "bg-accent/40" : ""}`}
            data-testid="nb-available-panel"
            onDragOver={handleContainerDragOver}
            onDragLeave={() => setIsDropTarget(false)}
            onDrop={handleContainerDrop}
        >
            <div className="border-b px-2 pt-1.5 text-xs font-medium">Available Variables</div>

            {/* Filter */}
            <div className="border-b px-2 py-1.5">
                <input
                    type="text"
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder="Filter by name or label (e.g. VEC_)"
                    aria-label="Filter variables"
                    data-testid="nb-variable-filter"
                    className="h-7 w-full rounded border bg-background px-2 text-xs"
                />
            </div>

            {/* Sort Controls */}
            <div className="flex items-center gap-1 border-b px-2 py-1.5">
                <Button
                    variant={sortField === "name" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => handleSortField("name")}
                >
                    Name
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
            <div
                className="flex-1 overflow-y-auto px-1 py-1"
                role="listbox"
                aria-multiselectable="true"
                aria-label="Available Variables"
                data-testid="nb-available-list"
            >
                {visibleVariables.map((variable) => {
                    const isHighlighted = highlightedSet.has(variable.name);
                    return (
                        <div
                            key={variable.name}
                            role="option"
                            aria-selected={isHighlighted}
                            data-highlighted={isHighlighted}
                            data-testid={`nb-available-item-${variable.name}`}
                            draggable
                            onDragStart={(e) => handleItemDragStart(variable, e)}
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
                {visibleVariables.length === 0 && (
                    <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                        {isFiltering ? "No variables match the filter" : "No variables available"}
                    </div>
                )}
            </div>

            <div
                className="border-t px-2 py-1 text-xs text-muted-foreground"
                data-testid="nb-available-count"
            >
                {visibleVariables.length} shown, {highlightedVariables.length} selected
            </div>

            {/* Footer Selection Buttons */}
            <div className="flex flex-col gap-1 border-t px-2 py-1.5">
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleSelectAllFiltered}
                    data-testid="nb-select-all-filtered"
                >
                    Select All (filtered)
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
