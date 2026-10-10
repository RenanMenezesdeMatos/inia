import type { Metadata } from "next"
import { Timer } from "lucide-react"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExampleCard, FieldRow, NodeReference, SeeAlso, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { NODE_CONTEXT_LABELS, WIKI_NODES, WIKI_NODE_ORDER, type NodeContext } from "@/components/wiki/wiki-reference"

export const metadata: Metadata = {
  title: "Nodes",
  description: "Todos os nodes reais do Builder — Gatilho, Aguardar, Condição, Selecionar colaboradores, Aplicar individualmente, Consolidar resultados, Ação, Orquestrador, Revisão humana, Output, Fim — com finalidade, entrada, saída, configurações, limitações e exemplo.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "contexto", label: "Contexto dos nodes" },
  { id: "catalogo", label: "Os 11 nodes" },
  { id: "compatibilidade", label: "Compatibilidade por contexto" },
  { id: "acao-tipos", label: "Ação: os tipos" },
  { id: "diagnostico-indicador", label: "Diagnóstico do indicador" },
  { id: "orchestrator-node", label: "Orquestrador e resultado estruturado" },
  { id: "variaveis", label: "Variáveis" },
  { id: "aguardar", label: "Aguardar" },
]

const CONTEXT_ORDER: NodeContext[] = ["STRUCTURE", "EMPLOYEE_COLLECTION", "EMPLOYEE", "CONSOLIDATED_RESULT"]

