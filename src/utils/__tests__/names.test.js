import { validateClientName, validatePersonName } from "../validators";

describe("name rules", () => {
  it("accepts real names with periods, hyphens, apostrophes and ñ", () => {
    ["Juan Dela Cruz", "Ma. Santos-Reyes", "O'Neil", "Peñaflor"].forEach((name) => expect(validatePersonName(name)).toBeNull());
  });

  it("refuses digits and symbols in a person's name", () => {
    ["Juan123", "Juan@Cruz", "Juan_Cruz", "#Juan"].forEach((name) => expect(validatePersonName(name, { label: "Full name" })).toMatch(/Full name can only have letters/));
    expect(validatePersonName("  ", { label: "First name" })).toBe("First name is required.");
  });

  it("lets a client (a business) have digits and &, but no other symbols", () => {
    expect(validateClientName("J&J 24 Hours Bakery")).toBeNull();
    expect(validateClientName("Arawan Logistics Center")).toBeNull();
    expect(validateClientName("Arawan <script>")).toMatch(/Client name can only have/);
    expect(validateClientName("Juan@Cruz")).toMatch(/Client name can only have/);
  });
});
