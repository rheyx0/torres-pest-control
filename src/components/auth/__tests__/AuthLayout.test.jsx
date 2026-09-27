import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AuthLayout, { PEST_FACTS } from "../AuthLayout";

const renderLayout = () => render(<MemoryRouter><AuthLayout><p>form</p></AuthLayout></MemoryRouter>);

afterEach(() => jest.useRealTimers());

test("shows one fact, and a dot for each", () => {
  renderLayout();
  expect(screen.getByText(PEST_FACTS[0])).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /Fact \d+ of/ })).toHaveLength(PEST_FACTS.length);
  expect(screen.getByRole("button", { name: `Fact 1 of ${PEST_FACTS.length}` })).toHaveAttribute("aria-current", "true");
});

test("moves to the next fact on its own", () => {
  jest.useFakeTimers();
  renderLayout();
  act(() => { jest.advanceTimersByTime(7000); });
  expect(screen.getByText(PEST_FACTS[1])).toBeInTheDocument();
});

test("a dot jumps straight to its fact", async () => {
  renderLayout();
  await userEvent.click(screen.getByRole("button", { name: `Fact 4 of ${PEST_FACTS.length}` }));
  expect(screen.getByText(PEST_FACTS[3])).toBeInTheDocument();
});

test("pauses while the pointer is over it", () => {
  jest.useFakeTimers();
  renderLayout();
  act(() => { screen.getByText(PEST_FACTS[0]).closest(".auth-facts").dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
  act(() => { jest.advanceTimersByTime(14000); });
  expect(screen.getByText(PEST_FACTS[0])).toBeInTheDocument();
});
