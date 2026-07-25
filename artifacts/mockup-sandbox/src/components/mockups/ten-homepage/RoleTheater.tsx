import { useState } from "react";

const ROLES = [
  {
    id: "intern",
    icon: "✦",
    label: "New Intern",
    tagline: "Start your journey",
    desc: "Register your profile and unlock real-world projects, mentorship, and a professional network.",
    accent: "#D4AF37",
    bg: "linear-gradient(135deg, #1a1200 0%, #2a1e00 100%)",
    border: "rgba(212,175,55,0.5)",
    glow: "rgba(212,175,55,0.2)",
    cta: "Register →",
    href: "register.html",
  },
  {
    id: "student",
    icon: "🎓",
    label: "Student",
    tagline: "Your workspace awaits",
    desc: "Track attendance, submit tasks, and monitor your internship progress in real time.",
    accent: "#60a5fa",
    bg: "linear-gradient(135deg, #071020 0%, #0d1e3a 100%)",
    border: "rgba(96,165,250,0.4)",
    glow: "rgba(96,165,250,0.15)",
    cta: "Login →",
    href: "login.html",
  },
  {
    id: "coordinator",
    icon: "🛡",
    label: "Coordinator",
    tagline: "Lead your cohort",
    desc: "Manage intern cohorts, review deliverables, and generate domain performance reports.",
    accent: "#a78bfa",
    bg: "linear-gradient(135deg, #100a20 0%, #1a1035 100%)",
    border: "rgba(167,139,250,0.4)",
    glow: "rgba(167,139,250,0.15)",
    cta: "Enter Portal →",
    href: "coordinator-login.html",
  },
  {
    id: "hr",
    icon: "👔",
    label: "HR",
    tagline: "Oversee & certify",
    desc: "Manage hiring pipelines, issue completion certificates, and access organisation-wide analytics.",
    accent: "#34d399",
    bg: "linear-gradient(135deg, #001810 0%, #012a1c 100%)",
    border: "rgba(52,211,153,0.4)",
    glow: "rgba(52,211,153,0.15)",
    cta: "Enter Portal →",
    href: "/hr-login",
  },
];

