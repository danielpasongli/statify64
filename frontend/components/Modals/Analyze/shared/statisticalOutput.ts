export const DEFAULT_ALPHA = 0.05;

export const formatNumber = (
  value: number | null | undefined,
  decimals = 3,
): string => Number.isFinite(value) ? (value as number).toFixed(decimals) : '';

export const formatPValue = (value: number | null | undefined): string => {
  if (!Number.isFinite(value)) return '';
  return (value as number) < 0.001 ? '<.001' : (value as number).toFixed(3);
};

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
}[character] as string));
