import { render, screen, within } from "@testing-library/react";
import CalendarLegend from "../CalendarLegend";

describe("CalendarLegend", () => {
  it("names all five statuses in words, not just colours", () => {
    render(<CalendarLegend />);

    const legend = screen.getByRole("list", { name: "Legend" });
    ["Confirmed", "Pending", "Reschedule", "Completed", "Cancel"].forEach((status) => {
      expect(within(legend).getByText(status)).toBeInTheDocument();
    });
  });

  it("strikes through Cancel (stored as Cancelled), as the cards do", () => {
    render(<CalendarLegend />);

    expect(screen.getByText("Cancel")).toHaveStyle({ textDecoration: "line-through" });
  });

  it("shows a note beside the key when given one", () => {
    render(<CalendarLegend note="Dragging keeps status" />);

    expect(screen.getByText("Dragging keeps status")).toBeInTheDocument();
  });
});
