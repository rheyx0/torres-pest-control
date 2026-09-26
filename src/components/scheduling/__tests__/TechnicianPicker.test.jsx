// The crew picker, and technicians who are out (migration 057).

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TechnicianPicker from "../TechnicianPicker";

const accounts = [
  { id: "juan", name: "Juan", status: "ACTIVE" },
  { id: "karl", name: "Karl", status: "ACTIVE" },
];
const out = new Map([["juan", { id: "a", technicianId: "juan", startsOn: "2031-01-16", endsOn: "2031-01-17", reason: "Sick" }]]);

describe("TechnicianPicker", () => {
  it("cannot tick someone who is out, and says why", async () => {
    const onChange = jest.fn();
    render(<TechnicianPicker accounts={accounts} value={[]} outIds={out} onChange={onChange} />);
    const juan = screen.getByRole("checkbox", { name: /Juan/ });
    expect(juan).toBeDisabled();
    expect(screen.getByText(/out \(Sick\) until Jan 17/)).toBeInTheDocument();
    await userEvent.click(juan);
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("checkbox", { name: /Karl/ }));
    expect(onChange).toHaveBeenCalledWith(["karl"]);
  });

  it("keeps someone already on the job tickable, so the visit can still be edited", () => {
    render(<TechnicianPicker accounts={accounts} value={["juan"]} outIds={out} onChange={() => {}} />);
    expect(screen.getByRole("checkbox", { name: /Juan/ })).toBeEnabled();
  });
});
