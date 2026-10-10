"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import type { AvatarLabController, LabSnapshot } from "@/lib/avatar/lab/lab-controller"
import { LabSection } from "./lab-fields"

/**
 * "Falar texto (Live real)": o mesmo motor de produção, mas com a sessão de voz de VERDADE (cookie
 * de login + API do Gemini, com custo). Sem login a sessão é recusada e a tela diz por quê.
 */
export function LabLivePanel({ controller, snapshot }: { controller: AvatarLabController; snapshot: LabSnapshot }) {
  const [text, setText] = useState("Diga em uma frase curta: bom dia, vamos revisar os seus indicadores de hoje?")
  const liveActive = snapshot.source === "live"

  return (
    <LabSection title="Falar texto (Live real)" description="Usa a sessão real do Gemini Live: só funciona logado na INIA nesta origem e consome a API.">
      <textarea
        className="min-h-20 w-full rounded-md border bg-background p-2 text-sm"
        value={text}
        maxLength={1200}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!text.trim() || (liveActive && snapshot.connecting)} onClick={() => controller.speakLive(text)}>
          Falar texto (Live real)
        </Button>
        <Button size="sm" variant="outline" disabled={!liveActive} onClick={() => controller.disconnectLive()}>
          Encerrar sessão real
        </Button>
        <span className="text-xs text-muted-foreground">
          Fonte ativa: <strong>{liveActive ? "sessão real" : "capturas"}</strong>
          {liveActive ? (snapshot.connected ? " · conectada" : snapshot.connecting ? " · conectando…" : " · desconectada") : null}
        </span>
      </div>
      {snapshot.liveError ? <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">{snapshot.liveError}</p> : null}
    </LabSection>
  )
}
