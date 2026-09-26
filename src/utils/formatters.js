// Display helpers. formatFileSize used to be defined inline inside
// ClientDetailPage; the date formats were repeated as inline toLocaleDateString
// calls in several pages.

export function formatFileSize(size) {
  if (!size) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Never" rather than an em dash, for the last-login column. */
export function formatLastLogin(value) {
  if (!value) return "Never";
  return formatDateTime(value);
}

/** RESIDENTIAL -> Residential, WAREHOUSE_STORAGE -> Warehouse Storage */
export function humanizeEnum(value) {
  if (!value) return "—";
  return String(value)
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The most a peso figure is shown as. Nothing real comes close — the largest
 * possible stock movement is 100,000 × ₱999,999.99 — so anything above it is
 * a bad row (migration 058 stops new ones), shown as a cap rather than as
 * "₱1.1000000000000001e+284T" breaking the layout.
 */
export const PESO_DISPLAY_CAP = 1e15;

/**
 * "₱1,234.50". The one peso formatter: `decimals` fixes the decimal places
 * (default 2); `minDecimals` lets whole amounts drop them ("₱1,234"). A figure
 * that is not a number shows as "₱0.00"; one past PESO_DISPLAY_CAP as "₱999T+".
 */
export function formatPeso(value, { decimals = 2, minDecimals = decimals } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `₱${(0).toFixed(minDecimals)}`;
  if (Math.abs(amount) >= PESO_DISPLAY_CAP) return amount < 0 ? "-₱999T+" : "₱999T+";
  return `₱${amount.toLocaleString(undefined, { minimumFractionDigits: minDecimals, maximumFractionDigits: decimals })}`;
}

/** "Sep 24" — the short form used in lists, rows and chips. */
export function formatShortDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * "1 visit", "3 visits", "0 visits". `many` defaults to `one` + "s"; pass it
 * for irregular words ("1 activity" / "2 activities").
 */
export function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}
