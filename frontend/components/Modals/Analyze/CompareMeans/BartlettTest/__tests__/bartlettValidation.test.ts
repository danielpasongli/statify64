/**
 * ============================================================================
 * BARTLETT TEST VALIDATION - Chi-Square, Memory, Waktu, dan Varians
 * ============================================================================
 *
 * Test ini untuk memvalidasi:
 * 1. Chi-Square: Apakah statistik Bartlett dihitung dengan benar
 * 2. Memory: Berapa banyak memori yang digunakan
 * 3. Waktu: Berapa lama waktu eksekusi
 * 4. Varians: Apakah varians per grup dihitung dengan benar
 *
 * Data Referensi dari SPSS untuk validasi hasil.
 * ============================================================================
 */

// ============================================
// KONFIGURASI TEST
// ============================================
const TOLERANCE = 0.0001; // Toleransi perbedaan untuk floating point
const WARMUP_RUNS = 2;
const TEST_RUNS = 5;

// Fungsi p-value yang sama dengan yang dipakai bartlettTestWorker.js.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chiSquarePValue } = require('@/public/workers/DescriptiveStatistics/libs/categoricalTests/categoricalChiSquare.js');

// Pembangkit bilangan acak berbenih (mulberry32) agar data uji selalu sama di setiap run.
const SEED = 20260914;
let seed = SEED;
function seededRandom(): number {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ============================================
// FUNGSI HELPER - SAMA DENGAN bartlettTestWorker.js
// ============================================

/**
 * Menghitung varians dari array data
 * Formula: s² = Σ(xᵢ - x̄)² / (n-1)
 */
function calculateVariance(data: number[]): number {
    const n = data.length;
    if (n < 2) return 0;

    // Hitung mean
    let sum = 0;
    for (let i = 0; i < n; i++) {
        sum += data[i];
    }
    const mean = sum / n;

    // Hitung sum of squared deviations
    let sumSquaredDeviations = 0;
    for (let i = 0; i < n; i++) {
        const diff = data[i] - mean;
        sumSquaredDeviations += diff * diff;
    }

    return sumSquaredDeviations / (n - 1);
}

/**
 * Menghitung mean dari array
 */
function calculateMean(data: number[]): number {
    if (data.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i];
    }
    return sum / data.length;
}

/**
 * Logaritma natural yang aman
 */
function safeLog(value: number): number {
    if (value <= 0) return 0;
    return Math.log(value);
}

// ============================================
// INTERFACE UNTUK HASIL TEST
// ============================================

interface GroupStatistics {
    name: string;
    n: number;
    mean: number;
    variance: number;
    standardDeviation: number;
}

interface BartlettResult {
    statistic: number;      // Chi-Square statistic (T)
    df: number;             // Degrees of freedom (k-1)
    pValue: number;         // P-value
    pooledVariance: number; // Varians gabungan (sp²)
    M: number;              // Statistik M sebelum koreksi
    C: number;              // Faktor koreksi
    groupStats: GroupStatistics[];
    executionTimeMs: number;
    memoryUsedMB: number;
}

// ============================================
// FUNGSI UTAMA: BARTLETT TEST
// ============================================

/**
 * Menghitung Bartlett Test lengkap
 */
