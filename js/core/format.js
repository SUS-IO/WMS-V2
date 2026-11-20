// Formatting + small utilities
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const D = (v) => (v instanceof Date ? v : new Date(v));
const valid = (d) => d instanceof Date && !isNaN(d);

export function fmtDate(v) {
  if (!v) return '—';
  const d = D(v); if (!valid(d)) return '—';
  return `${pad(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}
export function fmtTime(v) {
  if (!v) return '—';
  const d = D(v); if (!valid(d)) return '—';
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${pad(h)}:${pad(d.getMinutes())} ${ap}`;
}
export function fmtDateTime(v) {
  if (!v) return '—';
  const d = D(v); if (!valid(d)) return '—';
  return `${fmtDate(d)}, ${fmtTime(d)}`;
}
export function fmtDay(v) {
  const d = D(v); const t = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
export const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

// <input type="datetime-local"> helpers (local time)
export function toLocalInput(v) {
  const d = v ? D(v) : new Date();
  if (!valid(d)) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (s) => (s ? new Date(s).toISOString() : null);
export const toDateInput = (v) => (v ? toLocalInput(v).slice(0, 10) : '');

export function fmtNum(n, dp = 3) {
  if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: dp });
}
export function fmtMoney(n) {
  if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmtDuration(ms) {
  if (!ms || ms < 0) return '0h 00m';
  const m = Math.round(ms / 60000);
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}
export function hoursBetween(a, b) { return Math.max(0, (new Date(b) - new Date(a)) / 3600000); }

// Quantity (stored in base unit) shown with the issue-unit equivalent when the pack size is not 1
export function fmtQty(p, baseQty) {
  if (!p) return fmtNum(baseQty);
  const base = `${fmtNum(baseQty)} ${p.base_uom || ''}`.trim();
  if (Number(p.pack_qty) > 1 && Number(baseQty) !== 0) {
    return `${base} (${fmtNum(Number(baseQty) / Number(p.pack_qty), 2)} ${p.uom})`;
  }
  return base;
}

export function timeAgo(v) {
  const d = D(v); const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d);
}
export const daysSince = (v) => Math.floor((Date.now() - D(v).getTime()) / 86400000);

export const ROLE_LABEL = {
  admin: 'Administrator', workshop_manager: 'Workshop Manager', workshop_supervisor: 'Workshop Supervisor', store_user: 'Store User', viewer: 'Viewer (read-only)',
  dept_user: 'Department User', dept_manager: 'Department Manager', purchase_user: 'Purchase User', purchase_manager: 'Purchase Manager',
};
export const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

export function debounce(fn, ms = 300) {
  let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t); d.flush = (...a) => { clearTimeout(t); return fn(...a); };
  return d;
}

// natural comparison used by tables
export function cmp(a, b) {
  const an = a === null || a === undefined || a === '', bn = b === null || b === undefined || b === '';
  if (an && bn) return 0; if (an) return 1; if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export const num = (v, d = 0) => { const n = parseFloat(v); return isNaN(n) ? d : n; };
export const round = (n, dp = 3) => Math.round((Number(n) + Number.EPSILON) * 10 ** dp) / 10 ** dp;

export function downloadFile(name, content, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export function toCSV(rows) {
  return rows.map((r) => r.map((c) => { const s = c === null || c === undefined ? '' : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
}

/* ------------------------------------------------------------------ amount in words (Purchase documents) */
export const CURRENCIES = {
  INR: { symbol: '₹', major: 'Rupees', minor: 'Paise', indian: true }, USD: { symbol: '$', major: 'US Dollars', minor: 'Cents' },
  EUR: { symbol: '€', major: 'Euros', minor: 'Cents' }, GBP: { symbol: '£', major: 'Pounds', minor: 'Pence' },
  AED: { symbol: 'AED ', major: 'UAE Dirhams', minor: 'Fils' }, SAR: { symbol: 'SAR ', major: 'Saudi Riyals', minor: 'Halalas' },
  SGD: { symbol: 'S$', major: 'Singapore Dollars', minor: 'Cents' }, JPY: { symbol: '¥', major: 'Yen', minor: 'Sen' }, CNY: { symbol: 'CN¥', major: 'Yuan', minor: 'Fen' },
};
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
const below1000 = (n) => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + below100(n % 100) : '') : below100(n));
function intWords(n, indian) {
  if (n === 0) return 'Zero';
  const parts = [];
  const units = indian ? [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']] : [[1000000000, 'Billion'], [1000000, 'Million'], [1000, 'Thousand']];
  for (const [v, name] of units) { if (n >= v) { const q = Math.floor(n / v); parts.push((indian && q >= 100 ? intWords(q, true) : below1000(q)) + ' ' + name); n %= v; } }
  if (n > 0) parts.push(below1000(n));
  return parts.join(' ');
}
export function amountInWords(amount, cur = 'INR') {
  const c = CURRENCIES[cur] || CURRENCIES.INR; const v = Math.round((Math.abs(Number(amount) || 0) + Number.EPSILON) * 100);
  const major = Math.floor(v / 100); const minor = v % 100;
  return `${c.major} ${intWords(major, !!c.indian)}${minor ? ` and ${intWords(minor, false)} ${c.minor}` : ''} Only`;
}
export const fmtAmt = (n, cur = 'INR') => (n === null || n === undefined || n === '' || isNaN(n) ? '—' : (CURRENCIES[cur]?.symbol || '') + Number(n).toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
