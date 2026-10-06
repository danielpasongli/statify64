import { evaluateExpectedCountAssumption } from '@/components/Modals/Analyze/Descriptive/Crosstabs/utils/chiSquare/validation';

describe('expected-count assumption', () => {
  it('accepts diagnostics at the 20 percent boundary', () => {
    expect(evaluateExpectedCountAssumption({
      minExpectedCount: 1,
      cellsUnder5: 2,
      totalCells: 10,
      percentCellsUnder5: 20,
    }).valid).toBe(true);
  });

  it('rejects zero expected counts', () => {
    expect(evaluateExpectedCountAssumption({
      minExpectedCount: 0,
      cellsUnder5: 1,
      totalCells: 4,
      percentCellsUnder5: 25,
    }).valid).toBe(false);
  });

  it('rejects a minimum expected count below 1 (Cochran, 1954)', () => {
    const assessment = evaluateExpectedCountAssumption({
      minExpectedCount: 0.5,
      cellsUnder5: 1,
      totalCells: 10,
      percentCellsUnder5: 10,
    });
    expect(assessment.valid).toBe(false);
    expect(assessment.text).toContain('tidak terpenuhi');
  });

  it('states the minimum of 1 when the assumption holds', () => {
    expect(evaluateExpectedCountAssumption({
      minExpectedCount: 1,
      cellsUnder5: 0,
      totalCells: 4,
      percentCellsUnder5: 0,
    }).text).toContain('paling sedikit 1');
  });
});
