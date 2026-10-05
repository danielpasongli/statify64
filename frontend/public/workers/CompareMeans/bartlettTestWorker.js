/**
 * ============================================================================
 * WEB WORKER UJI BARTLETT
 * ============================================================================
 *
 * Worker Uji Bartlett (pola mandiri versi lama)
 *
 * TODO: Consider refactoring to BartlettCalculator class pattern
 * to match project architecture (see CompareMeans/libs/oneWayAnova.js)
 *
 * TUJUAN:
 * Menguji homogenitas (kesamaan) varians antar kelompok menggunakan distribusi chi-square.
 *
 * KONSEP DASAR:
 * Bartlett Test memeriksa apakah beberapa kelompok memiliki varians yang sama.
 * - Variabel uji: Variabel numerik yang variansnya ingin diuji (contoh: nilai ujian, tinggi badan)
 * - Variabel pengelompokan: Variabel kategorik yang membagi data ke kelompok (contoh: kelas A/B/C, jenis kelamin)
 *
 * HIPOTESIS:
 * H₀: σ₁² = σ₂² = ... = σₖ² (semua varians sama/homogen)
 * H₁: Minimal ada satu varians yang berbeda
 *
 * KAPAN DIGUNAKAN:
 * - Sebelum ANOVA: Cek asumsi homogenitas varians
 * - Quality Control: Cek konsistensi variabilitas antar batch/grup
 * - Penelitian: Bandingkan keberagaman data antar kelompok
 *
 * ASUMSI:
 * - Data berdistribusi normal (Bartlett sensitif terhadap non-normalitas)
 * - Jika data tidak normal, gunakan Levene's Test sebagai alternatif
 *
 * RUMUS BARTLETT:
 * 1. Hitung pooled variance (varians gabungan):
 *    sp² = Σ(Nᵢ-1)sᵢ² / (N-k)
 *
 * 2. Hitung statistik M:
 *    M = (N-k)×ln(sp²) - Σ(Nᵢ-1)×ln(sᵢ²)
 *
 * 3. Hitung faktor koreksi C:
 *    C = 1 + [1/(3(k-1))] × [Σ(1/(Nᵢ-1)) - 1/(N-k)]
 *
 * 4. Hitung statistik Bartlett:
 *    T = M / C
 *
 * 5. Statistik T mengikuti distribusi chi-square dengan df = k-1
 *
 * INTERPRETASI:
 * - p-value < 0.05: Tolak H₀, varians TIDAK sama (heterogen)
 * - p-value ≥ 0.05: Terima H₀, varians sama (homogen)
 *
 * REFERENSI:
 * Bartlett, M. S. (1937). "Properties of sufficiency and statistical tests".
 * Proceedings of the Royal Society of London, Series A, 160: 268-282.
 * ============================================================================
 */

import '../DescriptiveStatistics/libs/categoricalTests/categoricalChiSquare.js';
import { checkIsMissing } from './libs/utils.js';

const { chiSquarePValue } = self.CategoricalChiSquare;

/** Menjumlahkan nilai dengan koreksi Neumaier untuk mengurangi galat floating point. */
function compensatedSum(length, valueAt) {
    let sum = 0;
    let correction = 0;
    for (let index = 0; index < length; index++) {
        const value = valueAt(index);
        const next = sum + value;
        correction += Math.abs(sum) >= Math.abs(value)
            ? (sum - next) + value
            : (value - next) + sum;
        sum = next;
    }
    return sum + correction;
}

/**
 * Menghitung varians dari larik data menggunakan Typed Array yang dioptimalkan
 *
 * Varians mengukur seberapa tersebar data dari nilai rata-rata.
 * Rumus: s² = Σ(xᵢ - x̄)² / (n-1)
 *
 * OPTIMASI: Menggunakan Float64Array untuk performa terbaik pada dataset besar
 *
 * @param {Float64Array|number[]} data - Array berisi nilai-nilai numerik
 * @returns {number} Varians dari data (s²)
 */
