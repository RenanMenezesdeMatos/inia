"use client"

import { useState } from "react"
import { AlarmClock, BadgeCheck, Camera, ChartPie, ChevronLeft, CircleCheckBig, ImageIcon, PencilLine, UsersRound } from "lucide-react"

import { ProfileSeal, sealLevelPriority, type SealLevel } from "@/components/operator/profile-seal"
import { CoverArt } from "@/components/profile/cover-art"
import { useProfileEditor } from "@/components/profile/edit-profile/profile-editor-context"
import { PersonAvatar } from "@/components/profile/person-avatar"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { DEFAULT_COVER, professionalLineOf, type CoverPresentation } from "@/schemas/profile/my-profile.schema"

/** A pessoa EXIBIDA no perfil (a visitada — ou a própria, quando é o próprio perfil). Sempre vinda do backend. */
export type ProfileHeaderPerson = {
  displayName: string
  registeredName: string
  avatarUrl: string | null
  cover?: CoverPresentation
  jobTitle?: string | null
  teamName?: string | null
  /** Só em contextos de gestão (perfil de outra pessoa): identifica sem ambiguidade junto do nome escolhido. */
  matricula?: string | null
}

type ProfileHeaderProps = {
  person: ProfileHeaderPerson
  /** Perfil da própria pessoa autenticada: única situação em que foto, nome e capa podem ser editados. */
  isOwn: boolean
  /** Ações contextuais (voltar à equipe, falar com o time) — nunca de edição pessoal. */
  actions?: React.ReactNode
  /**
   * `profile` = cabeçalho da página de perfil; `preview` = a MESMA apresentação usada como prévia na página de edição (sem
   * ações, título não-h1 e mais compacta no mobile para não esconder o formulário).
   */
  variant?: "profile" | "preview"
  /** A faixa de abas encaixa na base do card: a borda inferior fica por conta dela. */
  attached?: boolean
}

/**
 * Cabeçalho do PERFIL (estilo perfil profissional): capa, foto em destaque, nome escolhido e informações profissionais em
 * segundo plano. Identifica a pessoa do perfil — o cabeçalho global continua identificando quem está logado.
 */
