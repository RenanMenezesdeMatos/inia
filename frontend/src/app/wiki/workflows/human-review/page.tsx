import type { Metadata } from "next"

import { ExampleCard, FieldRow, SeeAlso, UseCases, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { ESCALATION_ROLE_LABELS } from "@/schemas/admin/workflow-graph.schema"

export const metadata: Metadata = {
  title: "Revisão humana e Escalonar",
  description: "Por que a Revisão humana existe, quando usar, quem revisa, Aprovar/Reprovar/Escalar, o que acontece com o Workflow, decisão × leitura — e a Ação Escalonar (transferir responsabilidade).",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "por-que", label: "Por que existe" },
  { id: "quando", label: "Quando usar / não usar" },
  { id: "configuracao", label: "Configuração do node" },
  { id: "decisoes", label: "Aprovar, Reprovar, Escalar" },
  { id: "hierarquia", label: "Hierarquia em duas etapas" },
  { id: "decisao-vs-leitura", label: "Decisão ≠ leitura" },
  { id: "escalonar", label: "Escalonar (Ação)" },
  { id: "diferenca", label: "Revisão humana × Escalonar" },
]

export default function HumanReviewPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="05 · Workflow Engine"
        title="Revisão humana e Escalonar"
        lead="Revisão humana pausa a execução até uma pessoa decidir — Aprovar, Reprovar ou Escalar — em Pendências. Escalonar transfere responsabilidade a um cargo da hierarquia e pode seguir o fluxo. São coisas diferentes, e costumam aparecer juntas."
      />

      <WikiSection id="por-que" title="Por que existe" eyebrow="Humano no circuito">
        <p>
          Um Agent analisa, evidencia, resume e sugere acompanhamento — nunca decide punição. Quando o resultado terá efeito visível sobre uma
          pessoa, a Revisão humana coloca um gestor no circuito antes: ele confirma que a ocorrência realmente configura o que a análise apontou,
          rejeita o que não faz sentido ou escala o que é grave demais para decidir sozinho.
        </p>
        <WikiFlow
          compact
          steps={[
            { label: "Chamar agente produz o feedback com evidência", tone: "ai" },
            { label: "Revisão humana → execução fica “aguardando”; aparece em Pendências do revisor; o sino avisa", tone: "people" },
            { label: "Aprovar → Output ao operador · Reprovar → não publica · Escalar → Escalonar ao Gerente com o conteúdo", tone: "output" },
          ]}
        />
      </WikiSection>

      <WikiSection id="quando" title="Quando usar / não usar" eyebrow="Critério">
        <UseCases
          use={[
            "Feedback gerado por IA que vai ao operador (monitoria, diagnóstico de performance)",
            "Nota crítica (ex.: URA = 1) ou risco alto apontado por um Orchestrator",
            "Qualquer resultado com impacto na pessoa (escalonamento, plano de ação)",
          ]}
          avoid={[
            "Orientação simples que pode ser publicada direto (ex.: TMA de hoje acima da meta)",
            "Reconhecimento baseado em números oficiais",
            "Depois de “Consolidar resultados” — ali não há colaborador individual para revisar (a validação bloqueia)",
          ]}
        />
      </WikiSection>

      <WikiSection id="configuracao" title="Configuração do node" eyebrow="Rótulos reais">
        <FieldRow label="Quem revisa" value={`Cargo na hierarquia do operador (${Object.values(ESCALATION_ROLE_LABELS).join(", ")}), cargo na hierarquia de quem decidiu uma Revisão humana ANTERIOR desta mesma execução, ou uma pessoa específica.`} />
        <FieldRow label="Conteúdo a revisar" value="Um resultado do contexto de execução — normalmente o resultado do Chamar agente ou do Orquestrador. O revisor vê uma apresentação legível (resultado, indicador, evolução, comparação, principais evidências, afirmações com escopo e representatividade — com a cobertura operacional quando determinada —, limitações, base de cada recomendação, materiais, resumo das ferramentas e o status da validação de evidência); o payload técnico completo fica em “Ver detalhes técnicos”." />
        <FieldRow label="Instrução" value="O que o revisor precisa avaliar — aparece como “motivo” na pendência." />
        <FieldRow label="Saídas" value="Aprovado, Reprovado, Escalar — só as decisões conectadas no grafo aparecem para o revisor." />
        <FieldRow label="Contexto" value="Exige colaborador individual: cada revisão pertence a UMA pessoa." />
      </WikiSection>

      <WikiSection id="sem-revisor" title="Quando não há revisor ou conteúdo" eyebrow="Bloqueada, com o motivo">
        <p className="text-sm text-muted-foreground">
          A execução nunca fica esperando uma decisão que ninguém foi avisado para tomar. Ela fica <strong className="font-medium text-foreground">Bloqueada</strong> na etapa, mantém os resultados
          anteriores e só continua por uma nova tentativa confirmada em Execuções.
        </p>
        <FieldRow label="Bloqueada — sem revisor" value="Ninguém com o cargo acima do colaborador, revisor inativo (não sobe para o próximo da cadeia), revisão anterior não decidida neste caminho, ou o único revisor possível é o próprio colaborador." />
        <FieldRow label="Bloqueada — conteúdo ausente" value="O conteúdo escolhido não existe nesta execução: a etapa de origem não rodou neste caminho, ou a variável ainda não tem valor. Ninguém decide sem ver o conteúdo." />
        <FieldRow label="Quem é avisado" value="Quem publicou a versão vigente, pelo sino, uma vez por workflow, etapa e dia, sem o nome do colaborador — mesmo sendo o colaborador da execução. Quem não tem mais acesso ao workflow não recebe. Versão sem publicador ativo não avisa ninguém; a lista de workflows mostra a contagem de bloqueadas." />
        <FieldRow label="Nova tentativa" value="A prévia confere a causa de novo e não deixa confirmar enquanto ela continuar. Na mesma versão, continua da revisão, sem repetir as etapas anteriores nem a IA." />
      </WikiSection>

      <WikiSection id="decisoes" title="Aprovar, Reprovar, Escalar" eyebrow="O que acontece com o Workflow">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ExampleCard title="Aprovar">A execução segue pelo ramo Aprovado — nos modelos, o Output que publica o feedback no Acompanhamento do operador.</ExampleCard>
          <ExampleCard title="Reprovar">A execução segue pelo ramo Reprovado — nos modelos, Fim: nada é publicado (num fan-out, o ramo vai ao Join).</ExampleCard>
          <ExampleCard title="Escalar">A execução segue pelo ramo Escalar — nos modelos, Escalonar ao Gerente com o conteúdo analisado. Nunca um branch solto.</ExampleCard>
        </div>
        <p>
          A decisão é registrada uma única vez (idempotente): se outra pessoa decidiu primeiro, a plataforma avisa e mantém a decisão original. Não
          há prazo/SLA — a execução aguarda indefinidamente. O passo a passo para quem decide está em{" "}
          <WikiLink href="/wiki/pendencias#decidir">Pendências › Como aprovar, reprovar ou escalar</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="hierarquia" title="Hierarquia em duas etapas" eyebrow="Revisor anterior">
        <ExampleCard title="Supervisor revisa primeiro; se escalar, o Gerente revisa depois">
          O Workflow operacional &quot;Q4 persistente&quot; usa duas Revisões humanas encadeadas: a segunda aponta para &quot;cargo na hierarquia de
          quem decidiu a revisão anterior&quot; (Gerente), e registra a decisão final. Aprovação multi-etapas configurável visualmente ainda não
          existe — hoje é possível só encadeando Revisões humanas manualmente.
        </ExampleCard>
      </WikiSection>

      <WikiSection id="decisao-vs-leitura" title="Decisão ≠ leitura" eyebrow="Explícito">
        <WarningCallout kind="tip" title="Ler não decide">
          Marcar a notificação como lida, abrir a pendência ou ler o item no Acompanhamento não decide nada. A decisão só acontece dentro da
          revisão, com confirmação. A ciência do colaborador, por sua vez, é confirmação de leitura do PRÓPRIO colaborador — nunca aprovação.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="escalonar" title="Escalonar (Ação)" eyebrow="Transferência de responsabilidade">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <FieldRow label="Cargo-alvo" value={`${Object.values(ESCALATION_ROLE_LABELS).join(", ")} — resolvido na hierarquia do operador.`} />
          <FieldRow label="Conteúdo" value="Um trecho do contexto de execução (ex.: o resultado do Agent)." />
          <FieldRow label="Onde entregar" value="Um ou mais: Acompanhamento, Notificação, Avatar, Chat." />
          <FieldRow label="Continuar" value="Segue o fluxo (Continuar) ou encerra o branch sem exigir aresta (Encerrar branch)." />
        </div>
        <p>
          Escalonar cria um alerta de escalonamento para o destinatário, com o conteúdo — aparece no Acompanhamento da gestão e no sino como
          &quot;Escalonamento&quot;. Se o cargo pedido não existe na cadeia do operador, a Ação falha com retry limitado (nunca escolhe outra
          pessoa). Num fan-out, Escalonar precisa &quot;Continuar&quot; para chegar ao Join.
        </p>
      </WikiSection>

      <WikiSection id="diferenca" title="Revisão humana × Escalonar" eyebrow="Diferença">
        <WarningCallout title="Uma pede decisão e PAUSA; a outra encaminha e pode seguir">
          Escalonar encaminha responsabilidade e pode seguir o Workflow adiante. Revisão Humana pede uma decisão e PAUSA a execução até ela chegar.
          Um padrão comum: IA detecta risco → Supervisor revisa → confirma → Escalonar para o Gerente.
        </WarningCallout>
        <SeeAlso
          links={[
            { href: "/wiki/pendencias", label: "Pendências", hint: "a experiência de quem decide" },
            { href: "/wiki/notificacoes", label: "Notificações", hint: "Revisão pendente e Escalonamento no sino" },
            { href: "/wiki/workflows/fan-out-fan-in#revisao-em-fan-out", label: "Revisão humana num fan-out" },
            { href: "/wiki/workflows/outputs", label: "Outputs", hint: "o que vem depois de Aprovar" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
