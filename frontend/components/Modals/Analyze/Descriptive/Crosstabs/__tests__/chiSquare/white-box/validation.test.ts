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
});
