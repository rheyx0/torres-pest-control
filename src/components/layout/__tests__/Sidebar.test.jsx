import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Sidebar, { groupHeadingId, isNavItemActive } from "../Sidebar";
import { can } from "../../../utils/permissions";
import { brand, surface } from "../../../styles/tokens";

// A jest.mock factory may only close over variables whose names begin with
// "mock" — it is hoisted above the imports.
const mockAuth = { role: "ADMIN" };

jest.mock("../../../hooks/useAuth", () => ({
  __esModule: true,
  default: () => ({
    currentUser: { name: "Maria Santos", role: mockAuth.role },
    logout: jest.fn(),
    // The real matrix, not a stub: the point of these tests is that the rail
    // is driven by permissions, so faking can() would test nothing.
    can: (subsystem, action = "view") =>
      // eslint-disable-next-line global-require
      require("../../../utils/permissions").can(mockAuth.role, subsystem, action),
  }),
}));

function renderSidebar(pathname = "/", role = "ADMIN", badges = {}) {
  mockAuth.role = role;
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Sidebar badges={badges} />
    </MemoryRouter>
  );
}

const dashboard = { path: "/", exact: true };
const clients = { path: "/clients" };
const scheduling = { path: "/scheduling" };

describe("isNavItemActive", () => {
  it("matches a nav item on its own route", () => {
    expect(isNavItemActive("/clients", clients)).toBe(true);
  });

  // The bug this replaced: an exact-equality check meant a user three clicks
  // deep into a client profile saw the whole sidebar unlit.
  it("keeps the parent lit on a detail route", () => {
    expect(isNavItemActive("/clients/123", clients)).toBe(true);
    expect(isNavItemActive("/clients/123/documents", clients)).toBe(true);
  });

  it("does not light a sibling route that merely shares a prefix", () => {
    expect(isNavItemActive("/clients-archive", clients)).toBe(false);
  });

  it("does not light an unrelated route", () => {
    expect(isNavItemActive("/inventory", clients)).toBe(false);
    expect(isNavItemActive("/clients", scheduling)).toBe(false);
  });

  // "/" prefixes every route in the app, so the dashboard must stay exact or
  // it would be permanently active alongside whatever page you are on.
  it("only matches the dashboard on the root path", () => {
    expect(isNavItemActive("/", dashboard)).toBe(true);
    expect(isNavItemActive("/clients", dashboard)).toBe(false);
    expect(isNavItemActive("/scheduling", dashboard)).toBe(false);
  });
});

describe("Sidebar groups", () => {
  it("shows the main items and the whole Setup group to an admin", () => {
    renderSidebar("/", "ADMIN");

    ["Today", "Schedule", "Clients", "Inventory"].forEach((label) => {
      expect(screen.getByRole("link", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    });
    expect(screen.getByText("Setup")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Accounts/ })).toHaveAttribute("href", "/users");
    expect(screen.getByRole("link", { name: /Activity log/ })).toHaveAttribute("href", "/activity");
    expect(screen.getByRole("link", { name: /Services/ })).toHaveAttribute("href", "/services");
    // Retired: the report records the service performed instead.
    expect(screen.queryByRole("link", { name: /Treatment methods/ })).not.toBeInTheDocument();
  });

  // Filtering the items without then dropping the empty group would leave a
  // "Setup" heading floating above nothing.
  it.each(["TECHNICIAN", "STAFF"])("drops the whole Setup group for a %s, not just its links", (role) => {
    renderSidebar("/", role);

    expect(can(role, "users")).toBe(false);
    expect(can(role, "settings")).toBe(false);

    expect(screen.queryByText("Setup")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Accounts/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Activity log/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Schedule/ })).toBeInTheDocument();
  });

  it("labels each group's list by its heading, so the grouping reaches a screen reader", () => {
    renderSidebar("/", "ADMIN");

    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(2);
    lists.forEach((list) => {
      const headingId = list.getAttribute("aria-labelledby");
      expect(document.getElementById(headingId)).toBeInTheDocument();
    });

    const setup = lists.find((list) => list.getAttribute("aria-labelledby") === groupHeadingId("Setup"));
    expect(within(setup).getAllByRole("link")).toHaveLength(3);
  });
});

describe("Sidebar badges", () => {
  it("shows a count beside Schedule and Inventory", () => {
    renderSidebar("/", "ADMIN", { scheduling: 3, inventory: 4 });

    expect(within(screen.getByRole("link", { name: /Schedule/ })).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /Inventory/ })).getByText("4")).toBeInTheDocument();
  });

  it("shows nothing for a count of zero", () => {
    renderSidebar("/", "ADMIN", { scheduling: 0 });

    expect(within(screen.getByRole("link", { name: /Schedule/ })).queryByText("0")).toBeNull();
  });
});

describe("Sidebar active state", () => {
  it("marks exactly one link as the current page on a detail route", () => {
    renderSidebar("/clients/123", "ADMIN");

    const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Clients");
  });

  it("lifts the active item to white with a maroon marker, and only that item", () => {
    renderSidebar("/scheduling", "ADMIN");

    const active = screen.getByRole("link", { name: /Schedule/ });
    expect(active).toHaveStyle({ background: surface.panel });
    expect(active.querySelector("[data-active-marker]")).toHaveStyle({ background: brand.base });

    expect(screen.getByRole("link", { name: /Today/ }).querySelector("[data-active-marker]")).toBeNull();
  });

  it("moves the marker when the user navigates", async () => {
    renderSidebar("/clients");

    await userEvent.click(screen.getByRole("link", { name: /Inventory/ }));

    expect(screen.getByRole("link", { name: /Clients/ }).querySelector("[data-active-marker]")).toBeNull();
    expect(screen.getByRole("link", { name: /Clients/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /Inventory/ }).querySelector("[data-active-marker]")).not.toBeNull();
  });

  // Regression: with the `border` shorthand on the base style, React deleted
  // border-color when a link went inactive, so it fell back to currentColor
  // and every visited tab kept an outline.
  it("clears the outline from the item the user navigated away from", async () => {
    renderSidebar("/clients");

    await userEvent.click(screen.getByRole("link", { name: /Inventory/ }));
    await userEvent.click(screen.getByRole("link", { name: /Schedule/ }));

    ["Clients", "Inventory"].forEach((label) => {
      expect(screen.getByRole("link", { name: new RegExp(label) }).style.borderColor).toBe("transparent");
    });
  });
});

describe("Sidebar footer", () => {
  it("shows who is signed in", () => {
    renderSidebar("/", "STAFF");

    expect(screen.getByText("Maria Santos")).toBeInTheDocument();
    expect(screen.getByText("Staff")).toBeInTheDocument();
  });
});