export default function NodesPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="05 · Workflow Engine"
        title="Nodes"
        lead="As peças do fluxo. Onze nodes existem hoje no canvas — oito sempre disponíveis e três exclusivos do modo Consolidado. Agent não é um node: é chamado por dentro de uma Ação (Chamar agente) ou de um Orquestrador."
      >
        <p className="text-sm text-muted-foreground">
          Esta lista é gerada do mesmo catálogo de tipos que o editor usa — um node novo no produto obrigatoriamente entra aqui.
        </p>
      </WikiPageHeader>

      <WikiSection id="contexto" title="Contexto dos nodes" eyebrow="O tipo de informação disponível naquele ponto do fluxo">
        <p>
          Cada node recebe um <strong className="font-medium text-foreground">contexto</strong> — o tipo de informação disponível naquele ponto
          — inferido da posição no grafo, nunca configurado à mão. É o contexto que decide quais opções aparecem em cada painel e o que a validação
          aceita.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="Estrutura (STRUCTURE)">Raiz de um Workflow Consolidado: a Estrutura Consolidada inteira (equipe, grupo…). Ainda não há um colaborador individual.</ExampleCard>
          <ExampleCard title="Coleção de colaboradores (EMPLOYEE_COLLECTION)">Depois de &quot;Selecionar colaboradores&quot;: um subconjunto da estrutura, ainda sem execução individual.</ExampleCard>
          <ExampleCard title="Colaborador individual (EMPLOYEE)">Raiz de um Workflow Individual (Flag, Indicador, Agenda individual) ou depois de &quot;Aplicar individualmente&quot;: existe UM operador, com sua interação, medições e histórico.</ExampleCard>
          <ExampleCard title="Resultado consolidado (CONSOLIDATED_RESULT)">Depois de &quot;Consolidar resultados&quot;: os resultados de N colaboradores, com nomes resolvidos. Não existe &quot;operador atual&quot;.</ExampleCard>
        </div>
        <WikiFlow
          compact
          steps={[
            { label: "Estrutura", tone: "neutral" },
            { label: "Selecionar colaboradores → Coleção de colaboradores", tone: "core" },
            { label: "Aplicar individualmente → Colaborador individual (N execuções)", tone: "core" },
            { label: "Consolidar resultados → Resultado consolidado (1 execução)", tone: "core" },
          ]}
        />
      </WikiSection>

      <WikiSection id="catalogo" title="Os 11 nodes" eyebrow="Finalidade, quando usar, entrada, saída, configurações, limitações, exemplo">
        <div className="grid grid-cols-1 gap-4">
          {WIKI_NODE_ORDER.map((type) => {
            const node = WIKI_NODES[type]
            return (
              <NodeReference key={type} icon={node.icon} iconClass={node.iconClass} iconBgClass={node.iconBgClass} name={node.label} summary={node.summary}>
                <FieldRow label="Finalidade" value={node.purpose} />
                <FieldRow label="Quando usar" value={node.whenToUse} />
                <FieldRow label="Entrada" value={node.input} />
                <FieldRow label="Saída" value={node.output} />
                <FieldRow
                  label="Configuração"
                  value={
                    <ul className="list-inside list-disc space-y-0.5">
                      {node.settings.map((setting) => (
                        <li key={setting}>{setting}</li>
                      ))}
                    </ul>
                  }
                />
                {node.limitations.length > 0 ? (
                  <FieldRow
                    label="Limitações"
                    value={
                      <ul className="list-inside list-disc space-y-0.5">
                        {node.limitations.map((limitation) => (
                          <li key={limitation}>{limitation}</li>
                        ))}
                      </ul>
                    }
                  />
                ) : null}
                <FieldRow label="Exemplo" value={<span className="font-mono text-xs">{node.example}</span>} />
                <FieldRow label="Contextos" value={`${node.acceptedIn.map((context) => NODE_CONTEXT_LABELS[context]).join(" · ")}${node.consolidatedOnly ? " — só aparece na paleta em modo Consolidado" : ""}`} />
              </NodeReference>
            )
          })}
        </div>
      </WikiSection>

      <WikiSection id="compatibilidade" title="Compatibilidade por contexto" eyebrow="O que a validação aceita">
        <p>
          Nodes que dependem de um colaborador individual (Revisão humana, Chamar agente, Escalonar, Performance do colaborador numa Condição,
          &quot;O próprio operador&quot; num Output) só são aceitos em contexto individual — o publish bloqueia, com mensagem explicando qual node
          adicionar antes. O Orquestrador é a única exceção: também é aceito depois de &quot;Consolidar resultados&quot;.
        </p>
        <WikiTable caption="✅ aceito · ❌ bloqueado na publicação. Condição e Output aparecem em todos os contextos, mas Performance do colaborador e “O próprio operador” só em Colaborador individual.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Node</TableHead>
                {CONTEXT_ORDER.map((context) => (
                  <TableHead key={context}>{NODE_CONTEXT_LABELS[context]}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {WIKI_NODE_ORDER.filter((type) => type !== "trigger").map((type) => {
                const node = WIKI_NODES[type]
                return (
                  <TableRow key={type}>
                    <TableCell className="font-medium whitespace-nowrap">{node.label}</TableCell>
                    {CONTEXT_ORDER.map((context) => (
                      <TableCell key={context} className="font-mono">
                        {node.acceptedIn.includes(context) ? "✅" : "❌"}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </WikiTable>
        <WarningCallout title="Coleção → Fim é permitido">
          Termina a execução consolidada normalmente, mantendo a coleção no histórico — não é preciso passar por &quot;Aplicar individualmente&quot; se o
          objetivo era só produzir/auditar a coleção.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="acao-tipos" title="Ação: os tipos" eyebrow="Um node, quatro comportamentos (e dois legados)">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="Chamar agente">
            Aciona um Agent especialista diretamente, com uma instrução e o <strong>Formato da análise</strong>: Feedback de monitoria (padrão) ou
            Conformidade de processo ou Avaliação de processo (feedback com base, para &quot;Gerar feedback&quot;). Os dois só aceitam gatilho por Flag de canal (ver <WikiLink href="/wiki/bases-conhecimento#process-audit">Conformidade e avaliação de processo</WikiLink>). Ver <WikiLink href="/wiki/agents#agent-direto">Agent direto</WikiLink>. Se o
            Agent tem <strong>Ferramentas de investigação</strong>, o painel mostra &quot;Ferramentas nesta execução&quot;: as capacidades do Agent, que o
            Workflow pode restringir para esta execução (nunca conceder) — ver{" "}
            <WikiLink href="/wiki/agents/ferramentas-investigacao#workflow">Workflow pode restringir</WikiLink>. Com gatilho por Indicador, o
            formato pode ser <strong>Diagnóstico do indicador (feedback com base)</strong>: ver{" "}
            <WikiLink href="/wiki/workflows/nodes#diagnostico-indicador">Diagnóstico do indicador</WikiLink>.
          </ExampleCard>
          <ExampleCard title="Gerar feedback">
            Transforma o resultado de um <strong>Chamar agente</strong> ou <strong>Orquestrador</strong> anterior (a Origem, escolhida no painel) em
            feedback oficial de <strong>monitoria</strong> (gatilho por Flag) ou de <strong>indicador</strong> (gatilho por Indicador, com Chamar
            agente). Não analisa a interação de novo: confere a citação do Agent na transcrição real (monitoria) ou usa os dados oficiais do sistema
            — valor, meta, período — (indicador), valida o texto e a privacidade. Liberado, o Workflow segue (Revisão humana opcional, Output);
            retido, a execução espera o QA de feedback e retoma quando ele decidir; bloqueado, nunca é emitido. Este nó não entrega nada: quem entrega
            é o Output. Feedback oficial no Acompanhamento do operador sempre passa por aqui. Só aparece quando o módulo de feedback está ligado.
          </ExampleCard>
          <ExampleCard title="Feedback direto de atendimento (legado)">
            A versão anterior, que analisava a interação por conta própria e entregava fora do Output. Não é oferecida para nós novos; Workflows
            publicados com ela continuam executando.
          </ExampleCard>
          <ExampleCard title="Definir variável">Guarda um valor (fixo ou vindo do gatilho, de um node anterior ou de outra variável) na memória desta execução.</ExampleCard>
          <ExampleCard title="Definir configuração (legado)">
            Não pode mais ser criado pelo Builder. Um node já existente desse tipo (Workflows publicados antes da mudança) continua funcionando e
            editável, por compatibilidade.
          </ExampleCard>
          <ExampleCard title="Escalonar">
            Transfere responsabilidade a um cargo da hierarquia, com o conteúdo, em uma ou mais superfícies; pode Continuar o fluxo ou Encerrar o
            branch. Ver <WikiLink href="/wiki/workflows/human-review#escalonar">Escalonar</WikiLink>.
          </ExampleCard>
        </div>
      </WikiSection>

      <WikiSection id="diagnostico-indicador" title="Diagnóstico do indicador" eyebrow="O número é o sinal; o feedback nasce do processo">
        <p>
          O resultado de um indicador mostra <em>o que</em> aconteceu, nunca <em>por quê</em>. Por isso, com gatilho por Indicador, &quot;Chamar
          agente&quot; pode usar o formato <strong>Diagnóstico do indicador (feedback com base)</strong>. <em>Como</em> investigar é do próprio
          indicador: a estratégia publicada em{" "}
          <WikiLink href="/wiki/indicadores/configuracao#diagnostico-ia">Indicadores › Diagnóstico com IA</WikiLink>. O Workflow só decide quando
          disparar, qual Agent e a sequência. Sem estratégia publicada e ativa, o formato não publica. Se o Agent não for de um domínio permitido
          pela estratégia, também não publica.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <strong>Onde investigar.</strong> O sistema agrupa os atendimentos do colaborador no período da medição pelo motivo. Precisam existir pelo
            menos 3 atendimentos transcritos no motivo (a estratégia pode exigir mais). Fora da meta, num indicador de tempo em que menor é melhor, escolhe o motivo em que o tempo
            registrado mais passa da média geral, ponderado pelo volume. Nos outros casos, escolhe o motivo com mais atendimentos. Nenhum motivo é
            chamado de simples ou complexo, e a duração é identificada como aproximação: não é o cálculo oficial do indicador.
          </li>
          <li>
            <strong>Quais chamadas.</strong> O sistema escolhe uma amostra reproduzível desse motivo, até o máximo definido na estratégia (padrão: 5). O agente recebe só essas
            transcrições e avalia os processos oficiais de cada uma, com o mesmo contrato da Avaliação de processo.
          </li>
          <li>
            <strong>O que se sustenta.</strong> &quot;Gerar feedback&quot; recalcula a amostra e só aceita avaliações das chamadas que o sistema teria
            escolhido. Confere cada fala e cada regra da base e conta as etapas. Uma etapa não seguida em pelo menos 2 atendimentos (e ao menos tantas
            vezes quanto foi seguida) vira ponto de desenvolvimento. Uma etapa seguida de forma consistente vira ponto forte. Tudo é afirmado como
            &quot;em N de M atendimentos analisados&quot;.
          </li>
          <li>
            <strong>Grupo de referência.</strong> O grupo é formado pelo quartil de melhor resultado oficial do mesmo indicador, no mesmo Grupo e no
            mesmo período. Para ele, só aparece a frequência agregada da mesma etapa da base, no mesmo motivo, calculada a partir de etapas já
            verificadas. São exigidas pelo menos 4 pessoas no grupo, 4 pessoas contribuindo e 5 atendimentos (a estratégia pode exigir mais, nunca menos). Nunca aparece nome, resultado individual
            nem fala de colega.
          </li>
        </ol>
        <WarningCallout title="Associação não é causa">
          O feedback nunca diz que uma etapa causou o resultado nem que segui-la vai reduzir o indicador. Textos que ligam comportamento e indicador
          por causa, que citam grupo de referência sem o agregado ou que trazem números que não vieram do sistema são descartados pela validação,
          inclusive na edição do QA. Sem padrão consistente, sem motivo investigável ou em indicador sem métrica por atendimento, o feedback fica no
          fato oficial e diz, com as <strong>Limitações da análise</strong>, que não houve evidência suficiente para uma orientação específica.
          &quot;O que fazer&quot; só existe com regra oficial verificada da base, que também entra como material de apoio.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="orchestrator-node" title="Orquestrador e resultado estruturado" eyebrow="A camada de IA no Workflow">
        <p>
          <strong className="font-medium text-foreground">Agent</strong> é um especialista configurável (objetivo, contexto, bases de conhecimento).{" "}
          <strong className="font-medium text-foreground">Orchestrator</strong> escolhe e coordena especialistas — e é o que o node Orquestrador
          efetivamente chama. O Workflow, por sua vez, coordena todo o processo ao redor disso.
        </p>
        <p>
          Um Orchestrator pode declarar um <strong className="font-medium text-foreground">Resultado estruturado</strong> — grupos e campos tipados
          (texto, número, booleano, lista) que o Builder usa pra montar Conditions amigáveis (&quot;Diagnóstico › Severidade&quot;) em vez de expor
          caminhos técnicos. Os orquestradores do catálogo devolvem &quot;Síntese › Severidade, Aspectos, Requer acompanhamento&quot;.
        </p>
        <p>
          Especialistas acionados por um Orquestrador num Workflow recebem o contexto compartilhado (transcrição/entrada) além da pergunta
          reescrita — sem isso não teriam como citar evidência literal. Ver <WikiLink href="/wiki/orchestrators">Orchestrators</WikiLink>.
        </p>
        <p>
          <strong className="font-medium text-foreground">Roteamento.</strong> Por padrão, &quot;Decidido pela IA&quot;: o Orquestrador escolhe os
          especialistas a cada execução. Quando o gatilho já determina o assunto (por exemplo, a Flag de contestação só diz respeito a
          Faturamento), use &quot;Domínios fixos deste disparo&quot; e marque os domínios: o especialista de cada um é acionado direto, sem chamada de
          IA para escolher. Só dá para marcar domínio com exatamente um especialista ativo no Orquestrador; se isso mudar depois de publicar, a
          execução volta a escolher pela IA. Com um único especialista em Avaliação de processo, a síntese também é dispensada: o resultado do
          especialista segue direto para &quot;Gerar feedback&quot;. Com dois ou mais especialistas, a síntese continua. A aba Resultados mostra, por
          pessoa, se o especialista foi definido pelo Workflow ou escolhido pela IA e se a síntese foi dispensada.
        </p>
      </WikiSection>

      <WikiSection id="variaveis" title="Variáveis" eyebrow="Memória da execução">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="Fixa">Valor definido no próprio Workflow, sempre o mesmo.</ExampleCard>
          <ExampleCard title="Dinâmica">Valor vindo do gatilho, de um node anterior ou de outra variável.</ExampleCard>
        </div>
        <p>
          Variável é memória <strong className="font-medium text-foreground">da execução</strong> — nunca um indicador persistente. Regra prática: se um
          valor é usado uma vez só, referencie direto; se vai ser reutilizado mais adiante no mesmo fluxo, vire variável.
        </p>
      </WikiSection>

      <WikiSection id="aguardar" title="Aguardar" eyebrow="Pausa controlada">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Timer className="size-4" /> Pausa a execução por uma duração fixa e retoma sozinho, sem intervenção — o prazo é persistido, então sobrevive a
          um restart do motor.
        </div>
        <p>
          Nenhum dos 10 Workflows operacionais usa Aguardar — em todos os casos em que o pedido original sugeria uma espera (ex.: &quot;reavaliar em 7
          dias&quot;), a própria cadência do Trigger por agenda já cobre isso de forma mais simples.
        </p>
        <SeeAlso
          links={[
            { href: "/wiki/workflows/conditions", label: "Conditions", hint: "o node Condição em profundidade" },
            { href: "/wiki/workflows/ranking", label: "Selecionar colaboradores", hint: "critério e ranking" },
            { href: "/wiki/workflows/fan-out-fan-in", label: "Aplicar individualmente e Consolidar resultados" },
            { href: "/wiki/workflows/human-review", label: "Revisão humana e Escalonar" },
            { href: "/wiki/workflows/outputs", label: "Output" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
