// Grey placeholder shapes shown while a list loads, in place of "Loading…"
// text: the page keeps its shape, so nothing jumps when the data arrives.
// The words are still there for screen readers (and tests), visually hidden.

/** One shimmering bar. */
export function SkeletonBar({ width = "100%", height = "12px", style }) {
  return <span aria-hidden="true" className="skeleton" style={{ display: "block", width, height, ...style }} />;
}

/** A few lines of placeholder, e.g. a card's body or a list. */
function Skeleton({ label = "Loading…", lines = 4, style }) {
  const widths = ["92%", "76%", "84%", "64%", "88%", "70%"];
  return (
    <div role="status" style={{ display: "grid", gap: "10px", padding: "16px 18px", ...style }}>
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <SkeletonBar key={index} width={widths[index % widths.length]} />
      ))}
    </div>
  );
}

export default Skeleton;
