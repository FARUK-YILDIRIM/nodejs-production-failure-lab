import { badRequest } from './http-errors.ts';

const DIGITS = /^\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function positiveInt(value: unknown, field: string): number {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' && DIGITS.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw badRequest(`${field} must be a positive integer`);
  return parsed;
}

export function optionalIntInRange(
  value: unknown,
  field: string,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  if (value === undefined || value === '') return fallback;
  const parsed = positiveInt(value, field);
  if (parsed < min || parsed > max) throw badRequest(`${field} must be between ${min} and ${max}`);
  return parsed;
}

/** Parses a calendar date (YYYY-MM-DD) as midnight UTC. */
export function isoDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) throw badRequest(`${field} must be a date (YYYY-MM-DD)`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw badRequest(`${field} is not a valid date`);
  }
  return date;
}
