const fs = require('fs');
const path = require('path');
const { jStat } = require('jstat');

const modulePath = path.resolve(
  __dirname,
  '..',
  'categoricalChiSquare.js',
);

describe('mesin uji Chi-Square kategorik', () => {
  test('menyediakan modul algoritma khusus', () => {
    expect(fs.existsSync(modulePath)).toBe(true);
  });

  const loadApi = () => {
    jest.resetModules();
    return require(modulePath);
  };

  test('menyediakan p-value Chi-Square untuk digunakan modul statistik lain', () => {
    const api = loadApi();
    const cases = [
      { statistic: 0, df: 1 },
      { statistic: 3.841458820694124, df: 1 },
      { statistic: 5.991464547107979, df: 2 },
      { statistic: 18.307038053275146, df: 10 },
      { statistic: 100, df: 1 },
    ];

    expect(api.chiSquarePValue).toEqual(expect.any(Function));
    for (const { statistic, df } of cases) {
      const expected = 1 - jStat.chisquare.cdf(statistic, df);
      expect(Math.abs(api.chiSquarePValue(statistic, df) - expected))
        .toBeLessThan(1e-10);
    }
  });

  test('menghitung statistik Pearson, df, p-value, dan expected count tabel 2x2', () => {
    const api = loadApi();

    const result = api.calculatePearsonChiSquare([
      [3, 1],
      [1, 3],
    ]);

    expect(result.value).toBeCloseTo(2, 12);
    expect(result.df).toBe(1);
    expect(result.pValue).toBeCloseTo(0.1572992071, 9);
    expect(result.expectedCounts).toEqual([
      [2, 2],
      [2, 2],
    ]);
    expect(result.expectedDiagnostics).toEqual({
      minExpectedCount: 2,
      cellsUnder5: 4,
      totalCells: 4,
      percentCellsUnder5: 100,
    });
    expect(result.significant).toBe(false);
    expect(result.decision).toBe('fail-to-reject');
  });

  test('menolak H0 ketika p-value lebih kecil daripada alpha', () => {
    const api = loadApi();

    const result = api.calculatePearsonChiSquare([
      [30, 10],
      [10, 30],
    ], 0.05);

    expect(result.value).toBeCloseTo(20, 12);
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.significant).toBe(true);
    expect(result.decision).toBe('reject');
  });

  test('tetap stabil ketika frekuensi besar membuat perkalian marginal overflow', () => {
    const api = loadApi();

    const result = api.calculatePearsonChiSquare([
      [1e160, 1e160],
      [1e160, 1e160],
    ]);

    expect(result.expectedCounts).toEqual([
      [1e160, 1e160],
      [1e160, 1e160],
    ]);
    expect(result.value).toBe(0);
    expect(result.pValue).toBe(1);
    expect(result.decision).toBe('fail-to-reject');
  });

  test('tetap stabil ketika proporsi marginal yang sangat kecil dapat underflow', () => {
    const api = loadApi();

    const result = api.calculatePearsonChiSquare([
      [5e307, 5e-17],
      [5e307, 5e-17],
    ]);

    expect(result.expectedCounts).toEqual([
      [5e307, 5e-17],
      [5e307, 5e-17],
    ]);
    expect(result.value).toBe(0);
    expect(result.pValue).toBe(1);
  });

  test('menjumlahkan nilai dengan compensated summation agar digit kecil tidak hilang', () => {
    const api = loadApi();

    expect(api.compensatedSum([1e16, 1, -1e16])).toBe(1);
  });

  test('memberi konteks hipotesis Uji Kebebasan', () => {
    const api = loadApi();

    const result = api.chiSquareIndependenceTest([[10, 20], [20, 10]]);

    expect(result.testType).toBe('independence');
    expect(result.nullHypothesis).toBe('Variabel baris dan kolom saling bebas.');
    expect(result.alternativeHypothesis).toBe('Variabel baris dan kolom memiliki hubungan.');
  });

  test('menjalankan Uji Kesamaan Proporsi Binomial hanya untuk dua kategori hasil', () => {
    const api = loadApi();

    const result = api.binomialProportionTest([
      [10, 20],
      [30, 40],
      [15, 25],
      [20, 30],
    ]);

    expect(result.testType).toBe('binomial-proportion-homogeneity');
    expect(result.outcomeCategoryCount).toBe(2);
    expect(() => api.binomialProportionTest([[1, 2, 3], [3, 2, 1]]))
      .toThrow('Uji proporsi binomial membutuhkan tepat dua kategori hasil.');
  });

  test('menjalankan Uji Kesamaan Proporsi Multinomial untuk minimal tiga kategori hasil', () => {
    const api = loadApi();

    const result = api.multinomialProportionTest([
      [10, 20, 30],
      [20, 15, 25],
    ]);

    expect(result.testType).toBe('multinomial-proportion-homogeneity');
    expect(result.outcomeCategoryCount).toBe(3);
    expect(result.value).toBeCloseTo(4.5021645022, 9);
    expect(() => api.multinomialProportionTest([[1, 2], [2, 1]]))
      .toThrow('Uji proporsi multinomial membutuhkan minimal tiga kategori hasil.');
  });

  test('membentuk tabel kontingensi langsung dari kategori teks dan bobot', () => {
    const api = loadApi();

    const result = api.buildContingencyTable(
      ['B', 'A', 'A'],
      ['Y', 'X', 'Y'],
      [1, 2, 3],
    );

    expect(result).toEqual({
      rowCategories: ['A', 'B'],
      columnCategories: ['X', 'Y'],
      observed: [[2, 3], [0, 1]],
      rowTotals: [5, 1],
      columnTotals: [2, 4],
      total: 6,
      excludedWeight: 0,
    });
  });

  test('merecode kategori menjadi kode sementara berbasis satu tanpa mengubah data asli', () => {
    const api = loadApi();
    const dataAsli = ['SMA', 'SMP', 'SMA', 'SD'];

    expect(api.recodeCategoricalValues).toEqual(expect.any(Function));

    const hasil = api.recodeCategoricalValues(dataAsli);

    expect(Array.from(hasil.codes)).toEqual([1, 2, 1, 3]);
    expect(hasil.categories).toEqual(['SMA', 'SMP', 'SD']);
    expect(dataAsli).toEqual(['SMA', 'SMP', 'SMA', 'SD']);
  });

  test('membersihkan spasi dan mengabaikan kategori kosong saat recode sementara', () => {
    const api = loadApi();
    const result = api.buildContingencyTable(
      [' SMA ', 'SMA', 'SMP', ' SMP ', '', 'SMA'],
      ['Bekerja', ' Tidak bekerja ', 'Bekerja', 'Tidak bekerja', 'Bekerja', '   '],
    );

    expect(result.rowCategories).toEqual(['SMA', 'SMP']);
    expect(result.columnCategories).toEqual(['Bekerja', 'Tidak bekerja']);
    expect(result.observed).toEqual([
      [1, 1],
      [1, 1],
    ]);
    expect(result.total).toBe(4);
    expect(result.excludedWeight).toBe(2);
  });

  test('menerapkan pembulatan bobot setelah frekuensi setiap sel dijumlahkan', () => {
    const api = loadApi();

    const result = api.buildContingencyTable(
      ['x', 'x', 'y'],
      ['a', 'a', 'b'],
      [0.6, 0.6, 0.6],
      'round',
    );

    expect(result.observed).toEqual([[1, 0], [0, 1]]);
    expect(result.rowTotals).toEqual([1, 1]);
    expect(result.columnTotals).toEqual([1, 1]);
    expect(result.total).toBe(2);
  });

  test.each([
    { observed: [[1, 2]], message: 'Matriks observed membutuhkan minimal dua baris.' },
    { observed: [[1, 2], [3]], message: 'Matriks observed harus berbentuk persegi panjang.' },
    { observed: [[1, -2], [3, 4]], message: 'Frekuensi observed harus berupa bilangan berhingga dan tidak negatif.' },
    { observed: [[0, 0], [3, 4]], message: 'Setiap baris dan kolom harus memiliki total lebih dari nol.' },
  ])('menolak matriks yang tidak sah: $message', ({ observed, message }) => {
    const api = loadApi();
    expect(() => api.calculatePearsonChiSquare(observed)).toThrow(message);
  });

  test('menolak alpha di luar interval 0 sampai 1', () => {
    const api = loadApi();
    expect(() => api.calculatePearsonChiSquare([[1, 2], [2, 1]], 1))
      .toThrow('Alpha harus lebih besar dari 0 dan lebih kecil dari 1.');
  });
});
