import { DEFAULT_ALPHA, escapeHtml, formatNumber, formatPValue } from '../statisticalOutput';

describe('statistical output helpers', () => {
  it('uses a single default significance level', () => {
    expect(DEFAULT_ALPHA).toBe(0.05);
  });

  it('formats finite numbers and missing values consistently', () => {
    expect(formatNumber(1.23456)).toBe('1.235');
    expect(formatNumber(1.23456, 2)).toBe('1.23');
    expect(formatNumber(null)).toBe('');
    expect(formatNumber(Number.NaN)).toBe('');
  });

  it('formats small p-values consistently', () => {
    expect(formatPValue(0.0004)).toBe('<.001');
    expect(formatPValue(0.001)).toBe('0.001');
    expect(formatPValue(null)).toBe('');
  });

  it('escapes user-controlled labels before inserting them into HTML', () => {
    expect(escapeHtml('<b>A & B</b>')).toBe('&lt;b&gt;A &amp; B&lt;/b&gt;');
  });
});
