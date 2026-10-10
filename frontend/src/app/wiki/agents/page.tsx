import type { Metadata } from "next"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CapabilityBadge, ExampleCard, FieldRow, SeeAlso, StepList, UseCases, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { AiArchitectureDiagram } from "@/components/wiki/ai-architecture-diagram"
import { SPECIALIST_AGENTS, type SpecialistAgent } from "@/components/wiki/ai-catalog-data"
import { AGENT_TYPE_LABELS } from "@/schemas/admin/agent.schema"
import { SPECIALTY_KIND_LABELS } from "@/schemas/admin/orchestrator-policy"

export const metadata: Metadata = {
  title: "Agents",
  description: "Agent é um especialista de IA com objetivo, instruções e fontes de conhecimento autorizadas. O que é, quando usar, quando não usar, como criar (campos reais da UI), abas, princípio do especialista, Agent direto e o catálogo oficial.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "O que é um Agent" },
  { id: "regra-fundamental", label: "A regra fundamental" },
  { id: "quando-usar", label: "Quando usar / não usar" },
  { id: "tipos", label: "Tipos de Agent" },
  { id: "especialidade", label: "Tipo de especialidade" },
  { id: "como-criar", label: "Como criar um Agent" },
  { id: "campos", label: "Os campos, um a um" },
  { id: "abas", label: "As abas de um Agent" },
  { id: "especialista", label: "Princípio do especialista" },
  { id: "agent-direto", label: "Agent direto (sem Orchestrator)" },
  { id: "evidencia", label: "Evidência e não-invenção" },
  { id: "catalogo", label: "Catálogo de Agents especialistas" },
  { id: "legados", label: "Agentes legados" },
  { id: "limitacoes", label: "Limitações atuais" },
]

const AGENTS_WITH_KB = SPECIALIST_AGENTS.filter((agent) => agent.knowledgeBases.length > 0)
const AGENTS_WITHOUT_KB = SPECIALIST_AGENTS.filter((agent) => agent.knowledgeBases.length === 0)

