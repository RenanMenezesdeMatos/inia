"use client"

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { publicAsset } from "@/lib/assets/public-asset"
import { SupportDetails } from "@/components/error-states/support-details"
import { FAILURE_COPY, type Failure } from "@/lib/errors/failure"
import { offlineArtFor } from "@/lib/errors/offline-art"
import { isRecorded, onRecorded } from "@/lib/errors/report-client-failure"
import { cn } from "@/lib/utils"

/**
 * TELA DE ERRO DA INIA — um componente para todos os estados (400, 401, 403, 404, 500, sem conexão), com a arte de cada um.
 *  - `variant="page"`: ocupa a tela (fronteira global, página inexistente, sem conexão, fluxo bloqueado);
 *  - `variant="contextual"`: dentro de um painel/cartão (o resto da tela e o que foi digitado continuam).
 * Texto em HTML acessível (a arte é decorativa: `alt=""`, e some se não carregar — título, texto e ação continuam). Código e
 * referência aparecem quando existem, com "Copiar detalhes para suporte" (só código, referência, horário e contexto público).
 */
export type ErrorScreenAction = { label: string; onClick?: () => void; href?: string; variant?: "default" | "outline" }

export type ErrorScreenProps = {
  failure: Failure
  variant?: "page" | "contextual"
  /** Ação principal (substitui a do estado: "Voltar e corrigir", "Fazer login"…). */
  action?: ErrorScreenAction | null
  secondaryAction?: ErrorScreenAction | null
  /** Ajusta o texto para a causa pública (ex.: limite de tentativas). */
  title?: ReactNode
  description?: ReactNode
  /** A pessoa não resolve sozinha: "Procure o administrador e informe o código e a referência abaixo." */
  askAdministrator?: boolean
  /** O registro desta referência foi confirmado pelo servidor (falhas nascidas no navegador). */
  recorded?: boolean
  release?: string | null
  className?: string
}

/** A arte não muda depois de escolhida: nada a assinar. */
const noSubscription = () => () => {}

export const ASK_ADMINISTRATOR = "Procure o administrador e informe o código e a referência abaixo."

function ActionButton({ action, fallbackVariant }: { action: ErrorScreenAction; fallbackVariant: "default" | "outline" }) {
  const variant = action.variant ?? fallbackVariant
  if (action.href) {
    return (
      <Button asChild variant={variant}>
        <a href={action.href} onClick={action.onClick}>
          {action.label}
        </a>
      </Button>
    )
  }
  return (
    <Button type="button" variant={variant} onClick={action.onClick}>
      {action.label}
    </Button>
  )
}

export function ErrorScreen({ failure, variant = "page", action, secondaryAction, title, description, askAdministrator = false, recorded: recordedProp, release, className }: ErrorScreenProps) {
  const copy = failure.kind === "offline" ? FAILURE_COPY.offline : FAILURE_COPY[failure.kind]
  // Arte de "sem conexão": fixa por ocorrência (a referência), alternando entre ocorrências. Escolhida SÓ no navegador, depois de
  // montar: no servidor (e na hidratação) não há arte — nunca um sorteio diferente entre o HTML do servidor e o do navegador.
  const fixedArt = failure.kind === "offline" ? null : (copy as { art: string }).art
  const occurrence = failure.reference ?? failure.occurredAt
  const offlineArt = useSyncExternalStore(
    noSubscription,
    () => (failure.kind === "offline" ? offlineArtFor(occurrence) : null),
    () => null,
  )
  const art = fixedArt ?? offlineArt
  const [artFailed, setArtFailed] = useState(false)
  const [recordedLate, setRecordedLate] = useState(() => isRecorded(failure.reference))
  const recorded = recordedProp ?? recordedLate

  useEffect(() => {
    if (recordedProp !== undefined || !failure.reference) return
    return onRecorded((reference) => {
      if (reference === failure.reference) setRecordedLate(true)
    })
  }, [failure.reference, recordedProp])

  const showSupport = Boolean(failure.code || failure.reference)
  const page = variant === "page"
  const primary = action === undefined ? null : action
  const Heading = page ? "h1" : "h2"

  return (
    <section
      role={failure.kind === "404" ? undefined : "alert"}
      aria-labelledby={`erro-${failure.reference ?? failure.kind}-titulo`}
      data-error-kind={failure.kind}
      className={cn(
        "flex w-full items-center justify-center",
        page ? "min-h-[70vh] px-4 py-10 sm:px-6" : "rounded-2xl border border-border bg-card px-4 py-6 sm:px-6",
        className,
      )}
    >
      <div className={cn("flex w-full flex-col items-center gap-6 text-center", page ? "max-w-3xl sm:flex-row sm:items-center sm:gap-10 sm:text-left" : "max-w-xl sm:flex-row sm:text-left")}>
        {art && !artFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- arte local e estática (public/brand/error-states), sem otimização de imagem
          <img
            src={publicAsset(art)}
            alt=""
            aria-hidden
            data-error-art={art.split("/").pop()}
            width={768}
            height={768}
            decoding="async"
            onError={() => setArtFailed(true)}
            className={cn("shrink-0 select-none object-contain", page ? "size-48 sm:size-64" : "size-28 sm:size-32")}
          />
        ) : failure.kind === "offline" && !artFailed ? (
          // Lugar da arte enquanto ela é escolhida no navegador (sem pulo de layout).
          <div aria-hidden className={cn("shrink-0", page ? "size-48 sm:size-64" : "size-28 sm:size-32")} />
        ) : null}
        <div className="min-w-0 flex-1 space-y-3">
          <Heading id={`erro-${failure.reference ?? failure.kind}-titulo`} className={cn("font-semibold tracking-tight text-foreground", page ? "text-2xl sm:text-3xl" : "text-lg")}>
            {title ?? copy.title}
          </Heading>
          <p className="text-sm text-muted-foreground sm:text-base">{description ?? copy.description}</p>
          {askAdministrator ? <p className="text-sm font-medium text-foreground">{ASK_ADMINISTRATOR}</p> : null}
          {primary || secondaryAction ? (
            <div className="flex flex-wrap justify-center gap-2 pt-1 sm:justify-start">
              {primary ? <ActionButton action={primary} fallbackVariant="default" /> : null}
              {secondaryAction ? <ActionButton action={secondaryAction} fallbackVariant="outline" /> : null}
            </div>
          ) : null}
          {showSupport ? <SupportDetails failure={failure} recorded={recorded} release={release ?? null} /> : null}
        </div>
      </div>
    </section>
  )
}
