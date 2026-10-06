import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';

/**
 * Shared date formatting utilities for SuperAdmin.
 * Uses date-fns for consistent formatting across all pages.
 */

/** Parse a date value from API (string or Date) */
function parse(date) {
  if (!date) return null;
  const d = typeof date === 'string' ? parseISO(date) : new Date(date);
  return isValid(d) ? d : null;
}

/** Full date: "Mar 22, 2026" */
export function formatDate(date) {
  const d = parse(date);
  return d ? format(d, 'MMM d, yyyy') : '—';
}

/** Date + time: "Mar 22, 2026 2:30 PM" */
export function formatDateTime(date) {
  const d = parse(date);
  return d ? format(d, 'MMM d, yyyy h:mm a') : '—';
}

/** Relative: "3 hours ago" */
export function formatRelative(date) {
  const d = parse(date);
  return d ? formatDistanceToNow(d, { addSuffix: true }) : '—';
}

/** Short date: "22/03/2026" */
export function formatDateShort(date) {
  const d = parse(date);
  return d ? format(d, 'dd/MM/yyyy') : '—';
}

/** Month + Year: "March 2026" */
export function formatMonthYear(date) {
  const d = parse(date);
  return d ? format(d, 'MMMM yyyy') : '—';
}
