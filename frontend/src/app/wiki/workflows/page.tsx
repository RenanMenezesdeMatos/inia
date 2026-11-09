import type { Metadata } from "next"
import { ArrowRight } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CapabilityBadge, ExampleCard, SeeAlso, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Workflow Engine — visão geral",
  description: "Workflow é automação visual orientada por evento/dados: Trigger → Contexto → Condição → Ações/IA → Decisões → Outputs. Escopo, Abrangência, Modo de avaliação, DRAFT × PUBLISHED e validação de publicação.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "o-que-e", label: "O que é um Workflow" },
  { id: "como-pensar", label: "Como pensar um Workflow" },
  { id: "abrangencia", label: "Escopo, Abrangência e Modo de avaliação" },
  { id: "modelo-mental", label: "O modelo mental completo" },
  { id: "seguranca-grupo", label: "Segurança por grupo" },
  { id: "agenda-individual-consolidado", label: "Agenda: Individual × Consolidado" },
  { id: "sempre-individual", label: "Triggers sempre individuais" },
  { id: "periodo-comparacao", label: "Período e Comparação" },
  { id: "draft-published", label: "DRAFT × PUBLISHED" },
  { id: "validacao", label: "Validação de publicação" },
  { id: "guia-pratico", label: "Guia: quero fazer X" },
  { id: "mapa", label: "Mapa desta área" },
]

export default function WorkflowEngineOverviewPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="05 · Workflow Engine"
        title="Workflow Engine"
        lead="Automatize decisões, análises, interações e ações operacionais. O Workflow Engine liga um gatilho (algo aconteceu, ou chegou a hora) a uma decisão (uma Condition) e a uma ação real — analisar com IA, pedir uma decisão humana, encaminhar responsabilidade ou entregar informação a alguém."
      >
        <p className="max-w-2xl text-sm leading-relaxed text-foreground/80">
          Esta área documenta exatamente o que está implementado hoje — com os 10 Workflows operacionais reais criados, publicados e executados como
          prova, e os 20 modelos práticos configurados em rascunho (ver <WikiLink href="/wiki/casos-praticos/workflows">Casos práticos › Modelos de Workflow</WikiLink>).
        </p>
        <p className="max-w-2xl text-sm leading-relaxed text-foreground/80">
          Prefere aprender por um problema concreto? Em <WikiLink href="/wiki/workflows/exemplos">Aprenda na prática</WikiLink> você acompanha jornadas completas, etapa por etapa, em demonstrações com dados fictícios.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <CapabilityBadge label="Flag de canal" />
          <CapabilityBadge label="Indicador" />
          <CapabilityBadge label="Agenda de calendário" />
          <CapabilityBadge label="Agenda relativa ao expediente" />
          <CapabilityBadge label="Condition E/OU" />
          <CapabilityBadge label="Histórico e PRV" />
          <CapabilityBadge label="Chamar agente" />
          <CapabilityBadge label="Orchestrator" />
          <CapabilityBadge label="Selecionar / Aplicar / Consolidar" />
          <CapabilityBadge label="Revisão Humana" />
          <CapabilityBadge label="Escalonar" />
          <CapabilityBadge label="Variáveis" />
          <CapabilityBadge label="Validação única (Publicar = dry-run)" />
        </div>
      </WikiPageHeader>

      <WikiSection id="o-que-e" title="O que é um Workflow" eyebrow="Definição">
        <p>
          Um Workflow é uma <strong className="font-medium text-foreground">automação visual orientada por evento ou dados</strong>: um grafo de nodes
          montado no editor, que o motor executa para cada pessoa (ou estrutura) matriculada.
        </p>
        <WikiFlow
          compact
          steps={[
            { label: "Trigger", detail: "Flag de canal, Indicador ou Agenda — o QUANDO", tone: "input" },
            { label: "Contexto", detail: "o colaborador, a interação, as medições, a estrutura — o que existe naquele ponto", tone: "neutral" },
            { label: "Condição", detail: "regra determinística: TRUE / FALSE / SEM DADOS", tone: "core" },
            { label: "Ações / IA", detail: "Chamar agente, Orquestrador, Definir variável, Escalonar", tone: "ai" },
            { label: "Decisões", detail: "Revisão humana: Aprovar / Reprovar / Escalar", tone: "people" },
            { label: "Outputs", detail: "QUEM + ONDE + O QUÊ", tone: "output" },
          ]}
        />
      </WikiSection>

      <WikiSection id="como-pensar" title="Como pensar um Workflow" eyebrow="Fundamentos">
        <p>Toda decisão de desenho de um Workflow cabe numa destas perguntas:</p>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {[
            ["QUANDO?", "Trigger"],
            ["PRECISO DECIDIR?", "Condition"],
            ["PRECISO DE IA (um domínio)?", "Chamar agente"],
            ["PRECISO DE IA (coordenar/sintetizar)?", "Orchestrator"],
            ["PRECISO GUARDAR?", "Variável"],
            ["PRECISO QUE ALGUÉM DECIDA?", "Revisão Humana"],
            ["PRECISO ENCAMINHAR?", "Escalonar"],
            ["PRECISO ENTREGAR?", "Output"],
            ["PRECISO ESPERAR?", "Aguardar"],
            ["SÓ PARTE DA ESTRUTURA?", "Selecionar colaboradores"],
            ["CADA UM SEPARADO?", "Aplicar individualmente"],
            ["A EQUIPE INTEIRA DEPOIS?", "Consolidar resultados"],
            ["ACABOU?", "Fim"],
          ].map(([question, answer]) => (
            <div key={question} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3.5 py-2.5">
              <span className="text-sm text-muted-foreground">{question}</span>
              <span className="flex items-center gap-1.5 font-mono text-sm font-medium text-primary">
                <ArrowRight className="size-3.5" /> {answer}
              </span>
            </div>
          ))}
        </div>
      </WikiSection>

      <WikiSection id="abrangencia" title="Escopo, Abrangência e Modo de avaliação" eyebrow="Quem configura, onde, e quem é analisado">
        <p>
          São <strong className="font-medium text-foreground">cinco conceitos diferentes</strong>, nunca um só — misturá-los é a forma mais comum de
          um Workflow &quot;vazar&quot; entre grupos, de uma Condition oferecer uma opção que não existe pro contexto atual, ou de um relatório
          parecer coerente mas responder à pergunta errada. Exemplo fictício usado no resto desta seção:{" "}
          <strong className="font-medium text-foreground">Fátima</strong> é uma Admin restrita ao grupo{" "}
          <strong className="font-medium text-foreground">FATURAS</strong>; <strong className="font-medium text-foreground">Carlos</strong> é
          Supervisor da equipe de FATURAS.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ExampleCard title="① Escopo Administrativo — QUEM PODE CONFIGURAR">
            O que a própria Fátima está autorizada a ver e configurar, como admin — Workflows, Agents e Orchestrators. Definido na tela Usuários e
            perfis, reaproveitando o mesmo seletor de grupo usado em todo o resto do produto.
          </ExampleCard>
          <ExampleCard title="② Abrangência do Workflow — ONDE">
            Em quais grupos aquele Workflow específico pode atuar. Definida UMA vez, na criação — nunca reperguntada dentro do editor. Um Workflow
            de Fátima só pode ter Abrangência dentro do que ela mesma administra. Nunca decide sozinha se a análise é individual ou consolidada.
          </ExampleCard>
          <ExampleCard title="③ Modo de avaliação (Alvo da avaliação) — COMO ANALISAR">
            Individual (cada colaborador, separadamente) ou Consolidado (uma equipe/estrutura como uma única unidade). Só é uma escolha real pra
            Agenda de calendário — os demais Triggers já têm o modo implícito, nunca perguntado.
          </ExampleCard>
          <ExampleCard title="④ Filtro Populacional / Estrutura Consolidada — QUEM/QUAL ESTRUTURA">
            Em modo Individual: quais colaboradores, dentro da Abrangência, participam (Filtro Populacional — nunca vira agregação). Em modo
            Consolidado: qual estrutura é analisada como uma unidade só (Estrutura Consolidada).
          </ExampleCard>
        </div>
        <ExampleCard title="⑤ Destinatário — QUEM RECEBE">
          Quem recebe o resultado (Output/Escalonar) — o próprio colaborador analisado, o Supervisor dele, o Gerente, um cargo específico ou uma
          pessoa. Independente do Modo de avaliação: analisar uma estrutura nunca implica entregar pra cada pessoa dela.
        </ExampleCard>
        <p>
          As perguntas ② Abrangência, ③ Alvo da avaliação e ④ População/Estrutura vivem, em sequência numerada, no Sheet{" "}
          <strong className="font-medium text-foreground">Configurações do workflow</strong> — junto com o Gatilho (seção 2), que reaproveita
          exatamente a mesma configuração do nó Gatilho do canvas. Editar num lugar reflete no outro na hora; não são dois estados.
        </p>
      </WikiSection>

      <WikiSection id="modelo-mental" title="O modelo mental completo" eyebrow="Nesta ordem">
        <p>Todo Workflow, de ponta a ponta, responde a estas perguntas:</p>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {[
            ["QUEM PODE CONFIGURAR?", "Escopo Administrativo"],
            ["ONDE?", "Abrangência do Workflow"],
            ["QUANDO?", "Trigger"],
            ["COMO ANALISAR?", "Individual ou Consolidado"],
            ["QUEM/QUAL ESTRUTURA?", "Filtro Populacional / Estrutura Consolidada"],
            ["DE QUANDO?", "Período"],
            ["O QUE AVALIAR?", "Condition"],
            ["O QUE FAZER?", "Chamar agente / Orchestrator / Ação"],
            ["QUEM RECEBE?", "Destinatário (Output/Escalonar)"],
            ["ONDE aparece?", "Surface"],
          ].map(([question, answer]) => (
            <div key={question} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3.5 py-2.5">
              <span className="text-sm text-muted-foreground">{question}</span>
              <span className="flex items-center gap-1.5 font-mono text-sm font-medium text-primary">
                <ArrowRight className="size-3.5" /> {answer}
              </span>
            </div>
          ))}
        </div>
      </WikiSection>

      <WikiSection id="seguranca-grupo" title="Segurança por grupo é real, nunca só de tela" eyebrow="Backend valida">
        <p>
          Um admin restrito a um grupo nunca enxerga, edita ou publica um recurso de outro grupo — nem escondendo o menu certo, nem adivinhando um
          id em uma chamada direta à API. O backend valida em toda leitura e escrita; tentar acessar algo fora do escopo retorna &quot;não
          encontrado&quot;, nunca revela que o recurso existe em outro grupo.
        </p>
        <WarningCallout title="'Todos os grupos' nunca vira 'a empresa toda' por acidente">
          Pra um admin restrito (como Fátima), a opção &quot;Todos os grupos&quot; simplesmente não aparece nos seletores — ela escolhe um
          grupo/subgrupo específico dentre os seus. Nenhum Workflow, Agent ou Orchestrator dela pode assumir silenciosamente um alcance maior do
          que ela mesma tem.
        </WarningCallout>
        <WarningCallout kind="tip" title="Referência cross-group também é bloqueada">
          Um Workflow de FATURAS nunca consegue usar um Orchestrator exclusivo de outro grupo — nem a lista oferece essa opção, nem uma tentativa
          direta (payload manual) passa da validação do backend.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="agenda-individual-consolidado" title="Agenda de calendário — Individual × Consolidado" eyebrow="A única escolha real de modo">
        <p>Só a Agenda de calendário pergunta o Modo de avaliação — os demais Triggers já sabem a resposta sozinhos.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Individual</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Uma execução por colaborador elegível — o comportamento de sempre. O Filtro Populacional só restringe QUEM participa (ex.: só a equipe do Carlos); cada pessoa filtrada continua tendo sua própria execução.</p>
              <p className="font-mono text-xs text-foreground/80">João → execução · Maria → execução · Pedro → execução</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Consolidado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>UMA única execução representando a Estrutura Consolidada inteira (Equipe de Supervisor, Subgrupo, Grupo, ou a estrutura de Coordenador/Gerente/Gerente Sênior/Diretor) — nunca uma por operador dela.</p>
              <p className="font-mono text-xs text-foreground/80">Equipe do Carlos → 1 execução (nunca 3)</p>
            </CardContent>
          </Card>
        </div>
        <WarningCallout title="Filtro Populacional nunca é análise agregada">
          &quot;Individual, filtrado pela Equipe do Supervisor Carlos&quot; significa executar individualmente pra cada colaborador da equipe dele —
          nunca &quot;analisar a Equipe Carlos como uma única entidade&quot;. Isso só acontece em modo Consolidado.
        </WarningCallout>
        <Card className="bg-muted/30">
          <CardContent className="space-y-1.5 pt-4 font-mono text-xs">
            <p className="text-foreground/90">Modo: Consolidado · Estrutura: Equipe de Supervisor → Carlos</p>
            <p className="text-muted-foreground">1 matrícula, sujeito Carlos — nunca 1 por operador da equipe dele</p>
            <p className="text-muted-foreground">Condition: Média do indicador da equipe no mês corrente vs. Meta vigente</p>
            <p className="text-foreground/90">Output → Carlos, e/ou o Coordenador/Gerente dele — nunca fan-out pros operadores</p>
          </CardContent>
        </Card>
        <p>
          Em modo Consolidado, <strong className="font-medium text-foreground">Performance do colaborador nunca é uma Condition válida</strong> (não
          existe um colaborador individual como sujeito), e o Output <strong className="font-medium text-foreground">&quot;O próprio operador&quot;
          também não</strong>, exceto no caminho individual, entre &quot;Aplicar individualmente&quot; e &quot;Consolidar resultados&quot;. Fora desse
          caminho, a lista de destinatários não oferece essa opção e uma tentativa direta não passa da validação do backend. A
          validação roda em três momentos: ao trocar o Alvo da avaliação pra Consolidado (bloqueia antes de trocar, dizendo qual nó precisa mudar
          primeiro), ao publicar, e — simetricamente — ao trocar só o Gatilho de um Workflow que já está Consolidado pra um Trigger que não
          suporta esse modo (Flag, Indicador, ou Agenda relativa). Para analisar cada pessoa da estrutura separadamente dentro de um Workflow
          Consolidado, use <WikiLink href="/wiki/workflows/ranking">Selecionar colaboradores</WikiLink> e{" "}
          <WikiLink href="/wiki/workflows/fan-out-fan-in">Aplicar individualmente</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="sempre-individual" title="Triggers sempre individuais" eyebrow="Modo implícito">
        <h3 className="font-heading text-lg font-semibold">Agenda relativa ao expediente — sempre Individual</h3>
        <WarningCallout title="Não existe jornada de Grupo, Subgrupo ou Liderança">
          A jornada pertence ao colaborador. Agenda relativa ao expediente é <strong>sempre</strong> Individual — nunca uma escolha — porque depende
          do horário previsto de entrada e da carga horária de UMA pessoa. Estruturas organizacionais podem só limitar QUAIS colaboradores são
          elegíveis (Filtro Populacional) — nunca viram um &quot;50% da jornada da equipe&quot;, que não tem definição possível.
        </WarningCallout>
        <p>O editor nem pergunta o Modo de avaliação pra esse Trigger — mostra só um texto informativo. O backend rejeita, mesmo via payload manual, qualquer tentativa de configurar modo Consolidado numa Agenda relativa.</p>
        <h3 className="pt-2 font-heading text-lg font-semibold">Flag de canal e Indicador — sempre Individual</h3>
        <p>
          Flag de canal já carrega o operador da interação que disparou o evento; Indicador já carrega o colaborador da medição. Os dois são
          Individual por definição do próprio evento — nem Modo de avaliação, nem Filtro Populacional aparecem pra eles.
        </p>
      </WikiSection>

      <WikiSection id="periodo-comparacao" title="Período e Comparação" eyebrow="De quando, contra o quê">
        <p>
          Além da janela móvel e do período de calendário anterior, a Condition histórica escolhe também a{" "}
          <strong className="font-medium text-foreground">fase</strong> — período anterior completo (&quot;mês passado&quot;) ou corrente/parcial
          (&quot;este mês&quot;, &quot;hoje&quot;) — e o que comparar: um valor fixo (padrão), a{" "}
          <strong className="font-medium text-foreground">Meta vigente</strong> do indicador para o grupo analisado, ou o{" "}
          <strong className="font-medium text-foreground">mesmo período imediatamente anterior</strong>. Os dois últimos são sempre resolvidos de
          verdade em tempo de execução — nunca simulados ou hardcoded. Detalhes em <WikiLink href="/wiki/workflows/conditions#historico">Conditions › Histórico</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="draft-published" title="DRAFT × PUBLISHED" eyebrow="Rascunho e versão operacional">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ExampleCard title="DRAFT (Rascunho)">
            Pode ser editado e salvo a qualquer momento — inclusive inválido. Pode ser testado no QA Lab (&quot;Testar rascunho atual&quot; é o
            padrão). Nunca é matriculado de verdade: nenhum scheduler, nenhuma ingestão, nenhum efeito real.
          </ExampleCard>
          <ExampleCard title="PUBLISHED (Publicado)">
            A versão operacional: é a que o agendador e a ingestão por Flag/Indicador matriculam. Continuar editando cria &quot;alterações não
            publicadas&quot; — o publicado segue rodando com a versão anterior até um novo Publicar. Execuções em andamento continuam na versão
            em que nasceram.
          </ExampleCard>
        </div>
        <p>
          O QA Lab pode executar tanto o rascunho quanto a versão publicada (opção explícita), sempre com efeitos simulados — ver{" "}
          <WikiLink href="/wiki/qa-lab#draft-published">QA Lab › DRAFT × PUBLISHED</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="validacao" title="Validação de publicação" eyebrow="Uma função só">
        <p>
          &quot;Publicar&quot; exige que o rascunho passe 100% numa validação única — a MESMA função roda no botão Publicar e numa rota de
          validação sem escrita (dry-run). O editor espelha as regras de forma do grafo localmente (painel &quot;Problemas que impedem a
          publicação&quot;, com navegação até o nó) e, depois de Salvar rascunho, consulta o dry-run do servidor para o que depende do banco
          (destinatário, Agents/Orchestrators) — &quot;Pronto para publicar&quot; só aparece quando as duas passam, e o backend valida de novo ao
          publicar. Um rascunho pode existir inválido; publicar, não. O que é verificado:
        </p>
        <ul className="list-inside list-disc space-y-1.5">
          <li><strong className="font-medium text-foreground">Estrutura do grafo</strong> — exatamente um Gatilho; nenhum nó sem aresta de saída; nenhum branch desconectado.</li>
          <li><strong className="font-medium text-foreground">Contexto de cada node</strong> — Revisão humana, Chamar agente, Escalonar, Performance do colaborador e &quot;O próprio operador&quot; só em contexto individual; &quot;Aplicar individualmente&quot; só depois de uma coleção; &quot;Selecionar colaboradores&quot; nunca depois de &quot;Aplicar individualmente&quot;.</li>
          <li><strong className="font-medium text-foreground">Fan-in</strong> — um Join por Apply, nenhum caminho individual escapando do Join, todas as decisões de uma Revisão humana em fan-out convergindo no MESMO Join.</li>
          <li><strong className="font-medium text-foreground">Destinatário</strong> — depois de &quot;Consolidar resultados&quot; o Output vai para a gestão; destinatário por estrutura precisa resolver para exatamente uma pessoa (NOT_FOUND / AMBIGUOUS bloqueiam).</li>
          <li><strong className="font-medium text-foreground">Agents e Orchestrators</strong> — existentes, ativos, dentro do escopo do grupo; agente-coordenador não pode ser chamado direto; Orchestrator só de chat/voz não pode ser usado num Workflow.</li>
          <li><strong className="font-medium text-foreground">Conditions</strong> — campo de resultado estruturado existente; quartil com recorrência só para Quartil; Evolução/Queda não disponível para indicador TARGET nem para &quot;Últimos N fechamentos&quot;.</li>
          <li><strong className="font-medium text-foreground">Conformidade e Avaliação de processo</strong> — só com gatilho por Flag de canal (precisa de transcrição); vale para &quot;Chamar agente&quot; e para o formato dos especialistas do Orquestrador.</li>
          <li><strong className="font-medium text-foreground">Modo de avaliação</strong> — Consolidado só com Agenda de calendário.</li>
        </ul>
        <p>
          Os 22 modelos oficiais são a prova viva: todos passam no dry-run e continuam não publicados (ver{" "}
          <WikiLink href="/wiki/casos-praticos/workflows">Modelos de Workflow</WikiLink>).
        </p>
      </WikiSection>

      <WikiSection id="guia-pratico" title="Guia rápido: quero fazer X" eyebrow="Referência prática">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {[
            ["Reagir a uma chamada específica", "Flag de canal"],
            ["Reagir a uma nova medição de indicador", "Trigger de Indicador"],
            ["Rodar todo mês/toda semana", "Agenda de calendário"],
            ["Executar no meio do expediente de cada um", "Agenda relativa, 50%"],
            ["Decidir com base em um valor", "Condition"],
            ["Analisar com IA num domínio conhecido", "Chamar agente"],
            ["Coordenar especialistas ou sintetizar", "Orchestrator"],
            ["Guardar um valor pra usar depois", "Variável (Definir variável)"],
            ["Pedir que uma pessoa decida", "Revisão Humana"],
            ["Transferir responsabilidade", "Escalonar"],
            ["Mostrar algo pra alguém", "Output"],
            ["Esperar antes de continuar", "Aguardar"],
            ["Só os 5 piores da equipe", "Selecionar colaboradores › Por ranking"],
            ["Uma análise por pessoa + resumo pro gestor", "Aplicar individualmente → Consolidar resultados"],
          ].map(([question, answer]) => (
            <div key={question} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-2.5">
              <span className="text-sm text-muted-foreground">{question}</span>
              <span className="font-mono text-sm font-medium text-primary">→ {answer}</span>
            </div>
          ))}
        </div>
      </WikiSection>

      <WikiSection id="mapa" title="Mapa desta área" eyebrow="Onde está cada assunto">
        <SeeAlso
          links={[
            { href: "/wiki/workflows/exemplos", label: "Aprenda na prática", hint: "demonstrações guiadas com dados fictícios" },
            { href: "/wiki/workflows/criacao", label: "Como criar um Workflow", hint: "passo a passo no editor real" },
            { href: "/wiki/workflows/triggers", label: "Triggers", hint: "Flag, Indicador, Agenda" },
            { href: "/wiki/workflows/nodes", label: "Nodes", hint: "todos os 12, contexto, Variáveis, Aguardar" },
            { href: "/wiki/workflows/conditions", label: "Conditions", hint: "TRUE/FALSE/SEM DADOS, períodos, histórico" },
            { href: "/wiki/workflows/ranking", label: "Selecionar colaboradores e Ranking" },
            { href: "/wiki/workflows/fan-out-fan-in", label: "Fan-out e Fan-in" },
            { href: "/wiki/workflows/human-review", label: "Revisão humana e Escalonar" },
            { href: "/wiki/workflows/outputs", label: "Outputs, destinatários e Surfaces" },
            { href: "/wiki/workflows/erros-limitacoes", label: "Erros, limitações e evoluções" },
            { href: "/wiki/casos-praticos/workflows", label: "Modelos de Workflow", hint: "20 modelos + 10 reais" },
            { href: "/wiki/qa-lab", label: "QA Lab", hint: "teste antes de publicar" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
