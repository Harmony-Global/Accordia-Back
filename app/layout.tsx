import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Accordia API",
  description: "Accordia backend API"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
