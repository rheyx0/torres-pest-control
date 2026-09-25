import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PlanPanel from "../PlanPanel";

const future = (days, time = "09:00") => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.toISOString().slice(0, 10)}T${time}:00`;
};

const recurring = [1, 8, 15].map((days, index) => ({
  id: `r${index}`, planId: "p1", planKind: "RECURRING", planFrequency: "Weekly",
  status: "Confirmed", scheduledAt: future(days), durationMinutes: 60,
}));

const job = [1, 2].map((days, index) => ({
  id: `d${index}`, planId: "p2", planKind: "MULTI_DAY",
  status: "Confirmed", scheduledAt: future(days, "06:00"), durationMinutes: 780,
}));

function renderPanel(props) {
  const onAction = jest.fn(async () => true);
  const onOpen = jest.fn();
  render(<PlanPanel canManage canFinish accounts={[]} services={[]} onOpen={onOpen} onAction={onAction} {...props} />);
  return { onAction, onOpen };
}

describe("PlanPanel", () => {
  it("names the plan and where this visit sits in it", () => {
    renderPanel({ appointment: recurring[1], visits: recurring });
    expect(screen.getByText(/Recurring plan · Weekly · 2 of 3/)).toBeInTheDocument();
  });

  it("opens another visit of the plan", async () => {
    const { onOpen } = renderPanel({ appointment: recurring[0], visits: recurring });
    await userEvent.click(screen.getAllByRole("button", { name: /Confirmed/ })[2]);
    expect(onOpen).toHaveBeenCalledWith("r2");
  });

  it("asks before cancelling the rest of a plan", async () => {
    const { onAction } = renderPanel({ appointment: recurring[0], visits: recurring });
    await userEvent.click(screen.getByRole("button", { name: "Cancel remaining" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Cancel the 3 visits still to come?");
    await userEvent.click(screen.getByRole("button", { name: "Yes, cancel them" }));
    expect(onAction).toHaveBeenCalledWith("cancelPlanRemaining", "p1");
  });

  it("changes the start time of every later visit", async () => {
    const { onAction } = renderPanel({ appointment: recurring[1], visits: recurring });
    await userEvent.click(screen.getByRole("button", { name: "Change future visits" }));
    await userEvent.type(screen.getByLabelText("New start time"), "13:00");
    await userEvent.click(screen.getByRole("button", { name: /Apply to/ }));
    expect(onAction).toHaveBeenCalledWith("updatePlanFuture", "p1", "r1", { startTime: "13:00", technicianIds: null, serviceIds: null });
  });

  it("gives a multi-day job Add a day and Finish here, not Cancel remaining", async () => {
    const { onAction } = renderPanel({ appointment: job[0], visits: job });
    expect(screen.getByText(/Multi-day job · Day 1 of 2/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel remaining" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Finish here" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, finish here" }));
    expect(onAction).toHaveBeenCalledWith("finishJobHere", "d0");
  });

  it("adds a day after the last one", async () => {
    const { onAction } = renderPanel({ appointment: job[0], visits: job });
    await userEvent.click(screen.getByRole("button", { name: "Add a day" }));
    await userEvent.click(screen.getByRole("button", { name: "Add day 3" }));
    expect(onAction).toHaveBeenCalledWith("addPlanVisit", "p2", expect.objectContaining({ durationMinutes: 780 }));
  });

  it("lets the crew finish a job early but not manage the plan", () => {
    renderPanel({ appointment: job[0], visits: job, canManage: false, canFinish: true });
    expect(screen.getByRole("button", { name: "Finish here" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a day" })).not.toBeInTheDocument();
  });

  it("marks a recurring plan not to be renewed, and undoes it", async () => {
    const { onAction } = renderPanel({ appointment: recurring[0], visits: recurring });
    await userEvent.click(screen.getByRole("button", { name: "Don't renew" }));
    expect(onAction).toHaveBeenCalledWith("setPlanRenewal", "p1", false);
  });

  it("shows a declined plan and offers the reminder back", async () => {
    const declined = recurring.map((visit) => ({ ...visit, planRenewalDeclinedAt: "2026-01-01T00:00:00Z" }));
    const { onAction } = renderPanel({ appointment: declined[0], visits: declined });
    expect(screen.getByText(/Not renewing/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Don't renew" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remind me again" }));
    expect(onAction).toHaveBeenCalledWith("setPlanRenewal", "p1", true);
  });

  it("never offers Don't renew on a multi-day job", () => {
    renderPanel({ appointment: job[0], visits: job });
    expect(screen.queryByRole("button", { name: "Don't renew" })).not.toBeInTheDocument();
  });

  it("shows a server refusal and stays open", async () => {
    const onAction = jest.fn(async () => "Karl is already assigned during this time.");
    render(<PlanPanel appointment={recurring[0]} visits={recurring} canManage canFinish onOpen={() => {}} onAction={onAction} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel remaining" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, cancel them" }));
    expect(await screen.findByText("Karl is already assigned during this time.")).toBeInTheDocument();
  });
});
