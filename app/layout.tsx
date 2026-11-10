import type { Metadata } from "next";
import { Syne, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const syne = Syne({ variable: "--font-syne", subsets: ["latin"], weight: ["700", "800"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono-jb", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Coinsel",
  description: "Counsel for your coins. Never control.",
};

// Runs before first paint so there is no flash of the wrong theme. Saved choice wins; otherwise follow the system.
const THEME_SCRIPT = `try{var t=localStorage.getItem("coinsel-theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";if(t==="light")document.documentElement.classList.add("light")}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${syne.variable} ${inter.variable} ${mono.variable} h-full antialiased`}>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