export function RoleTheater() {
  const [active, setActive] = useState<string | null>(null);
  const activeRole = ROLES.find((r) => r.id === active) ?? null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

        .rt-root {
          font-family: 'Inter', system-ui, sans-serif;
          background: #06040e;
          min-height: 100vh;
          color: #fff;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          position: relative;
          transition: background 0.6s cubic-bezier(.4,0,.2,1);
        }

        .rt-bg-wash {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 0;
          transition: opacity 0.6s ease;
        }

        .rt-header {
          position: relative;
          z-index: 20;
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 24px 44px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .rt-logo-ring {
          width: 40px; height: 40px;
          border-radius: 50%;
          border: 1.5px solid rgba(212,175,55,0.5);
          display: flex; align-items: center; justify-content: center;
          background: rgba(212,175,55,0.06);
        }
        .rt-wordmark {
          font-size: 20px; font-weight: 900; letter-spacing: 0.12em;
          background: linear-gradient(135deg, #D4AF37, #f0d060);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .rt-sep { width: 1px; height: 20px; background: rgba(255,255,255,0.1); margin: 0 4px; }
        .rt-sub { font-size: 11px; color: rgba(255,255,255,0.35); letter-spacing: 0.04em; }

        .rt-stage {
          position: relative;
          z-index: 10;
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px 40px;
          gap: 24px;
        }

        .rt-eyebrow {
          text-align: center;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: rgba(212,175,55,0.7);
          transition: color 0.4s;
        }

        .rt-headline {
          text-align: center;
        }
        .rt-headline h1 {
          font-size: 34px; font-weight: 900; letter-spacing: -0.02em;
          margin: 0 0 8px; line-height: 1.1;
          transition: opacity 0.4s;
        }
        .rt-headline h1 em { font-style: normal; }
        .rt-headline p {
          font-size: 13.5px; color: rgba(255,255,255,0.45); margin: 0;
          max-width: 420px; line-height: 1.6;
          transition: opacity 0.4s;
          min-height: 44px;
        }

        .rt-tiles {
          display: flex;
          gap: 12px;
          width: 100%;
          max-width: 860px;
        }

        .rt-tile {
          flex: 1;
          border-radius: 14px;
          padding: 22px 18px 20px;
          cursor: pointer;
          transition: all 0.35s cubic-bezier(.34,1.56,.64,1);
          border: 1.5px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.025);
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 8px;
          position: relative;
          overflow: hidden;
        }
        .rt-tile:hover, .rt-tile.is-active {
          transform: translateY(-6px) scale(1.03);
        }
        .rt-tile-glow {
          position: absolute;
          inset: 0;
          border-radius: 14px;
          opacity: 0;
          transition: opacity 0.4s;
          pointer-events: none;
        }
        .rt-tile.is-active .rt-tile-glow { opacity: 1; }
        .rt-tile-icon {
          font-size: 26px;
          transition: transform 0.3s;
        }
        .rt-tile.is-active .rt-tile-icon { transform: scale(1.2); }
        .rt-tile-label {
          font-size: 13px; font-weight: 700; letter-spacing: 0.01em;
          transition: color 0.3s;
        }
        .rt-tile-sub {
          font-size: 10.5px; color: rgba(255,255,255,0.35);
          letter-spacing: 0.02em;
          transition: color 0.3s;
        }
        .rt-tile-dot {
          width: 6px; height: 6px; border-radius: 50%;
          margin-top: 4px;
          opacity: 0;
          transition: opacity 0.3s;
        }
        .rt-tile.is-active .rt-tile-dot { opacity: 1; }

        .rt-panel {
          width: 100%;
          max-width: 860px;
          border-radius: 16px;
          padding: 28px 32px;
          border: 1.5px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03);
          transition: all 0.4s ease;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
          overflow: hidden;
          min-height: 100px;
        }
        .rt-panel.is-shown {
          border-color: var(--panel-accent-border, rgba(255,255,255,0.12));
          background: var(--panel-bg, rgba(255,255,255,0.03));
          box-shadow: 0 0 40px var(--panel-glow, rgba(255,255,255,0.05));
        }

        .rt-panel-left { flex: 1; }
        .rt-panel-left h3 {
          font-size: 18px; font-weight: 800; margin: 0 0 6px;
          letter-spacing: -0.01em;
        }
        .rt-panel-left p {
          font-size: 12.5px; color: rgba(255,255,255,0.5); margin: 0;
          line-height: 1.55; max-width: 360px;
        }

        .rt-cta-btn {
          padding: 13px 28px;
          border-radius: 10px;
          font-size: 14px; font-weight: 700;
          cursor: pointer; border: none;
          letter-spacing: 0.02em;
          transition: opacity 0.2s, transform 0.2s;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .rt-cta-btn:hover { opacity: 0.88; transform: scale(1.03); }

        .rt-panel-idle {
          text-align: center; width: 100%;
          font-size: 13px; color: rgba(255,255,255,0.2);
          letter-spacing: 0.04em;
        }

        .rt-stats {
          display: flex; gap: 24px; align-items: center;
        }
        .rt-stat-val {
          font-size: 15px; font-weight: 800;
          background: linear-gradient(90deg, #D4AF37, #f0d060);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .rt-stat-lbl { font-size: 10px; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.06em; }
        .rt-stat-sep { width: 1px; height: 24px; background: rgba(255,255,255,0.07); }

        .rt-footer {
          position: relative; z-index: 20;
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 44px;
          font-size: 11px; color: rgba(255,255,255,0.18);
          border-top: 1px solid rgba(255,255,255,0.04);
        }

        @keyframes rt-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .rt-panel-content { animation: rt-fade-in 0.35s ease forwards; }
      `}} />

      <div
        className="rt-root"
        style={{ background: activeRole ? `radial-gradient(ellipse 80% 60% at 50% 0%, ${activeRole.glow} 0%, #06040e 60%)` : "#06040e" }}
      >
        <div className="rt-bg-wash" style={{
          background: activeRole
            ? `radial-gradient(ellipse 60% 50% at 50% 100%, ${activeRole.glow} 0%, transparent 70%)`
            : "none",
          opacity: activeRole ? 1 : 0,
        }} />

        <header className="rt-header">
          <div className="rt-logo-ring">
            <svg viewBox="0 0 24 20" width="18" height="18" fill="none">
              <path d="M4 8C4 6 5.8 4 8 4C10.2 4 12 6 12 8C12 10 10.2 12 8 12C5.8 12 4 10 4 8Z" stroke="#D4AF37" strokeWidth="1.6" fill="none"/>
              <path d="M12 8C12 6 13.8 4 16 4C18.2 4 20 6 20 8C20 10 18.2 12 16 12C13.8 12 12 10 12 8Z" stroke="#D4AF37" strokeWidth="1.6" fill="none"/>
              <path d="M6 19C6 16 7.8 13 10 13L11 16L9 19Z" fill="#D4AF37" opacity="0.8"/>
              <path d="M18 19C18 16 16.2 13 14 13L13 16L15 19Z" fill="#D4AF37" opacity="0.8"/>
            </svg>
          </div>
          <span className="rt-wordmark">TEN</span>
          <div className="rt-sep" />
          <span className="rt-sub">The Entrepreneurship Network</span>
        </header>

        <main className="rt-stage">
          <div className="rt-eyebrow" style={{ color: activeRole ? activeRole.accent : "rgba(212,175,55,0.7)" }}>
            Internship Management System
          </div>

          <div className="rt-headline">
            <h1>
              {activeRole ? (
                <em style={{ color: activeRole.accent }}>{activeRole.label} Portal</em>
              ) : (
                <>Launch Your Career <em style={{ color: "#D4AF37" }}>with TEN</em></>
              )}
            </h1>
            <p>
              {activeRole
                ? activeRole.desc
                : "Real projects, real mentorship, real results. Select your role below to continue."}
            </p>
          </div>

          <div className="rt-tiles">
            {ROLES.map((r) => (
              <div
                key={r.id}
                className={`rt-tile${active === r.id ? " is-active" : ""}`}
                style={active === r.id ? {
                  borderColor: r.border,
                  background: r.bg,
                  boxShadow: `0 0 28px ${r.glow}`,
                } : {}}
                onClick={() => setActive(active === r.id ? null : r.id)}
              >
                <div className="rt-tile-glow" style={{ background: `radial-gradient(circle at 50% 0%, ${r.glow} 0%, transparent 70%)` }} />
                <div className="rt-tile-icon">{r.icon}</div>
                <div className="rt-tile-label" style={active === r.id ? { color: r.accent } : {}}>{r.label}</div>
                <div className="rt-tile-sub" style={active === r.id ? { color: `${r.accent}99` } : {}}>{r.tagline}</div>
                <div className="rt-tile-dot" style={{ background: r.accent }} />
              </div>
            ))}
          </div>

          <div
            className={`rt-panel${activeRole ? " is-shown" : ""}`}
            style={activeRole ? {
              "--panel-accent-border": activeRole.border,
              "--panel-bg": `${activeRole.bg}80`,
              "--panel-glow": activeRole.glow,
            } as React.CSSProperties : {}}
          >
            {activeRole ? (
              <div className="rt-panel-content" key={activeRole.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 24 }}>
                <div className="rt-panel-left">
                  <h3 style={{ color: activeRole.accent }}>{activeRole.label} Portal</h3>
                  <p>{activeRole.desc}</p>
                </div>
                <button
                  className="rt-cta-btn"
                  style={{
                    background: activeRole.id === "intern"
                      ? "linear-gradient(135deg, #D4AF37, #b8941e)"
                      : `rgba(255,255,255,0.06)`,
                    color: activeRole.id === "intern" ? "#000" : activeRole.accent,
                    border: activeRole.id === "intern" ? "none" : `1.5px solid ${activeRole.border}`,
                  }}
                >
                  {activeRole.cta}
                </button>
              </div>
            ) : (
              <div className="rt-panel-idle">↑ Select a role above to continue</div>
            )}
          </div>

          <div className="rt-stats">
            {[["10+", "Domains"], ["500+", "Interns"], ["24/7", "Tracking"]].map(([v, l], i, a) => (
              <>
                <div key={v} style={{ textAlign: "center" }}>
                  <div className="rt-stat-val">{v}</div>
                  <div className="rt-stat-lbl">{l}</div>
                </div>
                {i < a.length - 1 && <div key={`sep-${i}`} className="rt-stat-sep" />}
              </>
            ))}
          </div>
        </main>

        <footer className="rt-footer">
          <span>© 2026 TEN — The Entrepreneurship Network</span>
          <span>Internship Management System</span>
        </footer>
      </div>
    </>
  );
}

export default RoleTheater;
