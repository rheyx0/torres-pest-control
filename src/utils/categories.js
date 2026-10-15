// Chemical or Non-chemical (Sprint 5, migration 075). A service carries its
// category; a visit takes it from its services: Chemical if any of them is
// chemical (people and pets keep away, the crew wears protective gear), and
// Non-chemical only when none is. Clients carry no category (only their
// checkup frequency).

export const SERVICE_CATEGORIES = [
  { value: "CHEMICAL", label: "Chemical" },
  { value: "NON_CHEMICAL", label: "Non-chemical" },
];

export const CHECKUP_FREQUENCIES = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
];

export const categoryLabel = (value) => SERVICE_CATEGORIES.find((entry) => entry.value === value)?.label || "";
export const checkupLabel = (value) => CHECKUP_FREQUENCIES.find((entry) => entry.value === value)?.label || "";

/** "CHEMICAL", "NON_CHEMICAL", or "" when none of the services has a category. */
export function visitCategory(services = []) {
  const known = services.filter(Boolean).map((service) => service.category).filter(Boolean);
  if (!known.length) return "";
  return known.includes("CHEMICAL") ? "CHEMICAL" : "NON_CHEMICAL";
}
