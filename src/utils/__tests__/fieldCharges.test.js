import { chargeKind, laborLine, laborParts, transportLine, updateCharge } from "../fieldCharges";
import { lineAmount } from "../billing";

test("transportation is km × rate per km", () => {
  const line = transportLine(25, 20);
  expect(line).toMatchObject({ kind: "EXTRA", unit: "km", description: "Transportation (25 km)", quantity: "25", unitPrice: "20" });
  expect(lineAmount(line)).toBe(500);
  expect(chargeKind(line)).toBe("TRANSPORT");
  expect(updateCharge(line, { quantity: "40" })).toEqual({ quantity: "40", description: "Transportation (40 km)" });
});

test("labor is technicians × days × daily rate", () => {
  const line = laborLine(3, 2, 1000);
  expect(line).toMatchObject({ unit: "technician-day", description: "Labor (3 technicians × 2 days)", quantity: "6" });
  expect(lineAmount(line)).toBe(6000);
  expect(chargeKind(line)).toBe("LABOR");
  expect(updateCharge(line, { days: "3" })).toMatchObject({ quantity: "9", description: "Labor (3 technicians × 3 days)" });
  // A saved line, read back without its parts, recovers them from the description.
  expect(laborParts({ kind: "EXTRA", unit: "technician-day", description: "Labor (1 technician × 4 days)", quantity: 4 })).toEqual({ technicians: "1", days: "4" });
});

test("other lines are not field charges", () => {
  expect(chargeKind({ kind: "EXTRA", unit: "job" })).toBeNull();
  expect(chargeKind({ kind: "SERVICE", unit: "km" })).toBeNull();
});
