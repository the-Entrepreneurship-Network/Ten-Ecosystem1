import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono, Syne } from "next/font/google";
import "./globals.css";

// TEN's own pairing, read off ten-theme.css on the live intern portal:
// Syne for display, DM Sans for body, JetBrains Mono for code. Self-hosted
// through next/font, so there is no render-blocking request to Google and no
// layout shift when the face swaps in.
const syne = Syne({
  variable: "--font-geist-sans-display",
  subsets: ["latin"],
  display: "swap",
  weight: ["600", "700", "800"],
});

const dmSans = DM_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TEN Project Assistant",
  description:
    "An AI mentor for students on virtual internships with The Entrepreneurship Network. Scope your project, plan your weeks, research properly, and submit work you are proud of.",
  applicationName: "TEN Project Assistant",
  authors: [{ name: "The Entrepreneurship Network" }],
  openGraph: {
    title: "TEN Project Assistant",
    description:
      "Scope your project, plan your weeks, research properly, and finish your TEN internship with excellence.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0A",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // Zoom stays available. Locking it is an accessibility failure, not a polish move.
  maximumScale: 5,
};

/**
 * Decides before first paint whether the ceremony should play, so a returning
 * navigation never flashes a curtain it is about to remove. Doing this in an
 * effect would be one painted frame too late.
 */
const INTRO_GATE = `try{document.documentElement.dataset.tenIntro=sessionStorage.getItem("ten.intro.played.v1")?"off":"on"}catch(e){document.documentElement.dataset.tenIntro="on"}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the gate below rewrites this attribute before
    // React ever hydrates, exactly like a theme-flash script.
    // The font variables belong on <html>, not <body>. `--font-sans` is
    // declared in @theme at :root and its value is `var(--font-geist-sans)`,
    // which is resolved where it is *declared*, not where it is used. With the
    // next/font class on <body> that reference was invalid at computed-value
    // time, so `--font-sans` came out empty and every surface silently fell
    // back to system-ui.
    <html
      lang="en"
      data-ten-intro="on"
      suppressHydrationWarning
      className={`${dmSans.variable} ${syne.variable} ${jetbrains.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: INTRO_GATE }} />
        {/* When the ceremony has already played this session, the curtain is
            hidden and the workspace is revealed in the same pre-paint pass.
            Waiting for hydration to reveal it would trade a curtain flash for a
            blank black screen, which lasts strictly longer. */}
        <style>{`html[data-ten-intro="off"] .intro-curtain{display:none}html[data-ten-intro="off"] .app-frame{opacity:1!important;transform:none!important}`}</style>
      </head>
      <body className="grain antialiased">
        {children}
      </body>
    </html>
  );
}
