//src\app\layout.tsx

import type { Metadata } from "next"
import localFont from "next/font/local"
import { headers } from "next/headers"

import { CSP_NONCE_HEADER } from "@/lib/security/content-security-policy"
import { cn } from "@/lib/utils"
import { Providers } from "./providers"
import "./globals.css"

export const metadata: Metadata = {
  title: "INIA",
  description: "INIA - Experiência logada",
}

// Fontes servidas pelo próprio app (src/app/fonts, licença SIL OFL 1.1 ao lado de cada família): o build não busca nada no Google
// Fonts — a VM da empresa não tem saída para a internet. Só o conjunto "latin" (todo o português, aspas, travessão, €), o mesmo que
// o next/font/google pré-carregava; caractere fora dele cai na fonte do sistema.
const atkinson = localFont({
  src: [
    { path: "./fonts/atkinson-hyperlegible-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/atkinson-hyperlegible-700-latin.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-atkinson",
})

// Fala citada no feedback (`RichContent quotes="emphasis"`): a versão nova da mesma família, só em itálico fino — a Atkinson Hyperlegible
// do texto não tem peso abaixo de 400. Sem preload: só as telas com feedback usam.
const atkinsonNext = localFont({
  src: [{ path: "./fonts/atkinson-hyperlegible-next-300-italic-latin.woff2", weight: "300", style: "italic" }],
  display: "swap",
  preload: false,
  variable: "--font-atkinson-next",
})

const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500-latin.woff2", weight: "500", style: "normal" },
  ],
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
