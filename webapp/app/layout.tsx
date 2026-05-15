import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Email Finder",
  description: "SMTP-based email verification tool",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.className} bg-gray-50 min-h-screen`}>
        <nav className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <Link href="/" className="font-bold text-lg tracking-tight">Email Finder</Link>
            <div className="flex gap-6 text-sm font-medium text-gray-600">
              <Link href="/" className="hover:text-gray-900">Single</Link>
              <Link href="/batch" className="hover:text-gray-900">Batch / CSV</Link>
              <Link href="/history" className="hover:text-gray-900">History</Link>
              <Link href="/settings" className="hover:text-gray-900">Settings</Link>
            </div>
          </div>
        </nav>
        <main className="max-w-5xl mx-auto px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
