/**
 * Mesin statistik untuk data kategorik.
 *
 * Urutan pemrosesan:
 * 1. buildContingencyTable() membersihkan kategori mentah dan membentuk frekuensi observed.
 * 2. calculatePearsonChiSquare() menghitung expected count, X^2, df, dan p-value.
 * 3. Fungsi uji khusus menambahkan tujuan serta hipotesis yang sesuai.
 *
 * Uji kebebasan dan uji kesamaan proporsi memakai perhitungan Pearson yang sama,
 * tetapi mempunyai pertanyaan penelitian dan hipotesis yang berbeda.
 */
(function exposeCategoricalChiSquare(root) {
    const DEFAULT_ALPHA = 0.05;

    function validateAlpha(alpha) {
        if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
            throw new RangeError('Alpha harus lebih besar dari 0 dan lebih kecil dari 1.');
        }
    }

    /**
     * Menjumlahkan bilangan dengan algoritma Neumaier.
     * Koreksi disimpan terpisah agar kontribusi kecil tidak langsung hilang ketika
     * dijumlahkan dengan bilangan yang jauh lebih besar.
     */
    function compensatedSum(values) {
        let sum = 0;
        let correction = 0;
        for (let index = 0; index < values.length; index += 1) {
            const value = values[index];
            const next = sum + value;
            correction += Math.abs(sum) >= Math.abs(value)
                ? (sum - next) + value
                : (value - next) + sum;
            sum = next;
        }
        return sum + correction;
    }

    /** Memastikan matriks observed layak dihitung sebagai tabel kontingensi. */
    function validateObserved(observed) {
        if (!Array.isArray(observed) || observed.length < 2) {
            throw new RangeError('Matriks observed membutuhkan minimal dua baris.');
        }

        const columnCount = Array.isArray(observed[0]) ? observed[0].length : 0;
        if (columnCount < 2) {
            throw new RangeError('Matriks observed membutuhkan minimal dua kolom.');
        }

        if (observed.some(row => !Array.isArray(row) || row.length !== columnCount)) {
            throw new TypeError('Matriks observed harus berbentuk persegi panjang.');
        }

        if (observed.some(row => row.some(value => !Number.isFinite(value) || value < 0))) {
            throw new TypeError('Frekuensi observed harus berupa bilangan berhingga dan tidak negatif.');
        }

        const rowTotals = observed.map(row => compensatedSum(row));
        const columnTotals = Array.from(
            { length: columnCount },
            (_, columnIndex) => compensatedSum(observed.map(row => row[columnIndex])),
        );

        if (rowTotals.some(total => total <= 0) || columnTotals.some(total => total <= 0)) {
            throw new RangeError('Setiap baris dan kolom harus memiliki total lebih dari nol.');
        }

        const total = compensatedSum(rowTotals);
        if (!Number.isFinite(total)
            || rowTotals.some(value => !Number.isFinite(value))
            || columnTotals.some(value => !Number.isFinite(value))) {
            throw new RangeError('Total frekuensi terlalu besar untuk dihitung secara aman.');
        }

        return {
            rowCount: observed.length,
            columnCount,
            rowTotals,
            columnTotals,
            total,
        };
    }

    /**
     * Menghitung ln(Gamma(x)) dengan aproksimasi Lanczos.
     * Nilai ini dipakai oleh distribusi Chi-Square saat menghitung p-value.
     */
    function logGamma(value) {
        const coefficients = [
            676.5203681218851,
            -1259.1392167224028,
            771.3234287776531,
            -176.6150291621406,
            12.507343278686905,
            -0.13857109526572012,
            9.984369578019572e-6,
            1.5056327351493116e-7,
        ];

        if (value < 0.5) {
            return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
        }

        const shifted = value - 1;
        let series = 0.9999999999998099;
        for (let index = 0; index < coefficients.length; index += 1) {
            series += coefficients[index] / (shifted + index + 1);
        }
        const base = shifted + coefficients.length - 0.5;
        return 0.5 * Math.log(2 * Math.PI)
            + (shifted + 0.5) * Math.log(base)
            - base
            + Math.log(series);
    }

    /** Menghitung fungsi gamma tidak lengkap teratur bagian bawah P(a, x). */
    function regularizedGammaP(shape, value) {
        if (value === 0) return 0;

        let sum = 1 / shape;
        let term = sum;
        for (let iteration = 1; iteration < 1000; iteration += 1) {
            term *= value / (shape + iteration);
            sum += term;
            if (Math.abs(term) <= Math.abs(sum) * 1e-15) break;
        }

        return sum * Math.exp(-value + shape * Math.log(value) - logGamma(shape));
    }

    /**
     * Menghitung peluang ekor atas Q(a, x).
     * Deret dipakai untuk x kecil dan pecahan berlanjut untuk x yang lebih besar.
     */
    function regularizedGammaQ(shape, value) {
        if (value === 0) return 1;
        if (value < shape + 1) return 1 - regularizedGammaP(shape, value);

        let offset = value + 1 - shape;
        let previous = 1e30;
        let current = 1 / offset;
        let fraction = current;

        for (let iteration = 1; iteration < 1000; iteration += 1) {
            const numerator = -iteration * (iteration - shape);
            offset += 2;
            current = numerator * current + offset;
            if (Math.abs(current) < 1e-30) current = 1e-30;
            previous = offset + numerator / previous;
            if (Math.abs(previous) < 1e-30) previous = 1e-30;
            current = 1 / current;
            const delta = current * previous;
            fraction *= delta;
            if (Math.abs(delta - 1) <= 1e-15) break;
        }

        return Math.exp(-value + shape * Math.log(value) - logGamma(shape)) * fraction;
    }

    /** Mengubah statistik X^2 menjadi peluang ekor atas berdasarkan df. */
    function chiSquarePValue(statistic, degreesOfFreedom) {
        if (statistic === Number.POSITIVE_INFINITY && degreesOfFreedom > 0) return 0;
        if (!Number.isFinite(statistic) || statistic < 0 || degreesOfFreedom <= 0) return null;
        const probability = regularizedGammaQ(degreesOfFreedom / 2, statistic / 2);
        return Math.min(1, Math.max(0, probability));
    }

    /**
     * Menghitung E_ij = (total baris i x total kolom j) / N.
     * Dua bentuk perkalian dibandingkan untuk mengurangi risiko overflow/underflow.
     */
    function calculateExpectedCount(rowTotal, columnTotal, total) {
        const usingColumnProportion = rowTotal * (columnTotal / total);
        const usingRowProportion = columnTotal * (rowTotal / total);
        return Math.max(usingColumnProportion, usingRowProportion);
    }

    /**
     * Menghitung inti Pearson Chi-Square dari matriks frekuensi observed.
     * Fungsi ini tidak menentukan makna uji; pembungkus di bawahnya yang memberi
     * konteks uji kebebasan, proporsi binomial, atau proporsi multinomial.
     */
    function calculatePearsonChiSquare(observed, alpha = DEFAULT_ALPHA) {
        validateAlpha(alpha);
        const {
            rowCount,
            columnCount,
            rowTotals,
            columnTotals,
            total,
        } = validateObserved(observed);

        const expectedCounts = Array.from(
            { length: rowCount },
            () => Array(columnCount).fill(0),
        );
        let statistic = 0;
        let statisticCorrection = 0;
        let minExpectedCount = Number.POSITIVE_INFINITY;
        let cellsUnder5 = 0;

        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
            for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
                const expected = calculateExpectedCount(
                    rowTotals[rowIndex],
                    columnTotals[columnIndex],
                    total,
                );
                if (!Number.isFinite(expected) || expected <= 0) {
                    throw new RangeError('Expected count tidak dapat dihitung secara aman.');
                }
                expectedCounts[rowIndex][columnIndex] = expected;
                minExpectedCount = Math.min(minExpectedCount, expected);
                if (expected < 5) cellsUnder5 += 1;

                const difference = observed[rowIndex][columnIndex] - expected;
                const component = difference * (difference / expected);
                const nextStatistic = statistic + component;
                statisticCorrection += Math.abs(statistic) >= Math.abs(component)
                    ? (statistic - nextStatistic) + component
                    : (component - nextStatistic) + statistic;
                statistic = nextStatistic;
            }
        }

        statistic += statisticCorrection;

        if (Number.isNaN(statistic)) {
            throw new RangeError('Statistik Chi-Square tidak dapat dihitung secara aman.');
        }

        const df = (rowCount - 1) * (columnCount - 1);
        const pValue = chiSquarePValue(statistic, df);
        const significant = pValue !== null && pValue < alpha;
        const totalCells = rowCount * columnCount;

        return {
            value: statistic,
            df,
            pValue,
            expectedCounts,
            rowTotals,
            columnTotals,
            total,
            alpha,
            significant,
            decision: significant ? 'reject' : 'fail-to-reject',
            expectedDiagnostics: {
                minExpectedCount,
                cellsUnder5,
                totalCells,
                percentCellsUnder5: (cellsUnder5 / totalCells) * 100,
            },
        };
    }

    /** Uji apakah dua variabel kategorik saling bebas atau berhubungan. */
    function chiSquareIndependenceTest(observed, alpha = DEFAULT_ALPHA) {
        return {
            ...calculatePearsonChiSquare(observed, alpha),
            testType: 'independence',
            nullHypothesis: 'Variabel baris dan kolom saling bebas.',
            alternativeHypothesis: 'Variabel baris dan kolom memiliki hubungan.',
        };
    }

    /** Uji kesamaan proporsi untuk hasil yang mempunyai tepat dua kategori. */
    function binomialProportionTest(observed, alpha = DEFAULT_ALPHA) {
        const columnCount = Array.isArray(observed) && Array.isArray(observed[0])
            ? observed[0].length
            : 0;
        if (columnCount !== 2) {
            throw new RangeError('Uji proporsi binomial membutuhkan tepat dua kategori hasil.');
        }

        return {
            ...calculatePearsonChiSquare(observed, alpha),
            testType: 'binomial-proportion-homogeneity',
            outcomeCategoryCount: columnCount,
            nullHypothesis: 'Proporsi binomial sama pada seluruh kelompok.',
            alternativeHypothesis: 'Minimal terdapat satu kelompok dengan proporsi binomial berbeda.',
        };
    }

    /** Uji kesamaan distribusi proporsi untuk hasil dengan minimal tiga kategori. */
    function multinomialProportionTest(observed, alpha = DEFAULT_ALPHA) {
        const columnCount = Array.isArray(observed) && Array.isArray(observed[0])
            ? observed[0].length
            : 0;
        if (columnCount < 3) {
            throw new RangeError('Uji proporsi multinomial membutuhkan minimal tiga kategori hasil.');
        }

        return {
            ...calculatePearsonChiSquare(observed, alpha),
            testType: 'multinomial-proportion-homogeneity',
            outcomeCategoryCount: columnCount,
            nullHypothesis: 'Distribusi proporsi multinomial sama pada seluruh kelompok.',
            alternativeHypothesis: 'Minimal terdapat satu kelompok dengan distribusi proporsi multinomial berbeda.',
        };
    }

    /** Mengurutkan kategori numerik secara numerik dan kategori lain sebagai teks. */
    function sortCategories(categories) {
        return Array.from(categories).sort((left, right) => {
            const leftNumber = left === '' || left === null || left === undefined
                ? Number.NaN
                : Number(left);
            const rightNumber = right === '' || right === null || right === undefined
                ? Number.NaN
                : Number(right);
            if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
                return leftNumber - rightNumber;
            }
            return String(left).localeCompare(String(right), undefined, { numeric: true });
        });
    }

    /**
     * Menyiapkan satu nilai kategori sebelum tabel kontingensi dibentuk.
     *
     * Data kategorik tidak harus direcode menjadi angka. Nilai teks dapat dipakai
     * langsung; spasi di awal/akhir dibuang agar variasi pengetikan seperti
     * "SMA" dan " SMA " tidak membentuk dua kategori. Sel kosong dan angka yang
     * tidak berhingga dikembalikan sebagai null agar dihitung sebagai missing.
     * Huruf besar-kecil tidak disamakan karena dapat mewakili kategori berbeda.
     */
    function normalizeCategoryValue(value) {
        if (typeof value === 'string') {
            const trimmedValue = value.trim();
            return trimmedValue === '' ? null : trimmedValue;
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : null;
        }
        return value === null || value === undefined ? null : value;
    }

    /**
     * Membentuk matriks frekuensi dari pasangan kategori baris dan kolom.
     * Setiap elemen pada indeks yang sama dianggap berasal dari satu kasus.
     * Kasus dengan salah satu kategori kosong dikeluarkan dan bobotnya dicatat
     * pada excludedWeight, sehingga pengguna tidak perlu melakukan recode hanya
     * untuk mengubah kategori teks menjadi kode numerik.
     */
    function buildContingencyTable(
        rowValues,
        columnValues,
        weights,
        cellAdjustment = 'none',
    ) {
        if (!Array.isArray(rowValues) || !Array.isArray(columnValues)) {
            throw new TypeError('Nilai baris dan kolom harus berupa array.');
        }
        if (rowValues.length !== columnValues.length) {
            throw new RangeError('Jumlah nilai baris dan kolom harus sama.');
        }

        const caseWeights = weights === undefined
            ? Array(rowValues.length).fill(1)
            : weights;
        if (!Array.isArray(caseWeights) || caseWeights.length !== rowValues.length) {
            throw new RangeError('Jumlah bobot harus sama dengan jumlah pasangan kategori.');
        }
        if (caseWeights.some(weight => !Number.isFinite(weight) || weight <= 0)) {
            throw new RangeError('Bobot harus berupa bilangan berhingga yang lebih besar dari nol.');
        }
        if (!['none', 'round', 'truncate'].includes(cellAdjustment)) {
            throw new RangeError('Penyesuaian sel harus none, round, atau truncate.');
        }

        const normalizedRows = [];
        const normalizedColumns = [];
        const includedWeights = [];
        const excludedWeights = [];

        for (let index = 0; index < rowValues.length; index += 1) {
            const rowValue = normalizeCategoryValue(rowValues[index]);
            const columnValue = normalizeCategoryValue(columnValues[index]);
            if (rowValue === null || columnValue === null) {
                excludedWeights.push(caseWeights[index]);
                continue;
            }
            normalizedRows.push(rowValue);
            normalizedColumns.push(columnValue);
            includedWeights.push(caseWeights[index]);
        }

        const rowCategories = sortCategories(new Set(normalizedRows));
        const columnCategories = sortCategories(new Set(normalizedColumns));
        const rowIndexByValue = new Map(rowCategories.map((value, index) => [value, index]));
        const columnIndexByValue = new Map(columnCategories.map((value, index) => [value, index]));
        let observed = Array.from(
            { length: rowCategories.length },
            () => Array(columnCategories.length).fill(0),
        );
        const observedCorrections = Array.from(
            { length: rowCategories.length },
            () => Array(columnCategories.length).fill(0),
        );

        for (let index = 0; index < normalizedRows.length; index += 1) {
            const rowIndex = rowIndexByValue.get(normalizedRows[index]);
            const columnIndex = columnIndexByValue.get(normalizedColumns[index]);
            const current = observed[rowIndex][columnIndex];
            const weight = includedWeights[index];
            const next = current + weight;
            observedCorrections[rowIndex][columnIndex] += Math.abs(current) >= Math.abs(weight)
                ? (current - next) + weight
                : (weight - next) + current;
            observed[rowIndex][columnIndex] = next;
        }


        observed = observed.map((row, rowIndex) => row.map(
            (value, columnIndex) => value + observedCorrections[rowIndex][columnIndex],
        ));

        if (cellAdjustment === 'round') {
            observed = observed.map(row => row.map(value => Math.round(value)));
        } else if (cellAdjustment === 'truncate') {
            observed = observed.map(row => row.map(value => Math.trunc(value)));
        }

        const rowTotals = observed.map(row => compensatedSum(row));
        const columnTotals = Array.from(
            { length: columnCategories.length },
            (_, columnIndex) => compensatedSum(observed.map(row => row[columnIndex])),
        );

        return {
            rowCategories,
            columnCategories,
            observed,
            rowTotals,
            columnTotals,
            total: compensatedSum(rowTotals),
            excludedWeight: compensatedSum(excludedWeights),
        };
    }

    const api = {
        compensatedSum,
        normalizeCategoryValue,
        buildContingencyTable,
        calculateExpectedCount,
        calculatePearsonChiSquare,
        chiSquareIndependenceTest,
        binomialProportionTest,
        multinomialProportionTest,
    };

    root.CategoricalChiSquare = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof self !== 'undefined' ? self : globalThis);
