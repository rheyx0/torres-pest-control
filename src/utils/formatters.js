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
