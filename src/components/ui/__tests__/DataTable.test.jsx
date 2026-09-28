import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataTable, { sortRows } from "../DataTable";

const columns = [
  { key: "name", label: "Name", sortable: true },
  { key: "visits", label: "Visits", sortable: true, align: "right" },
  { key: "note", label: "Note" },
];

const rows = [
  { id: 1, name: "Tan Family", visits: 4, note: "a" },
  { id: 2, name: "Cruz Bakery", visits: 12, note: "b" },
  { id: 3, name: "Ateneo GS", visits: 7, note: "c" },
];

const namesInOrder = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent);

describe("DataTable", () => {
  it("renders rows in the order given when nothing is sorted", () => {
    render(<DataTable columns={columns} rows={rows} />);

    expect(namesInOrder()).toEqual(["Tan Family", "Cruz Bakery", "Ateneo GS"]);
  });

  it("sorts by a column on click and reverses on a second click", async () => {
    render(<DataTable columns={columns} rows={rows} />);

    await userEvent.click(screen.getByRole("button", { name: "Visits" }));
    expect(namesInOrder()).toEqual(["Tan Family", "Ateneo GS", "Cruz Bakery"]);
    expect(screen.getByRole("columnheader", { name: /visits/i })).toHaveAttribute("aria-sort", "ascending");

    await userEvent.click(screen.getByRole("button", { name: "Visits" }));
    expect(namesInOrder()).toEqual(["Cruz Bakery", "Ateneo GS", "Tan Family"]);
  });

  it("does not offer sorting on a column that is not sortable", () => {
    render(<DataTable columns={columns} rows={rows} />);

    expect(screen.queryByRole("button", { name: "Note" })).toBeNull();
  });

  it("shows the empty message when there are no rows", () => {
    render(<DataTable columns={columns} rows={[]} empty="No accounts yet." />);

    expect(screen.getByText("No accounts yet.")).toBeInTheDocument();
  });

  it("sorts blanks last in either direction", () => {
    const withBlank = [...rows, { id: 4, name: "", visits: 1 }];
    expect(sortRows(withBlank, columns, { key: "name", direction: "asc" }).at(-1).id).toBe(4);
  });
});

describe("DataTable loading and phone layout", () => {
  it("shows placeholder rows while loading, then the rows", () => {
    const { rerender } = render(<DataTable columns={columns} rows={[]} loading empty="Loading clients…" />);
    expect(screen.getByText("Loading clients…")).toBeInTheDocument();
    expect(document.querySelectorAll("tr.dt-loading")).toHaveLength(5);
    rerender(<DataTable columns={columns} rows={rows} loading={false} />);
    expect(document.querySelectorAll("tr.dt-loading")).toHaveLength(0);
  });

  it("labels each cell with its column, for the phone card layout", () => {
    render(<DataTable columns={columns} rows={rows} />);
    const cells = screen.getByText("Tan Family").closest("tr").querySelectorAll("td");
    expect([...cells].map((cell) => cell.getAttribute("data-label"))).toEqual(["Name", "Visits", "Note"]);
  });
});