function calculateVariance(data) {
    const n = data.length;
    if (n < 2) return 0;

    console.log('[DEBUG] Worker - calculateVariance input:', {
        length: n,
        firstValue: data[0],
        firstValueType: typeof data[0],
        sample: Array.from(data).slice(0, 3)
    });

    // Konversi ke Float64Array jika belum
    const values = data instanceof Float64Array ? data : new Float64Array(data);

    // Gunakan nilai pertama sebagai origin agar pengurangan pada data ber-offset
    // besar tetap mempertahankan selisih antarpengamatan.
    const origin = values[0];
    const meanOffset = compensatedSum(n, index => values[index] - origin) / n;
    const mean = origin + meanOffset;

    console.log('[DEBUG] Worker - Mean calculated:', mean);

    // Hitung jumlah kuadrat deviasi dari mean
    const sumSquaredDeviations = compensatedSum(n, index => {
        const diff = (values[index] - origin) - meanOffset;
        return diff * diff;
    });

    console.log('[DEBUG] Worker - Sum squared deviations:', sumSquaredDeviations);

    // Varians = jumlah kuadrat deviasi / (n-1)
    // Dibagi (n-1) untuk varians sampel (unbiased estimator)
    const variance = sumSquaredDeviations / (n - 1);

    console.log('[DEBUG] Worker - Calculated variance:', variance);

    return variance;
}

/**
 * Menghitung logaritma natural dengan aman
 *
 * @param {number} value - Nilai yang akan dihitung ln-nya
 * @returns {number} ln(value) atau 0 jika value <= 0
 */
function safeLog(value) {
    if (value <= 0) return 0;
    return Math.log(value);
}

/** Memberi kode sementara 1, 2, 3, ... tanpa mengubah data faktor asli. */
function recodeCategoricalValues(values) {
    if (!Array.isArray(values)) {
        throw new TypeError('Nilai kategori harus berupa array.');
    }

    const categories = [];
    const codeByValue = new Map();
    const codes = new Int32Array(values.length);

    for (let i = 0; i < values.length; i++) {
        const rawValue = values[i];
        if (rawValue === null || rawValue === undefined) continue;
        if (typeof rawValue === 'number' && !Number.isFinite(rawValue)) continue;

        const value = String(rawValue).trim();
        if (value === '') continue;

        let code = codeByValue.get(value);
        if (code === undefined) {
            categories.push(value);
            code = categories.length;
            codeByValue.set(value, code);
        }
        codes[i] = code;
    }

    return { codes, categories };
}

/**
 * Mengelompokkan data numerik memakai kode faktor sementara.
 * Nama kelompok asli tetap menjadi kunci hasil agar dapat ditampilkan kembali.
 */
