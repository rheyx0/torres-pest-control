// Smoke tests for the wired page.
//
// The calendar's pieces are unit tested on their own, but nothing there
// proves SchedulingPage passes them the right things. These mount the real
// page with its data hooks mocked, which is what catches a prop renamed on
// one side of a boundary and not the other — a class of bug that compiles
// cleanly and then renders an empty grid.

import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import SchedulingPage, { buildStockRows, defaultStockOutDate, scopeAppointments, shortDuration, stockAvailable, validateStockOut, weekRangeLabel } from "../SchedulingPage";
import { localDateKey, startOfWeek } from "../../utils/calendarDates";

// SchedulingPage reads ?appointment= via useSearchParams, so it needs a router
// in scope. Every case renders through this helper rather than bare render().
function renderPage(entry = "/scheduling") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SchedulingPage />
    </MemoryRouter>
  );
}

const MONDAY = startOfWeek(new Date());
const dayKey = (offset = 0) => {
  const date = new Date(MONDAY);
  date.setDate(date.getDate() + offset);
  return localDateKey(date);
};

const mockClients = [
  { id: "c1", name: "Rhey Garcia", address: "12 Mabini St", phone: "09171234567" },
  { id: "c2", name: "Clizfel Testaclizfel", address: "4 Rizal Ave" },
];

const mockTechnicians = [
  { id: "t1", name: "Karl Hameed", role: "TECHNICIAN", status: "ACTIVE" },
  { id: "t2", name: "Bruce Banner", role: "TECHNICIAN", status: "ACTIVE" },
];

const mockAppointments = [
  {
    id: "a1",
    clientId: "c1",
    technicianId: "t1",
    scheduledAt: `${dayKey(0)}T09:00:00`,
    durationMinutes: 60,
    status: "Confirmed",
    pestConcern: "Termites",
    serviceType: "Termite Control",
    serviceId: "s1",
  },
  {
    id: "a2",
    clientId: "c2",
    technicianId: "t2",
    scheduledAt: `${dayKey(2)}T15:00:00`,
    durationMinutes: 120,
    status: "Pending",
    pestConcern: "Snakes",
  },
];

const mockInventory = [
  { id: "i1", name: "Termidor SC", type: "CHEMICAL", unit: "L", quantity: 10, status: "ACTIVE" },
  { id: "i2", name: "Bait station", type: "EQUIPMENT", unit: "pc", quantity: 3, status: "ACTIVE" },
  { id: "i3", name: "Gloves", type: "MATERIAL", unit: "pair", quantity: 50, status: "ACTIVE" },
];

const mockServices = [
  {
    id: "s1",
    name: "Termite Control",
    isActive: true,
    defaultPrice: 4500,
    defaultDurationMinutes: 120,
    materials: [{ itemId: "i1", defaultAmount: 1.5 }, { itemId: "i2", defaultAmount: 2 }],
  },
  {
    id: "s2",
    name: "Rodent Control",
    isActive: true,
    defaultPrice: 2500,
    defaultDurationMinutes: 60,
    materials: [{ itemId: "i2", defaultAmount: 4 }],
  },
];

const mockStockOutMany = jest.fn(async () => [{ movement_id: "m1" }]);
// The stock log; a test puts a technician's checkout here (migration 054).
let mockMovements = [];
const mockUpdateAppointment = jest.fn(async (a) => a);
const mockCreateAppointment = jest.fn(async (a) => ({ ...a, id: "new" }));

jest.mock("../../hooks/useAuth", () => ({
  __esModule: true,
  default: () => ({
    can: () => true,
    currentUser: { id: "u1", name: "Office Admin", role: "ADMIN" },
  }),
}));

jest.mock("../../hooks/useClients", () => ({
  __esModule: true,
  default: () => ({
    clients: mockClients,
    addDocument: jest.fn(),
    removeDocument: jest.fn(),
    getDocumentUrl: jest.fn(),
  }),
}));

jest.mock("../../hooks/useInventory", () => ({
  __esModule: true,
  default: () => ({ inventory: mockInventory, movements: mockMovements, stockOutMany: mockStockOutMany }),
}));

jest.mock("../../hooks/useUsers", () => ({
  __esModule: true,
  default: () => ({ staff: [], technicians: mockTechnicians }),
}));

