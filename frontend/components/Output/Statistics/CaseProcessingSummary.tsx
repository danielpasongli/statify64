import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ColumnHeader = { header: string; key?: string };
type TableRow = { rowHeader?: (string | null)[];[key: string]: unknown };

type TableData = {
    title?: string;
    columnHeaders?: ColumnHeader[];
    rows?: TableRow[];
    note?: string | string[];
};

interface CaseProcessingSummaryProps {
    data: string | { tables?: TableData[] };
}

const CaseProcessingSummary: React.FC<CaseProcessingSummaryProps> = ({ data }) => {
    let parsed: { tables?: TableData[] } | null = null;

    try {
        parsed = typeof data === "string" ? JSON.parse(data) : data;
    } catch {
        return <div className="text-destructive">Invalid Case Processing Summary format</div>;
    }

    const table = parsed?.tables?.[0];
    const headers = table?.columnHeaders ?? [];
    const rows = table?.rows ?? [];
    if (!headers.length) {
        return <div className="text-destructive">Case Processing Summary has no headers</div>;
    }
    const colKeys = headers.map((h) => h.key || h.header);

    const displayHeader = (header: string): string => {
        if (/percent/i.test(header)) return "Percent";
        return header;
    };

    const isFirstHeaderNeeded = (rowIndex: number): boolean => {
        const current = rows[rowIndex]?.rowHeader?.[0] ?? "";
        if (current === "Overall") return true;
        if (rowIndex === 0) return true;
        const prev = rows[rowIndex - 1]?.rowHeader?.[0] ?? "";
        return current !== prev;
    };

    const getRowSpanForFirstHeader = (startIndex: number): number => {
        const startValue = rows[startIndex]?.rowHeader?.[0] ?? "";
        if (!startValue || startValue === "Overall") return 1;

        let span = 1;
        for (let i = startIndex + 1; i < rows.length; i += 1) {
            const nextValue = rows[i]?.rowHeader?.[0] ?? "";
            if (nextValue !== startValue || nextValue === "Overall") break;
            span += 1;
        }
        return span;
    };

    const getFirstLabel = (row: TableRow): string => {
        const first = row.rowHeader?.[0] ?? "";
        const second = row.rowHeader?.[1] ?? "";
        return first === "Overall" ? second : first;
    };

    const getSecondLabel = (row: TableRow): string => {
        const first = row.rowHeader?.[0] ?? "";
        const second = row.rowHeader?.[1] ?? "";
        return first === "Overall" ? "" : second;
    };

    return (
        <Card className="border-border shadow-none">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-foreground">
                    {table?.title || "Case Processing Summary"}
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <div className="w-fit max-w-full overflow-auto">
                    <Table className="w-max border-collapse text-sm">
                        <TableHeader>
                            <TableRow className="border-b border-border bg-muted/40 hover:bg-muted/40">
                                <TableHead className="w-44 whitespace-nowrap text-left font-medium text-muted-foreground" colSpan={2}>
                                    &nbsp;
                                </TableHead>
                                {headers.map((h) => (
                                    <TableHead
                                        key={h.key || h.header}
                                        className="whitespace-nowrap text-center font-medium text-muted-foreground"
                                    >
                                        {displayHeader(h.header)}
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((row, idx) => {
                                const displayFirstHeader = isFirstHeaderNeeded(idx);
                                const firstHeaderRowSpan = displayFirstHeader ? getRowSpanForFirstHeader(idx) : 0;

                                return (
                                    <TableRow key={idx} className="border-b border-border hover:bg-transparent">
                                        {displayFirstHeader ? (
                                            <TableCell
                                                rowSpan={firstHeaderRowSpan}
                                                className="whitespace-nowrap bg-muted/40 text-left align-middle font-medium text-foreground"
                                            >
                                                {getFirstLabel(row)}
                                            </TableCell>
                                        ) : null}
                                        <TableCell className="whitespace-nowrap bg-muted/40 text-left font-medium text-foreground">
                                            {getSecondLabel(row)}
                                        </TableCell>
                                        {colKeys.map((k) => (
                                            <TableCell key={`${idx}-${k}`} className="whitespace-nowrap text-center">
                                                {String(row[k] ?? "")}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
                {table?.note ? (
                    <div className="px-6 py-3 text-xs leading-5 text-muted-foreground">
                        {table.note}
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
};

export default CaseProcessingSummary;