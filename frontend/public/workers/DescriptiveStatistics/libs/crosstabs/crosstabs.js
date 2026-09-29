/**
 * ============================================================================
 * CROSSTABS & CHI-SQUARE TESTS (UJI PROPORSI MULTINOMIAL/BINOMIAL)
 * ============================================================================
 *
 * TUJUAN:
 * Modul ini menangani pembuatan tabel tabulasi silang (Crosstabs) dan
 * melakukan uji independensi/kebebasan menggunakan Pearson Chi-Square.
 * Uji ini secara konseptual setara dengan uji kesamaan proporsi binomial
 * (untuk tabel 2x2) atau multinomial (untuk tabel RxC).
 *
 * KONSEP DASAR (UJI PROPORSI CHI-SQUARE):
 * Pearson Chi-Square digunakan untuk menguji apakah ada hubungan yang signifikan
 * antara dua variabel kategorik (Baris dan Kolom). Uji ini bekerja dengan cara
 * membandingkan frekuensi yang benar-benar terjadi/diamati (Observed) dengan
 * frekuensi yang diharapkan terjadi (Expected) jika kedua variabel tersebut
 * benar-benar saling bebas (tidak ada hubungan/proporsi sama rata).
 *
 * HIPOTESIS:
 * H₀: Variabel baris dan kolom saling bebas (Proporsi antar grup SAMA)
 * H₁: Terdapat hubungan antara baris dan kolom (Proporsi antar grup BERBEDA)
 *
 * CARA MEMBACA DALAM KERANGKA UJI PROPORSI:
 * - Tabel 2x2  : ekuivalen dengan perbandingan proporsi binomial antar grup.
 * - Tabel RxC  : ekuivalen dengan perbandingan proporsi multinomial antar grup.
 * - Jika p-value kecil (mis. < 0.05), artinya pola proporsi antar grup tidak sama.
 *
 * RUMUS UTAMA (PEARSON CHI-SQUARE):
 *   χ² = Σ [ (O_ij - E_ij)² / E_ij ]
 *
 *   di mana:
 *   - O_ij (Observed) = Jumlah frekuensi amatan nyata di sel baris i, kolom j.
 *   - E_ij (Expected) = Frekuensi harapan di sel baris i, kolom j.
 *                       Dihitung dengan rumus Proporsi Multinomial:
 *                       E_ij = (Total Baris i × Total Kolom j) / Grand Total (N)
 *
 * DERAJAT BEBAS (Degrees of Freedom / df):
 *   df = (Jumlah Baris - 1) × (Jumlah Kolom - 1)
 *
 * ASUMSI & ATURAN COCHRAN (1954):
 * Uji Chi-Square merupakan pendekatan asimtotik yang valid JIKA:
 * 1. Tidak boleh ada sel dengan frekuensi harapan (Expected) bernilai 0.
 * 2. Maksimal hanya boleh ada 20% sel yang memiliki frekuensi harapan (Expected) < 5.
 *    (Jika dilanggar, hasil Chi-Square bisa tidak akurat dan disarankan
 *     menggunakan Fisher's Exact Test atau menggabungkan kategori).
 *
 * LANGKAH ALGORITMA:
 * Implementasi berada di `../categoricalTests/categoricalChiSquare.js`.
 * 1. Bangun tabel: Kumpulkan seluruh data mentah dan bangun matriks
 *    kontingensi RxC beserta total baris (Row Totals) dan total kolom (Col Totals).
 * 2. Hitung frekuensi harapan: Untuk setiap sel, hitung (Total Baris * Total Kolom) / N.
 * 3. Hitung residual: Hitung selisih (O - E) untuk memperoleh residual.
 * 4. Chi-Square Accumulation: Kuadratkan selisih, bagi dengan E, dan jumlahkan
 *    untuk seluruh sel di dalam tabel.
 * 5. P-Value: Dihitung dari fungsi distribusi kumulatif (CDF) Gamma/Chi-Square.
 *
 * RINGKASAN PRAKTIS MEMBACA HASIL:
 * 1) Lihat `chiSquare.pearson.value`  -> besar kecilnya deviasi O vs E.
 * 2) Lihat `chiSquare.pearson.df`     -> derajat bebas (R-1)(C-1).
 * 3) Lihat `chiSquare.pearson.pValue` -> keputusan uji H0/H1.
 * 4) Lihat `expectedDiagnostics`      -> cek apakah asumsi uji layak.
 *
 * REFERENSI MATEMATIKA:
 * - Pearson, K. (1900). "On the criterion that a given system of deviations from
 *   the probable in the case of a correlated system of variables is such that it
 *   can be reasonably supposed to have arisen from random sampling".
 *   Philosophical Magazine. Series 5. 50 (302): 157–175.
 * - Cochran, W. G. (1954). "Some methods for strengthening the common χ² tests".
 *   Biometrics. 10 (4): 417–451.
 *
 * ============================================================================
 * PROSEDUR PENGGUNAAN (EKUIVALEN LANGKAH SPSS)
 * ============================================================================
 *
 * Langkah-langkah berikut menggambarkan prosedur uji Chi-Square di SPSS dan
 * bagaimana modul ini mengimplementasikan setiap langkah tersebut:
 *
 * LANGKAH 1 — Pengkodean Kategori:
 *   Setiap kategori variabel diberikan kode numerik atau string.
 *   Di Statify, ini ditangani melalui Value Labels pada Variable View.
 *   → Implementasi: `getCategoryLabel()` di crosstabulationFormatter.ts
 *     membaca `variable.values` untuk mengonversi kode ke label tampilan.
 *
 * LANGKAH 2 — Masukan Data dan Definisi Variabel:
 *   Data dimasukkan beserta label variabel, value labels, dan tipe measure.
 *   → Implementasi: Data dibaca dari IndexedDB via `useAnalysisData()` hook.
 *     Variabel didefinisikan di `useVariableStore` (nama, label, values, missing).
 *
 * LANGKAH 3 — Buka Dialog Crosstabs:
 *   SPSS: Analyze > Descriptive Statistics > Crosstabs.
 *   → Implementasi: Modal Crosstabs diregistrasi di `DescriptiveRegistry.tsx`.
 *     Pengguna membukanya dari menu Analyze > Descriptive Statistics > Crosstabs.
 *
 * LANGKAH 4 — Pemilihan Variabel Row dan Column:
 *   Pindahkan variabel ke kotak Row(s) dan Column(s).
 *   Urutan baris/kolom tidak mempengaruhi hasil pengujian (simetris).
 *   → Implementasi: `VariablesTab.tsx` dengan mekanisme drag-and-drop.
 *     State dikelola di `rowVariables` dan `columnVariables` (index.tsx).
 *     Worker menerima { row: Variable, col: Variable } dari hook analisis.
 *
 * LANGKAH 5 — Centang Chi-Square di Statistics:
 *   SPSS: Klik Statistics → centang "Chi Square" → Continue.
 *   → Implementasi: `StatisticsTab.tsx` → checkbox `pearsonChiSquare`.
 *     Mengatur `options.statistics.chiSquare = true`.
 *     Worker kemudian menjalankan `getPearsonChiSquare()` dalam `getStatistics()`.
 *
 * LANGKAH 6 — Centang Observed dan Expected di Cells:
 *   SPSS: Klik Cells → centang "Observed" dan "Expected" → Continue.
 *   → Implementasi: `CellsTab.tsx` → checkbox `observedCounts` dan `expectedCounts`.
 *     Mengatur `options.cells.observed = true` dan `options.cells.expected = true`.
 *     Formatter `crosstabulationFormatter.ts` membaca opsi ini untuk menentukan
 *     kolom mana yang ditampilkan di tabel Crosstabulation.
 *
 * LANGKAH 7 — Jalankan dan Baca Keluaran:
 *   SPSS: Klik OK → muncul keluaran tiga tabel.
 *   → Implementasi: Klik tombol OK di modal → `useCrosstabsAnalysis.ts` mengirim
 *     data ke `crosstabs.worker.js` → `CrosstabsCalculator.getStatistics()` (file ini).
 *     Hasil diformat oleh tiga formatter dan disimpan ke `useResultStore`:
 *       a) Ringkasan Pemrosesan Kasus → `caseProcessingFormatter.ts`
 *       b) [RowVar] * [ColVar] Crosstabulation → `crosstabulationFormatter.ts`
 *       c) Chi-Square Tests (Pearson + N of Valid Cases) → `chiSquareFormatter.ts`
 *
 * ============================================================================
 */