function groupDataByFactor(testData, factorData, testVariable = {}, factorVariable = {}) {
    const n = testData.length;
    const factorEncoding = recodeCategoricalValues(factorData);
    const isValidCase = (index) => {
        const value = testData[index];
        const group = factorData[index];
        if (typeof value === 'string' && value.trim() === '') return false;
        if (typeof group === 'string' && group.trim() === '') return false;
        if (checkIsMissing(value, testVariable.missing, true)) return false;
        if (checkIsMissing(group, factorVariable.missing, factorVariable.type !== 'STRING')) return false;
        return Number.isFinite(Number(value)) &&
            (typeof group !== 'number' || Number.isFinite(group));
    };

    console.log('[DEBUG] Worker - groupDataByFactor input:', {
        testDataLength: n,
        factorDataLength: factorData.length,
        firstTestValue: testData[0],
        firstTestValueType: typeof testData[0],
        firstFactorValue: factorData[0],
        firstFactorValueType: typeof factorData[0]
    });

    // LANGKAH 1: Hitung jumlah item per grup (first pass)
    const groupCounts = new Int32Array(factorEncoding.categories.length + 1);
    for (let i = 0; i < n; i++) {
        // Lewati kasus dengan nilai uji atau faktor yang missing.
        if (!isValidCase(i)) continue;

        const factorCode = factorEncoding.codes[i];
        const testValue = Number(testData[i]);

        // Lewati nilai yang tidak dapat dikonversi menjadi angka.
        if (isNaN(testValue)) {
            console.warn(`[WARN] Worker - Invalid number at index ${i}:`, testData[i]);
            continue;
        }

        groupCounts[factorCode]++;
    }

    // LANGKAH 2: Buat Float64Array untuk setiap grup
    const grouped = Object.create(null);
    const groupIndices = new Int32Array(factorEncoding.categories.length + 1);
    for (let code = 1; code < groupCounts.length; code++) {
        if (groupCounts[code] === 0) continue;
        const label = factorEncoding.categories[code - 1];
        grouped[label] = new Float64Array(groupCounts[code]);
    }

    // LANGKAH 3: Isi data ke Float64Array pada iterasi kedua
    for (let i = 0; i < n; i++) {
        // Lewati kasus dengan nilai uji atau faktor yang missing.
        if (!isValidCase(i)) continue;

        const factorCode = factorEncoding.codes[i];
        const factorValue = factorEncoding.categories[factorCode - 1];
        const testValue = Number(testData[i]);

        // Lewati nilai yang tidak dapat dikonversi menjadi angka.
        if (isNaN(testValue)) continue;

        // Tambahkan nilai ke Float64Array
        const idx = groupIndices[factorCode];
        grouped[factorValue][idx] = testValue;
        groupIndices[factorCode]++;
    }

    console.log('[DEBUG] Worker - Grouped data:', Object.keys(grouped).map(key => ({
        group: key,
        count: grouped[key].length,
        firstValue: grouped[key][0],
        valueType: 'Float64Array'
    })));

    return grouped;
}

/**
 * ============================================================================
 * Menghitung Statistik Uji Bartlett
 * ============================================================================
 *
 * Ini adalah fungsi utama yang menghitung statistik Bartlett untuk menguji
 * homogenitas varians antar kelompok.
 *
 * RUMUS BARTLETT:
 *
 * 1. Hitung varians untuk setiap kelompok (s₁², s₂², ..., sₖ²)
 *
 * 2. Hitung pooled variance (varians gabungan):
 *    sp² = Σ(Nᵢ-1)×sᵢ² / (N-k)
 *    di mana:
 *    - Nᵢ = jumlah observasi di kelompok ke-i
 *    - sᵢ² = varians kelompok ke-i
 *    - N = total jumlah observasi
 *    - k = jumlah kelompok
 *
 * 3. Hitung statistik M:
 *    M = (N-k)×ln(sp²) - Σ(Nᵢ-1)×ln(sᵢ²)
 *
 * 4. Hitung faktor koreksi C:
 *    C = 1 + [1/(3(k-1))] × [Σ(1/(Nᵢ-1)) - 1/(N-k)]
 *
 * 5. Hitung statistik Bartlett:
 *    T = M / C
 *
 * 6. T mengikuti distribusi chi-square dengan df = k-1
 *
 * CONTOH PERHITUNGAN:
 *
 * Data:
 *   Kelompok 1: [10, 12, 11, 13, 9]   → N₁=5, s₁²=2.5
 *   Kelompok 2: [15, 17, 16, 18, 14]  → N₂=5, s₂²=2.5
 *   Kelompok 3: [20, 22, 21, 23, 19]  → N₃=5, s₃²=2.5
 *
 * Perhitungan:
 *   N = 15, k = 3
 *   sp² = [(4×2.5) + (4×2.5) + (4×2.5)] / 12 = 30/12 = 2.5
 *   M = 12×ln(2.5) - [4×ln(2.5) + 4×ln(2.5) + 4×ln(2.5)]
 *     = 12×ln(2.5) - 12×ln(2.5) = 0
 *   C = 1 + [1/6] × [(1/4 + 1/4 + 1/4) - 1/12]
 *     = 1 + [1/6] × [3/4 - 1/12]
 *     = 1.111
 *   T = 0 / 1.111 = 0
 *   p-value = P(χ² > 0) = 1.000
 *
 * Hasil: p = 1.000 > 0.05 → Varians HOMOGEN ✅
 *
 * @param {Object} groupedData - Data yang sudah dikelompokkan {grupKey: [nilai1, nilai2, ...]}
 * @returns {Object} Hasil uji Bartlett dengan statistik, df, dan p-value
 * ============================================================================
 */
