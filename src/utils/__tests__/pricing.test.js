// Pricing (Sprint 3, migration 060).

import { customerPrice, defaultDeposit, describeServicePricing, itemMargin, materialCharge, servicePrice } from "../pricing";
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
