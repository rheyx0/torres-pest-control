import {
  conversionFactor,
  convertAmount,
  convertUnitPrice,
  convertibleUnits,
  describeConversion,
  dimensionOf,
  normalizeUnit,
} from "../units";

describe("normalizeUnit", () => {
  it("accepts the spellings people actually type", () => {
    expect(normalizeUnit("L")).toBe("L");
    expect(normalizeUnit(" litres ")).toBe("L");
    expect(normalizeUnit("Gallons")).toBe("gal");
    expect(normalizeUnit("KG")).toBe("kg");
  });

  it("returns empty for a unit it cannot convert", () => {
    ["pcs", "boxes", "sachets", "", null, undefined].forEach((unit) => {
      expect(normalizeUnit(unit)).toBe("");
    });
  });
});

describe("dimensionOf / convertibleUnits", () => {
  it("groups volume and mass separately", () => {
    expect(dimensionOf("gal").base).toBe("mL");
    expect(dimensionOf("lb").base).toBe("g");
  });

  // Count units are the signal to hide the picker entirely: there is nothing
  // honest to convert two boxes into.
  it("offers nothing for a count unit", () => {
    expect(convertibleUnits("pcs")).toEqual([]);
    expect(dimensionOf("pcs")).toBeNull();
  });

  it("lists the item's own unit first", () => {
    expect(convertibleUnits("L")[0]).toBe("L");
    expect(convertibleUnits("L")).toEqual(expect.arrayContaining(["mL", "gal", "qt", "fl oz"]));
  });
});

describe("conversionFactor", () => {
  it("is 1 between a unit and itself, however it was spelled", () => {
    expect(conversionFactor("litres", "L")).toBe(1);
  });

  it("converts within a dimension", () => {
    expect(conversionFactor("L", "mL")).toBe(1000);
    expect(conversionFactor("kg", "g")).toBe(1000);
  });

  // Null rather than a fallback of 1: silently treating a gallon as a kilogram
  // would put a wrong number into a stock level instead of refusing visibly.
  it("refuses across dimensions and for units it does not know", () => {
    expect(conversionFactor("gal", "kg")).toBeNull();
    expect(conversionFactor("gal", "boxes")).toBeNull();
    expect(conversionFactor("", "L")).toBeNull();
  });
});

describe("convertAmount", () => {
  it("converts the gallons-to-litres case this exists for", () => {
    expect(convertAmount(5, "gal", "L")).toBe(18.9271);
  });

  it("rounds to four decimals, matching stock_in_batch()", () => {
    expect(convertAmount(1, "gal", "L")).toBe(3.7854);
    expect(convertAmount(2.5, "lb", "kg")).toBe(1.134);
  });

  it("passes a same-unit amount straight through", () => {
    expect(convertAmount(6, "L", "L")).toBe(6);
  });

  it("returns null for an unusable amount or unit pair", () => {
    expect(convertAmount("", "gal", "L")).toBeNull();
    expect(convertAmount("abc", "gal", "L")).toBeNull();
    expect(convertAmount(5, "gal", "kg")).toBeNull();
  });
});

describe("describeConversion", () => {
  it("spells out the arithmetic the staff member would otherwise do", () => {
    expect(describeConversion(5, "gal", "L")).toBe("5 gal = 18.9271 L");
  });

  it("says nothing when no conversion is happening", () => {
    expect(describeConversion(5, "L", "L")).toBe("");
    expect(describeConversion(5, "gal", "pcs")).toBe("");
  });
});

// Stock In: changing the unit received in converts the price typed so far.
describe("convertUnitPrice", () => {
  test("re-expresses a price per another unit, rounded to centavos", () => {
    expect(convertUnitPrice(1000, "L", "gal")).toBe(3785.41);
    expect(convertUnitPrice(3785.41, "gal", "L")).toBe(1000);
    expect(convertUnitPrice(100, "L", "mL")).toBe(0.1);
  });
  test("keeps 4 decimals under ₱1, so a small price isn't doubled by rounding", () => {
    expect(convertUnitPrice(5, "L", "mL")).toBe(0.005);
  });
  test("nothing for a blank price or units that can't be compared", () => {
    expect(convertUnitPrice("", "L", "gal")).toBeNull();
    expect(convertUnitPrice(100, "L", "kg")).toBeNull();
  });
});
