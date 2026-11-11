"use client"

import type { AvatarView } from "@/components/operator/inia-humanoid-avatar-3d"
import type { AvatarQuality } from "@/lib/avatar/animation/types"
import { LAB_MODEL_URLS, LAB_MOTION_PROFILES, type LabModelUrl, type LabMotionProfile } from "@/lib/avatar/lab/lab-models"
import { LabSection, LabSelect } from "./lab-fields"

const VIEW_OPTIONS = [
  { value: "chat", label: "Chat (enquadramento do produto)" },
  { value: "front", label: "Frente" },
  { value: "threequarter", label: "Três quartos" },
  { value: "presenting", label: "Apresentando (sessão de feedback)" },
  { value: "profile", label: "Perfil" },
  { value: "back", label: "Costas" },
  { value: "full", label: "Corpo inteiro" },
] as const satisfies ReadonlyArray<{ value: AvatarView; label: string }>

const QUALITY_OPTIONS = [
  { value: "auto", label: "Automática (como no produto)" },
  { value: "high", label: "Alta" },
  { value: "medium", label: "Média" },
  { value: "low", label: "Baixa" },
] as const satisfies ReadonlyArray<{ value: AvatarQuality | "auto"; label: string }>

type Props = {
  modelUrl: LabModelUrl
  mentoraAvailable: boolean | null
  onModelUrl: (url: LabModelUrl) => void
  view: AvatarView
  onView: (view: AvatarView) => void
  quality: AvatarQuality | "auto"
  onQuality: (quality: AvatarQuality | "auto") => void
  motion: LabMotionProfile
  onMotion: (motion: LabMotionProfile) => void
}

export function LabAppearancePanel({ modelUrl, mentoraAvailable, onModelUrl, view, onView, quality, onQuality, motion, onMotion }: Props) {
  const modelOptions = LAB_MODEL_URLS.map((model) => ({
    value: model.url,
    label: model.url === "/models/inia-mentora.glb" && mentoraAvailable === false ? `${model.label} (ainda não existe)` : model.label,
    disabled: model.url === "/models/inia-mentora.glb" && mentoraAvailable === false,
  }))
  return (
    <LabSection title="Modelo, vista e qualidade" description="Vista e qualidade mudam por ref (o Canvas não re-renderiza); trocar o modelo recria a cena.">
      <LabSelect label="Modelo (GLB)" value={modelUrl} options={modelOptions} onChange={onModelUrl} />
      <div className="grid gap-3 sm:grid-cols-2">
        <LabSelect label="Vista" value={view} options={VIEW_OPTIONS} onChange={onView} />
        <LabSelect label="Qualidade" value={quality} options={QUALITY_OPTIONS} onChange={onQuality} />
      </div>
      <LabSelect label="Perfil de movimento" value={motion} options={LAB_MOTION_PROFILES} onChange={onMotion} />
      <p className="text-xs text-muted-foreground">
        A qualidade inicial (antialias) é decidida quando o Canvas nasce; depois só DPR e detalhes mudam.
      </p>
    </LabSection>
  )
}
