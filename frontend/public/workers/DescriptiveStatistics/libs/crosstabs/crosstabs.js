/**
 * Menyiapkan analisis tabulasi silang dari dua variabel kategorik.
 *
 * Tanggung jawab:
 * - menyiapkan data, nilai hilang, tanggal, dan bobot kasus;
 * - menyusun ringkasan kasus, statistik sel, dan hasil uji untuk formatter;
 * - meneruskan pembentukan tabel dan perhitungan uji ke CategoricalChiSquare.
 *
 * Modul perhitungan uji kategorik berada di:
 * ../categoricalTests/categoricalChiSquare.js
 * Modul tersebut menghitung Pearson Chi-Square untuk uji kebebasan
 * serta uji kesamaan proporsi binomial/multinomial antarkelompok.
 */

if (typeof self !== 'undefined' && typeof self.importScripts === 'function') {
    if (typeof isNumeric === 'undefined') {
        importScripts('../utils/utils.js');
    }
}

class CrosstabsCalculator {
    /** Menyimpan definisi variabel, data per kasus, bobot, dan pilihan analisis. */
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
        // W adalah total frekuensi berbobot; R dan C adalah jumlah kategori baris dan kolom.
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

    /**
     * Menyiapkan pasangan kategori valid dan meminta tabel kontingensi satu kali.
     * Kasus dengan nilai hilang dicatat terpisah dari kasus yang dianalisis.
     */
    #initialize() {
        if (this.initialized) return;

        const rowData = this.data.map(d => d[this.rowVar.name]);
        const colData = this.data.map(d => d[this.colVar.name]);

        if (!self.CategoricalChiSquare) {
            throw new Error('Mesin statistik kategorik belum dimuat.');
        }

        // Kumpulkan pasangan kategori dan bobot untuk modul perhitungan uji kategorik.
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

    /**
     * Menyesuaikan bobot per kasus hanya jika roundCase atau truncateCase dipilih.
     * Penyesuaian per sel dilakukan saat tabel dibentuk, setelah bobot dijumlahkan.
     */
    #adjustCaseWeight(weight) {
        const nonInt = (this.options && this.options.nonintegerWeights) || 'noAdjustment';
        if (nonInt === 'roundCase') return Math.round(weight);
        if (nonInt === 'truncateCase') return (weight < 0 ? Math.ceil(weight) : Math.trunc(weight));
        return weight;
    }

    /** Mengambil frekuensi harapan sel (i, j) tanpa pembulatan; null jika total nol. */
    _getExpectedCount(i, j) {
        this.#initialize();
        if (this.W === 0) return null;
        const expected = self.CategoricalChiSquare.calculateExpectedCount(
            this.rowTotals[i],
            this.colTotals[j],
            this.W,
        );
        return expected;
    }
    /**
     * Menyusun ringkasan kasus, tabel kontingensi, statistik sel, dan hasil uji.
     * Nilai perhitungan disimpan tanpa pembulatan agar dapat dipakai oleh formatter.
     */
    getStatistics() {
        this.#initialize();
        const cellStats = Array(this.R).fill(0).map(() => Array(this.C).fill(0));
        for (let i = 0; i < this.R; i++) {
            for (let j = 0; j < this.C; j++) {
                const f_ij = this.table[i][j];

                // Simpan nilai penuh. Pemformatan tampilan tidak boleh mengubah hasil mentah.
                const expectedExact = self.CategoricalChiSquare.calculateExpectedCount(
                    this.rowTotals[i],
                    this.colTotals[j],
                    this.W,
                );
                // Residual dihitung dari expected count yang belum dibulatkan.
                const residual = f_ij - expectedExact;

                let standardizedResidual = null;
                let adjustedResidual = null;

                if (expectedExact && expectedExact > 0) {
                    const unroundedStandardized = (f_ij - expectedExact) / Math.sqrt(expectedExact);
                    standardizedResidual = unroundedStandardized;

                    if (this.W > 0) {
                        const rowProp = this.rowTotals[i] / this.W;
                        const colProp = this.colTotals[j] / this.W;
                        const denom = Math.sqrt(expectedExact * (1 - rowProp) * (1 - colProp));
                        if (denom !== 0) {
                            const unroundedAdjusted = (f_ij - expectedExact) / denom;
                            adjustedResidual = unroundedAdjusted;
                        }
                    }
                }

                cellStats[i][j] = {
                    count: f_ij,
                    expected: expectedExact,
                    residual,
                    standardizedResidual,
                    adjustedResidual,
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

    /**
     * Baris mewakili kelompok; kolom mewakili kategori hasil.
     * Dua kategori hasil memakai uji kesamaan proporsi binomial; tiga atau lebih
     * memakai multinomial. Mengembalikan null jika tabel tidak layak diuji.
     */
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
     * Meminta hasil uji kebebasan dari modul perhitungan uji kategorik.
     * Hasil memuat statistik Pearson, df, p-value, dan diagnostik expected count.
     * Jika tabel tidak layak diuji, p-value dikembalikan sebagai null.
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
