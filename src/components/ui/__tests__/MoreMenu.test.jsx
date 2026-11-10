// The "…" menu floats above the page (rendered into document.body), so a
// table or window that scrolls or clips its contents cannot cut it off.

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MoreMenu from "../MoreMenu";

function renderInClippingBox(onEdit = jest.fn(), onRowClick = jest.fn()) {
  const { container } = render(
    <div data-testid="box" style={{ overflow: "hidden", height: "40px" }} onClick={onRowClick}>
      <MoreMenu items={[{ label: "Edit", onClick: onEdit }, false, { label: "Delete", danger: true, onClick: jest.fn() }]} />
    </div>
  );
  return { container, onEdit, onRowClick };
}

describe("MoreMenu", () => {
  it("opens outside the box that holds the button", async () => {
    const { container } = renderInClippingBox();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    const menu = screen.getByRole("menu");
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
    expect(menu.style.position).toBe("fixed");
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Edit", "Delete"]);
  });

  it("runs the choice, closes, and does not click the row behind it", async () => {
    const { onEdit, onRowClick } = renderInClippingBox();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape, on a click outside and on scrolling the page", async () => {
    renderInClippingBox();
    const open = () => userEvent.click(screen.getByRole("button", { name: "More actions" }));

    await open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await open();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await open();
    fireEvent.scroll(window);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
