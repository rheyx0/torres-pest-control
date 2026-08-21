// CRA resolves its entry point from `src/index` — the filename is fixed.
// (`main.jsx` is a Vite convention and would not be found; see
// node_modules/react-scripts/config/paths.js.)

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
