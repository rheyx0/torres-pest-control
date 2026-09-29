import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ClientForm from "../ClientForm";
import { clientWithEmail, emailTakenMessage, sharedClientEmails } from "../../../utils/validators";

// Migration 067: one email per client, since quotes and invoices are emailed.
const clients = [
  { id: "c1", reference: "TPC-C-0001", name: "Juan Dela Cruz", email: "juan@gmail.com", status: "ACTIVE" },
  { id: "c2", reference: "TPC-C-0002", name: "Arawan Logistics Center", email: "ops@arawanlogistics.example.com", status: "ACTIVE" },
  { id: "c3", reference: "TPC-C-0003", name: "Old Client", email: "old@example.com", status: "ARCHIVED" },
];

describe("clientWithEmail", () => {
  it("finds another client with the email, ignoring case and spaces", () => {
    expect(clientWithEmail("  JUAN@gmail.com ", clients)?.id).toBe("c1");
    expect(clientWithEmail("old@example.com", clients)?.id).toBe("c3");
  });

  it("skips the client being edited, and blank emails", () => {
    expect(clientWithEmail("juan@gmail.com", clients, "c1")).toBeNull();
    expect(clientWithEmail("", clients)).toBeNull();
  });

  it("names the client, and says when it is archived", () => {
    expect(emailTakenMessage(clients[0])).toBe("Already used by Juan Dela Cruz (TPC-C-0001). Each client needs their own email.");
    expect(emailTakenMessage(clients[2])).toMatch(/an archived client/);
  });

  it("lists emails already shared", () => {
    const shared = sharedClientEmails([...clients, { id: "c4", name: "Jack SepticEye", email: "Juan@Gmail.com" }]);
    expect(shared).toHaveLength(1);
    expect(shared[0].clients.map((client) => client.id)).toEqual(["c1", "c4"]);
  });
});

describe("ClientForm email", () => {
  const fill = async (overrides = {}) => {
    const values = { name: "Maria Santos", email: "maria@example.com", address: "Brgy. Tacunan, Davao City", ...overrides };
    await userEvent.clear(screen.getByLabelText("Client Name"));
    await userEvent.type(screen.getByLabelText("Client Name"), values.name);
    await userEvent.type(screen.getByRole("textbox", { name: /email/i }), values.email);
    await userEvent.type(screen.getByRole("textbox", { name: /address/i }), values.address);
  };

  it("refuses a new client with an email another client has", async () => {
    const onSubmit = jest.fn();
    render(<ClientForm clients={clients} onSubmit={onSubmit} />);
    await fill({ email: "Juan@Gmail.com" });
    await userEvent.click(screen.getByRole("button", { name: "Save Client" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Already used by Juan Dela Cruz \(TPC-C-0001\)/)).toBeInTheDocument();
  });

  it("refuses an edit that takes another client's email, but keeps a client's own", async () => {
    const onSubmit = jest.fn();
    const { unmount } = render(<ClientForm clients={clients} initialValues={{ ...clients[1], address: "Iloilo City" }} onSubmit={onSubmit} submitLabel="Save Changes" />);
    const email = screen.getByRole("textbox", { name: /email/i });
    await userEvent.clear(email);
    await userEvent.type(email, "juan@gmail.com");
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(onSubmit).not.toHaveBeenCalled();
    unmount();

    render(<ClientForm clients={clients} initialValues={{ ...clients[1], address: "Iloilo City" }} onSubmit={onSubmit} submitLabel="Save Changes" />);
    await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(onSubmit).toHaveBeenCalled();
  });
});
