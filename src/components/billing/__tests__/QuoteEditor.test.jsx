import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuoteEditor from "../QuoteEditor";

const clients = [{ id: "c1", name: "Ana Cruz", status: "ACTIVE" }];
const services = [
  { id: "s1", name: "Termite treatment", pricingMode: "AREA", areaRate: 20, minimumCharge: 3000, depositPercent: 50, isActive: true },
  { id: "s2", name: "General pest control", pricingMode: "FLAT", defaultPrice: 1500, depositPercent: 0, isActive: true },
];
const inventory = [{ id: "i1", name: "Termidor", unit: "L", cost: 1000, priceMode: "MARKUP", markupPercent: 50 }];

const renderEditor = (props = {}) => {
  const onSave = jest.fn().mockResolvedValue(true);
  render(<QuoteEditor clients={clients} services={services} inventory={inventory} initialClientId="c1" onSave={onSave} onClose={jest.fn()} {...props} />);
  return { onSave };
};

const totalRow = (label) => {
  const totals = screen.getByLabelText("Quote totals");
  return within(totals).getByText(label).nextElementSibling.textContent;
};

test("an area service is priced from the area, and sets its down payment", async () => {
  renderEditor();
  await userEvent.selectOptions(screen.getByLabelText("Add a service"), "s1");
  await userEvent.type(screen.getByLabelText("Area in square metres"), "200");
  expect(screen.getByLabelText("Line unit price")).toHaveValue(4000);
  expect(totalRow("Subtotal")).toBe("₱4,000.00");
  expect(totalRow("VAT (12%)")).toBe("₱480.00");
  expect(totalRow("Total")).toBe("₱4,480.00");
  expect(totalRow("Down payment")).toBe("₱2,240.00");
});

test("a small area is charged the minimum", async () => {
  renderEditor();
  await userEvent.selectOptions(screen.getByLabelText("Add a service"), "s1");
  await userEvent.type(screen.getByLabelText("Area in square metres"), "50");
  expect(screen.getByLabelText("Line unit price")).toHaveValue(3000);
});

test("a material comes in at its customer price, not its cost", async () => {
  renderEditor();
  await userEvent.selectOptions(screen.getByLabelText("Add a material"), "i1");
  expect(screen.getByLabelText("Line unit price")).toHaveValue(1500);
});

test("saving sends the lines as numbers", async () => {
  const { onSave } = renderEditor();
  await userEvent.selectOptions(screen.getByLabelText("Add a service"), "s2");
  await userEvent.click(screen.getByRole("button", { name: "Save as draft" }));
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ clientId: "c1", vatRate: 12 }),
    [expect.objectContaining({ kind: "SERVICE", serviceId: "s2", quantity: 1, unitPrice: 1500 })]
  );
});

test("an area service without an area is not saved", async () => {
  const { onSave } = renderEditor();
  await userEvent.selectOptions(screen.getByLabelText("Add a service"), "s1");
  await userEvent.click(screen.getByRole("button", { name: "Save as draft" }));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toBeInTheDocument();
});