function calculateBartlettTest(groupedData) {
    const groupNames = Object.keys(groupedData);
    const k = groupNames.length; // Jumlah kelompok

    // Validasi: minimal 2 kelompok diperlukan
    if (k < 2) {
        return {
            error: 'Bartlett Test requires at least 2 groups',
            insufficientType: 'lessThanTwoGroups'
        };
    }

    // ========================================================================
    // LANGKAH 1: Filter kelompok yang valid
    // ========================================================================
    // Setiap kelompok harus memiliki minimal 2 observasi untuk menghitung varians
    // (karena varians = Σ(x-mean)²/(n-1), jadi n minimal 2)

    const validGroups = [];
    const validGroupNames = [];
    const validGroupSizes = [];

    // Periksa setiap kelompok tanpa membuat salinan data kelompok.
    const groupKeys = Object.keys(groupedData);
    for (let i = 0; i < groupKeys.length; i++) {
        const groupKey = groupKeys[i];
        const groupData = groupedData[groupKey];
        if (groupData.length >= 2) {
            validGroups.push(groupData);
            validGroupNames.push(groupKey);
            validGroupSizes.push(groupData.length);
        }
    }

    // Validasi: minimal 2 kelompok valid diperlukan
    if (validGroups.length < 2) {
        return {
            error: 'Bartlett Test requires at least 2 groups with 2+ observations each',
            insufficientType: 'insufficientGroupSize'
        };
    }

    // ========================================================================
    // LANGKAH 2: Hitung ukuran sampel total dan varians per kelompok
    // ========================================================================
    // Gunakan Typed Array untuk kinerja optimal

    const numGroups = validGroups.length;
    const variances = new Float64Array(numGroups);
    const degreesOfFreedom = new Int32Array(numGroups);

    // N = total jumlah observasi dari semua kelompok
    let N = 0;
    for (let i = 0; i < numGroups; i++) {
        N += validGroupSizes[i];
        degreesOfFreedom[i] = validGroupSizes[i] - 1;
        variances[i] = calculateVariance(validGroups[i]);
    }

    // Total degrees of freedom = Σ(Nᵢ - 1) = N - k
    let totalDF = 0;
    for (let i = 0; i < numGroups; i++) {
        totalDF += degreesOfFreedom[i];
    }

    // Validasi: varians harus positif
    let hasZeroVariance = false;
    for (let i = 0; i < numGroups; i++) {
        if (variances[i] <= 0) {
            hasZeroVariance = true;
            break;
        }
    }

    if (hasZeroVariance) {
        return {
            error: 'One or more groups have zero or negative variance',
            insufficientType: 'zeroVariance'
        };
    }

    // ========================================================================
    // LANGKAH 3: Hitung Pooled Variance (Varians Gabungan)
    // ========================================================================
    // Rumus: sp² = Σ(Nᵢ-1)×sᵢ² / (N-k)
    //
    // Pooled variance adalah rata-rata tertimbang dari varians semua kelompok
    // Akumulasikan pembilang pooled variance tanpa membuat larik perantara.

    const pooledNumerator = compensatedSum(
        numGroups,
        index => degreesOfFreedom[index] * variances[index],
    );
    const pooledVariance = pooledNumerator / totalDF;

    console.log('[DEBUG] Worker - Pooled Variance:', pooledVariance);
    console.log('[DEBUG] Worker - Variances:', Array.from(variances));
    console.log('[DEBUG] Worker - Degrees of Freedom:', Array.from(degreesOfFreedom));

    if (pooledVariance <= 0) {
        return {
            error: 'Pooled variance is zero or negative',
            insufficientType: 'zeroPooledVariance'
        };
    }

    // ========================================================================
    // LANGKAH 4: Hitung Statistik M
    // ========================================================================
    // Rumus: M = (N-k)×ln(sp²) - Σ(Nᵢ-1)×ln(sᵢ²)
    //
    // M mengukur perbedaan antara:
    // - Log dari pooled variance (yang diasumsikan sama untuk semua grup)
    // - Log dari varians aktual setiap grup
    //
    // Jika semua varians benar-benar sama, M akan mendekati 0
    //
    // Contoh (dengan varians sama = 2.5):
    //   Part 1 = 12 × ln(2.5) = 12 × 0.916 = 10.997
    //   Part 2 = 4×ln(2.5) + 4×ln(2.5) + 4×ln(2.5)
    //          = 4×0.916 + 4×0.916 + 4×0.916
    //          = 3.665 + 3.665 + 3.665 = 10.997
    //   M = 10.997 - 10.997 = 0

    const numeratorPart1 = totalDF * safeLog(pooledVariance);

    // Akumulasikan bagian kedua statistik M untuk seluruh kelompok.
    const numeratorPart2 = compensatedSum(
        numGroups,
        index => degreesOfFreedom[index] * safeLog(variances[index]),
    );
    const M = numeratorPart1 - numeratorPart2;

    console.log('[DEBUG] Worker - M:', M, 'numeratorPart1:', numeratorPart1, 'numeratorPart2:', numeratorPart2);    // ========================================================================
    // LANGKAH 5: Hitung Faktor Koreksi C
    // ========================================================================
    // Rumus: C = 1 + [1/(3(k-1))] × [Σ(1/(Nᵢ-1)) - 1/(N-k)]
    //
    // Faktor koreksi C memperbaiki statistik M agar lebih akurat
    // mengikuti distribusi chi-square, terutama untuk sampel kecil
    //
    // Contoh (dengan k=3 groups, masing-masing n=5):
    //   Σ(1/(Nᵢ-1)) = 1/4 + 1/4 + 1/4 = 0.75
    //   1/(N-k) = 1/12 = 0.0833
    //
    //   correctionTerm = (0.75 - 0.0833) / (3×2)
    //                  = 0.6667 / 6
    //                  = 0.1111
    //
    //   C = 1 + 0.1111 = 1.1111

    // Jumlahkan kebalikan derajat bebas setiap kelompok untuk faktor koreksi.
    const sumInverseDf = compensatedSum(numGroups, index => 1 / degreesOfFreedom[index]);
    const correctionTerm = (sumInverseDf - (1 / totalDF)) / (3 * (numGroups - 1));
    const C = 1 + correctionTerm;

    // ========================================================================
    // LANGKAH 6: Hitung Statistik Bartlett (T)
    // ========================================================================
    // Rumus: T = M / C
    //
    // Statistik T mengikuti distribusi chi-square dengan df = k-1
    //
    // Contoh:
    //   M = 0 (varians semua sama)
    //   C = 1.1111
    //   T = 0 / 1.1111 = 0

    const bartlettStatistic = M / C;

    console.log('[DEBUG] Worker - C:', C, 'Bartlett Statistic:', bartlettStatistic);

    // ========================================================================
    // LANGKAH 7: Hitung derajat bebas dan nilai-p
    // ========================================================================
    // df = k - 1 (jumlah kelompok minus 1)
    //
    // Untuk k=3 kelompok → df = 2

    const df = numGroups - 1;

    // P-value = P(χ² > T)
    // Gunakan peluang ekor atas dari mesin Chi-Square lokal.
    //
    // Jika T=0 → nilai-p = 1,0 (varians homogen sempurna)
    // Jika T besar → nilai-p mendekati 0 (varians berbeda)
    const pValue = chiSquarePValue(bartlettStatistic, df);

    console.log('[DEBUG] Worker - df:', df, 'pValue:', pValue);
    console.log('[DEBUG] Worker - Final result:', {statistic: bartlettStatistic, df, pValue});

    return {
        statistic: bartlettStatistic,
        df: df,
        pValue: pValue,
        pooledVariance: pooledVariance,
        groupVariances: Array.from(variances),
        groupNames: validGroupNames,
        groupSizes: validGroupSizes,
        totalSampleSize: N,
        numberOfGroups: numGroups,
        M: M,
        C: C
    };
}// ============================================================================
// LOGGING UTILITIES - untuk manual testing via Console
// ============================================================================

