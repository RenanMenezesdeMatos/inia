"use client"

import { Button } from "@/components/ui/button"
import type { AvatarLabController, LabSnapshot } from "@/lib/avatar/lab/lab-controller"
import { LabSection } from "./lab-fields"

/**
 * "Gravar demonstração": Canvas do avatar (30 fps) + o áudio exato do alto-falante → WebM. Com
 * `?upload=http://127.0.0.1:PORTA/caminho` na URL, o vídeo também é enviado a esse receptor local.
 */
export function LabRecorderPanel({ controller, snapshot, uploadTarget }: { controller: AvatarLabController; snapshot: LabSnapshot; uploadTarget: string | null }) {
  const recording = snapshot.recording
  const busy = recording.status === "recording" || recording.status === "processing"
  return (
    <LabSection title="Gravar demonstração" description="WebM (VP9/Opus; VP8 se o navegador não tiver VP9). O áudio é o que sai do alto-falante do motor ativo.">
      <div className="flex flex-wrap items-center gap-2">
        {recording.status === "recording" ? (
          <Button size="sm" variant="destructive" onClick={() => void controller.stopRecording()}>
            Parar gravação
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => controller.startRecording()}>
            Gravar demonstração
          </Button>
        )}
        <span className="text-xs text-muted-foreground">{uploadTarget ? `Upload automático: ${uploadTarget}` : "Sem ?upload= na URL: só download."}</span>
      </div>
      {recording.status === "recording" ? (
        <p className="flex items-center gap-2 text-xs">
          <span className="inline-block size-2 animate-pulse rounded-full bg-red-500" />
          Gravando {recording.label} · {recording.mimeType}
          {recording.hasAudio ? "" : " · SEM áudio (toque Play antes para criar o contexto de áudio)"}
        </p>
      ) : null}
      {recording.status === "processing" ? <p className="text-xs text-muted-foreground">Finalizando o arquivo…</p> : null}
      {recording.status === "done" ? (
        <div className="space-y-1 text-xs">
          <a className="font-medium text-primary underline" href={recording.url} download={recording.fileName}>
            Baixar {recording.fileName}
          </a>
          <span className="ml-2 text-muted-foreground">
            {(recording.bytes / 1024 / 1024).toFixed(1)} MB · {recording.mimeType}
          </span>
          {recording.upload ? <p className="text-muted-foreground">Upload: {recording.upload}</p> : null}
        </div>
      ) : null}
      {recording.status === "error" ? <p className="text-xs text-destructive">{recording.message}</p> : null}
    </LabSection>
  )
}
