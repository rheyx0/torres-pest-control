import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewAppointmentModal from "../NewAppointmentModal";
import { localDateKey } from "../../../utils/calendarDates";

// Tomorrow, not today: the form refuses times in the past (migration 047), so
// a fixture at "today 09:30" would pass before 9:30 and fail after it.
const TOMORROW_DATE = new Date();
TOMORROW_DATE.setDate(TOMORROW_DATE.getDate() + 1);
const TODAY = localDateKey(TOMORROW_DATE);
const YESTERDAY_DATE = new Date();
YESTERDAY_DATE.setDate(YESTERDAY_DATE.getDate() - 1);
const YESTERDAY = localDateKey(YESTERDAY_DATE);

const services = [
  { id: "s1", name: "Termite Control", defaultPrice: 4500, defaultDurationMinutes: 120, isActive: true, materials: [{ itemId: "i1", defaultAmount: 2 }] },
  { id: "s2", name: "Fumigation", defaultPrice: null, defaultDurationMinutes: 150, isActive: true, materials: [] },
];

const clients = [
  { id: "c1", name: "Rhey Garcia", address: "12 Mabini St", phone: "09171234567" },
  { id: "c2", name: "Clizfel Testaclizfel", address: "4 Rizal Ave", email: "cliz@example.com" },
];

const activeAccounts = [
  { id: "t1", name: "Karl Hameed" },
  { id: "t2", name: "Bruce Banner" },
];

const existing = [
  {
    id: "existing",
    clientId: "c2",
    technicianId: "t1",
    scheduledAt: `${TODAY}T09:00:00`,
    durationMinutes: 60,
    status: "Confirmed",
  },
];

/** The client search box. Role "combobox" is ambiguous here — selects share it. */
const clientSearch = () => screen.getByPlaceholderText(/Search by name, phone, email, or address/);

function renderModal({ onCreate = jest.fn(async () => ({ id: "new" })), ...props } = {}) {
  const onClose = jest.fn();
  render(
    <NewAppointmentModal
      clients={clients}
      activeAccounts={activeAccounts}
      appointments={existing}
      onClose={onClose}
      onCreate={onCreate}
      {...props}
    />
  );
  return { onCreate, onClose };
}

