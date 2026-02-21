import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { AppShell } from "@/components/layout/AppShell"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Ciel",
  description: "AI-Powered Chainlink CRE Workflow Marketplace",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <AppShell>{children}</AppShell>
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  )
}
