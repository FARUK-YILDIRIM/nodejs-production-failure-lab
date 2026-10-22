/** Formats an amount in cents for display, e.g. 123456 → "$1,234.56". */
export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
