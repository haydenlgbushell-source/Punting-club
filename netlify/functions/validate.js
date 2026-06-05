// netlify/functions/validate.js — shared input validation helpers (CommonJS)
'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns null if valid, or an error string if invalid.
 */

const isUUID = (v) =>
  v && UUID_RE.test(String(v)) ? null : 'Must be a valid UUID.';

const isEnum = (v, allowed) =>
  allowed.includes(v) ? null : `Must be one of: ${allowed.join(', ')}.`;

const isString = (v, { min = 1, max = 255, label = 'Value', required = true } = {}) => {
  if (!v && !required) return null;
  if (!v || typeof v !== 'string') return `${label} is required.`;
  const t = v.trim();
  if (t.length < min) return `${label} must be at least ${min} character${min > 1 ? 's' : ''}.`;
  if (t.length > max) return `${label} must be ${max} characters or fewer.`;
  return null;
};

const isPositiveInt = (v, { max = 1_000_000, label = 'Amount' } = {}) => {
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  if (isNaN(n) || n <= 0) return `${label} must be a positive number.`;
  if (n > max)            return `${label} must be ${max.toLocaleString()} or less.`;
  return null;
};

const isPositiveFloat = (v, { max = 1_000, min = 1.01, label = 'Odds' } = {}) => {
  const n = parseFloat(v);
  if (isNaN(n) || n < min) return `${label} must be at least ${min}.`;
  if (n > max)             return `${label} must be ${max} or less.`;
  return null;
};

const isEmail = (v, { required = false } = {}) => {
  if (!v && !required) return null;
  if (!v) return 'Email is required.';
  if (!EMAIL_RE.test(String(v).trim())) return 'Invalid email address.';
  return null;
};

const isDate = (v, { required = false, label = 'Date' } = {}) => {
  if (!v && !required) return null;
  if (!v) return `${label} is required.`;
  if (!DATE_RE.test(String(v))) return `${label} must be in YYYY-MM-DD format.`;
  return null;
};

/**
 * Removes any keys not in `allowed` from an updates object.
 * Returns { clean, rejected } — rejected is an array of stripped keys.
 */
const sanitizeUpdates = (updates, allowed) => {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return { clean: {}, rejected: [] };
  }
  const clean = {};
  const rejected = [];
  for (const key of Object.keys(updates)) {
    if (allowed.includes(key)) {
      clean[key] = updates[key];
    } else {
      rejected.push(key);
    }
  }
  return { clean, rejected };
};

/**
 * Collects an array of [errorString | null] and returns the first error, or null.
 */
const firstError = (...results) => results.find(r => r !== null) || null;

module.exports = { isUUID, isEnum, isString, isPositiveInt, isPositiveFloat, isEmail, isDate, sanitizeUpdates, firstError };
