// Shared dashboard furniture: stat tiles, panels, job rows, ranked bars.
//
// Two rules these encode, so both dashboards inherit them:
//
//   - State colour goes on the tile that needs attention, not on every tile.
//     If they are all coloured, none of them read as urgent.
//   - Ranked bars are one series, so they take one hue and carry their value as
//     a direct label. Colouring each row differently would imply a category
//     difference that is not there.

import { colors } from "../../styles/theme";

export const TONE = {
  plain: { border: "#efe9e0", surface: "#ffffff", ink: colors.ink, label: colors.muted },
  attn: { border: "#f0c489", surface: "#fdf6ea", ink: "#9a5b0b", label: "#9a5b0b" },
  warning: { border: "#f0b48a", surface: "#fdf3ec", ink: "#8f4413", label: "#8f4413" },
  crit: { border: "#eeb0ac", surface: "#fdf0ef", ink: "#9a2d24", label: "#9a2d24" },
  done: { border: "#b9e0d0", surface: "#f0f9f5", ink: "#4a6b4a", label: "#4a6b4a" },
};

/**
 * The figure is sized from its own length rather than set once, because a peso
 * total has no fixed width — "3" and "₱10,173,218,400" landed in the same box
 * and the long one ran straight out of the tile.
 */
function figureSize(value) {
  const length = String(value).length;
  if (length <= 6) return "1.9rem";
  if (length <= 9) return "1.6rem";
  if (length <= 12) return "1.35rem";
  if (length <= 16) return "1.15rem";
  return "1rem";
}

export function StatTile({ label, value, note, tone = "plain", title }) {
  const shade = TONE[tone] || TONE.plain;
  return (
    <div style={{
      background: shade.surface,
      border: `1px solid ${shade.border}`,
      borderRadius: "7.5px",
      padding: "0.95rem 1rem",
      display: "grid",
      gap: "0.2rem",
      alignContent: "start",
      minWidth: 0,
    }}>
      <span style={{
        fontSize: "0.68rem", fontWeight: 500, letterSpacing: "0.07em",
        textTransform: "uppercase", color: shade.label,
        minWidth: 0, overflowWrap: "anywhere",
      }}>{label}</span>
      <span
        title={title}
        style={{
          fontSize: figureSize(value), fontWeight: 500, lineHeight: 1.1,
          color: shade.ink, fontVariantNumeric: "tabular-nums",
          minWidth: 0, overflowWrap: "anywhere",
        }}
      >{value}</span>
      {note && <span style={{ fontSize: "0.74rem", color: colors.muted, minWidth: 0, overflowWrap: "anywhere" }}>{note}</span>}
    </div>
  );
}

/** Tiles side by side, joined: shared hairline edges, no gaps between them. */
export function TileRow({ children, min = "170px" }) {
  return <div className="dash-joined" style={{
    gridTemplateColumns: `repeat(auto-fit, minmax(${min}, 1fr))`,
  }}>{children}</div>;
}

export function Panel({ title, action, children }) {
  return (
    <section style={{
      background: "#fff",
      border: "1px solid #efe9e0",
      borderRadius: "7.5px",
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: "0.75rem", padding: "0.8rem 1rem", borderBottom: "1px solid #efe9e0",
      }}>
        <h2 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 500, color: colors.ink }}>{title}</h2>
        {action && <span style={{ fontSize: "0.74rem", fontWeight: 500, color: colors.brand }}>{action}</span>}
      </div>
      <div style={{ padding: "0.85rem 1rem", display: "grid", gap: "0.7rem" }}>{children}</div>
    </section>
  );
}

export function Empty({ children }) {
  return <p style={{ margin: 0, color: colors.muted, fontSize: "0.84rem" }}>{children}</p>;
}

/** One appointment line: when, who, where, and the action it is waiting on. */
export function JobRow({ when, title, detail, action, first = false, whenWidth = "66px" }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: "0.7rem",
      paddingTop: first ? 0 : "0.7rem",
      borderTop: first ? "none" : "1px solid #f3eaea",
    }}>
      <span style={{
        flex: "none", width: whenWidth, fontSize: "0.78rem", fontWeight: 500,
        color: colors.ink, fontVariantNumeric: "tabular-nums", paddingTop: "0.1rem",
      }}>{when}</span>
      <span style={{ flex: 1, minWidth: 0, display: "grid", gap: "0.1rem" }}>
        <span style={{ fontSize: "0.87rem", fontWeight: 500, color: colors.ink }}>{title}</span>
        {detail && <span style={{ fontSize: "0.75rem", color: colors.muted }}>{detail}</span>}
      </span>
      {action && <span style={{ flex: "none", alignSelf: "center" }}>{action}</span>}
    </div>
  );
}

