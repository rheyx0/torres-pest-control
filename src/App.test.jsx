import { render, screen } from "@testing-library/react";
import App from "./App";
import { formatInventoryQuantity } from "./utils/formatters";

test("renders the app shell or login page", () => {
  render(<App />);

  expect(
    screen.getByRole("heading", { name: /welcome back|torres pest control/i })
  ).toBeInTheDocument();
});

test("formats extremely large inventory quantities using compact notation", () => {
  expect(formatInventoryQuantity(0)).toBe("0");
  expect(formatInventoryQuantity(999)).toBe("999");
  expect(formatInventoryQuantity(1000000)).toBe("1M");
  expect(formatInventoryQuantity(10000000000)).toBe("10B");
});
