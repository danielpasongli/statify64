"""Verifikasi independen normalitas; hanya untuk pengujian, bukan aplikasi.

Dependensi pengujian: scipy; openpyxl jika argumen lokasi workbook diberikan.
Jalankan: python verify-scipy-reference.py [lokasi_Dataset_Demo_Statify.xlsx]
Hasil JSON memuat ringkasan numerik, tanpa menyalin data penelitian.
"""
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
import scipy
from scipy import stats


engine = Path(__file__).resolve().parents[1] / 'normalityTests.js'
rng = np.random.default_rng(20261004)
cases = []
for n in [3, 4, 5, 6, 11, 12, 50, 500, 2000, 4999, 5000]:
    for name, data in [('normal', rng.normal(size=n)),
                       ('eksponensial', rng.exponential(size=n)),
                       ('ties', np.arange(n) % 3)]:
        cases.append({'name': f'{name}-{n}', 'data': data.tolist()})

for case in json.loads((engine.parent / '__tests__' / 'spss-benchmark-datasets.json').read_text())['datasets']:
    cases.append({'name': case['id'], 'data': case['data']})

if len(sys.argv) > 1:
    from openpyxl import load_workbook
    workbook = load_workbook(sys.argv[1], read_only=True, data_only=True)
    records = iter(workbook.active.values)
    header = next(records)
    rows = list(records)
    department = header.index('Department')
    for column, hr_only in [('Age', False), ('MonthlyIncome', False),
                            ('Age', True), ('HourlyRate', True)]:
        index = header.index(column)
        data = [row[index] for row in rows
                if isinstance(row[index], (int, float))
                and (not hr_only or row[department] == 'Human Resources')]
        cases.append({'name': column + ('-HR' if hr_only else ''), 'data': data})
    workbook.close()

node_script = r'''
const fs = require('fs');
const vm = require('vm');
const context = vm.createContext({console: {log() {}, warn() {}, error() {}}});
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), context);
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
const results = cases.map(({data}) => ({
    sw: context.calculateShapiroWilk(data),
    ks: context.calculateKolmogorovSmirnov(data),
}));
const tails = Array.from({length: 371}, (_, i) => context.normalityCDF(-i / 10));
process.stdout.write(JSON.stringify({results, tails}));
'''
process = subprocess.run(['node', '-e', node_script, str(engine)],
                         input=json.dumps(cases), text=True, capture_output=True, check=True)
actual = json.loads(process.stdout)
summary = []
for case, result in zip(cases, actual['results']):
    data = np.asarray(case['data'], dtype=float)
    reference = stats.shapiro(data)
    ordered = np.sort(data)
    cdf = stats.norm.cdf((ordered - data.mean()) / data.std(ddof=1))
    n = len(data)
    ks_d = max(np.max(np.arange(1, n + 1) / n - cdf),
               np.max(cdf - np.arange(n) / n))
    w_error = abs(result['sw']['statistic'] - reference.statistic)
    p_error = abs(result['sw']['pValue'] / reference.pvalue - 1)
    d_error = abs(result['ks']['statistic'] - ks_d)
    assert w_error < 1e-7, (case['name'], 'W', w_error)
    assert p_error < 1e-5, (case['name'], 'p', p_error)
    assert d_error < 5e-13, (case['name'], 'D', d_error)
    summary.append({'name': case['name'], 'n': n,
                    'W': result['sw']['statistic'], 'W_reference': float(reference.statistic),
                    'p': result['sw']['pValue'], 'p_reference': float(reference.pvalue),
                    'relative_p_error': p_error, 'absolute_D_error': float(d_error)})

tail_error = max(abs(value / stats.norm.sf(i / 10) - 1)
                 for i, value in enumerate(actual['tails']))
assert tail_error < 5e-12, ('normal SF', tail_error)
print(json.dumps({'scipy_version': scipy.__version__, 'cases_checked': len(cases),
                  'max_relative_tail_error': float(tail_error),
                  'max_relative_p_error': float(max(r['relative_p_error'] for r in summary)),
                  'results': summary}, indent=2))
