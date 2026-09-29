/**
 * ============================================================================
 * MESIN UJI NORMALITAS
 * ============================================================================
 *
 * Uji normalitas umum dengan bentuk keluaran yang kompatibel dengan SPSS.
 *
 * Uji residual regresi berada pada Regression/Assumption Test/normality.js.
 *
 * Implementasi ini mengikuti Royston (1995) dengan:
 * - SPSS-compatible KS p-values (Dallal-Wilkinson + Lilliefors)
 * - Enhanced numerical stability
 * - Penanganan kasus tepi secara menyeluruh
 *
 * TUJUAN:
 * Menguji apakah data mengikuti distribusi normal menggunakan dua metode:
 * 1. Kolmogorov-Smirnov (KS) dengan koreksi Lilliefors
 * 2. Shapiro-Wilk (SW) dengan aproksimasi Royston
 *
 * KONSEP DASAR:
 * Uji normalitas memeriksa apakah sebaran data sesuai dengan distribusi normal
 * (kurva lonceng / bell curve). Uji ini penting sebagai prasyarat untuk:
 * - ANOVA (asumsi normalitas residual)
 * - T-Test (asumsi normalitas kelompok)
 * - Regresi Linear (asumsi normalitas residual)
 * - Bartlett Test (sensitif terhadap non-normalitas)
 *
 * HIPOTESIS:
 * H₀: Data berdistribusi normal
 * H₁: Data TIDAK berdistribusi normal
 *
 * KAPAN DIGUNAKAN:
 * - Sebelum ANOVA: cek asumsi normalitas per kelompok
 * - Sebelum Bartlett Test: karena Bartlett sensitif terhadap non-normalitas
 * - Dalam Regresi: cek normalitas residual
 * - Explore/Descriptive: sebagai bagian dari "Normality Plots with Tests"
 *
 * METODE YANG TERSEDIA:
 *
 * 1. KOLMOGOROV-SMIRNOV (KS) dengan Koreksi Lilliefors:
 *    - Membandingkan CDF empiris data dengan CDF normal teoritis
 *    - Parameter normal (mean, sd) diestimasi dari data sendiri
 *    - Koreksi Lilliefors diperlukan karena parameter diestimasi (bukan diketahui)
 *    - Cocok untuk semua ukuran sampel (n ≥ 3)
 *
 *    RUMUS KS:
 *    a. Urutkan data: x₁ ≤ x₂ ≤ ... ≤ xₙ
 *    b. Hitung CDF empiris: Fₙ(xᵢ) = i/n
 *    c. Hitung CDF normal teoritis: F₀(xᵢ) = Φ((xᵢ - x̄) / s)
 *    d. D⁺ = max|Fₙ(xᵢ) - F₀(xᵢ)|        (deviasi sisi atas)
 *    e. D⁻ = max|F₀(xᵢ) - Fₙ(xᵢ₋₁)|      (deviasi sisi bawah)
 *    f. D = max(D⁺, D⁻)                     (statistik uji dua sisi)
 *
 * 2. SHAPIRO-WILK (SW):
 *    - Menghitung korelasi antara data terurut dan quantile normal teoritis
 *    - Lebih powerful untuk ukuran sampel kecil (n ≤ 50)
 *    - Batas atas: n ≤ 5000 (mengikuti konvensi SPSS)
 *    - Menggunakan aproksimasi Royston (1995) untuk p-value
 *
 *    RUMUS SW:
 *    a. Urutkan data: x₁ ≤ x₂ ≤ ... ≤ xₙ
 *    b. Hitung expected normal order statistics: mᵢ = Φ⁻¹((i - 0.375)/(n + 0.25))
 *    c. Hitung bobot koefisien aᵢ dari polinomial Royston
 *    d. W = [Σ aᵢ × x(ᵢ)]² / Σ(xᵢ - x̄)²  (atau ekuivalen: r² antara x dan m)
 *    e. W mendekati 1 → data normal; W jauh dari 1 → data tidak normal
 *
 * INTERPRETASI:
 * - p-value < 0.05: Tolak H₀ → Data TIDAK normal
 * - p-value ≥ 0.05: Gagal tolak H₀ → Data dianggap normal
 *
 * ASUMSI DAN KETERBATASAN:
 * - KS: Kurang sensitif di ekor distribusi; cocok untuk n besar
 * - SW: Lebih powerful untuk n kecil, tapi terbatas sampai n = 5000
 * - Kedua uji sensitif terhadap ukuran sampel besar (mudah menolak H₀)
 *
 * REFERENSI:
 * 1. Lilliefors, H. W. (1967). "On the Kolmogorov-Smirnov test for normality
 *    with mean and variance unknown". JASA, 62(318): 399-402.
 * 2. Shapiro, S. S., & Wilk, M. B. (1965). "An analysis of variance test for
 *    normality (complete samples)". Biometrika, 52(3/4): 591-611.
 * 3. Royston, P. (1995). "Remark AS R94: A remark on Algorithm AS 181".
 *    Applied Statistics, 44(4): 547-551.
 * 4. Royston, P. (1993). "A toolkit for testing for non-normality in complete
 *    and censored samples". The Statistician, 42: 37-43.
 * ============================================================================
 */

// =============================================================================
// FUNGSI HELPER STATISTIK DASAR
// =============================================================================

/**
 * Membersihkan array data dari nilai yang tidak valid.
 *
 * Memfilter NaN, null, undefined, Infinity, -Infinity, dan tipe bukan angka
 * agar tidak mengganggu perhitungan statistik uji normalitas.
 * Pola ini konsisten dengan validasi data di Bartlett Test.
 *
 * Algoritma:
 * 1. Iterasi setiap elemen dalam larik masukan
 * 2. Konversi ke Number dan cek apakah finite
 * 3. Kumpulkan statistik jumlah nilai invalid per tipe
 * 4. Log breakdown ke console jika ada nilai yang dibuang
 *
 * @param {any[]} values - Array data mentah (bisa berisi campuran tipe)
 * @returns {number[]} Array hanya berisi angka finite yang valid
 *
 * @example
 * // Filter campuran tipe data
 * cleanNumericData([5, null, 'a', 7, NaN, 3]);
 * // => [5, 7, 3]
 *
 * @example
 * // Semua masukan tidak valid → larik kosong
 * cleanNumericData([NaN, null, undefined, Infinity]);
 * // => []
 *
 * @example
 * // Masukan bukan larik → larik kosong
 * cleanNumericData("hello");
 * // => []
 */
function cleanNumericData(values) {
    if (!Array.isArray(values)) return [];
    const cleaned = [];

    // Catat jumlah setiap jenis nilai tidak valid
    let nullCount = 0;
    let undefinedCount = 0;
    let nanCount = 0;
    let infinityCount = 0;
    let negInfinityCount = 0;

    for (let i = 0; i < values.length; i++) {
        const v = values[i];

        // Periksa nilai null
        if (v === null) {
            nullCount++;
            continue;
        }

        // Periksa nilai undefined
        if (v === undefined) {
            undefinedCount++;
            continue;
        }

        // Konversi menjadi angka dan periksa validitasnya
        const num = Number(v);

        // Periksa NaN, termasuk string nonnumerik, objek, dan sebagainya
        if (isNaN(num)) {
            nanCount++;
            continue;
        }

        // Periksa Infinity
        if (num === Infinity) {
            infinityCount++;
            continue;
        }

        // Periksa -Infinity
        if (num === -Infinity) {
            negInfinityCount++;
            continue;
        }

        // Masukkan hanya bilangan berhingga yang sudah lolos pemeriksaan.
        cleaned.push(num);
    }

    // Catat ringkasan nilai yang dibuang untuk membantu penelusuran data.
    const totalSkipped = nullCount + undefinedCount + nanCount + infinityCount + negInfinityCount;
    if (totalSkipped > 0) {
        const parts = [];
        if (nanCount > 0) parts.push(`${nanCount} NaN`);
        if (nullCount > 0) parts.push(`${nullCount} null`);
        if (undefinedCount > 0) parts.push(`${undefinedCount} undefined`);
        if (infinityCount > 0) parts.push(`${infinityCount} Infinity`);
        if (negInfinityCount > 0) parts.push(`${negInfinityCount} -Infinity`);

        const breakdown = parts.join(', ');
        console.log(`[DEBUG] Normality - cleanNumericData: ${totalSkipped} nilai tidak valid dibuang dari ${values.length} total (${breakdown})`);
    }

    return cleaned;
}