if (typeof self !== 'undefined' && typeof self.importScripts === 'function') {
    if (typeof isNumeric === 'undefined') {
        importScripts('../utils/utils.js');
    }
}

class CrosstabsCalculator {
    constructor({ variable, data, weights, options }) {
        if (!variable || !variable.row || !variable.col) {
            throw new Error("Definisi variabel baris dan kolom diperlukan.");
        }
        this.rowVar = variable.row;
        this.colVar = variable.col;
        this.data = data;
        this.weights = weights;
        this.options = options || {};

        this.initialized = false;
        this.memo = {};

        this.table = [];
        this.rowTotals = [];
        this.colTotals = [];
        this.rowCategories = [];
        this.colCategories = [];
        this.W = 0;
        this.validWeight = 0;
        this.missingWeight = 0;
        this.R = 0;
        this.C = 0;

        // Periksa apakah data baris atau kolom mengandung tanggal dd-mm-yyyy
        const rowData = this.data.map(d => d[this.rowVar.name]);
        const colData = this.data.map(d => d[this.colVar.name]);

        this.isRowDateData = rowData.some(value =>
            typeof value === 'string' && isDateString(value)
        );
        this.isColDateData = colData.some(value =>
            typeof value === 'string' && isDateString(value)
        );
    }

    #initialize() {
        if (this.initialized) return;

