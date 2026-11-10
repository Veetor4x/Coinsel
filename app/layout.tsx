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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${syne.variable} ${inter.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
