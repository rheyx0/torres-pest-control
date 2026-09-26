// "Technician unavailable" (migrations 056 and 057).

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TechnicianUnavailableModal from "../TechnicianUnavailableModal";
import { todayISO } from "../../../utils/validators";

const TODAY = todayISO();
const at = (time) => `${TODAY}T${time}:00`;
const shiftDays = (days) => {
  const date = new Date(`${TODAY}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const technicians = [
  { id: "juan", name: "Juan", status: "ACTIVE" },
  { id: "karl", name: "Karl", status: "ACTIVE" },
  { id: "ana", name: "Ana", status: "ACTIVE" },
  { id: "ben", name: "Ben", status: "ACTIVE" },
];
const clients = [{ id: "c1", name: "Cruz Bakery" }, { id: "c2", name: "Reyes Home" }];
const appointments = [
  { id: "v1", reference: "TPC-V-00001", clientId: "c1", scheduledAt: at("09:00"), durationMinutes: 60, status: "Confirmed", technicianIds: ["juan"] },
  { id: "v2", reference: "TPC-V-00002", clientId: "c2", scheduledAt: at("13:00"), durationMinutes: 60, status: "Pending", technicianIds: ["juan", "ana"] },
  // Karl is busy all afternoon, Ana at 9.
  { id: "k", clientId: "c1", scheduledAt: at("12:00"), durationMinutes: 240, status: "Confirmed", technicianIds: ["karl"] },
  { id: "a", clientId: "c1", scheduledAt: at("09:00"), durationMinutes: 60, status: "Confirmed", technicianIds: ["ana"] },
];
const movements = [
  { id: "co", itemId: "i1", amount: 2, movementType: "OUT", stockOutReason: "TECHNICIAN_CHECKOUT", technicianId: "juan", movementDate: TODAY, itemName: "Termidor SC", itemUnit: "L" },
];

function renderModal({ onSubmit = jest.fn(async () => true), onEndAbsence = jest.fn(async () => true), absences = [], people = technicians } = {}) {
  render(
    <TechnicianUnavailableModal
      technicians={people}
      appointments={appointments}
      absences={absences}
      clients={clients}
      movements={movements}
      onClose={() => {}}
      onSubmit={onSubmit}
      onEndAbsence={onEndAbsence}
    />
  );
  return { onSubmit, onEndAbsence };
}

const chooseJuan = () => userEvent.selectOptions(screen.getByLabelText("Technician who is out"), "juan");

describe("TechnicianUnavailableModal", () => {
  it("lists the absent technician's visits with a free cover suggested", async () => {
    renderModal();
    await chooseJuan();

    const list = screen.getByRole("list", { name: "Visits to cover" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    // 9 AM: Ana is busy; Karl and Ben are free and Ben has the lighter day.
    // 1 PM: Karl is busy and Ana is already on it, so Ben again.
    expect(screen.getByLabelText(/Cover for Cruz Bakery/)).toHaveValue("ASSIGN:ben");
    expect(screen.getByLabelText(/Cover for Reyes Home/)).toHaveValue("ASSIGN:ben");
    const nineAm = within(screen.getByLabelText(/Cover for Cruz Bakery/));
    expect(nineAm.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Give it to Ben", "Give it to Karl", "Leave it unassigned", "Mark for reschedule",
    ]);
    const onePm = within(screen.getByLabelText(/Cover for Reyes Home/));
    expect(onePm.getByRole("option", { name: "Leave it to Ana" })).toBeInTheDocument();
    expect(onePm.queryByRole("option", { name: "Give it to Karl" })).not.toBeInTheDocument();
  });

  it("falls back on the rest of the crew when nobody is free", async () => {
    renderModal({ people: technicians.filter((account) => account.id !== "ben") });
    await chooseJuan();
    expect(screen.getByLabelText(/Cover for Cruz Bakery/)).toHaveValue("ASSIGN:karl");
    expect(screen.getByLabelText(/Cover for Reyes Home/)).toHaveValue("REMOVE");
  });

  // The second bug reported: covering with someone who is out themselves.
  it("never offers a cover who is out that day", async () => {
    renderModal({ absences: [{ id: "x", technicianId: "ben", startsOn: TODAY, endsOn: TODAY, reason: "Sick" }] });
    await chooseJuan();
    const nineAm = within(screen.getByLabelText(/Cover for Cruz Bakery/));
    expect(nineAm.queryByRole("option", { name: "Give it to Ben" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Cover for Cruz Bakery/)).toHaveValue("ASSIGN:karl");
  });

  it("reminds the office about stock the technician still holds", async () => {
    renderModal();
    await chooseJuan();
    expect(screen.getByRole("note")).toHaveTextContent("Juan still has stock checked out: Termidor SC 2 L.");
  });

  it("records the absence with every visit's change and the reason", async () => {
    const { onSubmit } = renderModal();
    await chooseJuan();
    await userEvent.selectOptions(screen.getByLabelText(/Cover for Reyes Home/), "RESCHEDULE");
    await userEvent.selectOptions(screen.getByLabelText("Reason"), "Family emergency");
    await userEvent.click(screen.getByRole("button", { name: "Mark out and reassign 2 visits" }));

    expect(onSubmit).toHaveBeenCalledWith("juan", {
      startsOn: TODAY,
      endsOn: TODAY,
      reason: "Family emergency",
      changes: [
        { appointment_id: "v1", action: "ASSIGN", technician_ids: ["ben"] },
        { appointment_id: "v2", action: "RESCHEDULE", technician_ids: ["ana"] },
      ],
    });
  });

  // The first bug reported: leave with no visits recorded nothing, so they
  // could still be booked. Marking out now works on its own.
  it("marks someone out even when they have no visits in those days", async () => {
    const { onSubmit } = renderModal();
    await userEvent.selectOptions(screen.getByLabelText("Technician who is out"), "ben");
    expect(screen.getByText("Ben has no visits to cover in these dates.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark out" }));
    expect(onSubmit).toHaveBeenCalledWith("ben", { startsOn: TODAY, endsOn: TODAY, reason: "Sick", changes: [] });
  });

  it("shows a refusal from the server and stays open", async () => {
    renderModal({ onSubmit: jest.fn(async () => "Karl is already assigned during this time.") });
    await chooseJuan();
    await userEvent.click(screen.getByRole("button", { name: "Mark out and reassign 2 visits" }));
    expect(await screen.findByText("Karl is already assigned during this time.")).toBeInTheDocument();
  });

  describe("who is out now and coming up", () => {
    const absences = [
      { id: "now", technicianId: "karl", startsOn: TODAY, endsOn: shiftDays(2), reason: "Sick" },
      { id: "later", technicianId: "ana", startsOn: shiftDays(5), endsOn: shiftDays(6), reason: "On leave" },
      { id: "past", technicianId: "ben", startsOn: shiftDays(-5), endsOn: shiftDays(-3), reason: "Sick" },
    ];

    it("lists current and upcoming absences, not past ones", () => {
      renderModal({ absences });
      const section = within(screen.getByRole("region", { name: "Out now and coming up" }));
      expect(section.getByText("Karl")).toBeInTheDocument();
      expect(section.getByText("Ana")).toBeInTheDocument();
      expect(section.queryByText("Ben")).not.toBeInTheDocument();
      expect(screen.getByRole("option", { name: /Karl \(out \(Sick\) until/ })).toBeInTheDocument();
    });

    it("ends an absence early, or cancels one that has not started", async () => {
      const { onEndAbsence } = renderModal({ absences });
      const section = within(screen.getByRole("region", { name: "Out now and coming up" }));

      await userEvent.click(section.getByRole("button", { name: "Cancel" }));
      expect(onEndAbsence).toHaveBeenCalledWith(expect.objectContaining({ id: "later" }), shiftDays(5));

      await userEvent.click(section.getByRole("button", { name: "Back early" }));
      await userEvent.type(screen.getByLabelText("Karl back to work on"), shiftDays(1));
      await userEvent.click(section.getByRole("button", { name: "Save" }));
      expect(onEndAbsence).toHaveBeenCalledWith(expect.objectContaining({ id: "now" }), shiftDays(1));
    });
  });
});