/**
 * Menghitung rata-rata aritmetika (mean).
 *
 * Rumus: x̄ = Σxᵢ / n
 *
 * Digunakan sebagai langkah awal dalam perhitungan S² (sum of squares)
 * pada Shapiro-Wilk dan juga untuk standardisasi z-score pada KS test.
 *
 * @param {number[]} values - Array berisi nilai-nilai numerik (harus sudah bersih/valid)
 * @returns {number} Rata-rata aritmetika
 *
 * @example
 * normalityMean([9, 10, 11, 12, 13]);
 * // => 11
 *
 * @example
 * normalityMean([2, 4, 6]);
 * // => 4
 */
function normalityMean(values) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
    }
    return sum / values.length;
}

/**
 * Menghitung simpangan baku sampel (standard deviation).
 *
 * Rumus: s = √[ Σ(xᵢ - x̄)² / (n-1) ]
 * Menggunakan pembagi (n-1) untuk estimator tidak bias (Bessel's correction).
 *
 * Digunakan dalam Kolmogorov-Smirnov test untuk standardisasi z-score:
 * z = (xᵢ - x̄) / s, sehingga bisa membandingkan dengan Φ(z).
 *
 * @param {number[]} values - Array berisi nilai-nilai numerik (harus sudah bersih/valid)
 * @param {number} [valuesMean] - Mean yang sudah dihitung sebelumnya (opsional, hemat komputasi)
 * @returns {number} Simpangan baku sampel
 *
 * @example
 * normalityStandardDeviation([9, 10, 11, 12, 13]);
 * // => 1.5811388300841898 (≈ √2.5)
 *
 * @example
 * // Dengan mean yang sudah dihitung sebelumnya
 * normalityStandardDeviation([9, 10, 11, 12, 13], 11);
 * // => 1.5811388300841898
 */
function normalityStandardDeviation(values, valuesMean = undefined) {
    const m = valuesMean !== undefined ? valuesMean : normalityMean(values);
    const divisor = values.length > 1 ? values.length - 1 : values.length;
    let sumSqDev = 0;
    for (let i = 0; i < values.length; i++) {
        const diff = values[i] - m;
        sumSqDev += diff * diff;
    }
    const variance = sumSqDev / divisor;
    return Math.sqrt(variance);
}

/**
 * Menghitung koefisien korelasi Pearson antara dua array.
 *
 * Rumus: r = Σ(xᵢ - x̄)(yᵢ - ȳ) / √[Σ(xᵢ - x̄)² × Σ(yᵢ - ȳ)²]
 *
 * Nilai r ∈ [-1, 1]:
 *   r = +1 → korelasi positif sempurna
 *   r =  0 → tidak berkorelasi
 *   r = -1 → korelasi negatif sempurna
 *
 * Catatan: Fungsi ini tersedia sebagai utilitas internal tetapi
 * tidak digunakan langsung dalam rumus W (W menggunakan rumus
 * (Σaᵢxᵢ)²/S² yang lebih efisien dan numerik stabil).
 *
 * @param {number[]} x - Array data pertama
 * @param {number[]} y - Array data kedua (panjang harus sama dengan x)
 * @returns {number} Koefisien korelasi Pearson (-1 sampai 1), atau 0 jika salah satu konstan
 *
 * @example
 * normalityPearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
 * // => 1.0 (korelasi positif sempurna)
 *
 * @example
 * normalityPearsonCorrelation([1, 2, 3], [3, 2, 1]);
 * // => -1.0 (korelasi negatif sempurna)
 */
function normalityPearsonCorrelation(x, y) {
    const n = x.length;
    const xm = normalityMean(x);
    const ym = normalityMean(y);

    let numerator = 0;
    let xDenom = 0;
    let yDenom = 0;

    for (let i = 0; i < n; i++) {
        const xd = x[i] - xm;
        const yd = y[i] - ym;
        numerator += xd * yd;
        xDenom += xd * xd;
        yDenom += yd * yd;
    }

    const denom = Math.sqrt(xDenom * yDenom);
    if (!isFinite(denom) || denom === 0) return 0;
    return numerator / denom;
}

/**
 * Aproksimasi CDF Normal Standar Φ(x).
 *
 * Menghitung probabilitas kumulatif P(Z ≤ x) untuk distribusi normal standar.
 * Menggunakan pendekatan polinomial Abramowitz & Stegun (1964), Rumus 26.2.17.
 * Akurasi: |error| < 7.5 × 10⁻⁸.
 *
 * Digunakan dalam:
 * - Kolmogorov-Smirnov: menghitung F₀(xᵢ) = Φ((xᵢ - x̄)/s)
 * - Shapiro-Wilk p-value: mentransformasi z-score ke probabilitas
 *
 * @param {number} x - Nilai z-score
 * @returns {number} Probabilitas kumulatif P(Z ≤ x), nilai dalam [0, 1]
 *
 * @example
 * normalityCDF(0);
 * // => 0.5 (titik tengah distribusi)
 *
 * @example
 * normalityCDF(1.96);
 * // => ~0.975 (batas kritis α=5% satu sisi)
 *
 * @example
 * normalityCDF(-1.96);
 * // => ~0.025
 *
 * @see {@link https://en.wikipedia.org/wiki/Normal_distribution#Numerical_approximations_for_the_normal_CDF}
 * @see Abramowitz, M. & Stegun, I. A. (1964). Handbook of Mathematical Functions, Formula 26.2.17.
 */
function normalityCDF(x) {
    if (x < -10) return 0;
    if (x > 10) return 1;

    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));

    if (x > 0) {
        p = 1 - p;
    }

    return p;
}

/**
 * Aproksimasi inti inverse CDF normal (quantile function) untuk p mendekati 1.
 *
 * Menghitung estimasi z-score dari probabilitas menggunakan aproksimasi rasional.
 * Rumus: z ≈ y − (c₀ + c₁y + c₂y²) / (1 + d₁y + d₂y² + d₃y³)
 * di mana y = √(−2 ln(p))
 *
 * Fungsi internal yang digunakan oleh normalityQuantile(). Hanya valid untuk
 * p mendekati 0 (karena menggunakan √(-2 ln(p)) yang diverges di p → 0).
 *
 * @param {number} p - Probabilitas mendekati 0 (0 < p < 1), biasanya 1 - target probability
 * @returns {number} Aproksimasi nilai z-score (selalu positif)
 *
 * @example
 * normalityApproxQuantile(0.025);
 * // => ~1.96 (quantile untuk probabilitas 1 - 0.025 = 0.975)
 *
 * @see Abramowitz & Stegun (1964), Formula 26.2.22.
 */
function normalityApproxQuantile(p) {
    const y = Math.sqrt(-2 * Math.log(p));
    return y - (2.515517 + 0.802853 * y + 0.010328 * y * y) /
        (1 + 1.432788 * y + 0.189269 * y * y + 0.001308 * y * y * y);
}

