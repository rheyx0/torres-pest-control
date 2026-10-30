import { fireEvent, render, screen } from "@testing-library/react";
import Collapsible from "../Collapsible";

beforeEach(() => window.localStorage.clear());

describe("Collapsible", () => {
  it("starts closed with its summary, and opens on click", () => {
    render(<Collapsible title="This week" summary="12 visits"><p>The chart</p></Collapsible>);
    const toggle = screen.getByRole("button", { name: /This week/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(/12 visits/)).toBeInTheDocument();
    expect(screen.queryByText("The chart")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("The chart")).toBeInTheDocument();
    expect(screen.queryByText(/12 visits/)).not.toBeInTheDocument();
  });

  it("can start open", () => {
    render(<Collapsible title="Filters" defaultOpen><p>Fields</p></Collapsible>);
    expect(screen.getByText("Fields")).toBeInTheDocument();
  });

  it("remembers the choice in this browser", () => {
    const { unmount } = render(<Collapsible title="Billing" storageKey="test-billing"><p>Tiles</p></Collapsible>);
    fireEvent.click(screen.getByRole("button", { name: /Billing/ }));
    unmount();
    render(<Collapsible title="Billing" storageKey="test-billing"><p>Tiles</p></Collapsible>);
    expect(screen.getByText("Tiles")).toBeInTheDocument();
  });
});
