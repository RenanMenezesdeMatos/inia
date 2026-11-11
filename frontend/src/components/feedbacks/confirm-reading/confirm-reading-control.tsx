"use client"

import { CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useConfirmedReadingAt } from "@/queries/feedback-read-confirmations/use-feedback-read-confirmation"
import type { FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"
import type { ReadConfirmationEntryPoint, ReadConfirmationResult } from "@/schemas/feedback-read-confirmations/feedback-read-confirmation.schema"

import { ReadingConfirmationDialog } from "./reading-confirmation-dialog"

type Props = {
  source: FeedbackSourceRef
  /** Onde o botão está — vai para o registro de usabilidade. */
  entryPoint: ReadConfirmationEntryPoint
  /** Nome do feedback na descrição do elemento ("… que você leu “Rechamada”"). */
  title?: string | null
  /** Ciência que já veio do servidor (o mapa desta sessão do navegador tem precedência). */
  acknowledgedAt: string | null
  /** Há uma conversa com a INIA em andamento sobre este feedback — confirmar a conclui (o elemento avisa). Ausente = pelo estado
   * da aplicação no cache compartilhado (o mesmo dos botões "Ouvir/Continuar" do Acompanhamento). */
  applicationInProgress?: boolean
  disabled?: boolean
  /** Só o ícone (o texto fica para leitor de tela) — cabeçalho da sessão no celular. */
  compact?: boolean
  className?: string
  /** Estilo do estado "Ciência confirmada" quando o fundo pede outro tom (ex.: palco escuro da sessão). */
  confirmedClassName?: string
  /** Logo antes de enviar as credenciais (ex.: a sessão para a fala e a voz antes de encerrar a conversa). */
  onBeforeConfirm?: () => void
  onConfirmed?: (result: ReadConfirmationResult) => void
}

/**
 * "Confirmar ciência" — o MESMO botão e o MESMO elemento no Acompanhamento e dentro da sessão com a INIA. Ciência = o próprio
 * colaborador confirma, com o login e a senha da sua conta, que leu o feedback, e diz se CONCORDA com ele (escolha obrigatória;
 * discordar pede motivo e justificativa e vira contestação). Concordando ou não, a ciência é registrada e conclui a conversa da
 * aplicação em andamento. A escolha registrada aparece no rodapé do item do Acompanhamento (`ReadingEvaluation`).
 */
export function ConfirmReadingControl({ source, entryPoint, title, acknowledgedAt, applicationInProgress, disabled = false, compact = false, className, confirmedClassName, onBeforeConfirm, onConfirmed }: Props) {
  const confirmedHere = useConfirmedReadingAt(source)
  const confirmedAt = confirmedHere ?? acknowledgedAt

  if (confirmedAt) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300", confirmedClassName)} data-testid="reading-confirmed">
        <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
        <span className={compact ? "sr-only" : undefined}>Ciência confirmada em {formatDateTime(confirmedAt)}</span>
      </span>
    )
  }

  return (
    <ReadingConfirmationDialog
      source={source}
      entryPoint={entryPoint}
      purpose="CONFIRM"
      title={title}
      applicationInProgress={applicationInProgress}
      onBeforeConfirm={onBeforeConfirm}
      onConfirmed={onConfirmed}
      trigger={(openDialog) => (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={className}
          disabled={disabled}
          onClick={openDialog}
          data-usage-element="feedback.confirm_reading.open"
          data-usage-entity-type={source.kind}
          data-usage-entity-id={source.id}
          title="Confirma, com o seu login e senha, que você leu este feedback, e registra se você concorda com ele. Seu gestor vê a data da confirmação."
          aria-label={compact ? "Confirmar ciência" : undefined}
        >
          <CheckCircle2 aria-hidden />
          <span className={compact ? "sr-only" : undefined}>Confirmar ciência</span>
        </Button>
      )}
    />
  )
}