/**
 * Menghitung quantile (inverse CDF) normal standar Φ⁻¹(p) untuk sembarang p ∈ (0, 1).
 *
 * Rumus: z = Φ⁻¹(p), sehingga P(Z ≤ z) = p
 * - Untuk p < 0.5: gunakan simetri → Φ⁻¹(p) = −Φ⁻¹(1−p)
 * - Untuk p ≥ 0.5: gunakan aproksimasi Abramowitz & Stegun
 *
 * Digunakan untuk menghitung Expected Normal Order Statistics (mᵢ) pada
 * uji Shapiro-Wilk via Blom (1958) plotting position:
 *   mᵢ = Φ⁻¹((i − 0.375) / (n + 0.25))
 *
 * @param {number} p - Probabilitas (0 < p < 1)
 * @returns {number} Nilai z-score yang bersesuaian, atau ±Infinity di batas
 *
 * @example
 * normalityQuantile(0.025);
 * // => -1.96 (batas bawah CI 95%)
 *
 * @example
 * normalityQuantile(0.975);
 * // => +1.96 (batas atas CI 95%)
 *
 * @example
 * normalityQuantile(0.5);
 * // => 0.0 (median distribusi normal)
 *
 * @see Blom, G. (1958). Statistical Estimates and Transformed Beta-Variables. Wiley.
 */
function normalityQuantile(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;

    if (p < 0.5) return -normalityApproxQuantile(1 - p);

    const y = Math.sqrt(-2 * Math.log(1 - p));
    return y - (2.515517 + 0.802853 * y + 0.010328 * y * y) /
        (1 + 1.432788 * y + 0.189269 * y * y + 0.001308 * y * y * y);
}

/**
 * Mengaproksimasi p-value untuk statistik D Kolmogorov-Smirnov dengan Koreksi Lilliefors.
 *
 * METODE:
 *   Menggunakan rumus analitik Dallal & Wilkinson (1986) yang diimplementasikan
 *   SPSS untuk koreksi Lilliefors. Rumus ini menggantikan distribusi Kolmogorov
 *   asimtotik (yang hanya valid jika mean & varians diketahui) dengan aproksimasi
 *   yang tepat ketika parameter diestimasi dari sampel.
 *
 * RUMUS (Dallal & Wilkinson, 1986):
 *   p = exp(−7.01256 × D² × (n + 2.78019)
 *            + 2.99587 × D × √(n + 2.78019)
 *            − 0.122119
 *            + 0.974598 / √n
 *            + 1.67997 / n)
 *
 * BATAS P-VALUE:
 *   SPSS melaporkan nilai-p maksimum 0,200 untuk Lilliefors karena rumus
 *   menjadi kurang akurat pada nilai D yang sangat kecil (data sangat normal).
 *   Jika p > 0.200, nilai dilaporkan sebagai ".200*" (lower bound).
 *
 * VALIDITAS:
 *   Rumus berlaku untuk n ≥ 5. Untuk n ≤ 4, nilai-p ditetapkan = 1,0.
 *
 * @param {number} d - Statistik D (selisih CDF empiris dan teoritis maksimum, d > 0)
 * @param {number} n - Ukuran sampel (integer ≥ 1)
 * @returns {{pValue: number, isLowerBound: boolean}} Objek dengan p-value (0−0.200)
 *   dan flag isLowerBound yang menandakan apakah p-value dicap di 0.200
 *
 * @example
 * approximateKSPValue(0.15, 30);
 * // => { pValue: 0.08..., isLowerBound: false }
 *
 * @example
 * // Sangat kecil D → capped di 0.200
 * approximateKSPValue(0.05, 100);
 * // => { pValue: 0.200, isLowerBound: true }
 *
 * @example
 * // n sangat kecil → p-value = 1.0
 * approximateKSPValue(0.3, 4);
 * // => { pValue: 1.0, isLowerBound: false }
 *
 * @see Dallal, G. E. & Wilkinson, L. (1986). "An analytic approximation to the
 *   distribution of Lilliefors's test statistic for normality". The American Statistician, 40(4): 294-296.
 */
function approximateKSPValue(d, n) {
    if (n <= 4) {
        return { pValue: 1.0, isLowerBound: false };
    }

    let p = Math.exp(
        -7.01256 * d * d * (n + 2.78019) +
        2.99587 * d * Math.sqrt(n + 2.78019) -
        0.122119 +
        0.974598 / Math.sqrt(n) +
        1.67997 / n
    );

    let isLowerBound = false;

    // SPSS membatasi maksimal p-value di 0.200 untuk Lilliefors
    if (p > 0.200) {
        p = 0.200;
        isLowerBound = true;
    }

    return { pValue: p, isLowerBound };
}

// =============================================================================
// UJI KOLMOGOROV-SMIRNOV (KS)
// =============================================================================

/**
 * Menghitung Statistik Uji Kolmogorov-Smirnov 1-Sampel (dengan Koreksi Lilliefors).
 *
 * Membandingkan distribusi kumulatif empiris (ECDF) data dengan distribusi normal
 * teoritis. Karena mean dan SD diestimasi dari data sendiri, koreksi Lilliefors
 * diterapkan pada nilai-p menggunakan rumus Dallal-Wilkinson (1986).
 *
 * Algoritma:
 *   1. Bersihkan data (filter NaN, null, Infinity, dll.)
 *   2. Urutkan data ascending: x₁ ≤ x₂ ≤ ... ≤ xₙ
 *   3. Hitung mean (x̄) dan simpangan baku (s)
 *   4. Untuk setiap xᵢ, hitung D⁺ dan D⁻ (deviasi CDF empiris vs teoritis)
 *   5. D = max(D⁺, D⁻) sebagai statistik uji dua sisi
 *   6. P-value via Dallal-Wilkinson (1986), dicap maksimum 0.200
 *
 * @param {number[]} values - Array berisi nilai-nilai numerik (bisa mengandung invalid values)
 * @returns {{statistic: number, df: number, pValue: number, isLowerBound: boolean}|null}
 *   Objek hasil uji KS, atau null jika data tidak valid (n < 3 atau SD = 0)
 *
 * @example
 * calculateKolmogorovSmirnov([9, 10, 11, 12, 13]);
 * // => { statistic: 0.136..., df: 5, pValue: 0.200, isLowerBound: true }
 *
 * @example
 * // Data tidak cukup
 * calculateKolmogorovSmirnov([1, 2]);
 * // => null
 *
 * @example
 * // Data non-normal (exponential-like)
 * calculateKolmogorovSmirnov([1, 1, 2, 3, 5, 8, 13, 21, 34, 55]);
 * // => { statistic: 0.27..., df: 10, pValue: 0.03..., isLowerBound: false }
 *
 * @see Lilliefors, H. W. (1967). "On the Kolmogorov-Smirnov test for normality
 *   with mean and variance unknown". JASA, 62(318): 399-402.
 */
