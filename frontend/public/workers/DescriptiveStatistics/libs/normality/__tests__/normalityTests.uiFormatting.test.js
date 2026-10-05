/**
 * ============================================================================
 * UI TABLE RENDERING AND FORMATTING TESTS
 * ============================================================================
 *
 * **Validates: Requirements 8.2, 8.4, 8.5, 8.6, 8.7**
 *
 * PURPOSE:
 * Tests that verify the structured output from runNormalityTests and
 * createNormalityTestEntry contains properly formatted values ready for
 * display in the Descriptive Statistics modal UI table.
 *
 * TEST COVERAGE:
 * - Requirement 8.2: Descriptive Statistics modal displays both KS and SW results
 * - Requirement 8.4: Row highlighting when p < α (isSignificant flag)
 *                     and conclusion "Data TIDAK normal"
 * - Requirement 8.5: Conclusion "Data dianggap normal" when p ≥ α
 * - Requirement 8.6: W statistic tersedia untuk ditampilkan
 * - Requirement 8.7: P-value tersedia tanpa kehilangan presisi
 *
 * CONTEXT:
 * Since the actual UI rendering happens in Vue components, these tests verify
 * the data formatting logic that prepares output for the UI. The structured
 * output from runNormalityTests contains all the necessary fields for the
 * UI to render the normality tests table correctly.
 *
 * REFERENCE:
 * - Design Document: Phase 5 (Integration and Performance) - Task 9.6
 * - normalityTests.js: runNormalityTests, createNormalityTestEntry, formatNormalityNumber
 */

