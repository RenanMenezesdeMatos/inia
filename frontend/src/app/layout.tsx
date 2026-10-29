//src\app\layout.tsx

import type { Metadata } from "next"
import { Atkinson_Hyperlegible, Atkinson_Hyperlegible_Next, IBM_Plex_Mono } from "next/font/google"
import { headers } from "next/headers"

import { CSP_NONCE_HEADER } from "@/lib/security/content-security-policy"
import { cn } from "@/lib/utils"
import { Providers } from "./providers"
import "./globals.css"

export const metadata: Metadata = {
  title: "INIA",
  description: "INIA - Experiência logada",
}

const atkinson = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-atkinson",
})

// Fala citada no feedback (`RichContent quotes="emphasis"`): a versão nova da mesma família, só em itálico fino — a Atkinson Hyperlegible
// do texto não tem peso abaixo de 400. Sem preload: só as telas com feedback usam.
const atkinsonNext = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  weight: ["300"],
  style: ["italic"],
  display: "swap",
  preload: false,
  variable: "--font-atkinson-next",
})

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-plex-mono",
})

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Nonce da CSP desta requisição (src/proxy.ts) para o script de tema do next-themes. Ler o cabeçalho torna TODAS as páginas
  // dinâmicas, de propósito: página pré-renderizada no build não tem como levar o nonce e teria os próprios scripts bloqueados.
  const nonce = (await headers()).get(CSP_NONCE_HEADER) ?? undefined
  return (
    <html lang="pt-BR" suppressHydrationWarning className={cn(atkinson.variable, atkinsonNext.variable, plexMono.variable)}>
      <body className="font-sans" suppressHydrationWarning>
        {/* Todos os providers de cliente (tema, acessibilidade, query, tooltip, toaster) vivem em UM lugar: ./providers.tsx. */}
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  )
}