describe("NewAppointmentModal", () => {
  it("renders as a labelled dialog", () => {
    renderModal();

    expect(screen.getByRole("dialog")).toHaveAccessibleName("New appointment");
  });

  // The fields used to be nine controls in one 460px column with no grouping.
  it("groups its fields into named sections", () => {
    renderModal();

    ["Client", "When", "Assignment", "Details"].forEach((legend) => {
      expect(screen.getByRole("group", { name: legend })).toBeInTheDocument();
    });
  });

  describe("client picker", () => {
    it("searches by name and by address", async () => {
      renderModal();
      const search = clientSearch();

      await userEvent.type(search, "Mabini");

      expect(screen.getByRole("option", { name: /Rhey Garcia/ })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /Clizfel/ })).not.toBeInTheDocument();
    });

    it("fills the service location from the chosen client", async () => {
      renderModal();

      await userEvent.click(clientSearch());
      await userEvent.click(screen.getByRole("option", { name: /Rhey Garcia/ }));

      expect(screen.getByLabelText(/Service location/)).toHaveValue("12 Mabini St");
    });

    it("shows the chosen client's address and phone as confirmation", async () => {
      renderModal();

      await userEvent.click(clientSearch());
      await userEvent.click(screen.getByRole("option", { name: /Rhey Garcia/ }));

      expect(screen.getByText("09171234567")).toBeInTheDocument();
    });

    // The box must never show one client's name while submitting a different
    // id, which is what typing after a pick would otherwise cause.
    it("invalidates the pick as soon as the user types again", async () => {
      const { onCreate } = renderModal();

      await userEvent.click(clientSearch());
      await userEvent.click(screen.getByRole("option", { name: /Rhey Garcia/ }));
      await userEvent.type(clientSearch(), "xyz");

      await userEvent.click(screen.getByRole("button", { name: /Create appointment/ }));

      expect(onCreate).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(/Select a client from the list/);
    });

    it("says so when nothing matches", async () => {
      renderModal();

      await userEvent.type(clientSearch(), "zzzzz");

      expect(screen.getByText("No clients match that search.")).toBeInTheDocument();
    });

    it("prefills the client it was opened for", () => {
      renderModal({ initialClientId: "c1" });

      expect(clientSearch()).toHaveValue("Rhey Garcia");
      expect(screen.getByLabelText(/Service location/)).toHaveValue("12 Mabini St");
    });
  });

  describe("duration", () => {
    // Replaces a bare Hours + Minutes number pair, which was the worst field
    // in the form for the most common case.
    it("offers the durations the office actually books", () => {
      renderModal();

      ["30m", "1h", "1h 30m", "2h"].forEach((label) => {
        expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
      });
    });

    it("defaults to one hour", () => {
      renderModal();

      expect(screen.getByRole("button", { name: "1h" })).toHaveAttribute("aria-pressed", "true");
    });

    it("selects a preset", async () => {
      renderModal();

      await userEvent.click(screen.getByRole("button", { name: "2h" }));

      expect(screen.getByRole("button", { name: "2h" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "1h" })).toHaveAttribute("aria-pressed", "false");
    });

    it("reveals the raw fields only for a custom duration", async () => {
      renderModal();

      expect(screen.queryByLabelText("Hours")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Custom" }));

      expect(screen.getByLabelText("Hours")).toBeInTheDocument();
      expect(screen.getByLabelText("Minutes")).toBeInTheDocument();
    });

    it("keeps custom duration inside the 24-hour limit as the user edits it", async () => {
      renderModal();

      await userEvent.click(screen.getByRole("button", { name: "Custom" }));
      const hours = screen.getByLabelText("Hours");
      const minutes = screen.getByLabelText("Minutes");

      await userEvent.clear(hours);
      await userEvent.type(hours, "25");
      await userEvent.clear(minutes);
      await userEvent.type(minutes, "90");

      expect(hours).toHaveValue(24);
      expect(minutes).toHaveValue(59);
    });

    it("submits the preset's minutes", async () => {
      const { onCreate } = renderModal();

      await userEvent.click(clientSearch());
      await userEvent.click(screen.getByRole("option", { name: /Rhey Garcia/ }));
      await userEvent.click(screen.getByRole("button", { name: "1h 30m" }));
      await userEvent.click(screen.getByRole("button", { name: /Create appointment/ }));

      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ durationMinutes: 90 }));
    });
  });

  describe("conflict preview", () => {
    // The same check the server runs, surfaced before the round trip rather
    // than after it is rejected.
    it("warns about a technician already booked in that window", async () => {
      renderModal({ initialScheduledAt: `${TODAY}T09:30` });

      await userEvent.click(screen.getByRole("checkbox", { name: /Karl Hameed/ }));

      expect(screen.getByRole("status")).toHaveTextContent(/already booked/i);
    });

    it("warns about a time outside the working day", () => {
      renderModal({ initialScheduledAt: `${TODAY}T05:00` });

      expect(screen.getByRole("status")).toHaveTextContent(/working day/i);
    });

    it("stays quiet for a slot that is fine", () => {
      renderModal({ initialScheduledAt: `${TODAY}T13:00` });

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    // busyTechnicianIds already existed and the detail panel used it; this
    // form did not, so a clash was only discoverable by submitting.
    it("marks a busy technician in the picker", () => {
      renderModal({ initialScheduledAt: `${TODAY}T09:30` });

      const picker = screen.getByRole("group", { name: "Assigned technicians" });
      expect(within(picker).getByRole("checkbox", { name: /Karl Hameed — already booked/ })).toBeInTheDocument();
      expect(within(picker).getByRole("checkbox", { name: "Bruce Banner" })).toBeInTheDocument();
    });

    // Advisory only: a stale appointments list must never stop a booking the
    // server would accept.
    it("does not block submission", async () => {
      const { onCreate } = renderModal({ initialScheduledAt: `${TODAY}T09:30` });

      await userEvent.click(clientSearch());
      await userEvent.click(screen.getByRole("option", { name: /Rhey Garcia/ }));
      await userEvent.click(screen.getByRole("checkbox", { name: /Karl Hameed/ }));
      await userEvent.click(screen.getByRole("button", { name: /Create appointment/ }));

      expect(onCreate).toHaveBeenCalled();
    });
  });

  describe("submitting", () => {
    it("sends every field the server expects", async () => {
      const { onCreate } = renderModal({ initialScheduledAt: `${TODAY}T14:00` });

      await userEvent.click(clientSearch());
      await userEvent.click(screen.getByRole("option", { name: /Rhey Garcia/ }));
      await userEvent.selectOptions(screen.getByLabelText("Pest concern"), "Termites");
      await userEvent.type(screen.getByLabelText("Notes"), "Back garden access");
      await userEvent.click(screen.getByRole("button", { name: /Create appointment/ }));

      expect(onCreate).toHaveBeenCalledWith({
        clientId: "c1",
        scheduledAt: `${TODAY}T14:00`,
        durationMinutes: 60,
        pestConcern: "Termites",
        serviceId: "",
        serviceType: "",
        serviceLocation: "12 Mabini St",
        technicianIds: [],
        serviceFrequency: "",
        price: "",
        notes: "Back garden access",
      });
    });

    // Order is the assignment: the first technician ticked leads the job, and
    // that is what appointments.technician_id ends up holding.
    it("sends the whole crew, lead first, in the order they were ticked", async () => {
      const { onCreate } = renderModal({ initialScheduledAt: `${TODAY}T14:00` });

      await userEvent.click(clientSearch());
      await userEvent.click(screen.getByRole("option", { name: /Rhey Garcia/ }));
      await userEvent.click(screen.getByRole("checkbox", { name: "Bruce Banner" }));
      await userEvent.click(screen.getByRole("checkbox", { name: /Karl Hameed/ }));
      await userEvent.click(screen.getByRole("button", { name: /Create appointment/ }));

      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ technicianIds: ["t2", "t1"] }));
    });

    it("carries the visit's frequency and price", async () => {
      const { onCreate } = renderModal({ initialScheduledAt: `${TODAY}T14:00` });

      await userEvent.click(clientSearch());
      await userEvent.click(screen.getByRole("option", { name: /Rhey Garcia/ }));
      await userEvent.selectOptions(screen.getByLabelText("Frequency"), "Quarterly");
      await userEvent.type(screen.getByLabelText(/Price/), "2500");
      await userEvent.click(screen.getByRole("button", { name: /Create appointment/ }));

      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ serviceFrequency: "Quarterly", price: "2500" })
      );
    });

    // The context mutators report failure by returning the message rather
    // than throwing, and the form still honours that contract.
    it("shows the error string the caller returns", async () => {
      const onCreate = jest.fn(async () => "That technician is already booked.");
      renderModal({ onCreate });

      await userEvent.click(clientSearch());
      await userEvent.click(screen.getByRole("option", { name: /Rhey Garcia/ }));
      await userEvent.click(screen.getByRole("button", { name: /Create appointment/ }));

      expect(await screen.findByRole("alert")).toHaveTextContent("That technician is already booked.");
    });

    describe("safeguards", () => {
      it("refuses a time in the past", async () => {
        const { onCreate } = renderModal({ initialScheduledAt: `${YESTERDAY}T10:00` });

        await userEvent.click(clientSearch());
        await userEvent.click(screen.getByRole("option", { name: /Rhey Garcia/ }));
        await userEvent.click(screen.getByRole("button", { name: /Create appointment/ }));

        expect(onCreate).not.toHaveBeenCalled();
        expect(screen.getByRole("alert")).toHaveTextContent(/cannot be booked in the past/);
      });

      it("will not let the picker go below now", () => {
        renderModal();

        expect(screen.getByLabelText(/Date and time/).getAttribute("min")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      });

      it("refuses a price over ₱999,999.99", async () => {
        const { onCreate } = renderModal({ initialScheduledAt: `${TODAY}T14:00` });

        await userEvent.click(clientSearch());
        await userEvent.click(screen.getByRole("option", { name: /Rhey Garcia/ }));
        await userEvent.type(screen.getByLabelText(/Price/), "10000000");
        await userEvent.click(screen.getByRole("button", { name: /Create appointment/ }));

        expect(onCreate).not.toHaveBeenCalled();
        expect(screen.getByRole("alert")).toHaveTextContent(/cannot be more than ₱999,999.99/);
      });

      it("refuses a custom duration of zero", async () => {
        const { onCreate } = renderModal({ initialScheduledAt: `${TODAY}T14:00` });

        await userEvent.click(clientSearch());
        await userEvent.click(screen.getByRole("option", { name: /Rhey Garcia/ }));
        await userEvent.click(screen.getByRole("button", { name: "Custom" }));
        await userEvent.clear(screen.getByLabelText("Hours"));
        await userEvent.click(screen.getByRole("button", { name: /Create appointment/ }));

        expect(onCreate).not.toHaveBeenCalled();
        expect(screen.getByRole("alert")).toHaveTextContent(/at least 15 minutes/);
      });
    });

    describe("service profiles", () => {
      it("lists the services it is given", () => {
        renderModal({ services });

        const select = screen.getByLabelText(/Service type/);
        expect(within(select).getByRole("option", { name: "Termite Control" })).toBeInTheDocument();
        expect(within(select).getByRole("option", { name: "Fumigation" })).toBeInTheDocument();
      });

      it("fills the default price and duration, and sends the link and the name", async () => {
        const { onCreate } = renderModal({ services, initialScheduledAt: `${TODAY}T08:00` });

        await userEvent.click(clientSearch());
        await userEvent.click(screen.getByRole("option", { name: /Rhey Garcia/ }));
        await userEvent.selectOptions(screen.getByLabelText(/Service type/), "s1");

        expect(screen.getByLabelText(/Price/)).toHaveValue(4500);
        expect(screen.getByRole("button", { name: "2h" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByText(/Prefills 1 material on the Stock-Out tab/)).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: /Create appointment/ }));
        expect(onCreate).toHaveBeenCalledWith(
          expect.objectContaining({ serviceId: "s1", serviceType: "Termite Control", price: "4500", durationMinutes: 120 })
        );
      });

      it("never overwrites a price already typed", async () => {
        renderModal({ services, initialScheduledAt: `${TODAY}T08:00` });

        await userEvent.type(screen.getByLabelText(/Price/), "3000");
        await userEvent.selectOptions(screen.getByLabelText(/Service type/), "s1");

        expect(screen.getByLabelText(/Price/)).toHaveValue(3000);
      });

      it("switches to a custom duration for a non-preset default", async () => {
        renderModal({ services });

        await userEvent.selectOptions(screen.getByLabelText(/Service type/), "s2");

        expect(screen.getByLabelText("Hours")).toHaveValue(2);
        expect(screen.getByLabelText("Minutes")).toHaveValue(30);
      });
    });

    it("closes from Cancel and from Escape", async () => {
      const { onClose } = renderModal();

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onClose).toHaveBeenCalledTimes(1);

      await userEvent.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it("cannot be submitted when there are no clients to book", () => {
      renderModal({ clients: [] });

      expect(screen.getByRole("button", { name: /Create appointment/ })).toBeDisabled();
    });
  });
});