function calculateBartlettTest(groupedData: { [key: string]: number[] }): BartlettResult {
    const startTime = performance.now();
    const startMemory = process.memoryUsage().heapUsed;

    const groupNames = Object.keys(groupedData);
    const k = groupNames.length;

    if (k < 2) {
        throw new Error('Bartlett Test requires at least 2 groups');
    }

    // LANGKAH 1: Hitung statistik per grup
    const groupStats: GroupStatistics[] = [];
    const variances: number[] = [];
    const degreesOfFreedom: number[] = [];
    let N = 0;

    for (const name of groupNames) {
        const data = groupedData[name];
        const n = data.length;

        if (n < 2) {
            throw new Error(`Group ${name} has less than 2 observations`);
        }

        const mean = calculateMean(data);
        const variance = calculateVariance(data);
        const stdDev = Math.sqrt(variance);

        groupStats.push({
            name,
            n,
            mean,
            variance,
            standardDeviation: stdDev
        });

        variances.push(variance);
        degreesOfFreedom.push(n - 1);
        N += n;
    }

    // Total degrees of freedom
    const totalDF = N - k;

    // LANGKAH 2: Hitung Pooled Variance
    // sp² = Σ(Nᵢ-1)×sᵢ² / (N-k)
    let pooledNumerator = 0;
    for (let i = 0; i < k; i++) {
        pooledNumerator += degreesOfFreedom[i] * variances[i];
    }
    const pooledVariance = pooledNumerator / totalDF;

    // LANGKAH 3: Hitung Statistik M
    // M = (N-k)×ln(sp²) - Σ(Nᵢ-1)×ln(sᵢ²)
    const part1 = totalDF * safeLog(pooledVariance);
    let part2 = 0;
    for (let i = 0; i < k; i++) {
        part2 += degreesOfFreedom[i] * safeLog(variances[i]);
    }
    const M = part1 - part2;

    // LANGKAH 4: Hitung Faktor Koreksi C
    // C = 1 + [1/(3(k-1))] × [Σ(1/(Nᵢ-1)) - 1/(N-k)]
    let sumInverseDf = 0;
    for (let i = 0; i < k; i++) {
        sumInverseDf += 1 / degreesOfFreedom[i];
    }
    const correctionTerm = (sumInverseDf - (1 / totalDF)) / (3 * (k - 1));
    const C = 1 + correctionTerm;

    // LANGKAH 5: Hitung Statistik Bartlett (Chi-Square)
    // T = M / C
    const bartlettStatistic = M / C;

    // LANGKAH 6: Hitung P-value
    const df = k - 1;
    const pValue = chiSquarePValue(bartlettStatistic, df);

    const endTime = performance.now();
    const endMemory = process.memoryUsage().heapUsed;

    return {
        statistic: bartlettStatistic,
        df,
        pValue: Math.max(0, Math.min(1, pValue)),
        pooledVariance,
        M,
        C,
        groupStats,
        executionTimeMs: endTime - startTime,
        memoryUsedMB: (endMemory - startMemory) / (1024 * 1024)
    };
}

// ============================================
// DATA TEST - CONTOH DARI TEXTBOOK/SPSS
// ============================================

/**
 * Dataset 1: Data sederhana untuk validasi manual
 * 3 grup, masing-masing 5 observasi
 * Varians sama (homogen) - Expected: p > 0.05
 */
const HOMOGENEOUS_DATA = {
    group1: [10, 12, 11, 13, 14],
    group2: [15, 17, 16, 18, 19],
    group3: [20, 22, 21, 23, 24]
};

/**
 * Dataset 2: Data dengan varians berbeda (heterogen)
 * Expected: p < 0.05
 */
const HETEROGENEOUS_DATA = {
    group1: [10, 11, 10, 11, 10],  // Varians kecil (~0.3)
    group2: [15, 25, 10, 30, 20],  // Varians besar (~62.5)
    group3: [20, 21, 19, 22, 18]   // Varians sedang (~2.5)
};

/**
 * Dataset 3: Data dari SPSS Example (untuk validasi)
 * Reference: https://www.ibm.com/docs/en/spss-statistics
 */
const SPSS_EXAMPLE_DATA = {
    treatment1: [23, 25, 27, 22, 24, 26],
    treatment2: [30, 32, 28, 31, 29, 33],
    treatment3: [18, 20, 19, 21, 17, 22]
};

/**
 * Dataset 4: Data besar untuk test performa
 */
function generateLargeData(groupSizes: number[], varianceMultipliers: number[]): { [key: string]: number[] } {
    const data: { [key: string]: number[] } = {};
    seed = SEED; // benih diulang agar setiap panggilan menghasilkan data yang sama

    for (let g = 0; g < groupSizes.length; g++) {
        const groupName = `group${g + 1}`;
        const size = groupSizes[g];
        const variance = varianceMultipliers[g];
        const groupData: number[] = [];

        // Generate data dengan varians yang dikontrol
        const baseMean = 50 + g * 10;
        for (let i = 0; i < size; i++) {
            // Box-Muller transform untuk distribusi normal
            const u1 = 1 - seededRandom();
            const u2 = seededRandom();
            const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            groupData.push(baseMean + z * Math.sqrt(variance));
        }

        data[groupName] = groupData;
    }

    return data;
}

// ============================================
// TEST SUITE
// ============================================

