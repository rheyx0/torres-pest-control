// Pricing (Sprint 3, migration 060).

import { chargeAllEstimate, chargeAllEstimateText, customerPrice, defaultDeposit, describeServicePricing, estimatedTotal, includedMaterialsText, itemMargin, materialCharge, quoteMaterialEstimate, servicePrice } from "../pricing";
import { formatPeso } from "../formatters";

describe("customerPrice and itemMargin", () => {
  it("marks up the internal cost", () => {
    expect(customerPrice({ cost: 100, priceMode: "MARKUP", markupPercent: 30 })).toBe(130);
    expect(customerPrice({ cost: 100, priceMode: "MARKUP", markupPercent: 0 })).toBe(100);
  });

  it("uses a fixed price when set, whatever the cost", () => {
    expect(customerPrice({ cost: 100, priceMode: "FIXED", customerPrice: 250 })).toBe(250);
  });

  it("measures profit against the cost, never billing the cost itself", () => {
    expect(itemMargin({ cost: 100, priceMode: "FIXED", customerPrice: 250 })).toEqual({ price: 250, profit: 150, percent: 60 });
    expect(itemMargin({ cost: 300, priceMode: "FIXED", customerPrice: 250 }).profit).toBe(-50);
  });
});

describe("servicePrice", () => {
  const flat = { pricingMode: "FLAT", defaultPrice: 2500 };
  const termite = { pricingMode: "AREA", areaRate: 50, minimumCharge: 3000 };

  it("charges a flat service its price", () => {
    expect(servicePrice(flat)).toBe(2500);
    expect(servicePrice({ pricingMode: "FLAT", defaultPrice: null })).toBeNull();
  });

  it("charges an area service area × rate, never below its minimum", () => {
    expect(servicePrice(termite, 100)).toBe(5000);
    expect(servicePrice(termite, 20)).toBe(3000);
  });

  it("cannot price an area service without an area", () => {
    expect(servicePrice(termite, "")).toBeNull();
    expect(servicePrice(termite, 0)).toBeNull();
  });
});

describe("materialCharge", () => {
  const chemical = { cost: 200, priceMode: "MARKUP", markupPercent: 50 }; // ₱300 to the client

  it("bills only what is used beyond the included quantity, at the customer price", () => {
    const rule = { defaultAmount: 2, billingMode: "EXTRA_CHARGED" };
    expect(materialCharge(rule, 3, chemical)).toEqual({ extraQuantity: 1, unitPrice: 300, amount: 300 });
    expect(materialCharge(rule, 1.5, chemical).amount).toBe(0);
  });

  it("bills nothing for an included material, however much is used", () => {
    expect(materialCharge({ defaultAmount: 2, billingMode: "INCLUDED" }, 10, chemical).amount).toBe(0);
  });
});

describe("defaults and wording", () => {
  it("works out the default down payment from the service's percent", () => {
    expect(defaultDeposit({ depositPercent: 50 }, 10000)).toBe(5000);
    expect(defaultDeposit({ depositPercent: 0 }, 10000)).toBe(0);
  });

  it("describes how a service is priced", () => {
    expect(describeServicePricing({ pricingMode: "AREA", areaRate: 50, minimumCharge: 3000 }, formatPeso)).toBe("₱50 / sqm, min ₱3,000");
    expect(describeServicePricing({ pricingMode: "FLAT", defaultPrice: 2500 }, formatPeso)).toBe("₱2,500");
  });
});

describe("includedMaterialsText", () => {
  const items = { i1: { id: "i1", name: "Demand CS Residual Spray", unit: "L" }, i2: { id: "i2", name: "Rodent Bait Blocks", unit: "pack" } };
  const itemById = (id) => items[id] || null;

  test("lists what the service's price covers", () => {
    const service = { materials: [{ itemId: "i1", defaultAmount: 1, billingMode: "INCLUDED" }, { itemId: "i2", defaultAmount: 2, billingMode: "INCLUDED" }] };
    expect(includedMaterialsText(service, itemById)).toBe("includes 1 L Demand CS Residual Spray, 2 pack Rodent Bait Blocks");
  });

  test("says when extra use is charged", () => {
    const service = { materials: [{ itemId: "i1", defaultAmount: 1, billingMode: "EXTRA_CHARGED" }] };
    expect(includedMaterialsText(service, itemById)).toBe("includes 1 L Demand CS Residual Spray · extra use charged");
  });

  test("nothing for a service without materials, or with unknown items", () => {
    expect(includedMaterialsText({ materials: [] }, itemById)).toBe("");
    expect(includedMaterialsText({ materials: [{ itemId: "gone", defaultAmount: 1 }] }, itemById)).toBe("");
    expect(includedMaterialsText(null, itemById)).toBe("");
  });
});

// A Charge all material is shown on a quotation as an estimate, never a line.
describe("charge all estimate", () => {
  const termidor = { id: "i1", name: "Termidor SC", unit: "L", priceMode: "FIXED", customerPrice: 1200 };
  const items = { i1: termidor };
  const service = { id: "s1", materials: [
    { itemId: "i1", defaultAmount: 8, billingMode: "CHARGE_ALL" },
    { itemId: "i2", defaultAmount: 2, billingMode: "INCLUDED" },
  ] };
  const byId = (id) => items[id];

  test("the service's usual amount at the customer price", () => {
    expect(chargeAllEstimate(service, byId)).toEqual([{ itemId: "i1", name: "Termidor SC", unit: "L", amount: 8, unitPrice: 1200, total: 9600 }]);
    expect(chargeAllEstimateText(service, byId)).toBe("Estimate: Termidor SC about 8 L × ₱1,200.00 = ₱9,600.00, charged by actual use");
    expect(chargeAllEstimateText({ materials: [{ itemId: "i1", defaultAmount: 8, billingMode: "EXTRA_CHARGED" }] }, byId)).toBe("");
  });

  test("added up over the quote's service lines, with VAT when it is added on top", () => {
    const lines = [{ kind: "SERVICE", serviceId: "s1", quantity: 2 }, { kind: "EXTRA", quantity: 1 }];
    const estimate = quoteMaterialEstimate(lines, () => service, byId);
    expect(estimate).toBe(19200);
    expect(estimatedTotal({ total: 10000, vatMode: "ADDED", vatRate: 12 }, estimate)).toBe(31504);
    expect(estimatedTotal({ total: 10000, vatMode: "NONE" }, estimate)).toBe(29200);
  });
});
