const FEATURES = [
  { icon: "📊", label: "Live Attendance & Performance Tracking" },
  { icon: "🧠", label: "Domain-Specific Expert Coordinators" },
  { icon: "📁", label: "Task Submission & Review System" },
  { icon: "🎓", label: "Internship Certificate & Reports" },
];

const ROLES = [
  { icon: "✦", label: "Register as Intern", accent: "#D4AF37", bg: "rgba(212,175,55,0.12)", border: "rgba(212,175,55,0.5)", primary: true },
  { icon: "🎓", label: "Student Login", accent: "#60a5fa", bg: "rgba(96,165,250,0.07)", border: "rgba(96,165,250,0.3)", primary: false },
  { icon: "🛡", label: "Coordinator", accent: "#a78bfa", bg: "rgba(167,139,250,0.07)", border: "rgba(167,139,250,0.3)", primary: false },
  { icon: "👔", label: "HR Portal", accent: "#34d399", bg: "rgba(52,211,153,0.07)", border: "rgba(52,211,153,0.3)", primary: false },
];

export function UnifiedNarrative() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

        .un-root {
          font-family: 'Inter', system-ui, sans-serif;
          background: #06040e;
          min-height: 100vh;
          color: #fff;
          display: flex;
          flex-direction: column;
          align-items: center;
          overflow: hidden;
          position: relative;
        }

        .un-bg {
          position: fixed; inset: 0; z-index: 0; pointer-events: none;
          background:
            radial-gradient(ellipse 70% 45% at 50% 0%, rgba(212,175,55,0.07) 0%, transparent 60%),
            radial-gradient(ellipse 50% 40% at 20% 80%, rgba(96,165,250,0.05) 0%, transparent 60%),
            radial-gradient(ellipse 50% 40% at 80% 80%, rgba(167,139,250,0.05) 0%, transparent 60%);
        }

        .un-grid-lines {
          position: fixed; inset: 0; z-index: 0; pointer-events: none;
          background-image:
            linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
          background-size: 60px 60px;
          mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%);
        }

        .un-nav {
          position: relative; z-index: 20;
          width: 100%; max-width: 900px;
          display: flex; align-items: center; justify-content: space-between;
          padding: 24px 0;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .un-brand { display: flex; align-items: center; gap: 10px; }
        .un-logo-sq {
          width: 32px; height: 32px;
          border-radius: 7px;
          background: rgba(212,175,55,0.08);
          border: 1.5px solid rgba(212,175,55,0.4);
          display: flex; align-items: center; justify-content: center;
        }
        .un-wordmark {
          font-size: 18px; font-weight: 900; letter-spacing: 0.14em;
          background: linear-gradient(135deg, #D4AF37, #f0d060);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .un-tagline { font-size: 10px; color: rgba(255,255,255,0.3); letter-spacing: 0.04em; }
        .un-nav-right { font-size: 11px; color: rgba(255,255,255,0.2); }

        .un-hero {
          position: relative; z-index: 10;
          width: 100%; max-width: 900px;
          text-align: center;
          padding: 52px 0 36px;
          display: flex; flex-direction: column; align-items: center; gap: 16px;
        }

        .un-badge {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 5px 14px;
          border-radius: 100px;
          background: rgba(212,175,55,0.08);
          border: 1px solid rgba(212,175,55,0.25);
          font-size: 11px; font-weight: 600; letter-spacing: 0.08em;
          color: rgba(212,175,55,0.85);
          text-transform: uppercase;
        }
        .un-badge-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: #D4AF37;
          animation: un-pulse 2s ease-in-out infinite;
        }
        @keyframes un-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.7); }
        }

        .un-h1 {
          font-size: 52px; font-weight: 900; letter-spacing: -0.035em;
          margin: 0; line-height: 1.05;
        }
        .un-h1 span {
          background: linear-gradient(135deg, #D4AF37 0%, #f5e070 40%, #D4AF37 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .un-sub {
          font-size: 16px; color: rgba(255,255,255,0.45); line-height: 1.6; max-width: 480px; margin: 0;
        }

        .un-divider {
          width: 48px; height: 2px;
          background: linear-gradient(90deg, transparent, rgba(212,175,55,0.4), transparent);
          border-radius: 1px;
          margin: 4px 0;
        }

        .un-roles {
          display: flex; gap: 10px; align-items: stretch; flex-wrap: wrap; justify-content: center;
          width: 100%; max-width: 900px;
          position: relative; z-index: 10;
        }
        .un-role-pill {
          display: flex; align-items: center; gap: 9px;
          padding: 13px 22px;
          border-radius: 12px;
          font-size: 13.5px; font-weight: 700;
          cursor: pointer; border: none;
          letter-spacing: 0.01em;
          transition: transform 0.25s cubic-bezier(.34,1.56,.64,1), box-shadow 0.25s, opacity 0.2s;
          white-space: nowrap;
        }
        .un-role-pill:hover { transform: translateY(-3px); opacity: 0.9; }
        .un-role-pill-icon { font-size: 16px; }

        .un-features {
          position: relative; z-index: 10;
          width: 100%; max-width: 900px;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          padding-top: 8px;
        }
        .un-feat {
          background: rgba(255,255,255,0.025);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          padding: 18px 16px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .un-feat-icon { font-size: 20px; }
        .un-feat-label { font-size: 12px; color: rgba(255,255,255,0.5); line-height: 1.4; font-weight: 500; }

        .un-stats-bar {
          position: relative; z-index: 10;
          width: 100%; max-width: 900px;
          display: flex; gap: 0; border-radius: 14px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.02);
        }
        .un-stat-cell {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; padding: 16px 12px; gap: 3px;
          border-right: 1px solid rgba(255,255,255,0.05);
        }
        .un-stat-cell:last-child { border-right: none; }
        .un-stat-val {
          font-size: 20px; font-weight: 900;
          background: linear-gradient(90deg, #D4AF37, #f0d060);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .un-stat-lbl { font-size: 10px; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.07em; }

        .un-footer {
          position: relative; z-index: 20;
          width: 100%; max-width: 900px;
          text-align: center;
          padding: 18px 0 24px;
          font-size: 11px; color: rgba(255,255,255,0.18);
          border-top: 1px solid rgba(255,255,255,0.04);
          margin-top: 20px;
        }

        @keyframes un-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        .un-floating { animation: un-float 5s ease-in-out infinite; }
      `}} />

      <div className="un-root">
        <div className="un-bg" />
        <div className="un-grid-lines" />

        <nav className="un-nav">
          <div className="un-brand">
            <div className="un-logo-sq">
              <svg viewBox="0 0 24 20" width="18" height="18" fill="none">
                <path d="M4 8C4 6 5.8 4 8 4C10.2 4 12 6 12 8C12 10 10.2 12 8 12C5.8 12 4 10 4 8Z" stroke="#D4AF37" strokeWidth="1.6" fill="none"/>
                <path d="M12 8C12 6 13.8 4 16 4C18.2 4 20 6 20 8C20 10 18.2 12 16 12C13.8 12 12 10 12 8Z" stroke="#D4AF37" strokeWidth="1.6" fill="none"/>
                <path d="M6 19C6 16 7.8 13 10 13L11 16L9 19Z" fill="#D4AF37" opacity="0.8"/>
                <path d="M18 19C18 16 16.2 13 14 13L13 16L15 19Z" fill="#D4AF37" opacity="0.8"/>
              </svg>
            </div>
            <div>
              <div className="un-wordmark">TEN</div>
              <div className="un-tagline">The Entrepreneurship Network</div>
            </div>
          </div>
          <div className="un-nav-right">Internship Management System · 2026</div>
        </nav>

        <section className="un-hero">
          <div className="un-badge">
            <div className="un-badge-dot" />
            Platform Open · 2026 Cohort
          </div>

          <h1 className="un-h1">
            Launch Your Career<br />
            <span>with TEN</span>
          </h1>

          <p className="un-sub">
            A professional internship platform for tomorrow's entrepreneurs. Real projects, real mentorship, real results.
          </p>

          <div className="un-divider" />
        </section>

        <div className="un-roles">
          {ROLES.map((r) => (
            <button
              key={r.label}
              className="un-role-pill"
              style={{
                background: r.primary
                  ? "linear-gradient(135deg, #D4AF37 0%, #b8941e 100%)"
                  : r.bg,
                color: r.primary ? "#000" : r.accent,
                border: r.primary ? "none" : `1.5px solid ${r.border}`,
                boxShadow: r.primary ? `0 4px 24px rgba(212,175,55,0.25)` : "none",
              }}
            >
              <span className="un-role-pill-icon">{r.icon}</span>
              {r.label}
            </button>
          ))}
        </div>

        <div style={{ height: 28 }} />

        <div className="un-features">
          {FEATURES.map((f) => (
            <div key={f.label} className="un-feat">
              <div className="un-feat-icon">{f.icon}</div>
              <div className="un-feat-label">{f.label}</div>
            </div>
          ))}
        </div>

        <div style={{ height: 16 }} />

        <div className="un-stats-bar">
          {[["10+", "Domains"], ["500+", "Interns Placed"], ["24/7", "Live Tracking"], ["4", "User Portals"]].map(([v, l]) => (
            <div key={l} className="un-stat-cell">
              <div className="un-stat-val">{v}</div>
              <div className="un-stat-lbl">{l}</div>
            </div>
          ))}
        </div>

        <footer className="un-footer">
          © 2026 TEN — The Entrepreneurship Network · Internship Management System
        </footer>
      </div>
    </>
  );
}

export default UnifiedNarrative;
