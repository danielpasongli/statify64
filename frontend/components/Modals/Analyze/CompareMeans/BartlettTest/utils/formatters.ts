import type { Variable } from '@/types/Variable';
import type { BartlettTestResult, BartlettTestTable } from '../types';
import { buildBartlettDescription } from './interpretation';

const getVariableName = (variable: Variable): string => {
    if (variable.label?.trim()) return variable.label;
    if (variable.name) return variable.name;
    return 'Unknown';
};

const formatDF = (value: number | undefined): number | string =>
    Number.isFinite(value) ? String(value) : '';

const formatExactNumber = (value: number | null | undefined): string =>
    Number.isFinite(value) ? String(value) : '';

export function formatBartlettTestTable(results: BartlettTestResult[]): BartlettTestTable {
    if (results.length === 0) {
        return {
            title: "Bartlett's Test of Homogeneity of Variances",
            columnHeaders: [{ header: 'No Data', key: 'noData' }],
            rows: [],
            note: 'No results available',
        };
    }

    const table: BartlettTestTable = {
        title: "Bartlett's Test of Homogeneity of Variances",
        columnHeaders: [
            { header: '', key: 'rowHeader' },
            { header: 'Chi-Square', key: 'chiSquare' },
            { header: 'df', key: 'df' },
            { header: 'Sig.', key: 'sig' },
        ],
        rows: [],
        description: buildBartlettDescription(results),
    };

    results.forEach(result => {
        if (!result?.variable) return;

        const variableName = getVariableName(result.variable);
        table.rows.push(result.error
            ? {
                rowHeader: [variableName],
                chiSquare: 'N/A',
                df: 'N/A',
                sig: 'N/A',
            }
            : {
                rowHeader: [variableName],
                chiSquare: formatExactNumber(result.statistic),
                df: formatDF(result.df),
                sig: formatExactNumber(result.pValue),
            });
    });

    return table;
}

export function formatDescriptiveStatisticsTable(results: BartlettTestResult[]): BartlettTestTable {
    if (results.length === 0) {
        return {
            title: 'Descriptive Statistics',
            columnHeaders: [{ header: 'No Data', key: 'noData' }],
            rows: [],
        };
    }

    const table: BartlettTestTable = {
        title: 'Descriptive Statistics',
        subtitle: 'Group variances and sample sizes',
        columnHeaders: [
            { header: '', key: 'rowHeader' },
            { header: 'Group', key: 'group' },
            { header: 'N', key: 'n' },
            { header: 'Variance', key: 'variance' },
        ],
        rows: [],
    };

    results.forEach(result => {
        if (result.error || !result.variable || !result.groupNames || !result.groupVariances) return;

        const variableName = getVariableName(result.variable);
        result.groupNames.forEach((group, index) => {
            table.rows.push({
                rowHeader: [variableName],
                group,
                n: result.groupSizes?.[index]?.toString() ?? '',
                variance: formatExactNumber(result.groupVariances?.[index]),
            });
        });

        table.rows.push({
            rowHeader: [variableName],
            group: 'Pooled',
            n: result.totalSampleSize?.toString() ?? '',
            variance: formatExactNumber(result.pooledVariance),
        });
    });

    return table;
}