function calculateKolmogorovSmirnov(values) {
    // LANGKAH 1: Validasi dan bersihkan data
    const cleaned = cleanNumericData(values);
    const n = cleaned.length;
    if (n < 3) {
        console.log('[DEBUG] KS - Data tidak cukup:', n, '(minimal 3)');
        return null;
    }

    console.log('[DEBUG] KS - Memulai perhitungan dengan n =', n);

    // LANGKAH 2: Urutkan data dari kecil ke besar
    const sorted = [...cleaned].sort((a, b) => a - b);

    const m = normalityMean(sorted);
    const sd = normalityStandardDeviation(sorted, m);

    console.log('[DEBUG] KS - Mean:', m, 'SD:', sd);

    if (!isFinite(sd) || sd === 0) {
        console.log('[DEBUG] KS - SD tidak valid (0 atau Infinity), uji dibatalkan');
        return null;
    }

    // ========================================================================
    // LANGKAH 4 & 5: Hitung statistik D (dua sisi)
    // ========================================================================
    // D+ = max|Fn(xi) - F0(xi)|      -> deviasi sisi atas
    // D- = max|F0(xi) - Fn(xi-1)|    -> deviasi sisi bawah
    // D  = max(D+, D-)               -> statistik uji final

    let dPlus = 0;
    let dMinus = 0;

    for (let i = 0; i < n; i++) {
        const Fn = (i + 1) / n;           // CDF empiris di titik xi
        const FnPrev = i / n;             // CDF empiris sebelum xi
        const zScore = (sorted[i] - m) / sd;
        const F0 = normalityCDF(zScore);   // CDF normal teoritis

        const dp = Math.abs(Fn - F0);
        const dm = Math.abs(F0 - FnPrev);

        if (dp > dPlus) dPlus = dp;
        if (dm > dMinus) dMinus = dm;
    }

    const D = Math.max(dPlus, dMinus);

    console.log('[DEBUG] KS - D+:', dPlus, 'D-:', dMinus, 'D (final):', D);

    // LANGKAH 6: Hitung p-value (koreksi Lilliefors via Dallal-Wilkinson 1986)
    const { pValue, isLowerBound } = approximateKSPValue(D, n);

    console.log('[DEBUG] KS - Statistik D:', D, 'df:', n, 'p-value:', pValue, isLowerBound ? '(Lower Bound)' : '');

    return {
        statistic: D,
        df: n,
        pValue: pValue,
        isLowerBound: isLowerBound
    };
}

// =============================================================================
// UJI SHAPIRO-WILK (SW)
// =============================================================================

/**
 * Mengaproksimasi p-value untuk statistik W Shapiro-Wilk.
 *
 * W tidak berdistribusi normal, sehingga transformasi logaritmik diperlukan
 * untuk mengubahnya ke z-score normal standar. Metode berbeda digunakan
 * berdasarkan ukuran sampel:
 *
 * KASUS BERDASARKAN UKURAN SAMPEL:
 *   n = 3    : Rumus eksak berbasis arcsin (analitik)
 *              p = 1 - exp(-(6/π) × arcsin(√W))
 *
 *   4 ≤ n ≤ 11 : Royston (1993) - koefisien polinomial kubik dalam n
 *              Transform: y₂ = -ln(γ - ln(1-W))
 *              μ dan σ adalah fungsi kubik dari n
 *
 *   n > 11   : Royston (1995) - koefisien polinomial dalam ln(n)
 *              Transform: y = ln(1-W)
 *              μ dan σ adalah fungsi polinomial dari ln(n)
 *
 * @param {number} W - Statistik W Shapiro-Wilk (0 < W ≤ 1)
 * @param {number} n - Ukuran sampel (n ≥ 3)
 * @returns {number} Aproksimasi p-value dalam rentang [0, 1]
 *
 * @example
 * // n=3 menggunakan rumus eksak
 * shapiroWilkPValue(0.75, 3);
 * // => ~0.0 (W rendah → strong non-normality)
 *
 * @example
 * // n=30 menggunakan pendekatan sampel besar
 * shapiroWilkPValue(0.98, 30);
 * // => ~0.8 (W tinggi → data likely normal)
 *
 * @example
 * // n=10 menggunakan pendekatan sampel kecil
 * shapiroWilkPValue(0.95, 10);
 * // => ~0.67 (moderate normality)
 *
 * @see Royston, P. (1993). "A toolkit for testing for non-normality in complete
 *   and censored samples". The Statistician, 42: 37-43.
 * @see Royston, P. (1995). "Remark AS R94: A remark on Algorithm AS 181".
 *   Applied Statistics, 44(4): 547-551.
 */
function shapiroWilkPValue(W, n) {
    const y = Math.log(1 - W);
    let mu;
    let sigma;
    let formulaUsed;

    // ========================================================================
    // Kasus n=3 menggunakan rumus eksak untuk distribusi W.
    // ========================================================================
    if (n === 3) {
        formulaUsed = 'n=3 (exact formula)';
        console.log(`[SW-DEBUG] P-value formula: ${formulaUsed}`);
        const pValue = 1 - Math.exp(-6.0 / Math.PI * Math.asin(Math.sqrt(W)));
        console.log(`[SW-DEBUG] P-value result: ${pValue}`);
        return pValue;
    }

    // ========================================================================
    //
    //   approximation in n to obtain μ and σ parameters.
    //   2. Transform: y₂ = −ln(g − y)
    //   4. Standardize: z = (y₂ − μ) / σ
    //   5. p-value = 1 − Φ(z)
    // ========================================================================
    if (n <= 11) {
        formulaUsed = 'n≤11 (Royston 1993 cubic polynomial)';
        console.log(`[SW-DEBUG] P-value formula: ${formulaUsed}`);
        // g(n) adalah batas polinomial; y > g berarti nilai W terlalu ekstrem.
        const g = -0.0006714 * n ** 3 + 0.025054 * n ** 2 - 0.39978 * n + 0.5440;
        if (y > g) {
            console.log(`[SW-DEBUG] y (${y}) > g (${g}), returning minimum p-value 1e-19`);
            return 1e-19;
        }
        const y2 = -Math.log(g - y);
        mu = -0.0020322 * n ** 3 + 0.062767 * n ** 2 - 0.77857 * n + 1.3822;
        sigma = Math.exp(-0.00020322 * n ** 3 + 0.0062767 * n ** 2 - 0.067861 * n + 0.459);
        console.log(`[SW-DEBUG] Transform: y=${y}, g=${g}, y2=${y2}`);
        console.log(`[SW-DEBUG] Distribution params: μ=${mu}, σ=${sigma}`);
        const pValue = 1 - normalityCDF((y2 - mu) / sigma);
        console.log(`[SW-DEBUG] P-value result: ${pValue}`);
        return pValue;
    }

    // ========================================================================
    //   AS 181". Applied Statistics, 44(4): 547-551, Table 2.
    //
    //   3. Standardize: z = (y − μ) / σ
    //   4. p-value = 1 − Φ(z)
    //
    // ========================================================================
    formulaUsed = 'n>11 (Royston 1995 ln-based polynomial)';
    console.log(`[SW-DEBUG] P-value formula: ${formulaUsed}`);
    const lnN = Math.log(n);
    mu = -1.5861 - 0.31082 * lnN - 0.083751 * lnN ** 2 + 0.0038915 * lnN ** 3;
    sigma = Math.exp(-0.4803 - 0.082676 * lnN + 0.0030302 * lnN ** 2);
    console.log(`[SW-DEBUG] Transform: y=${y}, ln(n)=${lnN}`);
    console.log(`[SW-DEBUG] Distribution params: μ=${mu}, σ=${sigma}`);
    const pValue = 1 - normalityCDF((y - mu) / sigma);
    console.log(`[SW-DEBUG] P-value result: ${pValue}`);
    return pValue;
}