export function Chip({ tone = "done", children }) {
  const shade = TONE[tone] || TONE.done;
  return <span style={{
    fontSize: "0.64rem", fontWeight: 500, letterSpacing: "0.05em",
    textTransform: "uppercase", borderRadius: "999px", padding: "0.15rem 0.5rem",
    background: shade.surface, color: shade.ink, border: `1px solid ${shade.border}`,
    whiteSpace: "nowrap",
  }}>{children}</span>;
}

/** Single-series magnitude: one hue, direct labels, no legend. */
export function RankedBars({ rows, format = (value) => value }) {
  const top = Math.max(...rows.map((row) => row.value), 0);
  if (rows.length === 0) return <Empty>Nothing recorded yet.</Empty>;
  return (
    <div style={{ display: "grid", gap: "0.6rem" }}>
      {rows.map((row) => (
        <div key={row.label} style={{ display: "grid", gap: "0.25rem" }}>
          <div style={{
            display: "flex", justifyContent: "space-between", gap: "0.75rem",
            fontSize: "0.8rem", fontWeight: 500, color: colors.body,
          }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</span>
            <span style={{ color: colors.muted, fontVariantNumeric: "tabular-nums", flex: "none" }}>{format(row.value)}</span>
          </div>
          <div style={{ height: "7px", borderRadius: "3.75px", background: "#f3eaea", overflow: "hidden" }}>
            <div style={{
              width: top > 0 ? `${Math.max(2, (row.value / top) * 100)}%` : "0%",
              height: "100%", borderRadius: "3.75px", background: colors.brandLight,
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const PIE_COLORS = ["#a52a25", "#b8794f", "#d6b48a", "#7f1111", "#c08a62", "#8b5e3c", "#d9c3a5"];

export function PieChart({ rows, format = (value) => value, centerLabel = "total", caption = null }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (total === 0) return <Empty>Nothing scheduled yet.</Empty>;

  let offset = 0;
  const stops = rows.map((row, index) => {
    const start = offset;
    offset += (row.value / total) * 100;
    return `${PIE_COLORS[index % PIE_COLORS.length]} ${start}% ${offset}%`;
  });

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(130px, 0.85fr) minmax(0, 1.15fr)", gap: "1rem", alignItems: "center" }}>
      <div style={{ width: "min(150px, 100%)", aspectRatio: "1", margin: "0 auto", borderRadius: "50%", background: `conic-gradient(${stops.join(", ")})`, position: "relative" }}>
        <div style={{ position: "absolute", inset: "27%", borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", textAlign: "center", color: colors.ink, fontSize: "0.8rem", fontWeight: 500, lineHeight: 1.1 }}>
          <span>
            {total}
            <span style={{ display: "block", color: colors.muted, fontSize: "0.62rem", fontWeight: 500 }}>{centerLabel}</span>
          </span>
        </div>
      </div>
      <div style={{ display: "grid", gap: "0.5rem" }}>
        {rows.map((row, index) => (
          <div key={row.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem", minWidth: 0, color: colors.body, fontSize: "0.75rem" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", minWidth: 0 }}>
              <span style={{ width: "9px", height: "9px", flex: "none", borderRadius: "3.75px", background: PIE_COLORS[index % PIE_COLORS.length] }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</span>
            </span>
            <span style={{ flex: "none", color: colors.muted, fontVariantNumeric: "tabular-nums" }}>{format(row.value)}</span>
          </div>
        ))}
      </div>
    </div>
    {caption && <p style={{ margin: 0, color: colors.muted, fontSize: "0.72rem" }}>{caption}</p>}
    </div>
  );
}

export const timeLabel = (value) =>
  new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export const dateLabel = (value) =>
  new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });

/**
 * "Today · 9:00 AM", "Yesterday · 4:30 PM" or "Sep 24 · 9:00 AM". A list that
 * can span days needs the day on every row, or two 9:00s look mis-sorted.
 */
export function whenLabel(value, now = new Date()) {
  const date = new Date(value);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86400000);
  const dayPart = diff === 0 ? "Today" : diff === -1 ? "Yesterday" : diff === 1 ? "Tomorrow" : dateLabel(value);
  return `${dayPart} · ${timeLabel(value)}`;
}
