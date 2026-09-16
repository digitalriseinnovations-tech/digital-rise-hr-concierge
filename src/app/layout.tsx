import "./globals.css";
import type { Metadata } from "next";
import { getProductBranding } from "@/lib/product-mode";

const branding = getProductBranding();

export const metadata: Metadata = {
  title: branding.fullName,
  description: `${branding.fullName}. Restricted access.`,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