/**
 * Menghitung Statistik Uji Shapiro-Wilk (W).
 *
 * Mengukur kemiripan antara data terurut dan distribusi normal teoritis
 * menggunakan rasio kuadrat bobot linier berbasis koefisien Royston.
 *
 * RUMUS UTAMA:
 *   W = (Σ aᵢ × x(ᵢ))² / S²
 *   di mana:
 *   - x(ᵢ)  = data terurut ke-i (ascending)
 *   - aᵢ    = koefisien bobot Royston (antisimetrik: Σaᵢ = 0)
 *   - S²    = Σ(xᵢ − x̄)² (total sum of squares)
 *   - W ∈ (0, 1]: mendekati 1 → normal, mendekati 0 → tidak normal
 *
 * ALGORITMA (Royston AS R94):
 *   1. Bersihkan data dan validasi ukuran sampel (3 ≤ n ≤ 5000)
 *   2. Urutkan data ascending
 *   3. Hitung expected normal order stats mᵢ via Blom (1958) plotting position
 *   4. Hitung endpoint coefficients aₙ, aₙ₋₁ via Royston polynomials p1, p2
 *   5. Hitung normalization factor φ dan middle coefficients
 *   6. Hitung W = (Σaᵢxᵢ)² / S², lalu batasi ke rentang [0, 1]
 *   7. Hitung nilai-p dengan pendekatan Royston sesuai ukuran sampel
 *
 * NUMERICAL STABILITY:
 *   - W is clamped to max 1.0 to prevent floating-point overshoot
 *   - φ menggunakan Math.abs() untuk mencegah NaN akibat akar bilangan negatif
 *   - S² = 0 pada data konstan akan langsung mengembalikan null
 *   - Global try-catch prevents uncaught exceptions
 *
 * @param {number[]} values - Array berisi nilai-nilai numerik mentah (will be cleaned internally)
 * @returns {{statistic: number, df: number, pValue: number}|null}
 *   Objek hasil { statistic: W, df: n, pValue } atau null jika data tidak valid
 *   (n < 3, n > 5000, semua data identik, atau error tak terduga)
 *
 * @example
 * // Data normal → W mendekati 1, p-value tinggi
 * calculateShapiroWilk([9, 10, 11, 12, 13]);
 * // => { statistic: 0.9867..., df: 5, pValue: 0.96... }
 *
 * @example
 * // Data tidak normal → W rendah, p-value rendah
 * calculateShapiroWilk([1, 1, 1, 10, 100]);
 * // => { statistic: 0.65..., df: 5, pValue: 0.002... }
 *
 * @example
 * // Data konstan → null (S² = 0)
 * calculateShapiroWilk([5, 5, 5, 5, 5]);
 * // => null
 *
 * @example
 * // Data dengan invalid values → dibersihkan dulu
 * calculateShapiroWilk([1, 2, NaN, 3, null, 4, 5]);
 * // => { statistic: 0.986..., df: 5, pValue: 0.96... }
 *
 * @see Shapiro, S. S. & Wilk, M. B. (1965). "An analysis of variance test for
 *   normality (complete samples)". Biometrika, 52(3/4): 591-611.
 * @see Royston, P. (1995). "Remark AS R94: A remark on Algorithm AS 181".
 *   Applied Statistics, 44(4): 547-551.
 * @see Blom, G. (1958). Statistical Estimates and Transformed Beta-Variables. Wiley.
 */
