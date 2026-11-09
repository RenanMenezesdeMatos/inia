import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CapabilityBadge, ExampleCard, SeeAlso, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { WIKI_OUTPUT_TARGETS, WIKI_SURFACES, NODE_CONTEXT_LABELS } from "@/components/wiki/wiki-reference"
import { VISIBLE_OUTPUT_SURFACES, outputSurfaceSchema } from "@/schemas/admin/workflow-graph.schema"

export const metadata: Metadata = {
  title: "Outputs, destinatários e Surfaces",
  description: "Output é QUEM + ONDE + O QUÊ. Output individual (contexto EMPLOYEE), Output consolidado (pós-JOIN → gestão), resolução organizacional determinística do destinatário (RESOLVED / NOT_FOUND / AMBIGUOUS) e as superfícies reais.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "quem-onde-o-que", label: "QUEM + ONDE + O QUÊ" },
  { id: "output-individual", label: "Output individual" },
  { id: "output-consolidado", label: "Output consolidado" },
  { id: "destinatarios", label: "Destinatários e resolução organizacional" },
  { id: "surfaces", label: "Surfaces" },
  { id: "materiais-apoio", label: "Materiais de apoio" },
  { id: "surface-x-trigger", label: "Surface × Trigger" },
  { id: "avatar-chat", label: "Avatar e Chat" },
  { id: "auditoria", label: "Auditoria" },
]

const TARGET_ORDER = ["CURRENT_OPERATOR", "SUPERVISOR_OF_OPERATOR", "MANAGER_OF_OPERATOR", "ROLE", "USER"] as const

