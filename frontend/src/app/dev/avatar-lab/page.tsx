import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AvatarLab } from "@/components/avatar-lab/avatar-lab"

// Laboratório de desenvolvimento do avatar: reproduz capturas REAIS do Gemini Live pelas peças de
// produção (transporte, reprodução, lip-sync, driver, avatar 3D) sem login e sem custo de API. Fora
// do matcher do proxy (sem sessão) e inexistente em produção.
export const metadata: Metadata = {
  title: "INIA · Laboratório do avatar",
  robots: { index: false, follow: false },
}

export default function AvatarLabPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <AvatarLab />
}
