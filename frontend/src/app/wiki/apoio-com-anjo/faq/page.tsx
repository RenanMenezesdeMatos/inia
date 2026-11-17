import type { Metadata } from "next"

import { CopyablePrompt } from "@/components/wiki/copyable-prompt"
import { buildHumanSupportPrompt, HUMAN_SUPPORT_FAQ } from "@/components/wiki/human-support-faq-data"
import { SeeAlso, WarningCallout, WikiArticle, WikiPageHeader, WikiSection } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "FAQ da operação dos Anjos",
  description: "Perguntas e respostas sobre a operação do Apoio com Anjo: o que é cada coisa, quando cada regra se aplica e como cada número é contado — com um prompt de referência para copiar.",
}

/**
 * FAQ DA OPERAÇÃO DOS ANJOS (pedido do responsável em 2026-11-16). Perguntas e respostas e o prompt de referência vêm da MESMA fonte
 * (`components/wiki/human-support-faq-data.ts`): mudou uma regra, muda num lugar só.
 */
const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Como usar esta FAQ" },
  ...HUMAN_SUPPORT_FAQ.map((section) => ({ id: section.id, label: section.title })),
  { id: "prompt", label: "Prompt de referência" },
]

export default function HumanSupportFaqPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="04 · Experiência do Colaborador"
        title="FAQ da operação dos Anjos"
        lead="Tudo sobre o Apoio com Anjo em perguntas e respostas: o que é cada coisa, quando cada regra se aplica e como cada número é contado. No fim, um prompt com as mesmas regras para usar num assistente de IA."
      >
        <WarningCallout kind="tip" title="Os números são os padrões do produto">
          Os tempos de resposta podem ser ajustados para a organização e para cada Grupo, e os tempos da pausa “Desconexão” para a organização. Confira os valores em uso em Painel dos Anjos › Monitoria Online › “Tempos de resposta”.
        </WarningCallout>
      </WikiPageHeader>

      {HUMAN_SUPPORT_FAQ.map((section) => (
        <WikiSection key={section.id} id={section.id} title={section.title} eyebrow={section.eyebrow}>
          <dl className="divide-y divide-border rounded-2xl border border-border bg-card">
            {section.items.map((item) => (
              <div key={item.q} className="space-y-1.5 px-4 py-3.5">
                <dt className="font-semibold text-foreground">{item.q}</dt>
                <dd className="text-pretty text-foreground/85">{item.a}</dd>
              </div>
            ))}
          </dl>
        </WikiSection>
      ))}

      <WikiSection id="prompt" title="Prompt de referência" eyebrow="Para copiar">
        <p>Cole este texto como instrução de um assistente de IA para treinar alguém ou tirar dúvidas sobre a operação. Ele traz as mesmas perguntas e respostas desta página e manda o assistente não inventar regra nem número.</p>
        <CopyablePrompt text={buildHumanSupportPrompt()} title="Prompt — operação dos Anjos" description="Regras de resposta + todas as perguntas e respostas desta FAQ." />
        <SeeAlso
          links={[
            { href: "/wiki/apoio-com-anjo", label: "Apoio com Anjo", hint: "o fluxo e as telas" },
            { href: "/wiki/introducao/papeis", label: "Papéis e o que cada um vê" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
