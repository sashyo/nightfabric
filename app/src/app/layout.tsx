import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "NIGHTFABRIC // Sanctum-9",
  description:
    "A cyberpunk open world where the locks are real: threshold identity, server-side clearance, and end-to-end encrypted loot.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="scanlines">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