        const rowData = this.data.map(d => d[this.rowVar.name]);
        const colData = this.data.map(d => d[this.colVar.name]);

        if (!self.CategoricalChiSquare) {
            throw new Error('Mesin statistik kategorik belum dimuat.');
        }

        // Adapter ini hanya menyiapkan data aplikasi. Pembentukan tabel dan
        // perhitungan Chi-Square dilakukan oleh CategoricalChiSquare.
        const validRows = [];
        const validColumns = [];
        const validWeights = [];

        for (let i = 0; i < this.data.length; i++) {
            const rawWeight = this.weights ? (this.weights[i] ?? 1) : 1;
            const weight = this.#adjustCaseWeight(rawWeight);
            if (typeof weight !== 'number' || weight <= 0) continue;

            // Samakan tanggal dengan representasi numerik SPSS sebelum dikelompokkan.
            let processedRowValue = rowData[i];
            let processedColValue = colData[i];

            if (this.isRowDateData && typeof rowData[i] === 'string' && isDateString(rowData[i])) {
                processedRowValue = dateStringToSpssSeconds(rowData[i]);
            }
            if (this.isColDateData && typeof colData[i] === 'string' && isDateString(colData[i])) {
                processedColValue = dateStringToSpssSeconds(colData[i]);
            }

            const isRowMissing = checkIsMissing(processedRowValue, this.rowVar.missing, isNumeric(processedRowValue));
            const isColMissing = checkIsMissing(processedColValue, this.colVar.missing, isNumeric(processedColValue));

            if (!isRowMissing && !isColMissing) {
                validRows.push(processedRowValue);
                validColumns.push(processedColValue);
                validWeights.push(weight);
            } else {
                this.missingWeight += weight;
            }
        }

        // Penyesuaian bobot per sel dilakukan setelah seluruh kasus dijumlahkan.
        const nonIntegerWeights = (this.options && this.options.nonintegerWeights) || 'noAdjustment';
        const cellAdjustment = nonIntegerWeights === 'roundCell'
            ? 'round'
            : nonIntegerWeights === 'truncateCell'
                ? 'truncate'
                : 'none';
        const tableResult = self.CategoricalChiSquare.buildContingencyTable(
            validRows,
            validColumns,
            validWeights,
            cellAdjustment,
        );

        this.rowCategories = tableResult.rowCategories;
        this.colCategories = tableResult.columnCategories;
        this.R = this.rowCategories.length;
        this.C = this.colCategories.length;
        this.table = tableResult.observed;
        this.rowTotals = tableResult.rowTotals;
        this.colTotals = tableResult.columnTotals;
        this.W = tableResult.total;
        this.validWeight = tableResult.total;
        this.missingWeight += tableResult.excludedWeight;

