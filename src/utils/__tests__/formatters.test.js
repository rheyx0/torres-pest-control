import { formatDateTime, formatLastLogin, formatPeso, formatShortDate, plural } from "../formatters";
import { peso, pesoCompact } from "../dashboardMetrics";

// Migration 058: a bad row must never print "₱1.1000000000000001e+284T".
describe("formatPeso", () => {
  it("formats pesos, two decimals unless asked", () => {
    expect(formatPeso(1234.5)).toBe("₱1,234.50");
    expect(formatPeso(1234.5, { minDecimals: 0 })).toBe("₱1,234.5");
    expect(formatPeso(1234, { minDecimals: 0 })).toBe("₱1,234");
    expect(formatPeso(1234.56, { decimals: 0 })).toBe("₱1,235");
  });

  it("caps an impossible figure instead of printing it", () => {
    expect(formatPeso(1.1e284)).toBe("₱999T+");
    expect(formatPeso(-1e20)).toBe("-₱999T+");
    expect(formatPeso(Infinity)).toBe("₱0.00");
    expect(formatPeso("not a number")).toBe("₱0.00");
  });

  it("is what the dashboard's compact figures fall back on", () => {
    expect(pesoCompact(1.1e284)).toBe("₱999T+");
    expect(pesoCompact(1.94e9)).toBe("₱1.94B");
    expect(pesoCompact(5550)).toBe("₱5,550");
    expect(peso(1e22)).toBe("₱999T+");
  });
});

describe("plural", () => {
  it.each([
    [0, "0 visits"],
    [1, "1 visit"],
    [2, "2 visits"],
  ])("counts %i", (count, expected) => {
    expect(plural(count, "visit")).toBe(expected);
  });

  it("takes an irregular plural", () => {
    expect(plural(3, "activity", "activities")).toBe("3 activities");
    expect(plural(1, "activity", "activities")).toBe("1 activity");
  });
});

describe("date helpers", () => {
  const value = "2026-09-24T08:00:05";

  // The Users page used to print "9/24/2026, 8:00:05 AM".
  it("never shows seconds", () => {
    expect(formatDateTime(value)).not.toMatch(/:05/);
    expect(formatLastLogin(value)).not.toMatch(/:05/);
  });

  it("formats a short date with no year", () => {
    expect(formatShortDate(value)).toMatch(/Sep/);
    expect(formatShortDate(value)).not.toMatch(/2026/);
  });

  it("falls back for empty values", () => {
    expect(formatShortDate("")).toBe("—");
    expect(formatLastLogin(null)).toBe("Never");
  });
});
