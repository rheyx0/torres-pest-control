// The built-in services (migration 084): Checkup, Follow-up Visit and
// Inspection drive features, so each carries a fixed tag (services.system_key)
// and cannot be renamed, retired or deleted. Found by the tag; before 084 (no
// tags at all) by the name, as the app always did.

export const SYSTEM_SERVICE_KEYS = { CHECKUP: "CHECKUP", FOLLOW_UP: "FOLLOW_UP", INSPECTION: "INSPECTION" };

export const SYSTEM_SERVICE_LABELS = {
  CHECKUP: "Used for warranty checkups",
  FOLLOW_UP: "Used for follow-up visits",
  INSPECTION: "Used for inspections",
};

const NAME_PATTERNS = {
  CHECKUP: /check[\s-]?up/i,
  FOLLOW_UP: /follow[\s-]?up/i,
  INSPECTION: /inspect/i,
};

export const isSystemService = (service) => Boolean(service?.systemKey);

/** Whether `service` plays the part `key`: by its tag, or by name before 084. */
export function servicePlays(service, key, services = []) {
  if (!service) return false;
  if (service.systemKey) return service.systemKey === key;
  // A catalog that has tags: an untagged service plays no part.
  if (services.some((entry) => entry.systemKey)) return false;
  return NAME_PATTERNS[key].test(service.name || "");
}

/** The active service that plays `key`, or null. */
export function findSystemService(services = [], key) {
  return services.find((service) => service.isActive !== false && servicePlays(service, key, services)) || null;
}
