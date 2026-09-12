import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Agendamento — Dra. Priscila",
  description:
    "Portal de agendamento da Dra. Priscila. Acesso por link mágico, sem login.",
  applicationName: "Agendamento Dra. Priscila",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0066cc",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
