import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders the app shell when Supabase is not configured", () => {
  render(<App />);

  expect(
    screen.getByRole("heading", { name: /supabase configuration required/i })
  ).toBeInTheDocument();
});