        this.initialized = true;
    }

    #adjustCaseWeight(weight) {
        const nonInt = (this.options && this.options.nonintegerWeights) || 'noAdjustment';
        if (nonInt === 'roundCase') return Math.round(weight);
        if (nonInt === 'truncateCase') return (weight < 0 ? Math.ceil(weight) : Math.trunc(weight));
        return weight;
    }

    _getExpectedCount(i, j) {
        this.#initialize();
        if (this.W === 0) return null;
        const expected = self.CategoricalChiSquare.calculateExpectedCount(
            this.rowTotals[i],
            this.colTotals[j],
            this.W,
        );
        return toSPSSFixed(expected, 1);
    }



    getStatistics() {
        this.#initialize();
        const cellStats = Array(this.R).fill(0).map(() => Array(this.C).fill(0));
        for (let i = 0; i < this.R; i++) {
            for (let j = 0; j < this.C; j++) {
                const f_ij = this.table[i][j];

                // Nilai tepat dipakai untuk perhitungan; pembulatan hanya untuk tampilan.
                const expectedExact = self.CategoricalChiSquare.calculateExpectedCount(
                    this.rowTotals[i],
                    this.colTotals[j],
                    this.W,
                );
                const expectedRounded = toSPSSFixed(expectedExact, 1);

                // Residual dihitung dari expected count yang belum dibulatkan.
                const residual = toSPSSFixed(f_ij - expectedExact, 1);

                let standardizedResidual = null;
                let adjustedResidual = null;

                if (expectedExact && expectedExact > 0) {
                    const unroundedStandardized = (f_ij - expectedExact) / Math.sqrt(expectedExact);
                    standardizedResidual = toSPSSFixed(unroundedStandardized, 3);

                    if (this.W > 0) {
                        const rowProp = this.rowTotals[i] / this.W;
                        const colProp = this.colTotals[j] / this.W;
                        const denom = Math.sqrt(expectedExact * (1 - rowProp) * (1 - colProp));
                        if (denom !== 0) {
                            const unroundedAdjusted = (f_ij - expectedExact) / denom;
                            adjustedResidual = toSPSSFixed(unroundedAdjusted, 3);
                        }
                    }
                }

                cellStats[i][j] = {
                    count: f_ij,
                    expected: expectedRounded,      // nilai tampilan, dibulatkan menjadi 1 desimal
                    residual,                       // residual tidak terstandardisasi, 1 desimal
                    standardizedResidual,           // 3 desimal
                    adjustedResidual,               // 3 desimal
                    rowPercent: this.rowTotals[i] > 0 ? 100 * (f_ij / this.rowTotals[i]) : 0,
                    colPercent: this.colTotals[j] > 0 ? 100 * (f_ij / this.colTotals[j]) : 0,
                    totalPercent: this.W > 0 ? 100 * (f_ij / this.W) : 0,
                };
            }
        }

        // Kembalikan kategori tanggal ke bentuk yang dibaca pengguna.
        const displayRowCategories = this.isRowDateData
            ? this.rowCategories.map(value => {
                if (typeof value === 'number') {
                    const dateString = spssSecondsToDateString(value);
                    return dateString || value;
                }
                return value;
            })
            : this.rowCategories;

        const displayColCategories = this.isColDateData
            ? this.colCategories.map(value => {
                if (typeof value === 'number') {
                    const dateString = spssSecondsToDateString(value);
                    return dateString || value;
                }
                return value;
            })
            : this.colCategories;

        return {
            summary: {
                rows: this.R,
                cols: this.C,
                totalCases: this.W,
                valid: this.validWeight,
                missing: this.missingWeight,
                rowCategories: displayRowCategories,
                colCategories: displayColCategories,
                rowTotals: this.rowTotals,
                colTotals: this.colTotals,
            },
            contingencyTable: this.table,
            cellStatistics: cellStats,
            chiSquare: {
                pearson: this.getPearsonChiSquare(),
                proportion: this.getProportionTest(),
            },
        };
    }

    getProportionTest() {
        this.#initialize();
        const hasEmptyMargin = this.rowTotals.some(total => total <= 0)
            || this.colTotals.some(total => total <= 0);
        if (this.R < 2 || this.C < 2 || this.W === 0 || hasEmptyMargin) return null;

        if (this.C === 2) {
            return self.CategoricalChiSquare.binomialProportionTest(this.table);
        }
        return self.CategoricalChiSquare.multinomialProportionTest(this.table);
    }

    /**
     * Mendelegasikan Statistik Pearson Chi-Square
     *
     * Uji Pearson Chi-Square pada Crosstabs (tabel kontingensi) digunakan untuk menguji
     * independensi (kebebasan) antara dua variabel kategorik (Baris dan Kolom).
     * Secara matematis, uji ini membandingkan proporsi pengamatan (Observed) pada setiap
     * sel dengan proporsi harapan (Expected) jika kedua variabel tersebut saling bebas.
     * Uji ini juga bisa dipandang sebagai uji proporsi multinomial/binomial untuk beberapa grup.
     *
     * RUMUS:
     *   χ² = Σ [ (O_ij - E_ij)² / E_ij ]
     *
     *   di mana:
     *   - O_ij = Frekuensi amatan di sel baris i, kolom j (Count/Observed)
     *   - E_ij = Frekuensi harapan di sel baris i, kolom j (Expected)
     *          = (Total Baris i × Total Kolom j) / Grand Total (N)
     *   - Derajat bebas (df) = (Baris - 1) × (Kolom - 1)
     *
     * ASUMSI:
     *   1. Semua expected count harus > 0.
     *   2. Maksimal 20% sel memiliki expected count < 5 (Aturan Cochran).
     *
     * KAPAN DIGUNAKAN:
     *   - Untuk melihat apakah proporsi/distribusi kategori kolom berbeda antar kategori baris.
     *   - Contoh: Apakah ada hubungan antara 'Jenis Kelamin' (L/P) dan 'Minat Beli' (Ya/Tidak)?
    *
    * LANGKAH KOMPUTASI DI MESIN STATISTIK KATEGORIK:
    *   1) Hitung df = (R-1)(C-1); bila df=0 atau N=0, hasil dikembalikan default/null.
    *   2) Loop semua sel tabel kontingensi.
    *   3) Hitung expected count per sel: E_ij = (rowTotal_i * colTotal_j) / N.
    *   4) Akumulasi χ² dengan komponen (O_ij - E_ij)^2 / E_ij.
    *   5) Sekaligus kumpulkan diagnostik expected (minimum expected, jumlah sel < 5).
    *   6) Hitung p-value dari distribusi Chi-Square(df).
    *
    * CARA MEMBACA NILAI KEMBALIAN FUNGSI:
    *   - value  : Nilai statistik χ² (semakin besar -> deviasi O vs E semakin besar).
    *   - df     : Derajat bebas distribusi uji.
    *   - pValue : Probabilitas mendapatkan χ² setidaknya sebesar nilai observasi
    *              jika H₀ benar (proporsi sama / independen).
    *   - expectedDiagnostics:
    *       * minExpectedCount     : expected terkecil.
    *       * cellsUnder5          : jumlah sel dengan expected < 5.
    *       * percentCellsUnder5   : persentase sel expected < 5.
    *
    * INTERPRETASI SINGKAT:
    *   - pValue < alpha (mis. 0.05)  -> tolak H₀, proporsi antar grup berbeda signifikan.
    *   - pValue >= alpha             -> gagal tolak H₀, belum ada bukti perbedaan proporsi.
    *   - Jika asumsi expected dilanggar berat, interpretasi perlu hati-hati.
     *
     * CONTOH PERHITUNGAN (Tabel 2x2):
     *   Baris \ Kolom  |  K1    |  K2    |  Total
     *   ------------------------------------------
     *   B1             | 10 (O) | 20 (O) | 30
     *   B2             | 30 (O) | 40 (O) | 70
     *   ------------------------------------------
     *   Total          | 40     | 60     | 100 (N)
     *
     *   - E_11 = (30 × 40)/100 = 12
     *   - χ² untuk sel (1,1) = (10 - 12)² / 12 = 4 / 12 = 0.333
     *   - Jumlahkan untuk ke-4 sel untuk mendapat nilai total χ².
     *
    * @returns {Object} Hasil perhitungan Pearson Chi-Square, p-value, dan diagnostik asumsi
     */
    getPearsonChiSquare() {
        this.#initialize();
        const df = (this.R > 1 && this.C > 1) ? (this.R - 1) * (this.C - 1) : 0;
        const hasEmptyMargin = this.rowTotals.some(total => total <= 0)
            || this.colTotals.some(total => total <= 0);
        if (this.W === 0 || df === 0 || hasEmptyMargin) {
            return {
                value: 0,
                df,
                pValue: null,
                testType: 'independence',
                expectedCounts: [],
                expectedDiagnostics: {
                    minExpectedCount: null,
                    cellsUnder5: 0,
                    totalCells: 0,
                    percentCellsUnder5: 0,
                },
            };
        }
        return self.CategoricalChiSquare.chiSquareIndependenceTest(this.table);
    }
}

self.CrosstabsCalculator = CrosstabsCalculator;
