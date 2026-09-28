// A plain, dense data table: uppercase 11px headers on a faint band,
// hairline rows, optional click-to-sort columns.
//
// `columns` entries: { key, label, align?, sortable?, sortValue?(row), render?(row), width? }.
// Sorting is local and stable; the sort state lives here so a page only
// declares what can be sorted, not how.
//
// `loading` shows placeholder rows until the first rows arrive. On a phone
// (under 640px, globals.css .dt) each row becomes a card: every cell on its
// own line, labelled with its column's name from data-label.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { neutral, surface, weight } from "../../styles/tokens";
import { colors } from "../../styles/theme";

function compare(a, b) {
  if (a == null && b == null) return 0;
  if (a == null || a === "") return 1;
  if (b == null || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function sortRows(rows, columns, sort) {
  if (!sort) return rows;
  const column = columns.find((entry) => entry.key === sort.key);
  if (!column) return rows;
  const read = column.sortValue || ((row) => row[column.key]);
  const direction = sort.direction === "desc" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => compare(read(left.row), read(right.row)) * direction || left.index - right.index)
    .map((entry) => entry.row);
}

const cell = {
  padding: "11px 14px",
  borderBottom: `1px solid ${colors.line}`,
  verticalAlign: "middle",
};

function DataTable({ columns, rows, rowKey = "id", initialSort = null, onRowClick, empty = "Nothing to show.", caption, loading = false }) {
  const [sort, setSort] = useState(initialSort);
  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort]);

  const toggleSort = (key) => {
    setSort((current) =>
      current?.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }
    );
  };

  return (
    <div className="scroll-x">
      <table className="dt" style={{ width: "100%", borderCollapse: "collapse", fontSize: "13.5px" }}>
        {caption && <caption style={{ position: "absolute", left: "-9999px" }}>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const ariaSort = active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined;
              const label = column.sortable ? (
                <button
                  type="button"
                  onClick={() => toggleSort(column.key)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px",
                    color: active ? neutral.ink : "inherit",
                  }}
                >
                  {column.label}
                  {active && (sort.direction === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                </button>
              ) : (
                column.label
              );
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort}
                  style={{
                    ...cell,
                    padding: "9px 14px",
                    textAlign: column.align || "left",
                    width: column.width,
                    fontSize: "11px",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: neutral.bark,
                    fontWeight: weight.medium,
                    background: "#faf7ee",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && loading ? (
            [0, 1, 2, 3, 4].map((index) => (
              <tr key={`loading-${index}`} className="dt-loading" style={{ background: surface.panel }}>
                {columns.map((column, columnIndex) => (
                  <td key={column.key} style={{ ...cell, textAlign: column.align || "left" }}>
                    {index === 0 && columnIndex === 0 && <span className="visually-hidden">{typeof empty === "string" && /^Loading/.test(empty) ? empty : "Loading…"}</span>}
                    <span aria-hidden="true" className="skeleton" style={{ display: "inline-block", width: `${[70, 55, 80, 60, 45][(index + columnIndex) % 5]}%`, height: "11px" }} />
                  </td>
                ))}
              </tr>
            ))
          ) : sorted.length === 0 ? (
            <tr className="dt-empty">
              <td colSpan={columns.length} style={{ ...cell, color: neutral.bark, textAlign: "center", padding: "24px" }}>
                {empty}
              </td>
            </tr>
          ) : (
            sorted.map((row, index) => (
              <tr
                key={typeof rowKey === "function" ? rowKey(row) : row[rowKey] ?? index}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={{ cursor: onRowClick ? "pointer" : undefined, background: surface.panel }}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    data-label={typeof column.label === "string" ? column.label : undefined}
                    style={{
                      ...cell,
                      borderBottom: index === sorted.length - 1 ? 0 : cell.borderBottom,
                      textAlign: column.align || "left",
                      color: neutral.ink,
                    }}
                  >
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
