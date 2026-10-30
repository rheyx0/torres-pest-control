import { render, screen } from "@testing-library/react";
import StatusPill from "../StatusPill";
import { appointmentStatusLabel } from "../../../utils/constants";

describe("Cancel label", () => {
  it("shows a cancelled visit as Cancel; the stored value stays Cancelled", () => {
    expect(appointmentStatusLabel("Cancelled")).toBe("Cancel");
    expect(appointmentStatusLabel("Pending")).toBe("Pending");
    render(<StatusPill status="Cancelled" />);
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.queryByText("Cancelled")).not.toBeInTheDocument();
  });

  it("leaves a word given as children alone (a cancelled contract keeps its word)", () => {
    render(<StatusPill tone="neutral">Cancelled</StatusPill>);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });
});