/**
 * Memformat angka dengan presisi tertentu
 */
function formatNumber(num) {
    if (typeof num !== 'number' || isNaN(num)) return 'N/A';
    return String(num);
}

/**
 * Memformat byte agar mudah dibaca
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Memperkirakan penggunaan memori data
 */
function estimateMemoryUsage(data) {
    let totalBytes = 0;

    if (Array.isArray(data)) {
        // Array of numbers
        totalBytes = data.length * 8; // Float64 = 8 bytes
    } else if (data instanceof Float64Array) {
        totalBytes = data.byteLength;
    } else if (typeof data === 'object') {
        // Object with arrays
        for (const key of Object.keys(data)) {
            if (Array.isArray(data[key])) {
                totalBytes += data[key].length * 8;
            } else if (data[key] instanceof Float64Array) {
                totalBytes += data[key].byteLength;
            }
        }
    }

    return totalBytes;
}

/**
 * Menampilkan log terperinci untuk Uji Bartlett
 */
function printDetailedLog(testVariable, factorVariable, groupedData, bartlettResult, timing, memoryEstimate) {
    console.log('\n');
    console.log('================================================================');
    console.log('       BARTLETT TEST - DETAILED ANALYSIS LOG');
    console.log('================================================================');
    console.log(`  Variable: ${testVariable?.name || testVariable}`);
    console.log(`  Factor: ${factorVariable?.name || factorVariable}`);
    console.log(`  Timestamp: ${new Date().toISOString()}`);
    console.log('================================================================');

    // ========== WAKTU EKSEKUSI ==========
    console.log('\n[WAKTU EKSEKUSI]');
    console.log(`  Total Time: ${formatNumber(timing.total, 3)} ms`);
    console.log(`  - Grouping: ${formatNumber(timing.grouping, 3)} ms`);
    console.log(`  - Calculation: ${formatNumber(timing.calculation, 3)} ms`);

    // ========== MEMORI ==========
    console.log('\n[MEMORY USAGE]');
    console.log(`  Input Data: ${formatBytes(memoryEstimate.input)}`);
    console.log(`  Grouped Data: ${formatBytes(memoryEstimate.grouped)}`);
    console.log(`  Total Estimate: ${formatBytes(memoryEstimate.total)}`);

    // ========== INFORMASI DATA ==========
    console.log('\n[DATA INFO]');
    console.log(`  Total N: ${bartlettResult.totalSampleSize}`);
    console.log(`  Number of Groups: ${bartlettResult.numberOfGroups}`);
    console.log(`  Groups: ${bartlettResult.groupNames?.join(', ')}`);

    // ========== VARIANS PER GRUP ==========
    console.log('\n[VARIANS PER GRUP]');
    console.log('  +----------+--------+------------------+------------------+');
    console.log('  |   Grup   |    N   |     Variance     |   ln(Variance)   |');
    console.log('  +----------+--------+------------------+------------------+');

    if (bartlettResult.groupNames && bartlettResult.groupVariances) {
        for (let i = 0; i < bartlettResult.groupNames.length; i++) {
            const groupName = String(bartlettResult.groupNames[i]).padEnd(8);
            const n = String(bartlettResult.groupSizes[i]).padStart(6);
            const variance = formatNumber(bartlettResult.groupVariances[i], 8).padStart(16);
            const logVar = formatNumber(Math.log(bartlettResult.groupVariances[i]), 8).padStart(16);
            console.log(`  | ${groupName} | ${n} | ${variance} | ${logVar} |`);
        }
    }
    console.log('  +----------+--------+------------------+------------------+');

    // ========== STATISTIK BARTLETT ==========
    console.log('\n[STATISTIK BARTLETT]');
    console.log(`  Pooled Variance (sp²): ${formatNumber(bartlettResult.pooledVariance, 8)}`);
    console.log(`  ln(sp²): ${formatNumber(Math.log(bartlettResult.pooledVariance), 8)}`);
    console.log(`  M (numerator): ${formatNumber(bartlettResult.M, 8)}`);
    console.log(`  C (correction factor): ${formatNumber(bartlettResult.C, 8)}`);

    // ========== HASIL CHI-SQUARE ==========
    console.log('\n[HASIL CHI-SQUARE]');
    console.log('  +-----------------------+------------------+');
    console.log(`  | Chi-Square Statistic  | ${formatNumber(bartlettResult.statistic, 8).padStart(16)} |`);
    console.log(`  | Degrees of Freedom    | ${String(bartlettResult.df).padStart(16)} |`);
    console.log(`  | P-Value               | ${formatNumber(bartlettResult.pValue, 8).padStart(16)} |`);
    console.log('  +-----------------------+------------------+');

    // ========== KESIMPULAN ==========
    console.log('\n[KESIMPULAN]');
    const alpha = 0.05;
    if (bartlettResult.pValue >= alpha) {
        console.log(`  Status: HOMOGEN (p = ${formatNumber(bartlettResult.pValue, 4)} >= ${alpha})`);
        console.log('  Interpretasi: Varians antar grup SAMA (homogen)');
        console.log('  Rekomendasi: Asumsi homogenitas TERPENUHI, dapat melanjutkan ke ANOVA');
    } else {
        console.log(`  Status: TIDAK HOMOGEN (p = ${formatNumber(bartlettResult.pValue, 4)} < ${alpha})`);
        console.log('  Interpretasi: Varians antar grup BERBEDA (heterogen)');
        console.log('  Rekomendasi: Pertimbangkan Welch ANOVA atau transformasi data');
    }

    // ========== VARIANCE RATIO ==========
    if (bartlettResult.groupVariances && bartlettResult.groupVariances.length > 1) {
        const maxVar = Math.max(...bartlettResult.groupVariances);
        const minVar = Math.min(...bartlettResult.groupVariances);
        const ratio = maxVar / minVar;
        console.log('\n[VARIANCE RATIO]');
        console.log(`  Max Variance: ${formatNumber(maxVar, 6)}`);
        console.log(`  Min Variance: ${formatNumber(minVar, 6)}`);
        console.log(`  Ratio (Max/Min): ${formatNumber(ratio, 2)}`);
        if (ratio < 3) {
            console.log('  Rule of Thumb: Ratio < 3 (Varians relatif homogen)');
        } else {
            console.log('  Rule of Thumb: Ratio >= 3 (Varians mungkin heterogen)');
        }
    }

    console.log('\n================================================================');
    console.log('       END OF BARTLETT TEST LOG');
    console.log('================================================================\n');

    // Kembalikan data untuk keperluan lain
    return {
        summary: {
            variable: testVariable?.name || testVariable,
            factor: factorVariable?.name || factorVariable,
            chiSquare: bartlettResult.statistic,
            df: bartlettResult.df,
            pValue: bartlettResult.pValue,
            isHomogeneous: bartlettResult.pValue >= alpha,
            executionTime: timing.total,
            memoryUsed: memoryEstimate.total
        },
        details: bartlettResult
    };
}