function calculateShapiroWilk(values) {
    console.log('[SW] ============================================================');
    console.log('[SW] Starting Shapiro-Wilk calculation');
    console.log('[SW] ============================================================');

    try {
        // LANGKAH 1: Validasi dan bersihkan data
        const cleaned = cleanNumericData(values);
        const n = cleaned.length;

        // LANGKAH 1a: Periksa batas ukuran sampel (persyaratan 3.1 dan 3.2)
        if (n < 3) {
            console.log(`[SW] Sample size n=${n} is below minimum. Shapiro-Wilk requires at least 3 observations.`);
            return null;
        }

        if (n > 5000) {
            console.log(`[SW] Sample size n=${n} exceeds maximum. Shapiro-Wilk is only valid for n ≤ 5000 (SPSS convention).`);
            return null;
        }

        console.log(`[SW] Input: n = ${n} observations`);

    // LANGKAH 2: Urutkan data dari kecil ke besar
    const x = [...cleaned].sort((a, b) => a - b);

    // ========================================================================
    // LANGKAH 3: Hitung statistik urutan normal harapan (mᵢ) menggunakan Blom (1958)
    // ========================================================================
    //   Beta-Variables". John Wiley & Sons, New York.
    //
    // Rumus posisi plot Blom:
    //   pᵢ = (i − 0.375) / (n + 0.25)
    //   mᵢ = Φ⁻¹(pᵢ)
    //
    // Konstanta 0,375 dan 0,25 memberikan pendekatan tak bias untuk statistik
    // urutan normal harapan. Rumus yang sama digunakan oleh SPSS dan algoritma
    // AS R94 Royston untuk menghitung bobot Shapiro-Wilk.
    const m = new Array(n).fill(0).map((_, i) => normalityQuantile((i + 1 - 0.375) / (n + 0.25)));
    const mSumSq = m.reduce((s, v) => s + v * v, 0);

    console.log(`[SW-DEBUG] Expected order statistics: Σmᵢ² = ${mSumSq}`);

    // ========================================================================
    // LANGKAH 4: Hitung koefisien bobot aᵢ (Royston AS R94)
    // ========================================================================
    //   AS 181". Applied Statistics, 44(4): 547-551.
    //
    // Koefisien aᵢ bersifat antisimetris: aᵢ = −a_{n+1−i}, sehingga Σaᵢ = 0.
    // Hanya separuh bagian atas yang dihitung; bagian bawah dicerminkan dengan tanda berlawanan.
    //
    //
    // W selalu berada dalam rentang [0, 1].
    //
    //
    //
    //      invariant to location shifts. Adding a constant C to all data:
    //      Σaᵢ(x(ᵢ) + C) = Σaᵢx(ᵢ) + C·Σaᵢ = Σaᵢx(ᵢ) + 0
    //
    //
    //
    const a = new Array(n).fill(0);
    const u = 1 / Math.sqrt(n);

    console.log('[SW-DEBUG] --------------------------------------------------------');
    console.log('[SW-DEBUG] Coefficient calculation');
    console.log('[SW-DEBUG] --------------------------------------------------------');

    if (n === 3) {
        // ----------------------------------------------------------------
        // Untuk sampel valid terkecil, bobotnya diketahui secara analitis:
        //   a₁ = −√(1/2) ≈ −0.7071, a₂ = 0, a₃ = +√(1/2) ≈ +0.7071
        // ----------------------------------------------------------------
        a[n - 1] = Math.SQRT1_2;  // a_n positif
        a[0] = -Math.SQRT1_2;     // a_1 negatif
        console.log(`[SW-DEBUG] n=3 special case: aₙ = ${a[n-1]}, a₁ = ${a[0]}`);
    } else {
        // ----------------------------------------------------------------
        //   44(4): 547-551, Table 1.
        //
        // Polinomial p1 menghitung aₙ, yaitu bobot terbesar atau paling kanan:
        //   aₙ = p1[0]·u⁴ + p1[1]·u³ + p1[2]·u² + p1[3]·u + p1[4]
        //   where u = 1/√n
        // ----------------------------------------------------------------
        const p1 = [-2.706056, 4.434685, -2.071190, -0.147981, 0.221157];
        // ----------------------------------------------------------------
        //   aₙ₋₁ = p2[0]·u⁴ + p2[1]·u³ + p2[2]·u² + p2[3]·u + p2[4]
        // ----------------------------------------------------------------
        const p2 = [-3.582633, 5.682633, -1.752461, -0.293762, 0.042981];
        //   polyVal([c₄,c₃,c₂,c₁,c₀], u) = c₄u⁴ + c₃u³ + c₂u² + c₁u + c₀
        const polyVal = (coeffs, z) => coeffs.reduce((acc, c) => acc * z + c, 0);

        // a_n: bobot ujung kanan positif
        const aN = polyVal(p1, u);
        a[n - 1] = Math.abs(aN);    // pastikan positif
        a[0] = -Math.abs(aN);       // ujung kiri negatif

        console.log(`[SW-DEBUG] Calculated aₙ (end coefficient) = ${a[n-1]}`);

        if (n >= 6) {
            // a_{n-1}: bobot ke-2 dari ujung kanan, HARUS POSITIF
            // polyVal p2 mengembalikan nilai negatif untuk n>=6 → negate untuk mendapat positif
            const aN1 = polyVal(p2, u);
            a[n - 2] = Math.abs(aN1);   // pastikan positif
            a[1] = -Math.abs(aN1);       // ke-2 dari kiri negatif

            console.log(`[SW-DEBUG] Calculated aₙ₋₁ (second-to-end coefficient) = ${a[n-2]}`);
        }

        // ----------------------------------------------------------------
        //
        // Untuk n minimal 6:
        //   φ = (Σmᵢ² − 2mₙ² − 2mₙ₋₁²) / (1 − 2aₙ² − 2aₙ₋₁²)
        // Untuk n = 4 atau 5:
        //   φ = (Σmᵢ² − 2mₙ²) / (1 − 2aₙ²)
        //
        // ----------------------------------------------------------------
        let phi;
        if (n >= 6) {
            phi = (mSumSq - 2 * m[n - 1] ** 2 - 2 * m[n - 2] ** 2) /
                (1 - 2 * a[n - 1] ** 2 - 2 * a[n - 2] ** 2);
        } else {
            phi = (mSumSq - 2 * m[n - 1] ** 2) /
                (1 - 2 * a[n - 1] ** 2);
        }

        console.log(`[SW-DEBUG] Normalization factor φ = ${phi}`);

        // NUMERICAL STABILITY: Math.abs(φ) prevents NaN from negative square root.
        //
        //
        if (phi < 0) {
            console.warn(`[SW] WARNING: φ = ${phi} < 0 (floating-point rounding in polynomial evaluation), using |φ| for stability`);
        }
        const constDen = Math.sqrt(Math.abs(phi));

        if (n >= 6) {
            for (let i = 2; i <= n - 3; i++) {
                a[i] = m[i] / constDen;
            }
        } else if (n === 5) {
            // Untuk n=5, a[2] adalah elemen tengah sehingga bernilai 0.
            // Karena a[1] tetap 0 untuk n<6, pasangan simetris a[3] juga 0.
            a[2] = 0;  // elemen tengah untuk n ganjil = 0
            a[3] = -a[1];  // a[1] = 0 karena p2 tidak digunakan untuk n < 6
        } else if (n === 4) {
            a[1] = m[1] / constDen;
            a[2] = -a[1];
        }
    }

    // ========================================================================
    // LANGKAH 5: Hitung statistik W = (Σ aᵢ xᵢ)² / S²
    // ========================================================================
    //   W = (Σ aᵢ × x₍ᵢ₎)² / Σ(xᵢ − x̄)²
    //
    // W mengukur korelasi linear antara data terurut x₍ᵢ₎ dan kuantil normal
    // teoretis yang terkandung dalam koefisien aᵢ.
    // W mendekati 1 → data konsisten dengan normalitas
    // W close to 0 → strong departure from normality
    //
    // Catatan: S² merupakan jumlah kuadrat yang belum dinormalisasi (tidak dibagi n−1).
    // Bentuk pembilang² / S² setara dengan kuadrat Pearson
    // correlation between x and a, which always yields W ∈ [0, 1].
    console.log('[SW-DEBUG] --------------------------------------------------------');
    console.log('[SW-DEBUG] Statistic W calculation');
    console.log('[SW-DEBUG] --------------------------------------------------------');

    //
    //
    const meanX = normalityMean(x);
    let numerator = 0;
    let S2 = 0;  // sum of squares = Σ(xᵢ - x̄)²

    for (let i = 0; i < n; i++) {
        numerator += a[i] * x[i];
        const diff = x[i] - meanX;
        S2 += diff * diff;
    }

    if (S2 === 0) {
        console.warn('[SW] WARNING: S² = 0 (all data identical), test aborted');
        return null;
    }

    // NUMERICAL STABILITY: W clamping to [0, 1] range.
    //
    //
    // (e.g., W = 1.0000000000000002) due to:
    //
    // data is perfectly normal).
    const W = Math.min(1, (numerator * numerator) / S2);

    console.log(`[SW-DEBUG] n = ${n}`);
    console.log(`[SW-DEBUG] Σmᵢ² = ${mSumSq}`);
    console.log(`[SW-DEBUG] numerator (Σaᵢxᵢ) = ${numerator}`);
    console.log(`[SW-DEBUG] S² (Σ(xᵢ-x̄)²) = ${S2}`);
    console.log(`[SW-DEBUG] W = (numerator)² / S² = ${numerator * numerator} / ${S2} = ${W}`);

    // LANGKAH 6: Hitung nilai-p menggunakan pendekatan Royston
    // Perhitungan nilai-p dibagi menjadi tiga kasus:
    //   n = 3: rumus eksak (Shapiro & Wilk, 1965)
    //   4 ≤ n ≤ 11: pendekatan polinomial kubik sampel kecil Royston (1993)
    //   n > 11: pendekatan polinomial berbasis ln(n) untuk sampel besar Royston (1995)
    console.log('[SW-DEBUG] --------------------------------------------------------');
    console.log('[SW-DEBUG] P-value calculation');
    console.log('[SW-DEBUG] --------------------------------------------------------');

    const pValue = shapiroWilkPValue(W, n);

        console.log(`[SW] Result: W = ${W}, p-value = ${pValue}`);
        console.log('[SW] ============================================================');

        return {
            statistic: W,
            df: n,
            pValue: Math.max(Math.min(pValue, 1), 0),
        };
    } catch (error) {
        console.error('[SW] ERROR: Unexpected exception during Shapiro-Wilk calculation');
        console.error('[SW] Error details:', error.message);
        console.error('[SW] Stack trace:', error.stack);
        console.log('[SW] Returning null due to exception');
        console.log('[SW] ============================================================');

        // Kembalikan null agar program tidak berhenti akibat galat
        return null;
    }
}

// =============================================================================
// UTILITAS HASIL UJI
// =============================================================================

/**
 * Membentuk satu entri hasil uji normalitas yang konsisten.
 *
 * Menghasilkan objek terstruktur yang mudah dirender di UI (tabel output).
 * Field `conclusion` dibuat eksplisit agar formatter bisa langsung memakainya.
 *
 * Conclusion values:
 * - 'reject-normality'       : p < α → Tolak H₀, data TIDAK normal
 * - 'fail-to-reject-normality': p ≥ α → Gagal tolak H₀, data dianggap normal
 * - 'not-computed'           : Uji tidak dapat dihitung
 *
 * @param {Object} params - Parameter entri
 * @param {string} params.key - Kunci unik uji ('kolmogorovSmirnov' atau 'shapiroWilk')
 * @param {string} params.label - Label tampilan ('Kolmogorov-Smirnov' atau 'Shapiro-Wilk')
 * @param {boolean} params.available - Apakah uji berhasil dihitung
 * @param {{statistic: number, df: number, pValue: number}|null} params.result - Hasil uji
 * @param {number} params.alpha - Level signifikansi (default 0.05)
 * @param {string} [params.unavailableReason] - Alasan jika uji tidak tersedia
 * @returns {Object} Entri hasil uji yang terstruktur dengan fields:
 *   key, label, available, statistic, df, pValue, isLowerBound, alpha,
 *   isSignificant, conclusion, unavailableReason
 *
 * @example
 * createNormalityTestEntry({
 *   key: 'shapiroWilk',
 *   label: 'Shapiro-Wilk',
 *   available: true,
 *   result: { statistic: 0.98, df: 30, pValue: 0.85 },
 *   alpha: 0.05,
 * });
 * // => { key: 'shapiroWilk', label: 'Shapiro-Wilk', available: true,
 * //      statistic: 0.98, df: 30, pValue: 0.85, isLowerBound: false,
 * //      alpha: 0.05, isSignificant: false, conclusion: 'fail-to-reject-normality' }
 */
