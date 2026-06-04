import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Chivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Chivo({ subsets: ["latin"], weight: ["400", "500", "700", "900"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "PR Factory — Agent Control",
  description: "Dispatch coding agents into sandboxes and watch them open PRs, live.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
