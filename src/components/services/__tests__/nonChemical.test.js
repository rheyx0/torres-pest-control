import { validateServiceForm } from "../ServiceProfilesAdmin";

const items = { i1: { id: "i1", name: "Demand CS 2.5", type: "CHEMICAL" }, i2: { id: "i2", name: "Glue Board Trap", type: "MATERIAL" } };
const form = (category, itemId) => ({ name: "Glue board trapping", category, pricingMode: "FLAT", defaultPrice: "1500", defaultDurationMinutes: "60", depositPercent: 0, followUpPrice: "", materials: [{ itemId, defaultAmount: "2" }] });

test("a non-chemical service can't list a chemical", () => {
  expect(validateServiceForm(form("NON_CHEMICAL", "i1"), [], null, (id) => items[id]).materials).toMatch(/Remove Demand CS 2.5 first/);
  expect(validateServiceForm(form("NON_CHEMICAL", "i2"), [], null, (id) => items[id]).materials).toBeUndefined();
  expect(validateServiceForm(form("CHEMICAL", "i1"), [], null, (id) => items[id]).materials).toBeUndefined();
});