/**
 * Main message handler
 */
self.onmessage = function(e) {
    try {
        const { type, data } = e.data;

        if (type === 'CALCULATE') {
            const {
                testVariables,
                factorVariable,
                variablesData,
                factorData
            } = data;

            // Pastikan fungsi distribusi Chi-Square lokal tersedia.
            if (typeof chiSquarePValue !== 'function') {
                throw new Error('Fungsi p-value Chi-Square lokal tidak tersedia.');
            }

            const results = [];

            // ============================================================
            // MULAI PENGUKURAN WAKTU DAN MEMORI
            // ============================================================
            const totalStartTime = performance.now();
            let inputMemory = 0;

            // Perkirakan memori masukan
            for (let i = 0; i < variablesData.length; i++) {
                inputMemory += estimateMemoryUsage(variablesData[i]);
            }
            inputMemory += estimateMemoryUsage(factorData);

            console.log('\n========================================');
            console.log('  BARTLETT TEST WORKER - STARTING');
            console.log('========================================');
            console.log(`  Test Variables: ${testVariables.map(v => v?.name || v).join(', ')}`);
            console.log(`  Factor Variable: ${factorVariable?.name || factorVariable}`);
            console.log(`  Input Memory: ${formatBytes(inputMemory)}`);
            console.log('========================================\n');

            // Proses setiap variabel uji
            for (let i = 0; i < testVariables.length; i++) {
                const testVariable = testVariables[i];
                const testData = variablesData[i];

                // Timing untuk grouping
                const groupingStart = performance.now();

                // Kelompokkan data berdasarkan faktor
                const groupedData = groupDataByFactor(testData, factorData, testVariable, factorVariable);

                const groupingEnd = performance.now();
                const groupingTime = groupingEnd - groupingStart;

                // Perkirakan memori data yang telah dikelompokkan
                const groupedMemory = estimateMemoryUsage(groupedData);

                // Ukur waktu perhitungan
                const calcStart = performance.now();

                // Hitung Uji Bartlett
                const bartlettResult = calculateBartlettTest(groupedData);

                const calcEnd = performance.now();
                const calcTime = calcEnd - calcStart;

                // Format hasil
                const result = {
                    variable: testVariable,
                    factorVariable: factorVariable,
                    ...bartlettResult
                };

                results.push(result);

                // ============================================================
                // PRINT DETAILED LOG untuk setiap variabel
                // ============================================================
                const timing = {
                    grouping: groupingTime,
                    calculation: calcTime,
                    total: groupingTime + calcTime
                };

                const memoryEstimate = {
                    input: estimateMemoryUsage(testData),
                    grouped: groupedMemory,
                    total: estimateMemoryUsage(testData) + groupedMemory
                };

                printDetailedLog(testVariable, factorVariable, groupedData, bartlettResult, timing, memoryEstimate);
            }

            // ============================================================
            // TOTAL TIMING
            // ============================================================
            const totalEndTime = performance.now();
            const totalTime = totalEndTime - totalStartTime;

            console.log('\n========================================');
            console.log('  BARTLETT TEST WORKER - COMPLETED');
            console.log('========================================');
            console.log(`  Total Variables Processed: ${testVariables.length}`);
            console.log(`  Total Execution Time: ${formatNumber(totalTime, 3)} ms`);
            console.log('========================================\n');

            self.postMessage({
                type: 'BARTLETT_RESULT',
                data: results
            });

        } else {
            self.postMessage({
                type: 'ERROR',
                error: `Unknown message type: ${type}`
            });
        }
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            error: error.message,
            stack: error.stack
        });
    }
};
