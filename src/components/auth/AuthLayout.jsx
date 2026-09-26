// The frame both sign-in routes share: the form column on parchment and the
// brand-maroon panel with its line drawing. Keeping it in one place is what
// stops the reset page drifting from the sign-in page.
//
// The panel was the charcoal-olive inverted surface; it is maroon now, the
// same brand colour as the app's primary actions, so signing in looks like
// the product it opens onto.

import { Link } from "react-router-dom";
import { CalendarCheck, Check, ClipboardCheck, FlaskConical, Lock } from "lucide-react";

/**
 * A protected home: the house, a shield with a check over it, a technician's
 * sprayer, and a pest ruled out — cream strokes on maroon.
 */
function HouseArt() {
  return (
    <svg
      className="auth-art"
      viewBox="0 0 460 250"
      fill="none"
      stroke="#f5e6d0"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* Ground, with low grass at both ends. */}
      <path d="M30 222h400" />
      <path d="M36 222c6-10 12-10 16 0M404 222c5-9 11-9 15 0M60 222c4-7 9-7 12 0" />

      {/* The house. */}
      <path d="M150 222V146h124v76" />
      <path d="M134 156l78-58 78 58" />
      <path d="M244 118V94h14v34" />
      <path d="M198 222v-42h28v42" />
      <path d="M166 162h22v20h-22zM236 162h22v20h-22z" />
      <path d="M177 162v20M166 172h22M247 162v20M236 172h22" />

      {/* A shield over the roof, checked: the home is protected. */}
      <path d="M194 34c12 6 24 6 36 0v26c0 16-12 27-18 30-6-3-18-14-18-30z" />
      <path d="M204 60l7 7 14-15" />

      {/* The technician's sprayer: tank, hose, wand, and a light mist. */}
      <path d="M318 222v-52a10 10 0 0 1 10-10h16a10 10 0 0 1 10 10v52z" />
      <path d="M326 160v-10h20v10" />
      <path d="M336 150v-10" />
      <path d="M354 186c20 0 26-16 40-30" />
      <path d="M394 156l14-12" />
      <path d="M414 136l6-3M416 144l7 0M413 151l6 4" strokeDasharray="1 4" />

      {/* A pest, ruled out. */}
      <circle cx="84" cy="176" r="26" />
      <path d="M66 158l36 36" />
      <ellipse cx="84" cy="180" rx="7" ry="10" />
      <circle cx="84" cy="166" r="4" />
      <path d="M77 176l-8-4M77 182h-9M77 188l-8 4M91 176l8-4M91 182h9M91 188l8 4M82 162l-3-6M86 162l3-6" />
    </svg>
  );
}

/** What the system is for, in three lines. */
const PILLARS = [
  { Icon: CalendarCheck, title: "Scheduling and dispatch", text: "Every visit, crew and recurring plan on one calendar." },
  { Icon: ClipboardCheck, title: "Service reports on site", text: "Findings, photos and the client's signature, filed from the field." },
  { Icon: FlaskConical, title: "Chemicals by batch", text: "Stock tracked by lot and expiry, used soonest-expiring first." },
];

function AuthLayout({ children }) {
  return (
    <div className="auth-page">
      <main className="auth-form-side">
        <Link to="/login" className="auth-brand" aria-label="Torres Pest Control">
          <img src="/login-logo.png" alt="" />
          <span>
            <span className="auth-brand-name">Torres</span>
            <span className="auth-brand-sub">Pest Control</span>
          </span>
        </Link>

        <div className="auth-form">{children}</div>

        <p className="auth-footer">© {new Date().getFullYear()} Torres Pest Control · Quezon City</p>
      </main>

      <aside className="auth-panel" aria-label="About this system">
        <p className="auth-panel-eyebrow">Torres Pest Control · Field operations</p>
        <h2>Every visit, report and litre accounted for.</h2>
        <ul className="auth-pillars">
          {PILLARS.map(({ Icon, title, text }) => (
            <li key={title}>
              <span className="auth-pillar-icon" aria-hidden="true">
                <Icon size={18} strokeWidth={1.6} />
              </span>
              <span>
                <strong>{title}</strong>
                <span>{text}</span>
              </span>
            </li>
          ))}
        </ul>
        <HouseArt />
        <ul className="auth-trust">
          <li>
            <Lock size={14} strokeWidth={1.6} aria-hidden="true" />
            Accounts managed by your admin
          </li>
          <li>
            <Check size={14} strokeWidth={1.6} aria-hidden="true" />
            Deactivated accounts lose access immediately
          </li>
        </ul>
      </aside>
    </div>
  );
}

export default AuthLayout;
