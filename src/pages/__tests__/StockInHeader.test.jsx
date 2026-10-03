// The Stock In delivery-note header: Date, PO reference and Intake Branch.
//
// These three sat at three different heights twice over. The first attempt
// passed grid styles to this file's LOCAL `Field` helper, which accepts only
// {label, hint, children} and drops a `style` prop on the floor — so the fix
// was a no-op that looked right in review and changed nothing on screen.
//
// jsdom has no layout engine, so none of this measures pixels; the alignment
// itself is verified in a real browser. What these tests hold down is the
// structure that makes alignment possible, which is exactly what the failed
// attempt lacked: one grid, with every label, control and hint as its direct
// children in a named band. Wrap a field back up in its own grid and the
// band classes go with it, and these fail.

import { render, screen } from "@testing-library/react";
import { BulkStockInModal } from "../InventoryPage";

const inventory = [{ id: "i1", name: "Termidor SC", unit: "Litre", status: "ACTIVE", quantity: 10 }];

function renderModal() {
  const { container } = render(
    <BulkStockInModal inventory={inventory} onClose={() => {}} onSubmit={async () => {}} />
  );
  return container.querySelector(".delivery-note-grid");
}

describe("Stock In delivery-note header", () => {
  it("puts all three fields in one grid", () => {
    const grid = renderModal();
    expect(grid).not.toBeNull();
    expect(grid.querySelectorAll(".dn-label")).toHaveLength(3);
    expect(grid.querySelectorAll(".dn-control")).toHaveLength(3);
  });

  it("makes every label, control and hint a direct child of that grid", () => {
    const grid = renderModal();
    // The band classes only line the fields up if the grid is their direct
    // parent — nested in a per-field wrapper they lay out against the wrapper.
    grid.querySelectorAll(".dn-label, .dn-control, .dn-hint").forEach((el) => {
      expect(el.parentElement).toBe(grid);
    });
  });

  it("orders children per field, so the stacked layout reads correctly", () => {
    const grid = renderModal();
    const bands = [...grid.children].map((el) => el.className.split(" ")[0]);
    // The help text is a tooltip in the control band now, not a band of its own.
    expect(bands).toEqual([
      "dn-label", "dn-control",
      "dn-label", "dn-control",
      "dn-label", "dn-control",
    ]);
  });

  it("gives each column its own placement class", () => {
    const grid = renderModal();
    ["dn-col-1", "dn-col-2", "dn-col-3"].forEach((column) => {
      expect(grid.querySelectorAll(`.${column}`)).toHaveLength(2);
    });
  });

  it("keeps each label wired to its own input", () => {
    const grid = renderModal();
    const labels = [...grid.querySelectorAll("label")];
    // \u00a0 rather than a plain space before the asterisk — see the marker
    // test below.
    expect(labels.map((l) => l.textContent.trim())).toEqual([
      "Date\u00a0*",
      "PO / Invoice no.\u00a0*",
      "Received at\u00a0*",
    ]);
    // Splitting a wrapping <label> into a sibling loses the implicit
    // association unless htmlFor is carried across.
    labels.forEach((label) => {
      expect(label.htmlFor).toBeTruthy();
      expect(grid.querySelector(`#${label.htmlFor}`)).not.toBeNull();
    });
  });

  it("holds the required marker to the label with a non-breaking space", () => {
    const grid = renderModal();
    grid.querySelectorAll(".dn-label span[aria-hidden]").forEach((star) => {
      expect(star.textContent).toBe(" *");
    });
    expect(grid.querySelectorAll(".dn-label span[aria-hidden]")).toHaveLength(3);
  });

  it("keeps the help text, as tooltips", () => {
    renderModal();
    expect(screen.getByText("The Purchase Order (PO) number, or the supplier's invoice number.")).toBeInTheDocument();
    expect(screen.getByText("The branch, station or warehouse where the items arrived.")).toBeInTheDocument();
  });
});