export default function OutputsPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="05 · Workflow Engine"
        title="Outputs, destinatários e Surfaces"
        lead="O Output é o único node com permissão de gerar efeito visível pro operador ou gestor. Ele responde três perguntas: QUEM recebe (destinatário), ONDE aparece (surface) e O QUÊ (o conteúdo, lido do contexto de execução)."
      >
        <div className="flex flex-wrap gap-2 pt-2">
          {VISIBLE_OUTPUT_SURFACES.map((surface) => (
            <CapabilityBadge key={surface} label={WIKI_SURFACES[surface].label} tone={WIKI_SURFACES[surface].status === "reader" ? "supported" : "partial"} />
          ))}
        </div>
      </WikiPageHeader>

      <WikiSection id="quem-onde-o-que" title="QUEM + ONDE + O QUÊ" eyebrow="Três configurações">
        <p className="font-mono text-sm font-medium text-foreground">QUEM (Destinatário) + ONDE (Superfícies) + O QUÊ (Fonte do conteúdo)</p>
        <WikiFlow
          compact
          steps={[
            { label: "Fonte: um resultado do contexto (ex.: resultado do Chamar agente)", tone: "neutral" },
            { label: "Destinatário resolvido: o próprio operador, ou alguém da gestão", tone: "core" },
            { label: "Para cada superfície escolhida: Feedback publicado, alerta, ou registro persistido", tone: "output" },
          ]}
        />
        <WarningCallout title="Acompanhamento pro próprio operador exige o resultado inteiro do Agent/Orchestrator como fonte">
          Para publicar um feedback de verdade no Acompanhamento do operador, a fonte precisa ser o resultado completo de um Chamar agente ou
          Orquestrador — nunca um sub-campo. É o que permite criar o caso, registrar a evidência e publicar pela mesma regra dos feedbacks manuais
          (precisa ter evidência).
        </WarningCallout>
      </WikiSection>

      <WikiSection id="output-individual" title="Output individual" eyebrow="Contexto Colaborador individual">
        <p>
          Em contexto <strong className="font-medium text-foreground">Colaborador individual</strong> (Workflow por Flag, Indicador, Agenda individual,
          ou depois de &quot;Aplicar individualmente&quot;), o Output pode ir para <strong className="font-medium text-foreground">&quot;O próprio
          operador&quot;</strong> — e também para o Supervisor/Gerente dele, um cargo ou uma pessoa, subindo a cadeia de quem reporta a quem a partir
          do operador.
        </p>
        <ExampleCard title="Exemplo">Feedback ao operador → O próprio operador · Acompanhamento — cria o caso de supervisão com a evidência e publica o Feedback; o operador confirma ciência depois.</ExampleCard>
      </WikiSection>

      <WikiSection id="output-consolidado" title="Output consolidado" eyebrow="Pós-JOIN → gestão">
        <p>
          Depois de &quot;Consolidar resultados&quot; (ou em contexto de Estrutura, sem fan-out) não existe &quot;o operador atual&quot;: o Output vai para
          um <strong className="font-medium text-foreground">destinatário de gestão</strong> — Supervisor, Gerente, um cargo específico ou uma pessoa —
          resolvido pela <strong className="font-medium text-foreground">estrutura</strong>. &quot;O próprio operador&quot; simplesmente não existe
          nesse contexto: a lista não oferece e a validação bloqueia.
        </p>
        <ExampleCard title="Exemplo">Consolidar resultados → Orquestrador · Gerencial → Resumo executivo ao Diretor → Diretor (resolvido pela estrutura) · Acompanhamento.</ExampleCard>
      </WikiSection>

      <WikiSection id="destinatarios" title="Destinatários e resolução organizacional" eyebrow="Determinística — nunca “um membro qualquer”">
        <WikiTable caption="Rótulos exatamente como aparecem no painel do Output.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Destinatário</TableHead>
                <TableHead>Como é resolvido</TableHead>
                <TableHead>Contextos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TARGET_ORDER.map((type) => {
                const doc = WIKI_OUTPUT_TARGETS[type]
                return (
                  <TableRow key={type}>
                    <TableCell className="font-medium whitespace-nowrap">{doc.label}</TableCell>
                    <TableCell>{doc.resolution}</TableCell>
                    <TableCell>{doc.contexts.map((context) => NODE_CONTEXT_LABELS[context]).join(" · ")}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </WikiTable>
        <h3 className="pt-2 font-heading text-lg font-semibold">Resolução por estrutura</h3>
        <p>
          Quando não há operador atual (contexto Estrutura ou Resultado consolidado), o destinatário de gestão é resolvido pela estrutura configurada
          — nunca escolhendo um membro qualquer e subindo a hierarquia dele:
        </p>
        <ul className="list-inside list-disc space-y-1.5">
          <li><strong className="font-medium text-foreground">Estrutura ancorada em pessoa</strong> (Equipe de Supervisor, estrutura de Coordenador/Gerente/Gerente Sênior/Diretor): se a própria âncora tem o cargo pedido, é ela; senão, os candidatos são os ancestrais dela com aquele cargo (cadeia linear → no máximo 1) e os descendentes com aquele cargo (um Output &quot;Supervisor&quot; numa Estrutura de Diretor tem dezenas de candidatos → ambíguo).</li>
          <li><strong className="font-medium text-foreground">Grupo/Subgrupo</strong> (sem pessoa-âncora): candidatos = ancestrais, com o cargo pedido, de TODOS os operadores membros — a hierarquia real, não um responsável inventado (Grupo/Subgrupo não têm &quot;dono&quot;).</li>
        </ul>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ExampleCard title="RESOLVED">Exatamente 1 candidato → destinatário inequívoco. O QA Lab mostra &quot;Destinatário resolvido: Cargo Nome&quot;.</ExampleCard>
          <ExampleCard title="NOT_FOUND">0 candidatos (ex.: &quot;Coordenador&quot; numa estrutura sem Coordenador) → a publicação é bloqueada; em runtime, a entrega falha com o motivo.</ExampleCard>
          <ExampleCard title="AMBIGUOUS">2+ candidatos (ex.: Grupo com operadores sob dois Gerentes) → bloqueado; nunca &quot;o primeiro da lista&quot;.</ExampleCard>
        </div>
        <p>
          A MESMA função roda na validação de publicação (dry-run detecta ambiguidade com a estrutura configurada hoje), no runtime (a estrutura pode
          ter mudado depois da publicação — revalida sempre) e no QA Lab (o trace mostra o destinatário resolvido ou o motivo de não resolver). Por
          isso os modelos consolidados que entregam à gestão são ancorados em pessoa — ver{" "}
          <WikiLink href="/wiki/estrutura#estruturas">As sete estruturas</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="surfaces" title="Surfaces" eyebrow="Onde algo aparece — só as reais">
        <WikiTable caption="Gerado do mesmo enum de superfícies do produto. “Superfície customizada” existe no domínio, mas não aparece no Builder até haver um cadastro de superfícies.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Surface</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>O que acontece</TableHead>
                <TableHead>Quem lê</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outputSurfaceSchema.options.map((surface) => {
                const doc = WIKI_SURFACES[surface]
                return (
                  <TableRow key={surface}>
                    <TableCell className="font-medium whitespace-nowrap">{doc.label}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <CapabilityBadge label={doc.status === "reader" ? "Tem leitor" : doc.status === "persisted" ? "Persistida, sem tela" : "Oculta no Builder"} tone={doc.status === "reader" ? "supported" : doc.status === "persisted" ? "partial" : "missing"} />
                    </TableCell>
                    <TableCell>{doc.whatHappens}</TableCell>
                    <TableCell>{doc.whoReads}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </WikiTable>
        <WarningCallout title="Pendências é uma experiência, não uma caixa de entrada de Outputs">
          A aba Pendências real lista SOMENTE Revisões humanas aguardando decisão. Um Output na superfície &quot;Pendências&quot; é gravado, mas não
          vira pendência — ver <WikiLink href="/wiki/pendencias#definicao">Uma definição de pendente</WikiLink>.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="materiais-apoio" title="Materiais de apoio" eyebrow="Quem recomenda ≠ quem apresenta">
        <p>
          O Agent (respondendo diretamente) ou o Orquestrador podem <strong className="font-medium text-foreground">recomendar</strong> materiais da
          Base de Conhecimento junto do resultado — a recomendação viaja no resultado do node e atravessa a Revisão humana (o revisor vê título e
          motivo). O Output decide, por entrega, se ela deve <strong className="font-medium text-foreground">apresentar</strong> o que já foi
          recomendado: a opção &quot;Incluir materiais de apoio recomendados&quot; aparece só quando a saída é Acompanhamento para o próprio
          operador (o Feedback publicado é a superfície que renderiza a recomendação). Padrão desligado — Workflows existentes, inclusive os
          modelos, não mudam. O Output nunca escolhe materiais nem bases: ver{" "}
          <WikiLink href="/wiki/acompanhamento#material-apoio">Material de apoio recomendado</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="surface-x-trigger" title="Surface × Trigger" eyebrow="Não são a mesma coisa">
        <p>
          <strong className="font-medium text-foreground">Surface</strong> é onde algo aparece. <strong className="font-medium text-foreground">Trigger</strong>{" "}
          é o que inicia um Workflow. Chat e Avatar são superfícies (de entrega e de interação), nunca gatilhos — ver{" "}
          <WikiLink href="/wiki/workflows/triggers#surface-nao-e-trigger">Triggers</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="fonte-do-conteudo" title="De onde vem o conteúdo" eyebrow="Fonte do conteúdo">
        <p>
          O conteúdo é o resultado de uma etapa anterior, um campo desse resultado, ou uma variável que uma etapa anterior define. A variável chega no
          formato do tipo dela: texto como está, número no formato brasileiro, verdadeiro/falso como Sim/Não. A publicação recusa origem que não existe ou
          que não vem antes. Se o conteúdo não existir na hora de rodar (a etapa de origem não rodou neste caminho, ou a variável não tem valor), a execução
          para com o motivo, sem entregar nada. No Acompanhamento do próprio colaborador, variável não serve: ali é preciso o resultado inteiro de uma análise.
        </p>
      </WikiSection>

      <WikiSection id="avatar-chat" title="Avatar e Chat" eyebrow="Alto nível">
        <p>
          O avatar 3D e o chat de texto/voz da INIA são interfaces de consumo e interação do operador dentro do Acompanhamento. Um Output no
          <strong className="font-medium text-foreground"> Chat</strong> cria uma conversa nova da INIA para o destinatário, com o conteúdo como primeira
          mensagem. No <strong className="font-medium text-foreground">Avatar</strong> ele vira um convite &quot;Recado da INIA&quot; no painel da INIA
          (o sino avisa): o colaborador escolhe Ouvir agora (a fala começa no clique), Ler o recado ou Depois — e o recado só conta como entregue
          quando a fala termina. Feedback confiável em Chat/Avatar vai sempre para &quot;O próprio operador&quot;. Ver{" "}
          <WikiLink href="/wiki/acompanhamento#inia-no-acompanhamento">Avatar e chat da INIA</WikiLink> e o exemplo em{" "}
          <WikiLink href="/wiki/workflows/execucao-manual#exemplo-avatar">Execução manual</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="auditoria" title="Auditoria" eyebrow="Toda entrega é real e gravada">
        <p>
          Toda entrega de Output/Escalonar é real e fica gravada, auditável pela aba Execuções do Admin e pelo trace do QA Lab (que mostra o
          destinatário resolvido, as superfícies e o efeito simulado por superfície).
        </p>
        <SeeAlso
          links={[
            { href: "/wiki/acompanhamento", label: "Acompanhamento e Ciência", hint: "onde o operador recebe" },
            { href: "/wiki/notificacoes", label: "Notificações", hint: "como um Output vira aviso" },
            { href: "/wiki/estrutura#grupo-subgrupo", label: "Grupo × Subgrupo × hierarquia", hint: "por que Grupo não tem dono" },
            { href: "/wiki/workflows/fan-out-fan-in", label: "Fan-in", hint: "o contexto do Output consolidado" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
