import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider, useConfirm } from "../ConfirmContext";
import ClientForm from "../../components/clients/ClientForm";

function Action({ onDone }) {
  const confirm = useConfirm();
  return (
    <button type="button" onClick={async () => onDone(await confirm({ title: "Void invoice?", details: [["Invoice", "TPC-INV-00001"]], confirmLabel: "Void", tone: "danger" }))}>
      Void it
    </button>
  );
}

describe("confirm before important actions", () => {
  it("asks, and answers what was chosen", async () => {
    const onDone = jest.fn();
    render(<ConfirmProvider><Action onDone={onDone} /></ConfirmProvider>);

    await userEvent.click(screen.getByRole("button", { name: "Void it" }));
    expect(screen.getByRole("dialog", { name: "Void invoice?" })).toHaveTextContent("TPC-INV-00001");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDone).toHaveBeenLastCalledWith(false);

    await userEvent.click(screen.getByRole("button", { name: "Void it" }));
    await userEvent.click(screen.getByRole("button", { name: "Void" }));
    expect(onDone).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says yes at once outside the provider", async () => {
    const onDone = jest.fn();
    render(<Action onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Void it" }));
    expect(onDone).toHaveBeenCalledWith(true);
  });
});

describe("shared phone numbers", () => {
  it("are allowed, with a note naming the other client", async () => {
    const clients = [{ id: "c1", reference: "TPC-C-0022", name: "asd", phone: "09171234567" }];
    const onSubmit = jest.fn();
    render(<ClientForm clients={clients} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Client Name"), "Maria Santos");
    await userEvent.type(screen.getByRole("textbox", { name: /phone/i }), "09171234567");
    await userEvent.type(screen.getByRole("textbox", { name: /address/i }), "Brgy. Tacunan, Davao City");
    expect(screen.getByText("Also the phone number of asd (TPC-C-0022).")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save Client" }));
    expect(onSubmit).toHaveBeenCalled();
  });
});