function createNormalityTestEntry({
    key,
    label,
    available,
    result,
    alpha,
    unavailableReason,
}) {
    const isValidResult = !!result && Number.isFinite(result.statistic) && Number.isFinite(result.pValue);
    const isSignificant = isValidResult ? result.pValue < alpha : null;

    return {
        key,
        label,
        available,
        statistic: isValidResult ? result.statistic : null,
        df: isValidResult ? result.df : null,
        pValue: isValidResult ? result.pValue : null,
        isLowerBound: isValidResult ? (result.isLowerBound || false) : false,
        alpha,
        isSignificant,
        conclusion: isValidResult
            ? (isSignificant ? 'reject-normality' : 'fail-to-reject-normality')
            : 'not-computed',
        unavailableReason: available ? undefined : unavailableReason,
    };
}

// =============================================================================
// RUNNER UTAMA (ORCHESTRATOR)
// =============================================================================

/**
 * Runner utama uji normalitas (orchestrator).
 *
 * Menjalankan kedua uji normalitas (Kolmogorov-Smirnov dan Shapiro-Wilk) dan
 * menghasilkan hasil terstruktur yang siap diformat ke tabel UI.
 * Konsep mirip dengan Bartlett runner di bartlettTestWorker.js.
 *
 * Alur Eksekusi:
 *   1. Validasi input dan ukuran sampel
 *   2. Jalankan Kolmogorov-Smirnov (selalu, jika n ≥ 3)
 *   3. Jalankan Shapiro-Wilk (hanya jika n ≤ 5000)
 *   4. Cetak log terperinci ke konsol dalam format tabel ASCII
 *   5. Kembalikan hasil terstruktur + backward compatibility keys
 *
 * @param {number[]} values - Array data numerik yang akan diuji
 * @param {Object} [options] - Opsi analisis
 * @param {number} [options.alpha=0.05] - Level signifikansi (harus dalam (0, 1))
 * @returns {Object} Hasil lengkap uji normalitas dengan struktur:
 *   - success {boolean}: Apakah minimal satu uji berhasil
 *   - sampleSize {number}: Jumlah observasi
 *   - alpha {number}: Level signifikansi yang digunakan
 *   - tests {Array}: Array entri hasil per uji (KS dan SW)
 *   - notes {string[]|undefined}: Catatan/warning jika ada
 *   - kolmogorovSmirnov {Object|null}: Backward compat - raw KS result
 *   - shapiroWilk {Object|null}: Backward compat - raw SW result
 *
 * @example
 * // Data normal
 * const result = runNormalityTests([9, 10, 11, 12, 13, 10, 11, 12, 10, 11]);
 * console.log(result.success);        // true
 * console.log(result.tests[1].label); // 'Shapiro-Wilk'
 * console.log(result.tests[1].conclusion); // 'fail-to-reject-normality'
 *
 * @example
 * // Data terlalu besar untuk SW
 * const bigData = Array.from({length: 6000}, (_, i) => i);
 * const result = runNormalityTests(bigData);
 * console.log(result.tests[1].available); // false
 * console.log(result.tests[1].unavailableReason);
 * // 'Shapiro-Wilk hanya dilaporkan untuk ukuran sampel hingga 5000.'
 *
 * @example
 * // Custom alpha
 * runNormalityTests([1, 2, 3, 4, 5], { alpha: 0.01 });
 */
function runNormalityTests(values, options = {}) {
    const alpha = Number.isFinite(options.alpha) && options.alpha > 0 && options.alpha < 1
        ? options.alpha
        : 0.05;

    const sampleSize = Array.isArray(values) ? values.length : 0;

    console.log('[DEBUG] Normality Runner - Memulai uji normalitas, n =', sampleSize, 'alpha =', alpha);

    // Klausa penjaga: jumlah data minimum untuk pengujian normalitas.
    if (!Array.isArray(values) || sampleSize < 3) {
        const reason = 'Normality tests require at least 3 valid observations.';
        console.log('[DEBUG] Normality Runner - Data tidak cukup:', sampleSize);
        return {
            success: false,
            sampleSize,
            alpha,
            notes: [reason],
            tests: [
                createNormalityTestEntry({
                    key: 'kolmogorovSmirnov',
                    label: 'Kolmogorov-Smirnov',
                    available: false,
                    result: null,
                    alpha,
                    unavailableReason: reason,
                }),
                createNormalityTestEntry({
                    key: 'shapiroWilk',
                    label: 'Shapiro-Wilk',
                    available: false,
                    result: null,
                    alpha,
                    unavailableReason: reason,
                }),
            ],
            kolmogorovSmirnov: null,
            shapiroWilk: null,
        };
    }

    const notes = [];
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // Jalankan Kolmogorov-Smirnov
    const ks = calculateKolmogorovSmirnov(values);

    // Jalankan Shapiro-Wilk (dibatasi sampai 5000 observasi)
    let sw = null;
    let swAvailable = true;
    let swUnavailableReason;

    if (sampleSize <= 5000) {
        sw = calculateShapiroWilk(values);
    } else {
        swAvailable = false;
        swUnavailableReason = 'Shapiro-Wilk is only reported for sample sizes up to 5000.';
        notes.push(swUnavailableReason);
    }

    const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // Susun entri hasil per uji
    const tests = [
        createNormalityTestEntry({
            key: 'kolmogorovSmirnov',
            label: 'Kolmogorov-Smirnov',
            available: !!ks,
            result: ks,
            alpha,
            unavailableReason: ks ? undefined : 'Kolmogorov-Smirnov could not be computed for this data.',
        }),
        createNormalityTestEntry({
            key: 'shapiroWilk',
            label: 'Shapiro-Wilk',
            available: swAvailable && !!sw,
            result: sw,
            alpha,
            unavailableReason: swAvailable
                ? (sw ? undefined : 'Shapiro-Wilk could not be computed for this data.')
                : swUnavailableReason,
        }),
    ];

    const hasAnyResult = tests.some((test) => test.available && test.pValue !== null);

    // Cetak log detail ke console (seperti Bartlett printDetailedLog)
    printNormalityLog(sampleSize, alpha, ks, sw, endTime - startTime);

    return {
        success: hasAnyResult,
        sampleSize,
        alpha,
        tests,
        notes: notes.length ? notes : undefined,
        // Backward compatibility: formatter lama masih membaca dua properti ini.
        kolmogorovSmirnov: ks,
        shapiroWilk: sw,
    };
}

// =============================================================================
// LOGGING UTILITIES - Laporan Detail ke Console
// =============================================================================

/**
 * Format angka dengan presisi tertentu untuk tampilan log.
 *
 * @param {number} num - Angka yang akan diformat
 * @param {number} [decimals=6] - Jumlah desimal yang diinginkan
 * @returns {string} Angka yang sudah diformat, atau 'N/A' jika input bukan angka valid
 *
 * @example
 * formatNormalityNumber(0.98654321, 8);
 * // => '0.98654321'
 *
 * @example
 * formatNormalityNumber(NaN);
 * // => 'N/A'
 */
function formatNormalityNumber(num, decimals = 6) {
    if (typeof num !== 'number' || isNaN(num)) return 'N/A';
    return num.toFixed(decimals);
}