export function ProfileHeader({ person, isOwn, actions, variant = "profile", attached = false }: ProfileHeaderProps) {
  const editor = useProfileEditor()
  const preview = variant === "preview"
  const canEdit = isOwn && !preview
  const Title = preview ? "p" : "h1"
  const professional = professionalLineOf(person.jobTitle, person.teamName)
  const identityLine = [
    person.registeredName !== person.displayName ? `Nome cadastrado: ${person.registeredName}` : null,
    !isOwn && person.matricula ? `Matrícula ${person.matricula}` : null,
  ].filter(Boolean)

  return (
    <header className={cn("overflow-hidden bg-card text-card-foreground", attached ? "rounded-t-xl" : "rounded-xl")} aria-label={preview ? "Prévia do perfil" : undefined}>
      <div className={cn("relative overflow-hidden", preview ? "h-16 sm:h-28 lg:h-32" : "h-24 sm:h-36")}>
        <CoverArt cover={person.cover ?? DEFAULT_COVER} priority={!preview} />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/15 to-transparent" />
        {canEdit ? (
          <Button type="button" variant="secondary" size="sm" className="absolute right-3 top-3 bg-card/85 text-foreground shadow-sm backdrop-blur-sm hover:bg-card" onClick={() => editor.open("cover")}>
            <ImageIcon aria-hidden /> <span className="hidden sm:inline">Alterar capa</span><span className="sr-only sm:hidden">Alterar capa</span>
          </Button>
        ) : null}
      </div>

      <div className={cn("px-4 sm:px-6", preview ? "pb-3 sm:pb-4" : "pb-4")}>
        <div className="flex items-end justify-between gap-3">
          <div className={cn("relative shrink-0", preview ? "-mt-8 sm:-mt-12" : "-mt-12 sm:-mt-16")}>
            <PersonAvatar
              name={person.displayName}
              avatarUrl={person.avatarUrl}
              alt={`Foto de ${person.displayName}`}
              className={cn("border-4 border-card bg-card shadow-sm ring-2 ring-primary/40", preview ? "size-16 sm:size-24" : "size-24 sm:size-32")}
              fallbackClassName="bg-primary text-2xl font-semibold text-primary-foreground sm:text-3xl"
            />
            {canEdit ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" size="icon" className="absolute bottom-1 right-1 size-9 rounded-full border-2 border-card shadow-md" aria-label="Alterar foto de perfil" onClick={() => editor.open("photo")}>
                    <Camera aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Alterar foto</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 pt-3">
            {actions}
            {canEdit ? (
              <Button type="button" variant="outline" onClick={() => editor.open("name")}>
                <PencilLine aria-hidden /> Editar perfil
              </Button>
            ) : null}
          </div>
        </div>

        {/* A prévia mora numa coluna estreita: nome e selos sempre empilhados (os breakpoints são da janela, não da coluna). */}
        <div className={cn("flex flex-col gap-3", preview ? "mt-2" : "mt-3 lg:flex-row lg:items-end lg:justify-between")}>
          <div className="min-w-0">
            <Title className={cn("line-clamp-2 break-words font-heading font-semibold tracking-tight", preview ? "text-lg sm:text-2xl" : "text-2xl sm:text-3xl")} title={person.displayName}>{person.displayName}</Title>
            {professional ? <p className="mt-0.5 break-words text-sm text-muted-foreground sm:text-base">{professional}</p> : null}
            {identityLine.length > 0 ? <p className="mt-1 break-words text-xs text-muted-foreground">{identityLine.join(" · ")}</p> : null}
          </div>
          {/* Na prévia do mobile os selos saem: a prévia não pode empurrar o formulário para fora da tela. */}
          <div className={preview ? "hidden sm:block" : undefined}><ProfileSeals /></div>
        </div>
      </div>
    </header>
  )
}

function ProfileSeals() {
  const [expanded, setExpanded] = useState(true)
  const seals: Array<{ icon: React.ReactNode; label: string; level: SealLevel }> = [
    { icon: <BadgeCheck />, label: "Qualidade", level: "gold" },
    { icon: <CircleCheckBig />, label: "Resolutiva", level: "silver" },
    { icon: <UsersRound />, label: "Colaborativa", level: "bronze" },
    { icon: <ChartPie />, label: "Produtiva", level: "default" },
    { icon: <AlarmClock />, label: "Pontual", level: "bronze" },
  ]
  const orderedSeals = [...seals].sort((a, b) => sealLevelPriority[b.level] - sealLevelPriority[a.level])

  return (
    <div className="flex min-w-0 items-center lg:justify-end">
      <div className={cn("flex min-w-0 items-center gap-1", expanded ? "overflow-visible" : "overflow-hidden")}>
        {orderedSeals.map((seal, index) => (
          <div
            className={cn("transition-all duration-150 ease-out", expanded ? "inia-seal-genie-in max-w-16 overflow-visible px-0.5 opacity-100" : "inia-seal-genie-out max-w-0 translate-x-2 overflow-hidden px-0 opacity-0")}
            style={{ transitionDelay: `${expanded ? (orderedSeals.length - index - 1) * 25 : index * 25}ms` }}
            key={seal.label}
          >
            <ProfileSeal icon={seal.icon} label={seal.label} level={seal.level} />
          </div>
        ))}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" className="ml-1 shrink-0" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? "Recolher selos" : "Exibir selos"} aria-expanded={expanded}>
            <ChevronLeft className={cn("transition-transform duration-200", !expanded && "rotate-180")} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{expanded ? "Recolher selos" : "Exibir selos"}</TooltipContent>
      </Tooltip>
    </div>
  )
}
