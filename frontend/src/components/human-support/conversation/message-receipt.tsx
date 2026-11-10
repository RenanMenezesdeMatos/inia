import { Check, CheckCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { RECEIPT_LABELS, type ReceiptStatus } from "./receipts"

/**
 * TIQUES DE UMA MENSAGEM PRÓPRIA, como num aplicativo de mensagens: um tique cinza = enviada (o servidor gravou); dois cinza =
 * entregue (o aplicativo da outra pessoa recebeu); dois azuis = lida (a outra pessoa estava com a conversa na tela). A cor nunca é a
 * única informação: o texto vai para leitores de tela e para a dica ao passar o mouse.
 */
export function MessageReceipt({ status, className }: { status: ReceiptStatus; className?: string }) {
  const Icon = status === "SENT" ? Check : CheckCheck
  return (
    <span title={RECEIPT_LABELS[status]} data-receipt={status.toLowerCase()} className={cn("inline-flex shrink-0 items-center", status === "READ" ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground", className)}>
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{RECEIPT_LABELS[status]}</span>
    </span>
  )
}
