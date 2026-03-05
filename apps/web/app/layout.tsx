import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { Web3Provider } from "@/components/providers/Web3Provider"
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
        <Web3Provider>
          {children}
          <Toaster position="bottom-right" richColors />
        </Web3Provider>
      </body>
    </html>
  )
}
