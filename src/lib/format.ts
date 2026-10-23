export function formatMoney(value: number, currency = 'USD', opts: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    ...opts,
  }).format(value);
}

export function formatPercent(value: number, digits = 1, signed = false) {
  const s = `${Math.abs(value).toFixed(digits)}%`;
  if (!signed) return value < 0 ? `−${s}` : s;
  return value > 0 ? `+${s}` : value < 0 ? `−${s}` : s;
}

export function formatSigned(value: number, digits = 2) {
  const s = Math.abs(value).toFixed(digits);
  return value > 0 ? `+${s}` : value < 0 ? `−${s}` : s;
}

export function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}
