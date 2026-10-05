/**
 * ============================================================================
 * MEMORY USAGE VALIDATION TESTS: Shapiro-Wilk Test
 * ============================================================================
 *
 * **Validates: Requirements 9.7**
 *
 * PURPOSE:
 * Validate that memory allocation during Shapiro-Wilk computation stays well
 * under the 10MB limit for the maximum sample size (n=5000), and verify that
 * no memory leaks occur (arrays are released after function return).
 *
 * THEORETICAL ANALYSIS:
 * The implementation uses O(n) arrays:
 *   - m[] (expected order statistics): n × 8 bytes = 40KB for n=5000
 *   - a[] (coefficients): n × 8 bytes = 40KB for n=5000
 *   - sorted x[]: n × 8 bytes = 40KB for n=5000
 * Total theoretical: ~120KB, well under 10MB limit.
 *
 * METHODOLOGY:
 * - Measure heap usage before and after computation using process.memoryUsage()
 * - Force garbage collection (if available) to get accurate measurements
 * - Suppress console.log during measurement to avoid string buffering noise
 * - Verify peak memory delta stays under 10MB threshold
 *
 * REFERENCE:
 * - Design Document: Phase 5 (Integration and Performance)
 * - Requirement 9.7: Memory allocation SHALL NOT exceed 10MB during calculation
 */