/**
 * Cetak laporan terperinci uji normalitas ke konsol dalam format tabel ASCII.
 *
 * Mengikuti pola printDetailedLog() pada Bartlett Test Worker.
 * Mencetak tabel ASCII yang rapi berisi:
 * - Informasi data (ukuran sampel, alpha, timestamp)
 * - Hasil Kolmogorov-Smirnov (Statistik D, df, p-value)
 * - Hasil Shapiro-Wilk (Statistik W, df, p-value)
 * - Kesimpulan per uji (normal / tidak normal)
 * - Waktu eksekusi dan rating performa
 * - Rekomendasi analisis lanjutan
 *
 * @param {number} sampleSize - Ukuran sampel (n)
 * @param {number} alpha - Level signifikansi (α)
 * @param {{statistic: number, df: number, pValue: number}|null} ksResult - Hasil uji KS
 * @param {{statistic: number, df: number, pValue: number}|null} swResult - Hasil uji SW
 * @param {number} executionTime - Waktu eksekusi dalam milidetik
 *
 * @example
 * printNormalityLog(30, 0.05, { statistic: 0.12, df: 30, pValue: 0.200 },
 *   { statistic: 0.98, df: 30, pValue: 0.85 }, 5.2);
 * // Prints formatted ASCII table to console
 */
function printNormalityLog(sampleSize, alpha, ksResult, swResult, executionTime) {
    console.log('\n');
    console.log('================================================================');
    console.log('       NORMALITY TESTS - DETAILED ANALYSIS LOG');
    console.log('================================================================');
    console.log(`  Sample Size (N): ${sampleSize}`);
    console.log(`  Significance Level (α): ${alpha}`);
    console.log(`  Timestamp: ${new Date().toISOString()}`);
    console.log('================================================================');

    // ========== HASIL KOLMOGOROV-SMIRNOV ==========
    console.log('\n[KOLMOGOROV-SMIRNOV TEST]');
    if (ksResult) {
        console.log('  +---------------------------+------------------+');
        console.log(`  | Statistik D               | ${formatNormalityNumber(ksResult.statistic, 8).padStart(16)} |`);
        console.log(`  | Degrees of Freedom (df)   | ${String(ksResult.df).padStart(16)} |`);
        console.log(`  | P-Value (Sig.)            | ${formatNormalityNumber(ksResult.pValue, 8).padStart(16)} |`);
        console.log('  +---------------------------+------------------+');

        if (ksResult.pValue >= alpha) {
            console.log(`  Kesimpulan: NORMAL (p = ${formatNormalityNumber(ksResult.pValue, 4)} >= ${alpha})`);
            console.log('  Interpretasi: Gagal tolak H₀ → Data dianggap berdistribusi normal');
        } else {
            console.log(`  Kesimpulan: TIDAK NORMAL (p = ${formatNormalityNumber(ksResult.pValue, 4)} < ${alpha})`);
            console.log('  Interpretasi: Tolak H₀ → Data TIDAK berdistribusi normal');
        }
        console.log('  Catatan: Menggunakan koreksi Lilliefors (parameter diestimasi dari data)');
    } else {
        console.log('  Status: TIDAK TERSEDIA');
        console.log('  Alasan: Data tidak memenuhi syarat (minimal 3 observasi, SD > 0)');
    }

    // ========== HASIL SHAPIRO-WILK ==========
    console.log('\n[SHAPIRO-WILK TEST]');
    if (swResult) {
        console.log('  +---------------------------+------------------+');
        console.log(`  | Statistik W               | ${formatNormalityNumber(swResult.statistic, 8).padStart(16)} |`);
        console.log(`  | Degrees of Freedom (df)   | ${String(swResult.df).padStart(16)} |`);
        console.log(`  | P-Value (Sig.)            | ${formatNormalityNumber(swResult.pValue, 8).padStart(16)} |`);
        console.log('  +---------------------------+------------------+');

        if (swResult.pValue >= alpha) {
            console.log(`  Kesimpulan: NORMAL (p = ${formatNormalityNumber(swResult.pValue, 4)} >= ${alpha})`);
            console.log('  Interpretasi: Gagal tolak H₀ → Data dianggap berdistribusi normal');
        } else {
            console.log(`  Kesimpulan: TIDAK NORMAL (p = ${formatNormalityNumber(swResult.pValue, 4)} < ${alpha})`);
            console.log('  Interpretasi: Tolak H₀ → Data TIDAK berdistribusi normal');
        }
        console.log('  Catatan: Aproksimasi p-value Royston (1993, 1995)');
    } else {
        console.log('  Status: TIDAK TERSEDIA');
        if (sampleSize > 5000) {
            console.log('  Alasan: Shapiro-Wilk hanya tersedia untuk n ≤ 5000');
        } else {
            console.log('  Alasan: Data tidak memenuhi syarat (minimal 3 observasi)');
        }
    }

    // ========== WAKTU EKSEKUSI ==========
    console.log('\n[WAKTU EKSEKUSI]');
    console.log(`  Total Time: ${formatNormalityNumber(executionTime, 3)} ms`);

    if (executionTime < 10) {
        console.log('  Performance: EXCELLENT (< 10 ms)');
    } else if (executionTime < 50) {
        console.log('  Performance: GOOD (< 50 ms)');
    } else if (executionTime < 100) {
        console.log('  Performance: ACCEPTABLE (< 100 ms)');
    } else {
        console.log('  Performance: SLOW (>= 100 ms) - Consider data size or system load');
    }

    // ========== REKOMENDASI ==========
    console.log('\n[REKOMENDASI]');
    const ksNormal = ksResult && ksResult.pValue >= alpha;
    const swNormal = swResult && swResult.pValue >= alpha;

    if (ksNormal && swNormal) {
        console.log('  ✅ Kedua uji menunjukkan data NORMAL');
        console.log('  → Asumsi normalitas TERPENUHI, aman melanjutkan ke ANOVA / T-Test / Bartlett');
    } else if (!ksNormal && !swNormal && ksResult && swResult) {
        console.log('  ❌ Kedua uji menunjukkan data TIDAK NORMAL');
        console.log('  → Pertimbangkan: uji non-parametrik, transformasi data, atau Levene Test (pengganti Bartlett)');
    } else if (ksResult || swResult) {
        console.log('  ⚠️ Hasil uji tidak konsisten (satu normal, satu tidak)');
        console.log('  → Periksa ukuran sampel dan distribusi data secara visual (histogram/Q-Q plot)');
    }

    console.log('\n================================================================');
    console.log('       END OF NORMALITY TESTS LOG');
    console.log('================================================================\n');
}

// =============================================================================
// EXPOSE FUNGSI KE BERBAGAI ENVIRONMENT
// =============================================================================

// Sediakan fungsi pada cakupan global worker (lingkungan Web Worker)
if (typeof self !== 'undefined') {
    self.calculateKolmogorovSmirnov = calculateKolmogorovSmirnov;
    self.calculateShapiroWilk = calculateShapiroWilk;
    self.approximateKSPValue = approximateKSPValue;
    self.shapiroWilkPValue = shapiroWilkPValue;
    self.runNormalityTests = runNormalityTests;
    self.printNormalityLog = printNormalityLog;
}

// Expose ke globalThis untuk environment hybrid/test harness
if (typeof globalThis !== 'undefined') {
    globalThis.calculateKolmogorovSmirnov = calculateKolmogorovSmirnov;
    globalThis.calculateShapiroWilk = calculateShapiroWilk;
    globalThis.approximateKSPValue = approximateKSPValue;
    globalThis.shapiroWilkPValue = shapiroWilkPValue;
    globalThis.runNormalityTests = runNormalityTests;
    globalThis.printNormalityLog = printNormalityLog;
}

// Expose ke CommonJS untuk unit testing dengan require()
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = {
        calculateKolmogorovSmirnov,
        calculateShapiroWilk,
        approximateKSPValue,
        shapiroWilkPValue,
        runNormalityTests,
        printNormalityLog,
    };
}
