/**
 * @fileoverview Amount formatting helpers for wallet UI.
 */

const DEFAULT_DISPLAY_DECIMALS = 8;

export const formatDecimal = (value: number, decimals: number) =>
  value
    .toFixed(decimals)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');

export const formatTokenAmountDisplay = (
  value: string | number,
  decimals: number = DEFAULT_DISPLAY_DECIMALS
) => {
  // Handle number inputs by converting to string
  const strValue = typeof value === 'number' ? String(value) : (value ?? '');
  const sanitized = strValue.trim();
  if (!sanitized) return '';
  const numeric = Number(sanitized);
  if (!Number.isFinite(numeric)) return value;
  if (numeric === 0) return '0';

  const minShown = Math.pow(10, -decimals);
  if (numeric > 0 && numeric < minShown) {
    return `<${formatDecimal(minShown, decimals)}`;
  }

  return formatDecimal(numeric, decimals);
};