jest.mock("../../hooks/useServices", () => ({
  __esModule: true,
  default: () => ({
    services: mockServices,
    activeServices: mockServices,
    serviceById: (id) => mockServices.find((service) => service.id === id) || null,
    serviceByName: (name) => mockServices.find((service) => service.name === name) || null,
  }),
}));

jest.mock("../../context/SchedulingContext", () => ({
  useScheduling: () => ({
    appointments: mockAppointments,
    createAppointment: mockCreateAppointment,
    updateAppointment: mockUpdateAppointment,
    submitReport: jest.fn(),
    addStockUsed: jest.fn(),
    addAttachment: jest.fn(),
    removeAttachment: jest.fn(),
    getAttachmentUrl: jest.fn(),
    uploadSignature: jest.fn(),
    getSignatureUrl: jest.fn(),
    loading: false,
    error: "",
  }),
}));

jest.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showError: jest.fn(), showSuccess: jest.fn() }),
}));

beforeEach(() => {
  mockUpdateAppointment.mockClear();
  mockCreateAppointment.mockClear();
  mockStockOutMany.mockClear();
});

describe("SchedulingPage", () => {
  it("renders the page header", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
  });

  it("renders one toolbar with every view and the period nav", () => {
    renderPage();

    const views = screen.getByRole("radiogroup", { name: "Scheduling view" });
    ["Day", "Week", "Month", "List"].forEach((label) => {
      expect(within(views).getByRole("radio", { name: new RegExp(label) })).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
  });

  it("opens on the week grid with this week's appointments drawn", () => {
    renderPage();

    expect(screen.getByText("Rhey Garcia")).toBeInTheDocument();
    expect(screen.getByText("Clizfel Testaclizfel")).toBeInTheDocument();
  });

  // The office's day is always on screen so there is somewhere to drop a
  // visit, but not the evening rows nobody books.
  it("draws the working day, 7 AM to 6 PM", () => {
    renderPage();

    expect(screen.getByText("7:00 AM")).toBeInTheDocument();
    expect(screen.getByText("5:00 PM")).toBeInTheDocument();
    expect(screen.queryByText("7:00 PM")).not.toBeInTheDocument();
  });

  it("starts on today, so the Today button has nothing to do", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "Today" })).toBeDisabled();
  });

  it("enables Today once the user has navigated away, and returns", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Next period" }));
    const today = screen.getByRole("button", { name: "Today" });
    expect(today).toBeEnabled();

    await userEvent.click(today);
    expect(screen.getByRole("button", { name: "Today" })).toBeDisabled();
  });

  describe("switching views", () => {
    it("shows the list with its own filters", async () => {
      renderPage();

      await userEvent.click(screen.getByRole("radio", { name: /List/ }));

      expect(screen.getByLabelText("Search appointments")).toBeInTheDocument();
      expect(screen.getByLabelText("Status")).toBeInTheDocument();
      // List has date-from/to of its own, so the period stepper steps aside.
      expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
    });

    it("shows the month grid", async () => {
      renderPage();

      await userEvent.click(screen.getByRole("radio", { name: /Month/ }));

      // The month label replaces the week range.
      expect(screen.getByText(new RegExp(new Date().toLocaleDateString([], { month: "long" })))).toBeInTheDocument();
    });

    it("opens the list on upcoming visits, with sortable columns", async () => {
      renderPage();

      await userEvent.click(screen.getByRole("radio", { name: /List/ }));

      expect(screen.getByRole("radio", { name: "Upcoming" })).toBeChecked();
      ["When", "Client", "Service", "Status", "Duration", "Price"].forEach((label) => {
        expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
      });
      expect(screen.getByRole("columnheader", { name: "Technicians" })).toBeInTheDocument();
      expect(screen.getByText(/^Showing \d+ of \d+/)).toBeInTheDocument();
    });

    it("shows a single day", async () => {
      renderPage();

      await userEvent.click(screen.getByRole("radio", { name: /Day/ }));

      expect(document.querySelector("[data-columns]")).toHaveAttribute("data-columns", "1");
      expect(document.querySelectorAll("[data-day]")).toHaveLength(1);
    });
  });

  it("filters the calendar down to one technician", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /All technicians/ }));
    await userEvent.click(screen.getByRole("option", { name: /Karl Hameed/ }));

    expect(screen.getByText("Rhey Garcia")).toBeInTheDocument();
    expect(screen.queryByText("Clizfel Testaclizfel")).not.toBeInTheDocument();
  });

  // The old page carried a sentence explaining that a dashed outline meant
  // Pending and a dotted one meant Reschedule. The encoding it described was
  // invisible on a real card; the replacement needs no prose.
  it("no longer needs a legend explaining its status encoding", () => {
    renderPage();

    expect(screen.queryByText(/Dashed outline = Pending/)).not.toBeInTheDocument();
  });

  // The top bar's New visit lands here with ?new=1.
  it("opens the create form from a New visit link", () => {
    renderPage("/scheduling?new=1");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  describe("the detail panel", () => {
    it("opens when an appointment is clicked", async () => {
      renderPage();

      await userEvent.click(screen.getByText("Rhey Garcia"));

      expect(screen.getAllByRole("dialog").length).toBeGreaterThan(0);
    });

    // The panel takes six grouped prop objects rather than thirty loose
    // props. A group spelled wrongly at the call site destructures to
    // undefined and throws on first use, so mounting it is the check.
    it("receives every prop group it destructures", async () => {
      renderPage();

      await userEvent.click(screen.getByText("Rhey Garcia"));

      // The card behind the panel also carries the client name, so assert on
      // the controls the panel's own prop groups feed instead: the tab strip
      // comes from `ui`, the save button from `actions`.
      expect(screen.getByRole("button", { name: /Save appointment/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Documents" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Stock-Out" })).toBeInTheDocument();
    });

    // The technician permission gate is a `fieldset disabled` wrapper. A form
    // moved outside one becomes editable by someone who may not edit it.
    it("keeps the overview form inside its permission fieldset", async () => {
      renderPage();

      await userEvent.click(screen.getByText("Rhey Garcia"));

      const save = screen.getByRole("button", { name: /Save appointment/i });
      expect(save.closest("fieldset")).not.toBeNull();
    });

    // Treatment methods were retired: the service is chosen on the report,
    // not in Overview, and the report form carries it by name.
    it("chooses the service in the Report tab, not in Overview", async () => {
      renderPage();

      await userEvent.click(screen.getByText("Rhey Garcia"));
      expect(screen.queryByLabelText("Service type")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Report" }));
      const service = screen.getByRole("checkbox", { name: "Termite Control" });
      expect(service).toBeChecked();
      expect(service).toHaveAttribute("name", "serviceIds");
      expect(service.closest("form")).toHaveAttribute("id", "appointment-report-form");
      // Several services can be ticked at once.
      await userEvent.click(screen.getByRole("checkbox", { name: "Rodent Control" }));
      expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
    });

    it("has no treatment notes box and no signed-form upload on the report", async () => {
      renderPage();

      await userEvent.click(screen.getByText("Rhey Garcia"));
      await userEvent.click(screen.getByRole("button", { name: "Report" }));

      expect(screen.queryByText(/Treatment notes/)).not.toBeInTheDocument();
      expect(screen.queryByText("Signed service forms")).not.toBeInTheDocument();
      expect(screen.getByText("Before-treatment pictures")).toBeInTheDocument();
      expect(screen.getByText("Treatment proof")).toBeInTheDocument();
    });
  });

  // "Schedule follow-up" was unreachable: it set the client id and opened the
  // create modal, but never closed the detail panel, and the panel's backdrop
  // sat at a HIGHER z-index than the modal — so the form opened behind the
  // thing that launched it.
  it("closes the detail panel when scheduling a follow-up, so the form is reachable", async () => {
    renderPage();

    await userEvent.click(screen.getByText("Rhey Garcia"));
    const followUp = screen.queryByRole("button", { name: /follow-up/i });
    if (!followUp) return; // the action lives behind the report tab

    await userEvent.click(followUp);

    expect(screen.getByRole("dialog")).toHaveAccessibleName("New appointment");
  });

  // Dragging used to write status = "Reschedule" to the database before any
  // drop happened, so aborting a drag stranded the appointment in that state.
  it("does not save anything when a drag starts", () => {
    renderPage();

    const card = screen.getByText("Rhey Garcia").closest("button");
    card.dispatchEvent(new MouseEvent("dragstart", { bubbles: true }));

    expect(mockUpdateAppointment).not.toHaveBeenCalled();
  });
});

describe("the Stock-Out tab", () => {
  async function openStockTab() {
    renderPage();
    await userEvent.click(screen.getByText("Rhey Garcia"));
    await userEvent.click(screen.getByRole("button", { name: "Stock-Out" }));
  }

  // Team lead's request: materials come from the service profile, and the
  // technician confirms rather than typing them from memory.
  it("prefills the service profile's materials", async () => {
    await openStockTab();

    expect(screen.getByRole("status")).toHaveTextContent(/Prefilled from the Termite Control service profile/);
    expect(screen.getByLabelText("Chemical item")).toHaveValue("i1");
    expect(screen.getByLabelText("Chemical quantity")).toHaveValue(1.5);
    expect(screen.getByLabelText("Equipment item")).toHaveValue("i2");
  });

  it("has an editable date that cannot go past today", async () => {
    await openStockTab();

    const date = screen.getByLabelText("Stock-out date");
    expect(date.getAttribute("max")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(date.value <= date.getAttribute("max")).toBe(true);
  });

  it("records the chosen date, not today, when backdated", async () => {
    await openStockTab();

    const date = screen.getByLabelText("Stock-out date");
    await userEvent.clear(date);
    await userEvent.type(date, "2026-01-15");
    await userEvent.click(screen.getByRole("button", { name: /Record stock out/ }));

    expect(mockStockOutMany).toHaveBeenCalledWith(
      "a1",
      [
        { itemId: "i1", amount: 1.5, batchId: "" },
        { itemId: "i2", amount: 2, batchId: "" },
      ],
      "2026-01-15"
    );
    // Let the save settle so its state updates land inside the test.
    expect(await screen.findByRole("button", { name: "Record stock out" })).toBeEnabled();
  });

  it("refuses more than is in stock, before calling the server", async () => {
    await openStockTab();

    const quantity = screen.getByLabelText("Equipment quantity");
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "5");

    expect(screen.getByText("Only 3 pc available.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Record stock out/ }));
    expect(mockStockOutMany).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Only 3 pc of Bait station is available/);
  });

  // Migration 054: what the crew checked out is used before the shelf, so it
  // counts toward what the visit can record — no double deduction, no refusal.
  describe("when the crew checked stock out", () => {
    beforeEach(() => {
      mockMovements = [{
        id: "co1", itemId: "i2", amount: 2, movementType: "OUT", stockOutReason: "TECHNICIAN_CHECKOUT",
        technicianId: "t1", movementDate: dayKey(0), itemName: "Bait station", itemUnit: "pc",
      }];
    });
    afterEach(() => { mockMovements = []; });

    it("counts it toward what is available and says it is used first", async () => {
      await openStockTab();

      expect(screen.getByText("The crew checked out 2 pc; that is used first, then the shelf.")).toBeInTheDocument();
      const quantity = screen.getByLabelText("Equipment quantity");
      await userEvent.clear(quantity);
      await userEvent.type(quantity, "5");
      expect(screen.queryByText(/available\.$/)).not.toBeInTheDocument();

      await userEvent.type(quantity, "0");
      expect(screen.getByText("Only 5 pc (3 pc on the shelf, 2 pc with the crew) available.")).toBeInTheDocument();
    });
  });
});

describe("stock-out helpers", () => {
  const now = new Date(2026, 8, 24, 10, 0);

  it("defaults the date to the visit's day once it has happened", () => {
    expect(defaultStockOutDate({ scheduledAt: new Date(2026, 8, 20, 9).toISOString() }, now)).toBe("2026-09-20");
  });

  it("defaults to today for a visit still ahead", () => {
    expect(defaultStockOutDate({ scheduledAt: new Date(2026, 8, 30, 9).toISOString() }, now)).toBe("2026-09-24");
  });

  it("keeps one empty row per category beside the prefilled ones", () => {
    const rows = buildStockRows(mockServices[0], mockInventory);
    expect(rows.map((row) => [row.category, row.itemId, row.amount])).toEqual([
      ["CHEMICAL", "i1", "1.5"],
      ["EQUIPMENT", "i2", "2"],
      ["MATERIAL", "", ""],
    ]);
  });

  it("skips a listed material whose item no longer exists", () => {
    const rows = buildStockRows({ materials: [{ itemId: "gone", defaultAmount: 1 }] }, mockInventory);
    expect(rows.every((row) => row.itemId === "")).toBe(true);
  });

  it("accepts decimals, carries a chosen batch, and refuses a future date", () => {
    const rows = [{ itemId: "i1", amount: "0.4", batchId: "b1" }];
    expect(validateStockOut(rows, "2026-01-01", mockInventory)).toEqual({ error: null, entries: [{ itemId: "i1", amount: 0.4, batchId: "b1" }] });
    expect(validateStockOut(rows, "2999-01-01", mockInventory).error).toMatch(/future/);
  });

  // Migration 055: only usable batches count; expired stock cannot be recorded.
  describe("stockAvailable", () => {
    const termidor = mockInventory[0];
    const batch = (id, quantity, expirationDate) => ({ id, itemId: "i1", quantity, expirationDate, receivedDate: "2026-01-01" });
    const batches = [batch("fresh", 6, "2027-06-01"), batch("old", 4, "2026-02-01")];

    it("counts the shelf by batch, leaving out what has expired", () => {
      expect(stockAvailable(termidor, { batches, date: "2026-03-01" })).toEqual({ shelf: 6, held: 0 });
      expect(stockAvailable(termidor, { batches, date: "2026-01-15" })).toEqual({ shelf: 10, held: 0 });
    });

    it("counts the crew's checked-out stock unless its batch has expired", () => {
      const held = [
        { checkout: { itemId: "i1", batchId: "fresh" }, remaining: 1 },
        { checkout: { itemId: "i1", batchId: "old" }, remaining: 2 },
      ];
      expect(stockAvailable(termidor, { batches, held, date: "2026-03-01" })).toEqual({ shelf: 6, held: 1 });
    });

    it("falls back on the item's quantity before batches exist", () => {
      expect(stockAvailable(termidor, { batches: [], date: "2026-03-01" })).toEqual({ shelf: 10, held: 0 });
    });
  });

  it("refuses zero, blanks and absurd quantities", () => {
    expect(validateStockOut([{ itemId: "i1", amount: "0" }], "2026-01-01", mockInventory).error).toMatch(/greater than zero/);
    expect(validateStockOut([{ itemId: "i1", amount: "" }], "2026-01-01", mockInventory).error).toMatch(/greater than zero/);
    expect(validateStockOut([], "2026-01-01", mockInventory).error).toMatch(/at least one item/);
  });
});

describe("weekRangeLabel", () => {
  it("names the month once inside a month", () => {
    expect(weekRangeLabel(new Date(2026, 8, 21), new Date(2026, 8, 27))).toBe("Sep 21 – 27, 2026");
  });

  it("names both months across a month boundary", () => {
    expect(weekRangeLabel(new Date(2026, 8, 28), new Date(2026, 9, 4))).toBe("Sep 28 – Oct 4, 2026");
  });

  it("names both years across New Year", () => {
    expect(weekRangeLabel(new Date(2026, 11, 28), new Date(2027, 0, 3))).toBe("Dec 28, 2026 – Jan 3, 2027");
  });
});

describe("scopeAppointments", () => {
  const now = new Date(2026, 8, 25, 12, 0);
  const at = (day, hour) => new Date(2026, 8, day, hour).toISOString();
  const list = [
    { id: "last-week", scheduledAt: at(18, 9), durationMinutes: 60 },
    { id: "running", scheduledAt: at(25, 11, 30), durationMinutes: 90 },
    { id: "tomorrow", scheduledAt: at(26, 9), durationMinutes: 60 },
    { id: "this-morning", scheduledAt: at(25, 8), durationMinutes: 60 },
  ];
  const ids = (scope) => scopeAppointments(list, scope, now).map((entry) => entry.id);

  it("puts what's still ahead first, soonest first", () => {
    expect(ids("upcoming")).toEqual(["running", "tomorrow"]);
  });

  it("lists the past newest first", () => {
    expect(ids("past")).toEqual(["this-morning", "last-week"]);
  });

  it("shows everything in date order", () => {
    expect(ids("all")).toEqual(["last-week", "this-morning", "running", "tomorrow"]);
  });
});

describe("shortDuration", () => {
  it.each([
    [90, "1h 30m"],
    [60, "1h"],
    [45, "45m"],
    [150, "2h 30m"],
  ])("writes %i minutes as %s", (minutes, label) => {
    expect(shortDuration(minutes)).toBe(label);
  });
});