// A <label> implicitly labels its first labelable descendant, and a button is
// labelable — so wrapping the duration toggles in Field's <label> gave the
// first one the label's entire text ("Duration 30m 1h 1h 30m 2h Custom") as
// its accessible name. They are a group, not a labelled control.
describe("duration presets are a group, not a labelled control", () => {
  it("exposes them as one named group", () => {
    renderModal();

    expect(screen.getByRole("group", { name: "Duration" })).toBeInTheDocument();
  });

  it("gives each preset its own accessible name", () => {
    renderModal();

    const group = screen.getByRole("group", { name: "Duration" });
    ["30m", "1h", "1h 30m", "2h", "Custom"].forEach((label) => {
      expect(within(group).getByRole("button", { name: label })).toBeInTheDocument();
    });
  });
});

describe("service first and clash hints", () => {
  // The service sets duration and price, so it comes before the time.
  it("asks for the service before the date and time", () => {
    renderModal({ services });

    const service = screen.getByRole("combobox", { name: /Service type/ });
    const when = screen.getByLabelText(/Date and time/);
    expect(service.compareDocumentPosition(when) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names who is already out at the chosen time, and where", () => {
    renderModal({ initialScheduledAt: `${TODAY}T09:30` });

    expect(screen.getByTestId("clash-hint")).toHaveTextContent(/Karl is on Clizfel Testaclizfel 9:00.*10:00/);
    expect(screen.getByText("1 of 2 free at this time")).toBeInTheDocument();
  });

  it("says nothing about clashes for a free slot", () => {
    renderModal({ initialScheduledAt: `${TODAY}T13:00` });

    expect(screen.queryByTestId("clash-hint")).toBeNull();
    expect(screen.getByText("All free at this time")).toBeInTheDocument();
  });

  // Booking a re-service from the Schedule side panel.
  it("carries the last visit's service, frequency and pest concern", () => {
    renderModal({
      services,
      initialClientId: "c1",
      initialServiceId: "s1",
      initialFrequency: "Quarterly",
      initialPestConcern: "Termites",
    });

    expect(screen.getByRole("combobox", { name: /Service type/ })).toHaveValue("s1");
    expect(screen.getByRole("combobox", { name: "Frequency" })).toHaveValue("Quarterly");
    expect(screen.getByRole("combobox", { name: "Pest concern" })).toHaveValue("Termites");
    expect(screen.getByLabelText(/Price/)).toHaveValue(4500);
    expect(screen.getByRole("button", { name: "2h" })).toHaveAttribute("aria-pressed", "true");
  });
});
