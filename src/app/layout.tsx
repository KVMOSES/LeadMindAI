import type { Metadata } from "next";
import { Space_Grotesk, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/lm/theme-provider";

// ── LeadMind AI type system ──────────────────────────────────────────────────
// Display  : Space Grotesk — expressive brand headings + dashboard metrics.
// Interface: Plus Jakarta Sans — polished, readable body typography.
// Data     : JetBrains Mono — metrics, IDs, scores, code, technical labels.

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" fill="none"><defs><linearGradient id="g" x1="12" y1="37" x2="42" y2="11" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8b5cf6"/><stop offset="0.52" stop-color="#6366f1"/><stop offset="1" stop-color="#38bdf8"/></linearGradient><linearGradient id="r" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8b5cf6" stop-opacity="0.55"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0.35"/></linearGradient></defs><rect x="0.75" y="0.75" width="46.5" height="46.5" rx="12.5" fill="#101319" stroke="url(#r)" stroke-width="1.5"/><path d="M13 11V35.5H23.5" stroke="url(#g)" stroke-width="4.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.5 35.5L29.5 19.5L34.5 29.5L41.5 12" stroke="url(#g)" stroke-width="4.25" stroke-linecap="round" stroke-linejoin="round"/><circle cx="13" cy="11" r="2.4" fill="#c4b5fd"/><circle cx="29.5" cy="19.5" r="2.4" fill="#c4b5fd"/><circle cx="34.5" cy="29.5" r="2.4" fill="#7dd3fc"/><circle cx="41.5" cy="12" r="6" fill="#a3e635" opacity="0.22"/><circle cx="41.5" cy="12" r="3.6" fill="#a3e635"/></svg>',
  );

export const metadata: Metadata = {
  title: "LeadMind AI — Conversational Sales Intelligence",
  description:
    "AI-powered lead intelligence: customer fit, buying intent, conversion predictions, next-best-actions and a conversational copilot connected to your live pipeline data.",
  keywords: ["LeadMind", "sales intelligence", "lead scoring", "AI copilot", "conversion prediction"],
  icons: {
    icon: FAVICON,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${spaceGrotesk.variable} ${jakarta.variable} ${jetbrains.variable} font-sans antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          {children}
          <Toaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
