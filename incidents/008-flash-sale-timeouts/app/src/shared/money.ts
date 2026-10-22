// Building an Intl.NumberFormat is expensive (locale data, option resolution);
// formatting with an existing one is cheap. Keep one per currency.
const formatters = new Map<string, Intl.NumberFormat>();

/** Formats an amount in cents for display, e.g. 123456 → "$1,234.56". */
export function formatMoney(cents: number, currency = 'USD'): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency });
    formatters.set(currency, formatter);
  }
  return formatter.format(cents / 100);
}
