/**
 * Unit tests untuk formatter functions Bartlett Test
 *
 * Formatter mengubah hasil kalkulasi menjadi format tabel
 * yang dapat ditampilkan oleh DataTableRenderer
 */

import {
    formatBartlettTestTable,
    formatDescriptiveStatisticsTable,
} from '../utils/formatters';
import type { BartlettTestResult } from '../types';
import type { Variable } from '@/types/Variable';

describe('formatters', () => {
    // Mock variable untuk testing
    const mockVariable: Variable = {
        tempId: 'var1',
        columnIndex: 0,
        name: 'score',
        type: 'NUMERIC',
        width: 8,
        decimals: 2,
        label: 'Test Score',
        values: [],
        missing: null,
        columns: 64,
        align: 'right',
        measure: 'scale',
        role: 'input',
    };

    const mockFactorVariable: Variable = {
        tempId: 'var2',
        columnIndex: 1,
        name: 'group',
        type: 'NUMERIC',
        width: 8,
        decimals: 0,
        label: 'Group',
        values: [],
        missing: null,
        columns: 64,
        align: 'right',
        measure: 'nominal',
        role: 'input',
    };

    describe('formatBartlettTestTable', () => {
        it('menampilkan statistik dan p-value tanpa pembulatan desimal tetap', () => {
            const result = formatBartlettTestTable([{
                variable: mockVariable,
                factorVariable: mockFactorVariable,
                statistic: 5.123456789012345,
                df: 2,
                pValue: 0.000123456789,
            }]);

            expect(result.rows[0].chiSquare).toBe('5.123456789012345');
            expect(result.rows[0].sig).toBe('0.000123456789');
        });

        it('harus mengembalikan tabel kosong jika results kosong', () => {
            const result = formatBartlettTestTable([]);

            expect(result.title).toContain('Bartlett');
            expect(result.rows).toHaveLength(0);
        });

        it('harus memformat hasil dengan benar', () => {
            const mockResults: BartlettTestResult[] = [
                {
                    variable: mockVariable,
                    factorVariable: mockFactorVariable,
                    statistic: 5.123,
                    df: 2,
                    pValue: 0.077,
                    groupNames: ['Group 1', 'Group 2', 'Group 3'],
                    groupSizes: [20, 20, 20],
                    groupVariances: [5.2, 6.1, 4.8],
                    pooledVariance: 10.5,
                    totalSampleSize: 60,
                    numberOfGroups: 3,
                },
            ];

            const result = formatBartlettTestTable(mockResults);

            expect(result.title).toContain('Bartlett');
            expect(result.columnHeaders).toBeDefined();
            expect(result.rows).toHaveLength(1);
            expect(result.description).toEqual(expect.arrayContaining([
                '<p><strong>Hipotesis</strong></p>',
                '<p>H₀: σ₁² = σ₂² = ⋯ = σₖ² — seluruh kelompok memiliki varians yang sama (homogen).</p>',
                '<p><strong>Interpretasi</strong></p>',
                '<p>Bartlett <br> Test Score: χ²(2) = 5.123, p-value = 0.077 ≥ α = 0.05; gagal menolak H₀, artinya belum terdapat cukup bukti untuk membuktikan bahwa varians antar kelompok berbeda (varians antar kelompok sama).</p>',
            ]));

            // Verifikasi rowHeader adalah array non-empty
            expect(result.rows[0]?.rowHeader).toBeInstanceOf(Array);
            expect((result.rows[0]?.rowHeader as any[])?.length).toBeGreaterThan(0);
        });

        it('harus memformat p-value kecil dengan benar', () => {
            const mockResults: BartlettTestResult[] = [
                {
                    variable: mockVariable,
                    factorVariable: mockFactorVariable,
                    statistic: 20.5,
                    df: 3,
                    pValue: 0.0001,
                    groupNames: ['A', 'B', 'C', 'D'],
                    groupSizes: [20, 20, 20, 20],
                    groupVariances: [5.0, 6.0, 7.0, 8.0],
                    pooledVariance: 15.2,
                    totalSampleSize: 80,
                    numberOfGroups: 4,
                },
            ];

            const result = formatBartlettTestTable(mockResults);

            // P-value kecil tetap ditampilkan sebagai nilai mentah, bukan batas pembulatan.
            const sigValue = result.rows[0].sig;
            expect(sigValue).toBe('0.0001');
            expect(result.description?.join(' ')).toContain('H₀ ditolak');
        });

        it('harus menangani error result', () => {
            const mockResults: BartlettTestResult[] = [
                {
                    variable: mockVariable,
                    factorVariable: mockFactorVariable,
                    error: 'Not enough data',
                },
            ];

            const result = formatBartlettTestTable(mockResults);

            expect(result.rows).toHaveLength(1);
            expect(result.rows[0].chiSquare).toBe('N/A');
            expect(result.rows[0].sig).toBe('N/A');
        });

        it('harus menggunakan nama variabel jika tidak ada label', () => {
            const variableNoLabel: Variable = {
                ...mockVariable,
                label: '',
            };

            const mockResults: BartlettTestResult[] = [
                {
                    variable: variableNoLabel,
                    factorVariable: mockFactorVariable,
                    statistic: 5.0,
                    df: 2,
                    pValue: 0.082,
                    groupNames: ['A', 'B', 'C'],
                    groupSizes: [16, 17, 17],
                    groupVariances: [5.0, 5.5, 4.5],
                    pooledVariance: 10.0,
                    totalSampleSize: 50,
                    numberOfGroups: 3,
                },
            ];

            const result = formatBartlettTestTable(mockResults);

            // rowHeader harus menggunakan nama variabel
            expect(result.rows[0].rowHeader).toContain('score');
        });
    });

    describe('formatDescriptiveStatisticsTable', () => {
        it('harus mengembalikan tabel dengan header yang benar', () => {
            const mockResults: BartlettTestResult[] = [
                {
                    variable: mockVariable,
                    factorVariable: mockFactorVariable,
                    statistic: 5.123,
                    df: 2,
                    pValue: 0.077,
                    groupNames: ['Group 1', 'Group 2', 'Group 3'],
                    groupSizes: [20, 20, 20],
                    groupVariances: [5.2, 6.1, 4.8],
                    pooledVariance: 10.5,
                    totalSampleSize: 60,
                    numberOfGroups: 3,
                },
            ];

            const result = formatDescriptiveStatisticsTable(mockResults);

            // Title uses English
            expect(result.title).toContain('Descriptive Statistics');
            expect(result.columnHeaders).toBeDefined();
        });

        it('harus memformat statistik deskriptif per grup', () => {
            const mockResults: BartlettTestResult[] = [
                {
                    variable: mockVariable,
                    factorVariable: mockFactorVariable,
                    statistic: 5.123,
                    df: 2,
                    pValue: 0.077,
                    groupNames: ['Group 1', 'Group 2'],
                    groupSizes: [30, 30],
                    groupVariances: [5.0, 6.0],
                    pooledVariance: 10.5,
                    totalSampleSize: 60,
                    numberOfGroups: 2,
                },
            ];

            const result = formatDescriptiveStatisticsTable(mockResults);

            // Harus ada baris untuk setiap grup
            expect(result.rows.length).toBeGreaterThan(0);
        });

        it('harus menangani results tanpa grup', () => {
            const mockResults: BartlettTestResult[] = [
                {
                    variable: mockVariable,
                    factorVariable: mockFactorVariable,
                    error: 'No groups found',
                },
            ];

            const result = formatDescriptiveStatisticsTable(mockResults);

            // Tidak boleh error, meskipun tidak ada grup
            expect(result).toBeDefined();
        });
    });
});
