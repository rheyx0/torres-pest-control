import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ClientFacts, ClientHeader, ClientTimeline, NextVisitBanner } from "../ClientProfileParts";

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
const client = {
  id: "c1",
  reference: "CL-2026-0001",
  name: "Jollibee Katipunan",
  classification: "COMMERCIAL",
  pestConcern: "Cockroaches",
  status: "ACTIVE",
  phone: "0917 800 1000",
  email: "",
  address: "10 Katipunan Ave, Quezon City",
  source: "Referral",
  serviceNotes: "Service after 9 PM closing only.",
  createdAt: "2026-03-03T09:00:00",
  updatedAt: "2026-09-19T14:10:00",
};

describe("ClientHeader", () => {
  const renderHeader = (props = {}) => {
    const handlers = { onEdit: jest.fn(), archive: jest.fn(), remove: jest.fn() };
    wrap(
      <ClientHeader
        client={client}
        plan="Quarterly"
        clientSince="Mar 2026"
        canEdit
        canBook
        onEdit={handlers.onEdit}
        menuItems={[
          { label: "Archive client", onClick: handlers.archive },
          { label: "Delete permanently…", onClick: handlers.remove, danger: true, separated: true },
        ]}
        {...props}
      />
    );
    return handlers;
  };

  it("has a Back button and a breadcrumb back to Clients", () => {
    renderHeader();
    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumb).getByRole("link", { name: "Clients" })).toHaveAttribute("href", "/clients");
    expect(within(crumb).getByText("CL-2026-0001")).toBeInTheDocument();
    expect(within(crumb).getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("shows status, classification, pest concern, plan and client-since", () => {
    renderHeader();
    ["Active", "Commercial", "Cockroaches", "Quarterly plan", "Client since Mar 2026"].forEach((text) => {
      expect(screen.getByText(text)).toBeInTheDocument();
    });
  });

  it("offers Call, Edit and Book visit, with Book visit prefilled for this client", () => {
    renderHeader();
    expect(screen.getByRole("link", { name: /Call/ })).toHaveAttribute("href", "tel:09178001000");
    expect(screen.getByRole("link", { name: /Book visit/ })).toHaveAttribute("href", "/scheduling?new=1&client=c1");
    expect(screen.getByRole("button", { name: /Edit/ })).toBeInTheDocument();
  });

  // Delete used to sit beside Edit as a top-level button.
  it("keeps Archive and Delete in the … menu", async () => {
    const handlers = renderHeader();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Archive client" }));
    expect(handlers.archive).toHaveBeenCalled();
  });

  it("does not offer booking for an archived client", () => {
    renderHeader({ client: { ...client, status: "ARCHIVED" } });
    expect(screen.queryByRole("link", { name: /Book visit/ })).toBeNull();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });
});

describe("ClientFacts", () => {
  it("highlights the site notes and links the address to directions", () => {
    wrap(<ClientFacts client={client} value={{ total: 41500, visits: 6 }} canEdit onEdit={() => {}} />);
    expect(screen.getByRole("note", { name: "Site notes" })).toHaveTextContent("Service after 9 PM");
    expect(screen.getByRole("link", { name: /Directions/ }).getAttribute("href")).toMatch(/^https:\/\/www\.google\.com\/maps/);
    expect(screen.getByText("₱41,500 · 6 visits")).toBeInTheDocument();
  });

  it("offers to add a missing email", async () => {
    const onEdit = jest.fn();
    wrap(<ClientFacts client={client} value={{ total: 0, visits: 0 }} canEdit onEdit={onEdit} />);
    await userEvent.click(screen.getByRole("button", { name: "Add email" }));
    expect(onEdit).toHaveBeenCalled();
  });
});

describe("NextVisitBanner and ClientTimeline", () => {
  const appointment = {
    id: "a1",
    clientId: "c1",
    scheduledAt: "2026-12-15T21:30:00",
    durationMinutes: 60,
    status: "Confirmed",
    serviceType: "General Pest Control",
    serviceFrequency: "Quarterly",
    technicianIds: ["jun"],
  };

  it("links the next visit to the schedule", () => {
    wrap(<NextVisitBanner appointment={appointment} crewNames={["Jun Dela Cruz"]} />);
    expect(screen.getByRole("link", { name: /Next visit/ })).toHaveAttribute("href", "/scheduling?appointment=a1");
    expect(screen.getByText(/Quarterly service · General Pest Control · Jun Dela Cruz/)).toBeInTheDocument();
  });

  it("draws reports with their signature state and findings, and opens the report", async () => {
    const onOpenReport = jest.fn();
    const report = {
      ...appointment,
      id: "r1",
      scheduledAt: "2026-09-16T10:30:00",
      reportSubmitted: true,
      signaturePath: "sig.png",
      report: "Gel bait at 14 points.",
      recommendations: "seal gaps under back door.",
      attachments: [{ id: "p1" }, { id: "p2" }],
      stockUsed: [{ name: "Maxforce FC Gel", amount: 2, unit: "tube" }],
      price: 12500,
    };
    wrap(
      <ClientTimeline
        events={[
          { key: "report-r1", kind: "report", at: report.scheduledAt, appointment: report },
          { key: "created", kind: "created", at: client.createdAt },
        ]}
        nameOf={() => "Jun Dela Cruz"}
        onOpenReport={onOpenReport}
      />
    );

    expect(screen.getByText("Signed")).toBeInTheDocument();
    expect(screen.getByText(/Gel bait at 14 points/)).toBeInTheDocument();
    expect(screen.getByText(/Maxforce FC Gel 2 tube · 2 photos · ₱12,500/)).toBeInTheDocument();
    expect(screen.getByText("Client created")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Service report filed" }));
    expect(onOpenReport).toHaveBeenCalledWith(report);
  });
});
