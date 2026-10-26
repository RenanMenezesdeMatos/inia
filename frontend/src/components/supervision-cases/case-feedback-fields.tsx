import { AlertTriangle, BookOpenCheck, CheckCircle2, ClipboardCheck, Target } from "lucide-react"
import type { ReactNode } from "react"
import { RichContent } from "@/components/rich-content/rich-content"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatRawMeasures } from "@/lib/supervision-cases/case-indicator"
import type { SupervisionCase } from "@/schemas/supervision-cases/supervision-case.schema"

type CaseFeedback = SupervisionCase["feedbacks"][number]

/**
 * Campos do feedback estruturado do caso. A recomendação é o texto do redator (negrito, listas) e passa pelo RichContent, como todo
 * texto gerado para leitura humana; a evidência é fala literal da chamada e os demais campos são rótulos curtos — texto puro.
 * No feedback de indicador, evidência e comportamento são texto do sistema com a medição: o número cru vira o formato do produto.
 * No de monitoria nada é reformatado (a evidência é citação literal).
 */
export function CaseFeedbackFields({ feedback }: { feedback: CaseFeedback }) {
  const measure = (text: string) => (feedback.kind === "INDICATOR" ? formatRawMeasures(text) : text)
  return (
    <>
      <FeedbackField icon={<Target className="size-4" />} title="Indicador impactado">{feedback.impactedIndicator}</FeedbackField>
      <FeedbackField icon={<ClipboardCheck className="size-4" />} title="Evidência encontrada">{measure(feedback.evidenceFound)}</FeedbackField>
      <FeedbackField icon={<AlertTriangle className="size-4" />} title="Comportamento observado">{measure(feedback.observedBehavior)}</FeedbackField>
      <FeedbackField icon={<BookOpenCheck className="size-4" />} title="Procedimento relacionado">{feedback.relatedProcedure}</FeedbackField>
      <FeedbackField icon={<CheckCircle2 className="size-4" />} title="Recomendação"><RichContent text={feedback.recommendation} quotes="emphasis" /></FeedbackField>
      <FeedbackField icon={<CheckCircle2 className="size-4" />} title="Abordagem sugerida">{feedback.suggestedApproach ?? "Não informada"}</FeedbackField>
    </>
  )
}

function FeedbackField({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <Card size="sm"><CardHeader><div className="flex items-center gap-2 text-primary">{icon}<CardTitle className="text-sm">{title}</CardTitle></div></CardHeader><CardContent className="text-sm text-muted-foreground">{children}</CardContent></Card>
}