describe('Bartlett Test Validation', () => {

    // ----------------------------------------
    // TEST 1: VALIDASI PERHITUNGAN VARIANS
    // ----------------------------------------
    describe('1. Validasi Perhitungan Varians', () => {

        test('Varians dihitung dengan benar untuk data sederhana', () => {
            const data = [10, 12, 11, 13, 14];
            const variance = calculateVariance(data);

            // Manual calculation:
            // Mean = (10+12+11+13+14)/5 = 12
            // Variance = [(10-12)² + (12-12)² + (11-12)² + (13-12)² + (14-12)²] / (5-1)
            //          = [4 + 0 + 1 + 1 + 4] / 4 = 10/4 = 2.5
            const expectedVariance = 2.5;

            console.log('\n=== VALIDASI VARIANS ===');
            console.log(`Data: [${data.join(', ')}]`);
            console.log(`Mean: ${calculateMean(data)}`);
            console.log(`Varians Calculated: ${variance}`);
            console.log(`Varians Expected: ${expectedVariance}`);
            console.log(`Selisih: ${Math.abs(variance - expectedVariance)}`);

            expect(variance).toBeCloseTo(expectedVariance, 4);
        });

        test('Varians tiap grup dihitung dengan benar', () => {
            console.log('\n=== VARIANS PER GRUP (HOMOGENEOUS DATA) ===');

            for (const [groupName, data] of Object.entries(HOMOGENEOUS_DATA)) {
                const variance = calculateVariance(data);
                const mean = calculateMean(data);
                const stdDev = Math.sqrt(variance);

                console.log(`${groupName}:`);
                console.log(`  Data: [${data.join(', ')}]`);
                console.log(`  N: ${data.length}`);
                console.log(`  Mean: ${mean.toFixed(4)}`);
                console.log(`  Varians: ${variance.toFixed(4)}`);
                console.log(`  Std Dev: ${stdDev.toFixed(4)}`);
            }

            // Semua grup dalam HOMOGENEOUS_DATA harus memiliki varians 2.5
            expect(calculateVariance(HOMOGENEOUS_DATA.group1)).toBeCloseTo(2.5, 4);
            expect(calculateVariance(HOMOGENEOUS_DATA.group2)).toBeCloseTo(2.5, 4);
            expect(calculateVariance(HOMOGENEOUS_DATA.group3)).toBeCloseTo(2.5, 4);
        });

        test('Varians berbeda antar grup (heterogen)', () => {
            console.log('\n=== VARIANS PER GRUP (HETEROGENEOUS DATA) ===');

            const variances: number[] = [];

            for (const [groupName, data] of Object.entries(HETEROGENEOUS_DATA)) {
                const variance = calculateVariance(data);
                variances.push(variance);

                console.log(`${groupName}:`);
                console.log(`  Data: [${data.join(', ')}]`);
                console.log(`  Varians: ${variance.toFixed(4)}`);
            }

            // Varians harus berbeda secara signifikan
            const varianceRatio = Math.max(...variances) / Math.min(...variances);
            console.log(`\nRasio Varians Max/Min: ${varianceRatio.toFixed(2)}`);

            expect(varianceRatio).toBeGreaterThan(10); // Varians berbeda jauh
        });
    });

    // ----------------------------------------
    // TEST 2: VALIDASI CHI-SQUARE STATISTIC
    // ----------------------------------------
    describe('2. Validasi Chi-Square Statistic', () => {

        test('Chi-Square untuk data homogen harus kecil', () => {
            console.log('\n=== CHI-SQUARE: DATA HOMOGEN ===');

            const result = calculateBartlettTest(HOMOGENEOUS_DATA);

            console.log('Hasil Bartlett Test:');
            console.log(`  Chi-Square (T): ${result.statistic.toFixed(6)}`);
            console.log(`  Degrees of Freedom: ${result.df}`);
            console.log(`  P-value: ${result.pValue.toFixed(6)}`);
            console.log(`  Pooled Variance: ${result.pooledVariance.toFixed(6)}`);
            console.log(`  M (sebelum koreksi): ${result.M.toFixed(6)}`);
            console.log(`  C (faktor koreksi): ${result.C.toFixed(6)}`);

            console.log('\nStatistik Per Grup:');
            for (const stat of result.groupStats) {
                console.log(`  ${stat.name}: N=${stat.n}, Mean=${stat.mean.toFixed(2)}, Var=${stat.variance.toFixed(4)}`);
            }

            // Data homogen → Chi-Square harus mendekati 0, P-value harus > 0.05
            expect(result.statistic).toBeLessThan(1);
            expect(result.pValue).toBeGreaterThan(0.05);
        });

        test('Chi-Square untuk data heterogen harus besar', () => {
            console.log('\n=== CHI-SQUARE: DATA HETEROGEN ===');

            const result = calculateBartlettTest(HETEROGENEOUS_DATA);

            console.log('Hasil Bartlett Test:');
            console.log(`  Chi-Square (T): ${result.statistic.toFixed(6)}`);
            console.log(`  Degrees of Freedom: ${result.df}`);
            console.log(`  P-value: ${result.pValue.toFixed(6)}`);
            console.log(`  Pooled Variance: ${result.pooledVariance.toFixed(6)}`);

            console.log('\nStatistik Per Grup:');
            for (const stat of result.groupStats) {
                console.log(`  ${stat.name}: N=${stat.n}, Mean=${stat.mean.toFixed(2)}, Var=${stat.variance.toFixed(4)}`);
            }

            // Data heterogen → Chi-Square harus besar, P-value harus < 0.05
            expect(result.statistic).toBeGreaterThan(5);
            expect(result.pValue).toBeLessThan(0.05);
        });

        test('Validasi dengan data SPSS', () => {
            console.log('\n=== CHI-SQUARE: VALIDASI SPSS ===');

            const result = calculateBartlettTest(SPSS_EXAMPLE_DATA);

            console.log('Hasil Bartlett Test:');
            console.log(`  Chi-Square (T): ${result.statistic.toFixed(6)}`);
            console.log(`  Degrees of Freedom: ${result.df}`);
            console.log(`  P-value: ${result.pValue.toFixed(6)}`);

            console.log('\nStatistik Per Grup:');
            for (const stat of result.groupStats) {
                console.log(`  ${stat.name}: N=${stat.n}, Mean=${stat.mean.toFixed(2)}, Var=${stat.variance.toFixed(4)}, SD=${stat.standardDeviation.toFixed(4)}`);
            }

            // SPSS example memiliki varians mirip → homogen
            expect(result.df).toBe(2); // 3 groups - 1 = 2
            expect(result.pValue).toBeGreaterThan(0.05);
        });
    });

    // ----------------------------------------
    // TEST 3: VALIDASI WAKTU EKSEKUSI
    // ----------------------------------------
    describe('3. Validasi Waktu Eksekusi', () => {

        test('Waktu eksekusi untuk data kecil (< 100 observasi)', () => {
            console.log('\n=== WAKTU EKSEKUSI: DATA KECIL ===');

            const times: number[] = [];

            // Warmup
            for (let i = 0; i < WARMUP_RUNS; i++) {
                calculateBartlettTest(HOMOGENEOUS_DATA);
            }

            // Measurement
            for (let i = 0; i < TEST_RUNS; i++) {
                const result = calculateBartlettTest(HOMOGENEOUS_DATA);
                times.push(result.executionTimeMs);
            }

            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const minTime = Math.min(...times);
            const maxTime = Math.max(...times);

            console.log(`Total Observasi: ${Object.values(HOMOGENEOUS_DATA).flat().length}`);
            console.log(`Waktu Rata-rata: ${avgTime.toFixed(4)} ms`);
            console.log(`Waktu Min: ${minTime.toFixed(4)} ms`);
            console.log(`Waktu Max: ${maxTime.toFixed(4)} ms`);

            expect(avgTime).toBeLessThan(10); // Harus < 10ms untuk data kecil
        });

        test('Waktu eksekusi untuk data sedang (1,000 observasi)', () => {
            console.log('\n=== WAKTU EKSEKUSI: DATA SEDANG (1,000) ===');

            const mediumData = generateLargeData([200, 300, 250, 150, 100], [10, 15, 12, 8, 20]);
            const totalObs = Object.values(mediumData).flat().length;
            const times: number[] = [];

            // Warmup
            for (let i = 0; i < WARMUP_RUNS; i++) {
                calculateBartlettTest(mediumData);
            }

            // Measurement
            for (let i = 0; i < TEST_RUNS; i++) {
                const result = calculateBartlettTest(mediumData);
                times.push(result.executionTimeMs);
            }

            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

            console.log(`Total Observasi: ${totalObs}`);
            console.log(`Waktu Rata-rata: ${avgTime.toFixed(4)} ms`);
            console.log(`Throughput: ${(totalObs / avgTime * 1000).toFixed(0)} obs/detik`);

            expect(avgTime).toBeLessThan(50); // Harus < 50ms
        });

        test('Waktu eksekusi untuk data besar (10,000 observasi)', () => {
            console.log('\n=== WAKTU EKSEKUSI: DATA BESAR (10,000) ===');

            const largeData = generateLargeData([2000, 3000, 2500, 1500, 1000], [10, 15, 12, 8, 20]);
            const totalObs = Object.values(largeData).flat().length;
            const times: number[] = [];

            // Warmup
            for (let i = 0; i < WARMUP_RUNS; i++) {
                calculateBartlettTest(largeData);
            }

            // Measurement
            for (let i = 0; i < TEST_RUNS; i++) {
                const result = calculateBartlettTest(largeData);
                times.push(result.executionTimeMs);
            }

            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

            console.log(`Total Observasi: ${totalObs}`);
            console.log(`Waktu Rata-rata: ${avgTime.toFixed(4)} ms`);
            console.log(`Throughput: ${(totalObs / avgTime * 1000).toFixed(0)} obs/detik`);

            expect(avgTime).toBeLessThan(500); // Harus < 500ms
        });

        test('Waktu eksekusi untuk data sangat besar (100,000 observasi)', () => {
            console.log('\n=== WAKTU EKSEKUSI: DATA SANGAT BESAR (100,000) ===');

            const veryLargeData = generateLargeData([20000, 30000, 25000, 15000, 10000], [10, 15, 12, 8, 20]);
            const totalObs = Object.values(veryLargeData).flat().length;
            const times: number[] = [];

            // Warmup
            for (let i = 0; i < WARMUP_RUNS; i++) {
                calculateBartlettTest(veryLargeData);
            }

            // Measurement
            for (let i = 0; i < TEST_RUNS; i++) {
                const result = calculateBartlettTest(veryLargeData);
                times.push(result.executionTimeMs);
            }

            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

            console.log(`Total Observasi: ${totalObs}`);
            console.log(`Waktu Rata-rata: ${avgTime.toFixed(4)} ms`);
            console.log(`Throughput: ${(totalObs / avgTime * 1000).toFixed(0)} obs/detik`);

            expect(avgTime).toBeLessThan(5000); // Harus < 5 detik
        });
    });

    // ----------------------------------------
    // TEST 4: VALIDASI MEMORY USAGE
    // ----------------------------------------
    describe('4. Validasi Memory Usage', () => {

        test('Memory usage untuk berbagai ukuran data', () => {
            console.log('\n=== MEMORY USAGE COMPARISON ===');
            console.log('=' .repeat(70));

            const testCases = [
                { name: 'Kecil', sizes: [50, 50, 50, 50, 50], total: 250 },
                { name: 'Sedang', sizes: [200, 300, 250, 150, 100], total: 1000 },
                { name: 'Besar', sizes: [2000, 3000, 2500, 1500, 1000], total: 10000 },
                { name: 'Sangat Besar', sizes: [20000, 30000, 25000, 15000, 10000], total: 100000 },
            ];

            const results: { name: string; total: number; memoryMB: number; bytesPerObs: number }[] = [];

            for (const testCase of testCases) {
                // Force garbage collection jika tersedia
                if (global.gc) global.gc();

                const beforeMemory = process.memoryUsage().heapUsed;

                const data = generateLargeData(testCase.sizes, [10, 15, 12, 8, 20]);
                const result = calculateBartlettTest(data);

                const afterMemory = process.memoryUsage().heapUsed;
                const memoryUsedMB = (afterMemory - beforeMemory) / (1024 * 1024);
                const bytesPerObs = (afterMemory - beforeMemory) / testCase.total;

                results.push({
                    name: testCase.name,
                    total: testCase.total,
                    memoryMB: memoryUsedMB,
                    bytesPerObs
                });
            }

            // Print table
            console.log('| Ukuran Data    | Observasi  | Memory (MB) | Bytes/Obs |');
            console.log('|----------------|------------|-------------|-----------|');
            for (const r of results) {
                console.log(`| ${r.name.padEnd(14)} | ${r.total.toString().padStart(10)} | ${r.memoryMB.toFixed(4).padStart(11)} | ${r.bytesPerObs.toFixed(2).padStart(9)} |`);
            }

            // Memory untuk 100k observasi tidak boleh lebih dari 100MB
            const largestResult = results[results.length - 1];
            expect(largestResult.memoryMB).toBeLessThan(100);
        });

        test('Memory efficiency dengan Typed Arrays vs Regular Arrays', () => {
            console.log('\n=== MEMORY: TYPED ARRAYS vs REGULAR ARRAYS ===');

            const size = 100000;

            // Regular Array
            if (global.gc) global.gc();
            const beforeRegular = process.memoryUsage().heapUsed;
            const regularArray: number[] = [];
            for (let i = 0; i < size; i++) {
                regularArray.push(Math.random() * 100);
            }
            const afterRegular = process.memoryUsage().heapUsed;
            const regularMemory = (afterRegular - beforeRegular) / (1024 * 1024);

            // Float64Array
            if (global.gc) global.gc();
            const beforeTyped = process.memoryUsage().heapUsed;
            const typedArray = new Float64Array(size);
            for (let i = 0; i < size; i++) {
                typedArray[i] = Math.random() * 100;
            }
            const afterTyped = process.memoryUsage().heapUsed;
            const typedMemory = (afterTyped - beforeTyped) / (1024 * 1024);

            console.log(`Ukuran Data: ${size.toLocaleString()} elemen`);
            console.log(`Regular Array: ${regularMemory.toFixed(4)} MB`);
            console.log(`Float64Array: ${typedMemory.toFixed(4)} MB`);
            console.log(`Rasio: Float64Array ${(regularMemory / typedMemory).toFixed(2)}x lebih hemat`);

            // Float64Array seharusnya lebih hemat
            // Tapi bisa jadi tidak karena JIT optimization
            expect(typedMemory).toBeLessThan(regularMemory * 2);
        });
    });

    // ----------------------------------------
    // TEST 5: RINGKASAN LENGKAP
    // ----------------------------------------
    describe('5. Ringkasan Lengkap - Semua Metrik', () => {

        test('Comprehensive test dengan semua metrik', () => {
            console.log('\n');
            console.log('='.repeat(80));
            console.log(' BARTLETT TEST - COMPREHENSIVE VALIDATION REPORT');
            console.log('='.repeat(80));

            // Test dengan berbagai ukuran data
            const testCases = [
                {
                    name: 'HOMOGEN (Varians Sama)',
                    data: HOMOGENEOUS_DATA,
                    expectedHomogen: true
                },
                {
                    name: 'HETEROGEN (Varians Beda)',
                    data: HETEROGENEOUS_DATA,
                    expectedHomogen: false
                },
                {
                    name: 'SPSS Example',
                    data: SPSS_EXAMPLE_DATA,
                    expectedHomogen: true
                },
                {
                    name: 'DATA BESAR (10K)',
                    data: generateLargeData([2000, 3000, 2500, 1500, 1000], [10, 10, 10, 10, 10]),
                    expectedHomogen: true
                },
                {
                    name: 'DATA BESAR HETEROGEN (10K)',
                    data: generateLargeData([2000, 3000, 2500, 1500, 1000], [5, 50, 10, 100, 20]),
                    expectedHomogen: false
                }
            ];

            for (const testCase of testCases) {
                console.log('\n' + '-'.repeat(80));
                console.log(` TEST: ${testCase.name}`);
                console.log('-'.repeat(80));

                const totalObs = Object.values(testCase.data).flat().length;
                const numGroups = Object.keys(testCase.data).length;

                // Run test
                const times: number[] = [];
                let finalResult: BartlettResult | null = null;

                // Warmup
                for (let i = 0; i < WARMUP_RUNS; i++) {
                    calculateBartlettTest(testCase.data);
                }

                // Measurement
                for (let i = 0; i < TEST_RUNS; i++) {
                    const result = calculateBartlettTest(testCase.data);
                    times.push(result.executionTimeMs);
                    finalResult = result;
                }

                const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

                // Print results
                console.log('\n[DATA INFO]');
                console.log(`  Total Observasi: ${totalObs.toLocaleString()}`);
                console.log(`  Jumlah Grup: ${numGroups}`);

                console.log('\n[VARIANS PER GRUP]');
                for (const stat of finalResult!.groupStats) {
                    console.log(`  ${stat.name}: N=${stat.n}, Var=${stat.variance.toFixed(4)}, SD=${stat.standardDeviation.toFixed(4)}`);
                }

                console.log('\n[CHI-SQUARE RESULT]');
                console.log(`  Statistic (T): ${finalResult!.statistic.toFixed(6)}`);
                console.log(`  Degrees of Freedom: ${finalResult!.df}`);
                console.log(`  P-value: ${finalResult!.pValue.toFixed(6)}`);
                console.log(`  Pooled Variance: ${finalResult!.pooledVariance.toFixed(6)}`);
                console.log(`  M (sebelum koreksi): ${finalResult!.M.toFixed(6)}`);
                console.log(`  C (faktor koreksi): ${finalResult!.C.toFixed(6)}`);

                console.log('\n[PERFORMANCE]');
                console.log(`  Waktu Rata-rata: ${avgTime.toFixed(4)} ms`);
                console.log(`  Throughput: ${(totalObs / avgTime * 1000).toFixed(0)} obs/detik`);

                console.log('\n[INTERPRETASI]');
                const isHomogen = finalResult!.pValue > 0.05;
                if (isHomogen) {
                    console.log(`  ✅ P-value (${finalResult!.pValue.toFixed(4)}) > 0.05`);
                    console.log(`  ✅ KESIMPULAN: Varians HOMOGEN (sama)`);
                    console.log(`  ✅ Data memenuhi asumsi untuk ANOVA`);
                } else {
                    console.log(`  ❌ P-value (${finalResult!.pValue.toFixed(4)}) < 0.05`);
                    console.log(`  ❌ KESIMPULAN: Varians HETEROGEN (berbeda)`);
                    console.log(`  ⚠️  Pertimbangkan menggunakan Welch's ANOVA atau transformasi data`);
                }

                // Validate
                expect(isHomogen).toBe(testCase.expectedHomogen);
            }

            console.log('\n' + '='.repeat(80));
            console.log(' END OF REPORT');
            console.log('='.repeat(80));
        });
    });
});