export default function AgentsPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="06 · Agents"
        title="Agents"
        lead="Um Agent é um especialista de IA com objetivo, instruções (contexto) e fontes de conhecimento autorizadas. É a unidade central de configuração da camada de IA — dono de UM domínio, nunca de todo o conhecimento da empresa."
      >
        <div className="flex flex-wrap gap-2 pt-2">
          <CapabilityBadge label="Configuração pela UI" />
          <CapabilityBadge label="Bases autorizadas por Agent" />
          <CapabilityBadge label="Retrieval por trechos" />
          <CapabilityBadge label="Evidência literal verificada por código" />
          <CapabilityBadge label="Execuções persistidas" />
          <CapabilityBadge label="Abas Capacidades / Propostas" tone="missing" />
        </div>
      </WikiPageHeader>

      <WikiSection id="regra-fundamental" title="A regra fundamental" eyebrow="Princípio">
        <WarningCallout title="Um Agent não é dono de todo o conhecimento da empresa" kind="tip">
          <strong>Agent</strong> = especialista em um domínio. <strong>Base de Conhecimento</strong> = fonte autorizada daquele domínio.{" "}
          <strong>Retrieval</strong> = seleção dos trechos realmente relevantes para a chamada. <strong>Orchestrator</strong> = coordenação de
          especialistas quando a análise exige mais de uma competência ou uma síntese. <strong>Workflow</strong> = usa o caminho mais simples
          possível.
        </WarningCallout>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="Errado — e o que existia antes desta consolidação">
            Um &quot;Agente de Feedback de Chamadas&quot; com 12 bases vinculadas (fatura, reparo, cancelamento, cadastro, conduta…) e, pior, com o
            texto INTEIRO de todas elas colado no prompt a cada chamada: ~350 mil caracteres (≈100 mil tokens) por request, mesmo quando a ligação
            era só uma segunda via de conta.
          </ExampleCard>
          <ExampleCard title="Certo — o que existe agora">
            &quot;Especialista de Faturamento&quot; pode consultar Contestação, Segunda Via e Negociação de Débito; numa chamada de segunda via entram
            só as seções pertinentes (na casa de 3 a 9 mil caracteres). O agente de Performance não tem base nenhuma: analisa números oficiais. Um
            &quot;Orquestrador · Faturamento&quot; só entra quando a chamada tem mais de um aspecto do mesmo domínio.
          </ExampleCard>
        </div>
      </WikiSection>

      <WikiSection id="quando-usar" title="Quando usar / não usar" eyebrow="Critério">
        <UseCases
          use={[
            "Problema conhecido de um domínio: o Workflow já sabe qual competência precisa (flag de rechamada no grupo FATURAS → Faturamento)",
            "Feedback de monitoria com evidência literal da transcrição",
            "Feedback de indicador com os números oficiais fornecidos pelo Workflow",
            "Auditoria de conformidade de um procedimento (Conformidade de processo)",
          ]}
          avoid={[
            "Comparação numérica que uma Condition resolve (não use IA para 78% < 80%)",
            "Interação com vários domínios de processo ao mesmo tempo (use um Orchestrator)",
            "Síntese de N análises individuais (use o Orquestrador gerencial pós-JOIN)",
            "Um “super-agent” com todas as bases da empresa",
          ]}
        />
      </WikiSection>

      <WikiSection id="tipos" title="Tipos de Agent" eyebrow="Campo “Tipo”">
        <WikiTable caption="Rótulos exatamente como aparecem no seletor “Tipo” do formulário.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Para quê</TableHead>
                <TableHead>Como é acionado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">{AGENT_TYPE_LABELS.CALL_FEEDBACK}</TableCell>
                <TableCell>Monitoria: avalia uma interação/transcrição contra critérios e conhecimento vigente.</TableCell>
                <TableCell>Sempre por gatilho (Workflow por Flag de canal) — nunca por pedido direto do usuário.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">{AGENT_TYPE_LABELS.INDICATOR_FEEDBACK}</TableCell>
                <TableCell>Indicador: explica resultados oficiais, meta, período, evolução.</TableCell>
                <TableCell>Por pedido do operador (chat) ou por agendamento (Workflow por Agenda com fonte de dados) — nunca por Flag.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">{AGENT_TYPE_LABELS.DIAGNOSTICS}</TableCell>
                <TableCell>Diagnóstico de performance individual (recorrência em Q4, quedas, prioridades).</TableCell>
                <TableCell>Cada grupo cria o seu; acionado por Workflow (Chamar agente).</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">{AGENT_TYPE_LABELS.ORCHESTRATOR}</TableCell>
                <TableCell>Agente-coordenador: identifica o pedido e decide quais especialistas acionar. É o “Agente orquestrador” escolhido ao criar um Orchestrator.</TableCell>
                <TableCell>Nunca chamado direto num Workflow (a validação bloqueia) — só via Orchestrator.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">{AGENT_TYPE_LABELS.HR}</TableCell>
                <TableCell>Temas de RH (políticas internas) — fora da análise de chamadas e indicadores.</TableCell>
                <TableCell>Como especialista de um Orchestrator (ex.: o que atende o chat/voz do operador).</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">{AGENT_TYPE_LABELS.CUSTOM}</TableCell>
                <TableCell>Especialista de propósito específico (a maioria dos especialistas por domínio do catálogo).</TableCell>
                <TableCell>Workflow (Chamar agente) ou como especialista de um Orchestrator.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="especialidade" title="Tipo de especialidade" eyebrow="Campo “Tipo de especialidade” — o que o Agent sabe">
        <p>
          O <strong>Tipo</strong> (acima) diz como o Agent é acionado e que contrato de entrada ele espera. A <strong>especialidade</strong> responde
          outra pergunta — <em>o que este Agent sabe ou analisa</em> — e é o que um Orquestrador consulta para decidir quem pode ser seu especialista.
        </p>
        <WikiTable caption="Rótulos exatamente como aparecem no seletor “Tipo de especialidade”.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Especialidade</TableHead>
                <TableHead>O que significa</TableHead>
                <TableHead>Campo extra</TableHead>
                <TableHead>Exemplos do catálogo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">{SPECIALTY_KIND_LABELS.DOMAIN}</TableCell>
                <TableCell>Sabe <strong>O QUE</strong> deveria acontecer num assunto de negócio — audita a chamada contra o procedimento oficial daquele domínio.</TableCell>
                <TableCell>
                  Domínio de negócio — escolhido no <WikiLink href="/wiki/agents/dominios-negocio">catálogo administrável</WikiLink> (hoje: Faturamento, Retenção e Cancelamento, Suporte Técnico, Cadastro e Titularidade; um domínio novo é configuração)
                </TableCell>
                <TableCell>Especialista de Faturamento, de Retenção e Cancelamento, de Suporte Técnico, de Cadastro e Titularidade</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">{SPECIALTY_KIND_LABELS.CROSS_CUTTING}</TableCell>
                <TableCell>Aplica a mesma competência em qualquer assunto — <strong>COMO</strong> o atendimento foi conduzido. Não é “sabe de tudo”: é uma dimensão que atravessa domínios.</TableCell>
                <TableCell>Competência (ex.: Qualidade, Experiência, Eficiência)</TableCell>
                <TableCell>Especialista de Qualidade de Atendimento, de Experiência do Cliente, de Eficiência Operacional</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">{SPECIALTY_KIND_LABELS.PERFORMANCE}</TableCell>
                <TableCell>Explica números oficiais de um colaborador (indicadores, PRV, reconhecimento, disponibilidade). Chamado direto pelo Workflow — nunca por um Orquestrador de atendimento.</TableCell>
                <TableCell>—</TableCell>
                <TableCell>Especialista de Performance Individual, de PRV, de Reconhecimento, de Disponibilidade Operacional</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">{SPECIALTY_KIND_LABELS.SYNTHESIS}</TableCell>
                <TableCell>Recebe os resultados <strong>já produzidos</strong> de N colaboradores (depois de “Consolidar resultados”) e devolve padrões, riscos, pontos fortes, tendências e próximos passos. Não roteia entre especialistas e não recalcula indicador ou PRV.</TableCell>
                <TableCell>Aceita resultado consolidado (sempre)</TableCell>
                <TableCell>Especialista de Síntese Gerencial</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <WarningCallout title="Multidomínio ≠ transversal" kind="tip">
          <strong>Multidomínio</strong> é uma propriedade do <em>Orquestrador</em>: coordena especialistas de vários assuntos. <strong>Transversal</strong> é uma
          propriedade do <em>Agent</em>: uma competência (Qualidade, Experiência, Eficiência) que vale em qualquer assunto. Um Orquestrador de um único
          domínio pode ter um especialista transversal; um especialista transversal nunca vira “multidomínio”.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="como-criar" title="Como criar um Agent" eyebrow="Admin › Agentes › Novo agente">
        <StepList
          steps={[
            { title: "Abra Admin › Agentes e clique em “Novo agente”", detail: "Também disponível no atalho da sidebar. Você pode “Duplicar” um Agent existente para partir de uma configuração próxima." },
            { title: "Quem é este agente", detail: <>Preencha <strong>Nome</strong>, escolha o <strong>Tipo</strong>, descreva o <strong>Objetivo</strong> (o que ele deve alcançar) e a <strong>Descrição</strong> (como funciona, em linhas gerais).</> },
            { title: "Grupo (alcance)", detail: <>Escolha o <strong>Alcance por grupo</strong>: “Todos os grupos” (só admin global) ou um Grupo/Subgrupo específico. Ao escolher um grupo, as bases já escopadas para ele entram pré-selecionadas.</> },
            { title: "Contexto (prompt)", detail: "Instruções detalhadas de como o agente deve raciocinar. Os especialistas do catálogo seguem um esqueleto de 12 pontos: papel, objetivo, fontes permitidas, prioridade da base, uso da transcrição, uso de indicadores, ausência de dados, fatos × hipóteses, evidências, formato da saída, limitações e proibições." },
            { title: "Bases de conhecimento consultadas", detail: <>Mova para “Selecionadas” as bases que este Agent pode consultar. Só bases publicadas entram no runtime; ver <WikiLink href="/wiki/bases-conhecimento#vinculo">Vínculo com Agents</WikiLink>. Não associe base “para preencher campo”.</> },
            { title: "Restrições específicas deste agente", detail: "Marque os assuntos proibidos que valem só para este Agent — eles são SOMADOS aos assuntos proibidos globais de Governança, nunca os substituem." },
            { title: "Criar agente", detail: "Depois de criado, as abas Teste, Execuções e Histórico ficam disponíveis. O Agent nasce ativo; o interruptor no cabeçalho desativa/ativa." },
            { title: "Teste", detail: <>Na aba <strong>Teste</strong>, cole uma “Transcrição ou cenário de teste” e clique em <strong>Executar teste</strong> — uma request real ao modelo, persistida como execução (Teste manual). Para testar com uma interação real e ver o rastro de conhecimento, use o <WikiLink href="/wiki/qa-lab#agent-orchestrator">QA Lab › Agent</WikiLink>.</> },
          ]}
        />
      </WikiSection>

      <WikiSection id="campos" title="Os campos, um a um" eyebrow="1:1 com o formulário">
        <FieldRow label="Nome" value="Nome do Agent — é o contrato exibido em Workflows, Orchestrators, QA Lab e nesta Wiki." />
        <FieldRow label="Tipo" value={`${Object.values(AGENT_TYPE_LABELS).join(", ")}.`} />
        <FieldRow label="Objetivo" value="O que esse agente deve alcançar." />
        <FieldRow label="Descrição" value="Como ele funciona, em linhas gerais." />
        <FieldRow label="Grupo" value="Alcance por grupo: Todos os grupos, Grupo ou Subgrupo. Define quem pode usá-lo e quais bases entram pré-selecionadas." />
        <FieldRow label="Contexto (prompt)" value="Instruções detalhadas de raciocínio — hierarquia: sistema > instruções do Agent > trechos recuperados (dados) > entrada." />
        <FieldRow label="Bases de conhecimento consultadas" value="Lista de bases autorizadas (Disponíveis ↔ Selecionadas). O backend recusa ids inexistentes ou excluídos." />
        <FieldRow label="Materiais de apoio" value="“Recomendar materiais quando este Agente responder diretamente” (padrão desligado): com a opção ligada, quando o Agent é o respondente final (node “Chamar agente”, teste manual), ele pode indicar até 3 materiais das bases que consultou. Como especialista de um Orquestrador, a seleção final é do Orquestrador." />
        <FieldRow label="Ferramentas de investigação" value={<>Sete capacidades amigáveis (Indicadores e tendências, Segmentação operacional, Comparação operacional, Interações e transcrições, Jornada operacional, Base de Conhecimento, Materiais de apoio), todas desligadas por padrão. Com capacidades, o Agent investiga os dados com ferramentas determinísticas antes de responder; um Workflow pode restringir (nunca conceder). Ver <WikiLink href="/wiki/agents/ferramentas-investigacao">Ferramentas de investigação</WikiLink>.</>} />
        <FieldRow label="Restrições específicas" value="Assuntos proibidos adicionais, somados aos globais de Governança." />
        <FieldRow label="Ativo" value="Interruptor no cabeçalho. Um Agent inativo bloqueia a publicação de Workflows que o usam." />
        <p className="text-sm text-muted-foreground">Não existem outros campos no formulário atual — em particular, nenhum campo de modelo de IA, temperatura ou provedor: a execução fica atrás de uma interface única e trocável (hoje implementada com Gemini).</p>
      </WikiSection>

      <WikiSection id="abas" title="As abas de um Agent" eyebrow="Configuração · Teste · Execuções · Histórico">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="Configuração">Os campos acima.</ExampleCard>
          <ExampleCard title="Teste">Executa o agente agora, com a configuração atual, contra um cenário de exemplo (transcrição ou descrição). Disponível depois que o agente for criado.</ExampleCard>
          <ExampleCard title="Execuções">Testes manuais e disparos por gatilho já executados por este agente — entrada, saída, status e erro de cada um (toda execução é persistida).</ExampleCard>
          <ExampleCard title="Histórico">Quem criou, quem alterou, o que mudou e quando.</ExampleCard>
        </div>
        <p className="text-sm text-muted-foreground">
          As abas <strong className="font-medium text-foreground">Capacidades</strong> e <strong className="font-medium text-foreground">Propostas</strong> aparecem
          desabilitadas com &quot;Chega em uma próxima etapa&quot; — não existem ainda.
        </p>
      </WikiSection>

      <WikiSection id="especialista" title="Princípio do especialista" eyebrow="Um Agent por domínio">
        <AiArchitectureDiagram />
        <p>
          Cada <WikiLink href="/wiki/agents/dominios-negocio">domínio de negócio</WikiLink> com base de conhecimento tem um especialista correspondente (hoje: Faturamento, Retenção e Cancelamento, Suporte
          Técnico, Cadastro e Titularidade), mais os transversais de condução (Qualidade de Atendimento, Experiência do Cliente, Eficiência
          Operacional) e os de performance sem base (Performance Individual, PRV, Reconhecimento, Disponibilidade Operacional). Nenhum Agent
          concentra mais de um domínio de processo — o teste de consistência do catálogo cobra isso.
        </p>
      </WikiSection>

      <WikiSection id="agent-direto" title="Agent direto (sem Orchestrator)" eyebrow="Regra">
        <WarningCallout title="A regra de produto" kind="tip">
          <strong>Se você já sabe qual especialista precisa, use um Agent.</strong> <strong>Se precisa escolher ou combinar especialistas, use um
          Orchestrator.</strong> E se só precisa sintetizar resultados já produzidos (depois de “Consolidar resultados”), use um Agent de síntese —
          não um Orquestrador.
        </WarningCallout>
        <WikiFlow
          compact
          steps={[
            { label: "Workflow sabe o domínio (Abrangência de grupo, flag específica, Condition de performance)", tone: "core" },
            { label: "Chamar agente → o especialista do domínio, direto", tone: "ai" },
            { label: "Uma request de IA — nunca duas", tone: "output" },
          ]}
        />
        <WarningCallout title="Nunca Workflow → Orquestrador → Agent só para gastar outra request">
          Se o trigger já é &quot;contestação de fatura&quot; num grupo de faturamento, o caminho é Workflow → Especialista de Faturamento. O
          Orchestrator existe para coordenar (mais de um domínio, mais de um aspecto) ou sintetizar — não para repetir o que o especialista faz.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="evidencia" title="Evidência e não-invenção" eyebrow="Auditável por construção">
        <ul className="list-inside list-disc space-y-1">
          <li>Evidência da chamada = trecho literal (copiado) da transcrição, conferido por código antes de aceitar a resposta. Se a IA parafraseia, o resultado é descartado e a execução marcada como falha.</li>
          <li>Evidência da base = título exato do documento e a seção do trecho recuperado; sem trecho que cubra, o agente declara &quot;não há procedimento cadastrado&quot;.</li>
          <li>Ausência na transcrição nunca significa omissão do operador.</li>
          <li>Fato ≠ hipótese: hipóteses vêm marcadas como &quot;hipótese:&quot;; causalidade só como hipótese.</li>
          <li>Nunca inverter Cliente/Operador, nunca atribuir emoção sem texto, nunca criar regra, prazo ou item que não esteja no trecho recuperado.</li>
          <li>Nenhum Agent ou Orchestrator decide punição: analisam, evidenciam, resumem e sugerem acompanhamento; casos de impacto passam por Revisão Humana.</li>
        </ul>
      </WikiSection>

      <WikiSection id="catalogo" title="Catálogo de Agents especialistas" eyebrow={`${SPECIALIST_AGENTS.length} especialistas — um por competência real`}>
        <p>
          Configurados pela tela de Agentes (nome, tipo, objetivo, descrição, alcance, prompt profissional, bases e restrições). A lista abaixo é a
          mesma fonte que os testes de consistência conferem contra o banco de referência.
        </p>
        <h3 className="pt-2 font-heading text-lg font-semibold">Com Base de Conhecimento ({AGENTS_WITH_KB.length})</h3>
        <Accordion type="single" collapsible className="space-y-3">
          {AGENTS_WITH_KB.map((agent) => (
            <AgentItem key={agent.id} agent={agent} />
          ))}
        </Accordion>
        <h3 className="pt-2 font-heading text-lg font-semibold">Sem Base de Conhecimento ({AGENTS_WITHOUT_KB.length})</h3>
        <p className="text-sm text-muted-foreground">
          Nem todo Agent precisa de base: performance, PRV, eficiência e reconhecimento analisam indicadores oficiais fornecidos pelo Workflow. Não
          associar base só para preencher campo.
        </p>
        <Accordion type="single" collapsible className="space-y-3">
          {AGENTS_WITHOUT_KB.map((agent) => (
            <AgentItem key={agent.id} agent={agent} />
          ))}
        </Accordion>
      </WikiSection>

      <WikiSection id="legados" title="Agentes legados" eyebrow="Compatibilidade">
        <p>
          &quot;Agente de Feedback de Chamadas&quot; e &quot;Agente de Processos&quot; (com 10–12 bases) continuam ativos por compatibilidade com fluxos
          antigos — não são o padrão. Com o retrieval por trechos, mesmo eles deixaram de injetar todas as bases inteiras.
        </p>
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="Transparência">
        <ul className="list-inside list-disc space-y-1">
          <li>Especialistas são single-operador: analisam um colaborador/interação por vez (por isso o Orquestrador pós-JOIN roda sem especialistas).</li>
          <li>O especialista de um node de Workflow é fixo — não há roteamento dinâmico &quot;pelo problema identificado&quot; dentro de um mesmo Workflow.</li>
          <li>Abas Capacidades e Propostas ainda não existem.</li>
          <li>O chat/voz da INIA ainda não persiste as interações do operador com os Agents.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/bases-conhecimento", label: "Bases de Conhecimento", hint: "o que o Agent consulta e como" },
            { href: "/wiki/orchestrators", label: "Orchestrators", hint: "quando um Agent não basta" },
            { href: "/wiki/qa-lab#agent-orchestrator", label: "Testar um Agent no QA Lab" },
            { href: "/wiki/casos-praticos#guia-agent-faturamento", label: "Guia: criar um Agent de Faturamento" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}

function AgentItem({ agent }: { agent: SpecialistAgent }) {
  return (
    <AccordionItem value={agent.id} className="rounded-lg border border-border px-4">
      <AccordionTrigger>
        <span className="flex flex-wrap items-baseline gap-2">
          <span>{agent.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{AGENT_TYPE_LABELS[agent.agentType]}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-3">
        <p className="text-foreground/90">{agent.objective}</p>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          <FieldRow label="Domínio" value={agent.domain} />
          <FieldRow label="Bases" value={agent.knowledgeBases.length ? agent.knowledgeBases.join(" · ") : "Nenhuma — analisa dados oficiais"} />
          <FieldRow label="Quando usar" value={agent.whenToUse.join("; ")} />
          <FieldRow label="Não usar" value={agent.whenNotToUse.join("; ")} />
          <FieldRow label="Output" value={agent.expectedOutput} />
          <FieldRow label="Limitações" value={agent.limitations.join("; ")} />
        </dl>
      </AccordionContent>
    </AccordionItem>
  )
}