describe('Shapiro-Wilk Test: Memory Usage Validation', () => {

    let calculateShapiroWilk;

    // Suppress console during module load and warmup to avoid noise
    const originalConsoleLog = console.log;
    const originalConsoleWarn = console.warn;

    function suppressConsole() {
        console.log = () => {};
        console.warn = () => {};
    }

    function restoreConsole() {
        console.log = originalConsoleLog;
        console.warn = originalConsoleWarn;
    }

    beforeAll(() => {
        // Load the module
        const fs = require('fs');
        const path = require('path');

        const sourcePath = path.join(__dirname, '../normalityTests.js');
        const sourceCode = fs.readFileSync(sourcePath, 'utf-8');

        const context = {};
        const wrappedCode = `
            ${sourceCode}
            if (typeof calculateShapiroWilk !== 'undefined') {
                context.calculateShapiroWilk = calculateShapiroWilk;
            }
        `;

        suppressConsole();
        const func = new Function('context', wrappedCode);
        func(context);
        restoreConsole();

        calculateShapiroWilk = context.calculateShapiroWilk;
    });

    /**
     * Generate pseudo-random normal data using Box-Muller transform
     * with a simple seeded PRNG for reproducibility.
     */
    function generateNormalData(n, seed = 42) {
        function mulberry32(a) {
            return function () {
                a |= 0; a = a + 0x6D2B79F5 | 0;
                let t = Math.imul(a ^ a >>> 15, 1 | a);
                t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
                return ((t ^ t >>> 14) >>> 0) / 4294967296;
            };
        }

        const rand = mulberry32(seed);
        const data = [];

        for (let i = 0; i < n; i += 2) {
            const u1 = rand();
            const u2 = rand();
            const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
            data.push(z0);
            if (i + 1 < n) {
                data.push(z1);
            }
        }

        return data;
    }

    /**
     * Force garbage collection if available (run Jest with --expose-gc).
     * If not available, this is a no-op.
     */
    function forceGC() {
        if (global.gc) {
            global.gc();
        }
    }

    /**
     * Get current heap usage in bytes.
     */
    function getHeapUsed() {
        return process.memoryUsage().heapUsed;
    }

    describe('Requirement 9.7: Memory allocation < 10MB for n=5000', () => {

        test('should use less than 10MB memory during n=5000 calculation', () => {
            // Arrange: Generate n=5000 dataset
            const data = generateNormalData(5000);
            const TEN_MB = 10 * 1024 * 1024; // 10MB in bytes

            // Warmup: run multiple times to stabilize JIT
            suppressConsole();
            for (let i = 0; i < 5; i++) {
                calculateShapiroWilk(data);
            }
            forceGC();

            // Act: Measure heap before and after computation
            const heapBefore = getHeapUsed();
            const result = calculateShapiroWilk(data);
            const heapAfter = getHeapUsed();
            restoreConsole();

            const memoryDelta = heapAfter - heapBefore;

            // Log memory usage for monitoring
            console.log('[MEMORY] Shapiro-Wilk n=5000:');
            console.log(`  Heap before: ${(heapBefore / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  Heap after:  ${(heapAfter / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  Delta:       ${(memoryDelta / 1024).toFixed(2)} KB`);
            console.log(`  Threshold:   10 MB`);

            // Assert: Memory delta should be well under 10MB
            // Theoretical: ~120KB (3 arrays × 5000 × 8 bytes)
            expect(result).not.toBeNull();
            expect(memoryDelta).toBeLessThan(TEN_MB);
        });

        test('should use less than 10MB for worst-case memory scenario', () => {
            // Arrange: Use a dataset that exercises all code paths (extreme outliers)
            const data = generateNormalData(5000, 123);
            data[0] = -1e9;
            data[4999] = 1e9;

            const TEN_MB = 10 * 1024 * 1024;

            // Warmup
            suppressConsole();
            calculateShapiroWilk(generateNormalData(5000, 99));
            forceGC();

            // Act: Measure memory
            const heapBefore = getHeapUsed();
            const result = calculateShapiroWilk(data);
            const heapAfter = getHeapUsed();
            restoreConsole();

            const memoryDelta = heapAfter - heapBefore;

            console.log('[MEMORY] Shapiro-Wilk n=5000 (with outliers):');
            console.log(`  Heap before: ${(heapBefore / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  Heap after:  ${(heapAfter / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  Delta:       ${(memoryDelta / 1024).toFixed(2)} KB`);

            // Assert
            expect(result).not.toBeNull();
            expect(memoryDelta).toBeLessThan(TEN_MB);
        });
    });

    describe('Memory Leak Detection: Arrays released after function return', () => {

        test('tidak menahan memori berlebihan setelah perhitungan berulang', () => {
            // Ukur memori yang tertahan setelah GC, bukan alokasi sementara.
            // Proses terpisah memastikan GC tersedia dan heap Jest tidak ikut diukur.
            const { spawnSync } = require('child_process');
            const path = require('path');
            const script = `
                const fs = require('fs');
                console.log = () => {};
                const { calculateShapiroWilk } = require(process.argv[1]);
                const data = JSON.parse(fs.readFileSync(0, 'utf8'));
                for (let i = 0; i < 20; i++) calculateShapiroWilk(data);
                global.gc();
                const baseline = process.memoryUsage().heapUsed;
                const growth = [];
                for (let batch = 0; batch < 2; batch++) {
                    for (let i = 0; i < 10; i++) {
                        if (!calculateShapiroWilk(data)) throw new Error('Perhitungan gagal');
                    }
                    global.gc();
                    growth.push(process.memoryUsage().heapUsed - baseline);
                }
                process.stdout.write(JSON.stringify(growth));
            `;
            const child = spawnSync(process.execPath, [
                '--expose-gc', '-e', script,
                path.join(__dirname, '../normalityTests.js'),
            ], {
                input: JSON.stringify(generateNormalData(5000)),
                encoding: 'utf8',
                timeout: 10000,
            });
            expect(child.error).toBeUndefined();
            expect(child.status).toBe(0);
            for (const retainedBytes of JSON.parse(child.stdout)) {
                expect(retainedBytes).toBeLessThan(10 * 1024 * 1024);
            }
        });

        test('should release intermediate arrays after computation completes', () => {
            // Verify function uses only local variables (no closure captures or globals)
            // by checking that total memory used for computation is bounded.
            const data = generateNormalData(5000);

            // Extensive warmup
            suppressConsole();
            for (let i = 0; i < 20; i++) {
                calculateShapiroWilk(data);
            }
            forceGC();

            // Measure a single computation's memory footprint
            // Do multiple runs and take the minimum positive delta (most accurate)
            const deltas = [];
            for (let i = 0; i < 5; i++) {
                const before = getHeapUsed();
                let result = calculateShapiroWilk(data);
                const after = getHeapUsed();
                result = null;
                deltas.push(after - before);
                forceGC();
            }
            restoreConsole();

            // Sort and take median
            deltas.sort((a, b) => a - b);
            const medianDelta = deltas[Math.floor(deltas.length / 2)];

            console.log('[MEMORY RELEASE] Single computation footprint:');
            console.log(`  All deltas (KB): [${deltas.map(d => (d / 1024).toFixed(1)).join(', ')}]`);
            console.log(`  Median delta: ${(medianDelta / 1024).toFixed(2)} KB`);
            console.log(`  Expected theoretical: ~120 KB (3 arrays × 5000 × 8 bytes)`);

            // Assert: A single computation should not retain more than 10MB
            // The algorithm creates O(n) arrays: m[5000], a[5000], sortedX[5000]
            // = 3 × 5000 × 8 = 120KB theoretical minimum
            const TEN_MB = 10 * 1024 * 1024;
            expect(medianDelta).toBeLessThan(TEN_MB);
        });
    });

    describe('Memory Usage Proportional to Sample Size', () => {

        test('should demonstrate memory stays under 10MB for all sample sizes', () => {
            // Test memory usage at different sample sizes
            const sizes = [100, 500, 1000, 2500, 5000];
            const TEN_MB = 10 * 1024 * 1024;
            const memoryResults = [];

            suppressConsole();

            sizes.forEach(n => {
                const data = generateNormalData(n);
                const deltas = [];

                // Warmup
                for (let i = 0; i < 5; i++) {
                    calculateShapiroWilk(data);
                }
                forceGC();

                // Measure multiple times and take median
                for (let run = 0; run < 5; run++) {
                    const before = getHeapUsed();
                    calculateShapiroWilk(data);
                    const after = getHeapUsed();
                    deltas.push(after - before);
                }

                deltas.sort((a, b) => a - b);
                const medianDelta = deltas[Math.floor(deltas.length / 2)];
                memoryResults.push({ n, medianDelta });
            });

            restoreConsole();

            // Log scaling behavior
            console.log('\n[MEMORY SCALING] Sample Size vs Memory Usage (median of 5 runs):');
            console.log('  +--------+------------------+');
            console.log('  |   n    |  Median Delta    |');
            console.log('  +--------+------------------+');
            memoryResults.forEach(({ n, medianDelta }) => {
                console.log(
                    `  | ${String(n).padStart(5)} ` +
                    `| ${(medianDelta / 1024).toFixed(2).padStart(12)} KB |`
                );
            });
            console.log('  +--------+------------------+');

            // Assert: All measurements should be well under 10MB (Requirement 9.7)
            memoryResults.forEach(({ n, medianDelta }) => {
                expect(medianDelta).toBeLessThan(TEN_MB);
            });
        });
    });
});
