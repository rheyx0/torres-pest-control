import { categoryLabel, visitCategory } from "../categories";

const chem = { id: "s1", category: "CHEMICAL" };
const nonChem = { id: "s2", category: "NON_CHEMICAL" };

test("a visit is Chemical if any of its services is chemical", () => {
  expect(visitCategory([chem])).toBe("CHEMICAL");
  expect(visitCategory([nonChem, chem])).toBe("CHEMICAL");
  expect(visitCategory([nonChem])).toBe("NON_CHEMICAL");
  // Before migration 075 no service has a category: nothing is shown.
  expect(visitCategory([{ id: "s3", category: "" }])).toBe("");
  expect(visitCategory([])).toBe("");
});

test("labels", () => {
  expect(categoryLabel("NON_CHEMICAL")).toBe("Non-chemical");
});
