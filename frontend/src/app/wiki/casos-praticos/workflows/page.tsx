import type { Metadata } from "next"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { CapabilityBadge, FieldRow, SeeAlso, WikiArticle, WikiLink, WikiPageHeader, WikiSection } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { WorkflowDiagram } from "@/components/wiki/workflow-diagram"
import { OPERATION_WORKFLOWS } from "@/components/wiki/wiki-data"
import { WORKFLOW_BENEFICIARY_LABELS, WORKFLOW_TEMPLATES } from "@/components/wiki/ai-catalog-data"

export const metadata: Metadata = {
  title: "Modelos de Workflow",
  description: "Os 20 modelos práticos de Workflow para Call Center (22 instâncias, todos em rascunho) — problema, beneficiário, trigger, subject, população, nodes, Agent, Orchestrator, KB, Revisão humana, Output, destinatário, Surface e limitações — e os 10 Workflows operacionais reais.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "vinte-modelos", label: "20 modelos práticos" },
  { id: "workflows-reais", label: "10 Workflows operacionais reais" },
]

export default function WorkflowModelsPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="12 · Casos Práticos"
        title="Modelos de Workflow"
        lead="Vinte modelos configurados no produto e dez Workflows operacionais executados como prova — documentados a partir dos grafos reais, nunca declarados à mão."
      >
        <div className="flex flex-wrap gap-2 pt-2">
          <CapabilityBadge label={`${WORKFLOW_TEMPLATES.length} modelos (22 instâncias)`} />
          <CapabilityBadge label={`${WORKFLOW_TEMPLATES.filter((t) => t.usesKnowledgeBase).length} usam Base de Conhecimento`} />
          <CapabilityBadge label={`${WORKFLOW_TEMPLATES.filter((t) => t.orchestrator !== "—").length} usam Orquestrador`} />
          <CapabilityBadge label={`${WORKFLOW_TEMPLATES.filter((t) => !t.usesAi).length} sem IA`} tone="partial" />
          <CapabilityBadge label={`${WORKFLOW_TEMPLATES.filter((t) => t.isConformanceCase).length} caso de conformidade (3 instâncias)`} />
          <CapabilityBadge label={`${OPERATION_WORKFLOWS.length} Workflows operacionais reais`} />
        </div>
      </WikiPageHeader>

      <WikiSection id="vinte-modelos" title="20 modelos práticos de Workflows para Call Center" eyebrow="Catálogo oficial — todos em rascunho">
        <p>
          Vinte modelos configurados no produto (22 instâncias: o Modelo 18 tem uma por domínio com base de conhecimento), todos em{" "}
          <strong className="font-medium text-foreground">DRAFT</strong> — nenhum publicado, nenhum no agendador produtivo, nenhum efeito real.
          Testáveis no QA Lab. Cada um usa o caminho mais simples: Agent especialista direto quando o domínio é conhecido; Orquestrador só para
          síntese consolidada ou análise multidomínio. A camada de IA por trás deles está em <WikiLink href="/wiki/agents">Agents</WikiLink>,{" "}
          <WikiLink href="/wiki/orchestrators">Orchestrators</WikiLink> e <WikiLink href="/wiki/bases-conhecimento">Bases de Conhecimento</WikiLink>.
        </p>
        <p className="text-sm text-muted-foreground">
          Beneficiário principal (derivado do grafo real, nunca declarado à mão):{" "}
          {(["OPERADOR", "SUPERVISOR", "LIDERANCA", "MULTINIVEL"] as const)
            .map((beneficiary) => `${WORKFLOW_BENEFICIARY_LABELS[beneficiary]} ${WORKFLOW_TEMPLATES.filter((t) => t.beneficiary === beneficiary).length}`)
            .join(" · ")}
          . Todos os 22 rascunhos passam na validação de publicação (a mesma do botão Publicar, em modo dry-run) e continuam não publicados. Regra de
          destinatário aplicada pelo validador: &quot;O próprio operador&quot; só em contexto individual; depois de &quot;Consolidar resultados&quot; o
          Output vai para a gestão, resolvido <strong>pela estrutura</strong> — a pessoa-âncora quando ela tem o cargo, senão a cadeia acima/abaixo
          dela; num Grupo/Subgrupo, a hierarquia real de todos os membros. Exatamente uma pessoa: mais de uma (Grupo com 2 Gerentes) ou nenhuma
          bloqueia a publicação, e o motor confere de novo na hora de entregar. Nunca &quot;um membro qualquer&quot;. &quot;Escalar&quot; numa Revisão
          humana sempre significa Escalonar ao Gerente com o conteúdo analisado — nunca um branch solto.
        </p>
        <p className="text-sm text-muted-foreground">
          Estrutura: modelos <strong>genéricos</strong> rodam em qualquer operação (Todos os grupos, ou a pessoa-âncora da sua estrutura); modelos{" "}
          <strong>de domínio</strong> (17, 18) apontam para o Grupo do domínio (Faturamento, Retenção, Suporte Técnico) e o pré-requisito está
          descrito em cada um; os consolidados ancorados em pessoa (Supervisor, Gerente, Diretor) cobrem a estrutura escolhida ao instalar — o
          campo &quot;Estrutura&quot; de cada modelo diz o que escolher. O template oficial descreve o requisito organizacional (ex.: &quot;Grupo do
          domínio Retenção e Cancelamento&quot;) — nunca o nome de um Grupo específico; os 22 rascunhos são a instância configurada no ambiente de
          demonstração, com bindings concretos.
        </p>
        {/* Exemplo demonstrativo: o ÚNICO lugar da Wiki onde um Grupo da massa demo é citado pelo nome — marcado
            com data-demo-example pra que o teste de saúde distinga "exemplo de instância" de "definição do template". */}
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground" data-demo-example="workflow-templates">
          <strong className="font-medium text-foreground">Exemplo do ambiente demonstrativo (instância, não requisito):</strong> o Modelo 17 está
          instanciado no Grupo &quot;B2C · Retenção&quot; e os Modelos 18a/b/c nos Grupos &quot;B2C · Faturamento&quot;, &quot;B2C · Retenção&quot; e
          &quot;B2C · Suporte Técnico&quot; da massa demo. Outra empresa instala o mesmo template apontando para o Grupo do domínio correspondente
          na sua própria estrutura, com o nome que ele tiver lá.
        </p>
        <Accordion type="single" collapsible className="space-y-3">
          {WORKFLOW_TEMPLATES.map((template) => (
            <AccordionItem key={template.id} value={template.id} className="rounded-lg border border-border px-4">
              <AccordionTrigger>
                <span className="flex items-baseline gap-2.5">
                  <span className="font-mono text-xs text-muted-foreground">{String(template.number).padStart(2, "0")}</span>
                  <span>{template.name.replace(/^Modelo · \d+ · /, "")}</span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Que problema resolve?</span> {template.problem}
                </p>
                <p className="text-foreground/90">{template.objective}</p>
                <div className="flex flex-wrap gap-2">
                  <CapabilityBadge label={`Beneficiário: ${WORKFLOW_BENEFICIARY_LABELS[template.beneficiary]}`} />
                  <CapabilityBadge label="DRAFT" tone="partial" />
                  {template.usesKnowledgeBase ? <CapabilityBadge label="Usa KB" /> : <CapabilityBadge label="Sem KB" tone="missing" />}
                  {template.orchestrator !== "—" ? <CapabilityBadge label="Orquestrador" /> : <CapabilityBadge label="Agent direto" tone="missing" />}
                  {template.isConformanceCase ? <CapabilityBadge label="Conformidade de processo" /> : null}
                </div>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  <FieldRow label="Trigger" value={template.trigger} />
                  <FieldRow label="Subject" value={template.subject} />
                  <FieldRow label="Population" value={template.population} />
                  <FieldRow label="Estrutura" value={template.structure} />
                  <FieldRow label="Nodes" value={template.nodes.join(" → ")} />
                  <FieldRow label="Condition" value={template.condition} />
                  <FieldRow label="Ranking" value={template.ranking} />
                  <FieldRow label="Agent" value={template.agent} />
                  <FieldRow label="Orquestrador" value={template.orchestrator} />
                  <FieldRow label="Base (KB)" value={template.knowledgeBase} />
                  <FieldRow label="Rev. Humana" value={template.humanReview} />
                  <FieldRow label="Output" value={template.output} />
                  <FieldRow label="Surface" value={template.surface} />
                  <FieldRow label="Dados" value={template.requiredData} />
                  <FieldRow label="Esperado" value={template.expectedBehavior} />
                  <FieldRow label="Limitações" value={template.limitations} />
                </dl>
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Quem recebe o quê?</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {template.deliveries.map((delivery, index) => (
                      <li key={index} className="flex flex-wrap gap-x-2">
                        <span className="font-medium text-foreground">{delivery.recipient}:</span>
                        <span className="text-foreground/90">{delivery.what}</span>
                        <span className="text-muted-foreground">→ {delivery.surface}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <WorkflowDiagram nodes={template.diagram} />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </WikiSection>

      <WikiSection id="workflows-reais" title="10 Workflows operacionais reais" eyebrow="Prova, não exemplo artificial">
        <p>
          Criados, publicados e executados de verdade contra o banco de desenvolvimento — nenhum Trigger ou Node usado apenas pra demonstrar uma
          feature. Anteriores ao catálogo de especialistas por domínio: usam os orquestradores da época (Indicadores, Monitoria Completa) e
          registram os bugs encontrados e corrigidos naquela rodada.
        </p>
        <Accordion type="single" collapsible className="space-y-3">
          {OPERATION_WORKFLOWS.map((workflow, index) => (
            <AccordionItem key={workflow.id} value={workflow.id} className="rounded-lg border border-border px-4">
              <AccordionTrigger>
                <span className="flex items-baseline gap-2.5">
                  <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                  <span>{workflow.name}</span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                <p className="text-foreground/90">{workflow.objective}</p>
                <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  <FieldRow label="Trigger" value={workflow.trigger} />
                  <FieldRow label="Por quê" value={workflow.triggerReason} />
                  {workflow.orchestrator ? <FieldRow label="Orquestrador" value={workflow.orchestrator} /> : null}
                  {workflow.humanReview ? <FieldRow label="Rev. Humana" value={workflow.humanReview} /> : null}
                  {workflow.escalation ? <FieldRow label="Escalonamento" value={workflow.escalation} /> : null}
                  <FieldRow label="Sem Dados" value={workflow.noData} />
                  <FieldRow label="Resultado" value={workflow.expected} />
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Conditions</p>
                  <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    {workflow.conditions.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
                {workflow.errors.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Erros encontrados nesta rodada</p>
                    <ul className="list-inside list-disc space-y-1 text-sm text-amber-700 dark:text-amber-300">
                      {workflow.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <WorkflowDiagram nodes={workflow.diagram} />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        <SeeAlso
          links={[
            { href: "/wiki/casos-praticos", label: "Guias integrados" },
            { href: "/wiki/workflows", label: "Workflow Engine — visão geral" },
            { href: "/wiki/qa-lab", label: "QA Lab", hint: "testar qualquer modelo com dados reais" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
