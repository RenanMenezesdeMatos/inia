import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FieldRow, SeeAlso, WarningCallout, WikiArticle, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { WIKI_NOTIFICATIONS } from "@/components/wiki/wiki-reference"

export const metadata: Metadata = {
  title: "Notificações (sino)",
  description: "O sino lista avisos endereçados a você: revisão pendente, novo acompanhamento e escalonamento. Marcar como lida nunca decide nada.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "tipos", label: "Tipos de aviso" },
  { id: "comportamento", label: "Clicar, marcar como lida, atualizar" },
  { id: "ler-nao-e-decidir", label: "Ler não é decidir" },
  { id: "limitacoes", label: "Limitações atuais" },
]

const ORDER = ["HUMAN_REVIEW", "WORKFLOW_OUTPUT", "INIA_MESSAGE", "ESCALATION", "OTHER"] as const

export default function NotificationsPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="04 · Experiência do Colaborador"
        title="Notificações (sino)"
        lead="O sino no topo significa “algo novo aconteceu”: lista os avisos endereçados a você — nunca os de outra estrutura — e leva ao lugar certo. O destino de cada aviso é decidido pelo backend; a rota, pela tela."
      />

      <WikiSection id="tipos" title="Tipos de aviso" eyebrow="Em linguagem de produto">
        <WikiTable caption="Rótulos exatamente como aparecem no sino.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aviso</TableHead>
                <TableHead>Significa</TableHead>
                <TableHead>Clicar leva a</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ORDER.map((kind) => {
                const doc = WIKI_NOTIFICATIONS[kind]
                return (
                  <TableRow key={kind}>
                    <TableCell className="font-medium whitespace-nowrap">{doc.label}</TableCell>
                    <TableCell>{doc.productMeaning}</TableCell>
                    <TableCell>{doc.whereItLeads}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          O número no sino é a quantidade de avisos não lidos; a faixa &quot;N revisões aguardam sua decisão&quot; é um atalho para Pendências e usa a
          mesma contagem real de revisões pendentes.
        </p>
      </WikiSection>

      <WikiSection id="comportamento" title="Clicar, marcar como lida, atualizar" eyebrow="Comportamento">
        <FieldRow label="Clicar num aviso" value="Marca como lido e leva ao contexto certo: revisão → aba Pendências com a revisão aberta; resultado ou escalonamento → Acompanhamento com o item destacado." />
        <FieldRow label="Lidas" value="Marca todos os avisos como lidos." />
        <FieldRow label="Atualização" value="O sino se atualiza ao abrir a página, ao voltar para a aba do navegador e a cada minuto." />
      </WikiSection>

      <WikiSection id="ler-nao-e-decidir" title="Ler não é decidir" eyebrow="Explícito">
        <WarningCallout kind="tip" title="Marcar como lido nunca aprova ou reprova nada">
          Marcar uma notificação como lida só grava a leitura. A decisão de uma revisão só acontece em Pendências, dentro da própria revisão, com
          confirmação.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="Transparência">
        <ul className="list-inside list-disc space-y-1">
          <li>Atualização por consulta periódica — não há aviso instantâneo (push) nem e-mail.</li>
          <li>Alertas órfãos (de uma execução apagada) não viram pendência — pendente é sempre a execução aguardando, não o aviso.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/pendencias", label: "Pendências e Revisão humana" },
            { href: "/wiki/acompanhamento", label: "Acompanhamento e Ciência" },
            { href: "/wiki/workflows/outputs#surfaces", label: "Surface Notificação", hint: "como um Output vira aviso" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
