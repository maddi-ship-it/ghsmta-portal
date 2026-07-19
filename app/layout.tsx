import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Georgia High School Musical Theatre Awards",
    template: "%s | GHSMTA",
  },
  description: "Application and adjudication portal for the Georgia High School Musical Theatre Awards.",
  applicationName: "GHSMTA Awards Portal",
  appleWebApp: {
    capable: true,
    title: "GHSMTA",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070b18",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
