import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BrandFrame — AI-Native Video Platform",
  description: "Semantic search, chat-with-video, and provenance-tracked in-scene pause ads. Built for the Backblaze Generative Media Hackathon.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn(inter.variable, jetbrainsMono.variable, "font-sans antialiased")}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <div className="flex min-h-screen flex-col">
            <header className="border-b border-border">
              <div className="container mx-auto flex h-14 items-center justify-between px-4">
                <a href="/" className="flex items-center gap-2">
                  <span className="text-xl font-bold text-primary">BrandFrame</span>
                </a>
                <nav className="flex items-center gap-4">
                  <a href="/search" className="text-sm text-muted-foreground hover:text-foreground">Search</a>
                  <a href="/studio" className="text-sm text-muted-foreground hover:text-foreground">Studio</a>
                </nav>
              </div>
            </header>
            <main className="flex-1">{children}</main>
            <footer className="border-t border-border py-6">
              <div className="container mx-auto px-4 text-center text-xs text-muted-foreground">
                BrandFrame — Backblaze Generative Media Hackathon 2026
              </div>
            </footer>
          </div>
          <Toaster position="bottom-right" theme="dark" />
        </ThemeProvider>
      </body>
    </html>
  );
}
