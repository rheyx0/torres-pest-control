// The frame both sign-in routes share: the form column on parchment and the
// brand-maroon panel beside it. Keeping it in one place is what stops the
// reset page drifting from the sign-in page.
//
// The panel is deliberately minimal: one pest-control fact at a time, in
// large type, fading to the next every few seconds, with dots to jump
// between them. It pauses while the pointer is over it or a dot has focus,
// and stays still for anyone who asks for reduced motion.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

/** Short, plain facts and tips. Kept general enough to be true everywhere. */
export const PEST_FACTS = [
  "Termites work around the clock. They never stop to sleep.",
  "Termites eat wood from the inside out, so damage is often found only once it is serious.",
  "One female cockroach can produce hundreds of young in her lifetime.",
  "A rat can squeeze through a gap about the size of a coin.",
  "Ants leave scent trails so the rest of the colony can follow them to food.",
  "Mosquitoes find you by the carbon dioxide you breathe out.",
  "Bed bugs can go for months without a meal.",
  "Pests are easier to keep out than to remove. Regular treatment is the best defence.",
];

const ROTATE_MS = 7000;

function PestFacts() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (paused || reduced) return undefined;
    const timer = setInterval(() => setIndex((current) => (current + 1) % PEST_FACTS.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused]);

  return (
    <div
      className="auth-facts"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <p className="auth-panel-eyebrow">Did you know?</p>
      {/* Keyed, so each new fact plays the fade-in again. */}
      <blockquote key={index} className="auth-fact">{PEST_FACTS[index]}</blockquote>
      <div className="auth-fact-dots" role="group" aria-label="Pest facts">
        {PEST_FACTS.map((fact, dot) => (
          <button
            key={fact}
            type="button"
            aria-label={`Fact ${dot + 1} of ${PEST_FACTS.length}`}
            aria-current={dot === index ? "true" : undefined}
            className={dot === index ? "is-current" : undefined}
            onClick={() => setIndex(dot)}
          />
        ))}
      </div>
    </div>
  );
}

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

        <p className="auth-footer">© {new Date().getFullYear()} Torres Pest Control · Brgy. Tacunan, Davao City, Philippines</p>
      </main>

      <aside className="auth-panel" aria-label="Pest control facts">
        <PestFacts />
        <p className="auth-panel-foot">Torres Pest Control · Field operations</p>
      </aside>
    </div>
  );
}

export default AuthLayout;
