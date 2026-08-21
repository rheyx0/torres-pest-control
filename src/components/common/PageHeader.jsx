// The eyebrow + title block repeated at the top of every page.

import { colors } from "../../styles/theme";

function PageHeader({ eyebrow, title, actions }) {
  return (
    <div
      style={{
        marginBottom: "1.5rem",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        gap: "1rem",
        flexWrap: "wrap",
      }}
    >
      <div>
        {eyebrow && (
          <p
            style={{
              margin: 0,
              color: colors.brandInk,
              fontWeight: 800,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontSize: "0.72rem",
            }}
          >
            {eyebrow}
          </p>
        )}
        <h1 style={{ margin: "0.3rem 0 0", fontSize: "2.2rem", color: colors.ink, fontWeight: 800 }}>
          {title}
        </h1>
      </div>
      {actions}
    </div>
  );
}

export default PageHeader;
