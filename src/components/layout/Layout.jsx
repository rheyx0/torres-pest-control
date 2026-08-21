// Sidebar + content shell for every authenticated page.
//
// This markup used to be inlined in App.js around <Routes>. As a component it
// can wrap routes individually, which is what lets the login and landing
// pages opt out of the chrome.

import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import { appBackground } from "../../styles/theme";

function Layout({ children }) {
  return (
    <div className="app-shell" style={{ background: appBackground }}>
      <Sidebar />
      <div className="app-content" style={{ padding: "2.25rem 2rem 2.5rem", background: "transparent" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
          <Navbar />
          {children || <Outlet />}
        </div>
      </div>
    </div>
  );
}

export default Layout;