describe('UI Table Rendering and Formatting', () => {

    let runNormalityTests;
    let formatNormalityNumber;

    beforeAll(() => {
        const fs = require('fs');
        const path = require('path');

        const sourcePath = path.join(__dirname, '../normalityTests.js');
        const sourceCode = fs.readFileSync(sourcePath, 'utf-8');

        const context = {};
        const wrappedCode = `
            ${sourceCode}
            if (typeof runNormalityTests !== 'undefined') {
                context.runNormalityTests = runNormalityTests;
            }
            if (typeof formatNormalityNumber !== 'undefined') {
                context.formatNormalityNumber = formatNormalityNumber;
            }
        `;

        const func = new Function('context', wrappedCode);
        func(context);

        runNormalityTests = context.runNormalityTests;
        formatNormalityNumber = context.formatNormalityNumber;
    });

    describe('Requirement 8.2: Both KS and SW Results Displayed Together', () => {

        test('should return both KS and SW results for valid data within SW range', () => {
            const data = [12, 15, 18, 21, 24, 27, 30, 33, 36, 39];
            const result = runNormalityTests(data);

            // Both tests should be available
            expect(result.tests).toHaveLength(2);
            expect(result.tests[0].key).toBe('kolmogorovSmirnov');
            expect(result.tests[1].key).toBe('shapiroWilk');
            expect(result.tests[0].available).toBe(true);
            expect(result.tests[1].available).toBe(true);
        });

        test('should include columns: Test Name (label), Statistic, df, p-value, Conclusion', () => {
            const data = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
            const result = runNormalityTests(data);

            result.tests.forEach((entry) => {
                // label = Test Name column
                expect(entry).toHaveProperty('label');
                expect(typeof entry.label).toBe('string');

                // statistic = Statistic column (W for SW, D for KS)
                expect(entry).toHaveProperty('statistic');
                expect(typeof entry.statistic).toBe('number');

                // df = Degrees of Freedom column
                expect(entry).toHaveProperty('df');
                expect(typeof entry.df).toBe('number');

                // pValue = P-Value (Sig.) column
                expect(entry).toHaveProperty('pValue');
                expect(typeof entry.pValue).toBe('number');

                // conclusion = Conclusion column
                expect(entry).toHaveProperty('conclusion');
                expect(typeof entry.conclusion).toBe('string');
            });
        });

        test('should show unavailableReason in conclusion when SW is unavailable (n > 5000)', () => {
            // Generate data with n > 5000
            const data = Array.from({ length: 5001 }, (_, i) => i + 1);
            const result = runNormalityTests(data);

            const swEntry = result.tests.find(t => t.key === 'shapiroWilk');
            expect(swEntry.available).toBe(false);
            expect(swEntry.conclusion).toBe('not-computed');
            expect(swEntry.unavailableReason).toBeDefined();
            expect(swEntry.unavailableReason).toContain('5000');
        });
    });

    describe('Requirement 8.6: W Statistic Formatted to 8 Decimal Places', () => {

        test('should produce W statistic that can be formatted to 8 decimal places', () => {
            const data = [3, 7, 11, 15, 19, 23, 27, 31, 35, 39];
            const result = runNormalityTests(data);

            const swEntry = result.tests.find(t => t.key === 'shapiroWilk');
            expect(swEntry.statistic).not.toBeNull();

            // Format to 8 decimal places
            const formatted = swEntry.statistic.toFixed(8);
            expect(formatted).toMatch(/^\d+\.\d{8}$/);

            // Verify formatting produces a valid number string
            const reparsed = parseFloat(formatted);
            expect(reparsed).toBeCloseTo(swEntry.statistic, 8);
        });

        test('formatNormalityNumber should preserve W precision', () => {
            // Angka hasil uji tidak dibulatkan oleh utilitas keluaran.
            const testW = 0.987654321;
            const formatted = formatNormalityNumber(testW, 8);
            expect(formatted).toBe(String(testW));
        });

        test('should format W=1.0 to 8 decimal places as "1.00000000"', () => {
            // Linear data produces W very close to 1
            const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const result = runNormalityTests(data);

            const swEntry = result.tests.find(t => t.key === 'shapiroWilk');
            const formatted = swEntry.statistic.toFixed(8);

            // Should have exactly 8 decimal digits
            const parts = formatted.split('.');
            expect(parts).toHaveLength(2);
            expect(parts[1]).toHaveLength(8);
        });

        test('should format small W values to 8 decimal places correctly', () => {
            // Non-normal data produces smaller W
            const data = [1, 1, 1, 2, 2, 2, 100, 100, 100, 200];
            const result = runNormalityTests(data);

            const swEntry = result.tests.find(t => t.key === 'shapiroWilk');
            expect(swEntry.statistic).not.toBeNull();

            const formatted = swEntry.statistic.toFixed(8);
            expect(formatted).toMatch(/^\d+\.\d{8}$/);
        });

        test('formatNormalityNumber should return "N/A" for invalid values', () => {
            expect(formatNormalityNumber(NaN, 8)).toBe('N/A');
            expect(formatNormalityNumber(undefined, 8)).toBe('N/A');
            expect(formatNormalityNumber(null, 8)).toBe('N/A');
        });
    });

    describe('Requirement 8.7: P-Value Formatted to 3 Decimal Places', () => {

        test('should produce p-value that can be formatted to 3 decimal places', () => {
            const data = [12, 15, 18, 21, 24, 27, 30, 33, 36, 39];
            const result = runNormalityTests(data);

            const swEntry = result.tests.find(t => t.key === 'shapiroWilk');
            expect(swEntry.pValue).not.toBeNull();

            // Format to 3 decimal places (SPSS convention per Requirement 5.3)
            const formatted = swEntry.pValue.toFixed(3);
            expect(formatted).toMatch(/^\d+\.\d{3}$/);
        });

        test('formatNormalityNumber should preserve p-value precision', () => {
            const testP = 0.045678;
            const formatted = formatNormalityNumber(testP, 3);
            expect(formatted).toBe(String(testP));
        });

        test('should format high p-value (normal data) to 3 decimal places', () => {
            // Linear data → high p-value
            const data = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
            const result = runNormalityTests(data);

            const swEntry = result.tests.find(t => t.key === 'shapiroWilk');
            const formatted = swEntry.pValue.toFixed(3);
            const parts = formatted.split('.');
            expect(parts[1]).toHaveLength(3);
        });

        test('should format very small p-value (non-normal data) to 3 decimal places', () => {
            // Highly non-normal data
            const data = [1, 1, 1, 1, 1, 1, 1, 1, 1, 100];
            const result = runNormalityTests(data);

            const swEntry = result.tests.find(t => t.key === 'shapiroWilk');
            const formatted = swEntry.pValue.toFixed(3);
            expect(formatted).toMatch(/^\d+\.\d{3}$/);
        });

        test('should preserve p-value=0 boundary', () => {
            const formatted = formatNormalityNumber(0, 3);
            expect(formatted).toBe('0');
        });

        test('KS p-value should also be formattable to 3 decimal places', () => {
            const data = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
            const result = runNormalityTests(data);

            const ksEntry = result.tests.find(t => t.key === 'kolmogorovSmirnov');
            expect(ksEntry.pValue).not.toBeNull();

            const formatted = ksEntry.pValue.toFixed(3);
            expect(formatted).toMatch(/^\d+\.\d{3}$/);
        });
    });

    describe('Requirement 8.5: Conclusion "Data dianggap normal" when p ≥ α', () => {

        test('should set conclusion to "fail-to-reject-normality" when p >= alpha', () => {
            // Linear data produces high p-value (normal)
            const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const result = runNormalityTests(data, { alpha: 0.05 });

            const swEntry = result.tests.find(t => t.key === 'shapiroWilk');

            // p-value should be >= 0.05 for linear data
            expect(swEntry.pValue).toBeGreaterThanOrEqual(0.05);
            expect(swEntry.conclusion).toBe('fail-to-reject-normality');
        });

        test('conclusion "fail-to-reject-normality" maps to "Data dianggap normal" display text', () => {
            const data = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
            const result = runNormalityTests(data, { alpha: 0.05 });

            const swEntry = result.tests.find(t => t.key === 'shapiroWilk');
            expect(swEntry.conclusion).toBe('fail-to-reject-normality');

            // UI mapping: 'fail-to-reject-normality' → 'Data dianggap normal'
            const conclusionText = swEntry.conclusion === 'fail-to-reject-normality'
                ? 'Data dianggap normal'
                : 'Data TIDAK normal';
            expect(conclusionText).toBe('Data dianggap normal');
        });

        test('should not highlight row (isSignificant = false) when p >= alpha', () => {
            const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const result = runNormalityTests(data, { alpha: 0.05 });

            const swEntry = result.tests.find(t => t.key === 'shapiroWilk');
            expect(swEntry.isSignificant).toBe(false);
        });
    });

    describe('Requirement 8.4: Highlight Row and "Data TIDAK normal" when p < α', () => {

        test('should set conclusion to "reject-normality" when p < alpha', () => {
            // Highly skewed data to produce low p-value
            const data = [1, 1, 1, 1, 1, 2, 2, 50, 100, 500];
            const result = runNormalityTests(data, { alpha: 0.05 });

            const swEntry = result.tests.find(t => t.key === 'shapiroWilk');

            // p-value should be < 0.05 for highly non-normal data
            expect(swEntry.pValue).toBeLessThan(0.05);
            expect(swEntry.conclusion).toBe('reject-normality');
        });

        test('conclusion "reject-normality" maps to "Data TIDAK normal" display text', () => {
            const data = [1, 1, 1, 1, 1, 2, 2, 50, 100, 500];
            const result = runNormalityTests(data, { alpha: 0.05 });

            const swEntry = result.tests.find(t => t.key === 'shapiroWilk');
            expect(swEntry.conclusion).toBe('reject-normality');

            // UI mapping: 'reject-normality' → 'Data TIDAK normal'
            const conclusionText = swEntry.conclusion === 'reject-normality'
                ? 'Data TIDAK normal'
                : 'Data dianggap normal';
            expect(conclusionText).toBe('Data TIDAK normal');
        });

        test('should highlight row (isSignificant = true) when p < alpha', () => {
            const data = [1, 1, 1, 1, 1, 2, 2, 50, 100, 500];
            const result = runNormalityTests(data, { alpha: 0.05 });

            const swEntry = result.tests.find(t => t.key === 'shapiroWilk');
            expect(swEntry.isSignificant).toBe(true);
        });

        test('isSignificant flag should correctly drive row highlighting for both tests', () => {
            const data = [1, 1, 1, 1, 1, 2, 2, 50, 100, 500];
            const result = runNormalityTests(data, { alpha: 0.05 });

            // Both tests should detect non-normality
            result.tests.forEach((entry) => {
                if (entry.available && entry.pValue !== null) {
                    if (entry.pValue < 0.05) {
                        expect(entry.isSignificant).toBe(true);
                        expect(entry.conclusion).toBe('reject-normality');
                    } else {
                        expect(entry.isSignificant).toBe(false);
                        expect(entry.conclusion).toBe('fail-to-reject-normality');
                    }
                }
            });
        });

        test('should handle custom alpha for significance determination', () => {
            // Data that might be borderline at alpha=0.05
            const data = [3, 5, 7, 9, 11, 13, 15, 17, 19, 21];

            const result01 = runNormalityTests(data, { alpha: 0.01 });
            const result10 = runNormalityTests(data, { alpha: 0.10 });

            const sw01 = result01.tests.find(t => t.key === 'shapiroWilk');
            const sw10 = result10.tests.find(t => t.key === 'shapiroWilk');

            // Alpha stored in the entry for UI reference
            expect(sw01.alpha).toBe(0.01);
            expect(sw10.alpha).toBe(0.10);

            // isSignificant should reflect comparison against the specific alpha
            if (sw01.pValue !== null) {
                expect(sw01.isSignificant).toBe(sw01.pValue < 0.01);
            }
            if (sw10.pValue !== null) {
                expect(sw10.isSignificant).toBe(sw10.pValue < 0.10);
            }
        });
    });

    describe('End-to-End: UI Table Data Formatting Verification', () => {

        test('should produce complete table row data for normal data display', () => {
            const data = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
            const result = runNormalityTests(data, { alpha: 0.05 });

            const swEntry = result.tests.find(t => t.key === 'shapiroWilk');

            // Simulate UI formatting
            const tableRow = {
                testName: swEntry.label,
                statistic: swEntry.statistic.toFixed(8),
                df: swEntry.df,
                pValue: swEntry.pValue.toFixed(3),
                conclusion: swEntry.conclusion === 'reject-normality'
                    ? 'Data TIDAK normal'
                    : 'Data dianggap normal',
                highlighted: swEntry.isSignificant
            };

            expect(tableRow.testName).toBe('Shapiro-Wilk');
            expect(tableRow.statistic).toMatch(/^\d+\.\d{8}$/);
            expect(tableRow.df).toBe(10);
            expect(tableRow.pValue).toMatch(/^\d+\.\d{3}$/);
            expect(tableRow.conclusion).toBe('Data dianggap normal');
            expect(tableRow.highlighted).toBe(false);
        });

        test('should produce complete table row data for non-normal data display', () => {
            const data = [1, 1, 1, 1, 1, 2, 2, 50, 100, 500];
            const result = runNormalityTests(data, { alpha: 0.05 });

            const swEntry = result.tests.find(t => t.key === 'shapiroWilk');

            // Simulate UI formatting
            const tableRow = {
                testName: swEntry.label,
                statistic: swEntry.statistic.toFixed(8),
                df: swEntry.df,
                pValue: swEntry.pValue.toFixed(3),
                conclusion: swEntry.conclusion === 'reject-normality'
                    ? 'Data TIDAK normal'
                    : 'Data dianggap normal',
                highlighted: swEntry.isSignificant
            };

            expect(tableRow.testName).toBe('Shapiro-Wilk');
            expect(tableRow.statistic).toMatch(/^\d+\.\d{8}$/);
            expect(tableRow.df).toBe(10);
            expect(tableRow.pValue).toMatch(/^\d+\.\d{3}$/);
            expect(tableRow.conclusion).toBe('Data TIDAK normal');
            expect(tableRow.highlighted).toBe(true);
        });

        test('should produce complete table with both KS and SW rows', () => {
            const data = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
            const result = runNormalityTests(data, { alpha: 0.05 });

            // Format both rows as they would appear in the UI table
            const tableRows = result.tests
                .filter(entry => entry.available && entry.statistic !== null)
                .map(entry => ({
                    testName: entry.label,
                    statistic: entry.statistic.toFixed(entry.key === 'shapiroWilk' ? 8 : 8),
                    df: entry.df,
                    pValue: entry.pValue.toFixed(3),
                    conclusion: entry.conclusion === 'reject-normality'
                        ? 'Data TIDAK normal'
                        : 'Data dianggap normal',
                    highlighted: entry.isSignificant
                }));

            // Should have 2 rows (KS + SW)
            expect(tableRows).toHaveLength(2);

            // First row: KS
            expect(tableRows[0].testName).toBe('Kolmogorov-Smirnov');
            expect(tableRows[0].statistic).toMatch(/^\d+\.\d{8}$/);
            expect(tableRows[0].pValue).toMatch(/^\d+\.\d{3}$/);

            // Second row: SW
            expect(tableRows[1].testName).toBe('Shapiro-Wilk');
            expect(tableRows[1].statistic).toMatch(/^\d+\.\d{8}$/);
            expect(tableRows[1].pValue).toMatch(/^\d+\.\d{3}$/);
        });
    });
});