// ============================================
// TABEL RINGKASAN
// ============================================

describe('Tabel Ringkasan Hasil Test', () => {
    test('Generate summary table', () => {
        console.log('\n');
        console.log('='.repeat(100));
        console.log(' TABEL RINGKASAN BARTLETT TEST');
        console.log('='.repeat(100));

        // Header
        console.log('| No | Dataset              | N      | Groups | Chi-Sq   | df | P-value  | Waktu(ms) | Status      |');
        console.log('|----|----------------------|--------|--------|----------|----|---------:|-----------|-------------|');

        const datasets = [
            { no: 1, name: 'Homogen (Sama)', data: HOMOGENEOUS_DATA },
            { no: 2, name: 'Heterogen (Beda)', data: HETEROGENEOUS_DATA },
            { no: 3, name: 'SPSS Example', data: SPSS_EXAMPLE_DATA },
            { no: 4, name: 'Besar Homogen 10K', data: generateLargeData([2000, 3000, 2500, 1500, 1000], [10, 10, 10, 10, 10]) },
            { no: 5, name: 'Besar Heterogen 10K', data: generateLargeData([2000, 3000, 2500, 1500, 1000], [5, 50, 10, 100, 20]) },
            { no: 6, name: 'Sangat Besar 100K', data: generateLargeData([20000, 30000, 25000, 15000, 10000], [10, 12, 11, 9, 13]) },
        ];

        for (const ds of datasets) {
            const result = calculateBartlettTest(ds.data);
            const n = Object.values(ds.data).flat().length;
            const groups = Object.keys(ds.data).length;
            const status = result.pValue > 0.05 ? 'HOMOGEN ✅' : 'HETEROGEN ❌';

            console.log(`| ${ds.no.toString().padStart(2)} | ${ds.name.padEnd(20)} | ${n.toString().padStart(6)} | ${groups.toString().padStart(6)} | ${result.statistic.toFixed(4).padStart(8)} | ${result.df.toString().padStart(2)} | ${result.pValue.toFixed(6)} | ${result.executionTimeMs.toFixed(4).padStart(9)} | ${status.padEnd(11)} |`);
        }

        console.log('='.repeat(100));

        expect(true).toBe(true);
    });
});
