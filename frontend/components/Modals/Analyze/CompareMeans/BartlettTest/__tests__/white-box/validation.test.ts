import { getBartlettSelectionError } from '../../utils/validation';

describe('Bartlett selection validation', () => {
  it('requires at least one test variable', () => {
    expect(getBartlettSelectionError(0, true)).toBe('Please select at least one test variable');
  });

  it('requires one grouping variable', () => {
    expect(getBartlettSelectionError(1, false)).toBe('Please select a grouping variable');
  });

  it('accepts a complete selection', () => {
    expect(getBartlettSelectionError(1, true)).toBeNull();
  });
});
