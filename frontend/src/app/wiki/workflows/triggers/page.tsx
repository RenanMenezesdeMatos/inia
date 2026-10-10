import type { Metadata } from "next"
import { Calendar, Flag, Hand, ListChecks } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExampleCard, FieldRow, SeeAlso, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { WIKI_TRIGGERS } from "@/components/wiki/wiki-reference"
import { FLAG_VALUE_TYPE_LABELS } from "@/schemas/admin/channel-flag.schema"

export const metadata: Metadata = {
  title: "Triggers",
  description: "As quatro famílias reais de gatilho: Flag de canal, Indicador, Agenda (calendário ou relativa ao expediente) e Manual (Executar agora). Chat e Avatar não são Trigger.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Quatro famílias" },
  { id: "flag", label: "Flag de canal" },
  { id: "indicador", label: "Indicador" },
  { id: "agenda", label: "Agenda de calendário" },
  { id: "agenda-relativa", label: "Agenda relativa ao expediente" },
  { id: "manual", label: "Manual (Executar agora)" },
  { id: "trocar-tipo", label: "Trocar o tipo do gatilho" },
  { id: "surface-nao-e-trigger", label: "Surface não é Trigger" },
]

const ICONS = { channel_flag: Flag, indicator: ListChecks, schedule: Calendar, manual: Hand } as const

export default function TriggersPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="05 · Workflow Engine"
        title="Triggers"
        lead="O QUANDO de um Workflow. Quatro famílias — e só quatro: três reagem a eventos ou ao relógio e uma espera alguém clicar em Executar agora. Não existe Trigger de Chat nem de Avatar: são superfícies de entrega, nunca de disparo."
      >
        <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2 xl:grid-cols-4">
          {(["channel_flag", "indicator", "schedule", "manual"] as const).map((kind) => {
            const doc = WIKI_TRIGGERS[kind]
            const Icon = ICONS[kind]
            return (
              <Card key={kind}>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 text-sky-600 dark:text-sky-300" />
                    <CardTitle>{doc.label}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>{doc.summary}</p>
                  <p className="font-mono text-xs">{doc.example}</p>
                  <p className="text-xs">{doc.evaluationMode}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
        <WarningCallout kind="tip" title="Agenda não define janela de análise">
          <code className="font-mono">todo dia 5 às 09:00</code> é o Trigger. <code className="font-mono">PRV dos últimos 3 fechamentos &lt; 80%</code> é uma
          Condition histórica depois dele. São conceitos sempre independentes.
        </WarningCallout>
      </WikiPageHeader>

      <WikiSection id="flag" title="Flag de canal" eyebrow="Algo aconteceu numa interação">
        <WikiFlow
          compact
          steps={[
            { label: "Interação chega pela ingestão", detail: "canal (hoje só VOICE), operador, transcrição e flags já calculadas", tone: "input" },
            { label: "Para cada Workflow publicado com gatilho por aquela flag", detail: "o operador é elegível? Abrangência ∩ Filtro Populacional, ativo, papel Operador", tone: "core" },
            { label: "Matrícula individual do operador da interação", detail: "valor do gatilho = valor da flag (verdadeiro/falso ou numérico)", tone: "core" },
          ]}
        />
        <FieldRow label="Interação" value="Uma chamada específica, com transcrição em texto e as flags calculadas fora da INIA. A INIA não deriva flag a partir de áudio ou transcrição bruta." />
        <FieldRow label="Operador" value="O colaborador da interação — sempre Individual; nem Modo de avaliação nem Filtro Populacional aparecem." />
        <FieldRow label="Canal" value="Hoje só VOICE existe; o catálogo de flags por canal é configurável e pensado para novos canais." />
        <FieldRow label="Flag" value={`Cadastrada em Admin › Flags de canal com Canal, Nome da flag, Tipo de valor (${FLAG_VALUE_TYPE_LABELS.BOOLEAN} ou ${FLAG_VALUE_TYPE_LABELS.NUMERIC}) e Descrição. Ex.: rechamada, nota_ura, tdna, tempo_silencio, cancelamento, contestacao, transferencia, detrator.`} />
        <FieldRow label="Elegibilidade" value="Decisão pontual, por interação: só Workflows publicados cuja Abrangência (e Filtro Populacional, se houver) inclui o operador. A mesma semântica do agendador e do QA Lab." />
        <FieldRow label="Transcrição" value="Fica disponível para Chamar agente/Orquestrador (evidência literal) e é obrigatória para Conformidade de processo e Avaliação de processo." />
        <WarningCallout title="Uma interação dispara TODOS os Workflows publicados com aquela flag">
          Cada Workflow publicado que usa a flag matricula o operador separadamente. Em ambientes de teste, uma ingestão real pode acionar vários
          Workflows e vários Agents de uma vez — use o QA Lab para testar um de cada vez.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="indicador" title="Indicador" eyebrow="Chegou uma nova medição">
        <p>
          Reage à <strong className="font-medium text-foreground">chegada de uma nova medição</strong> de um indicador específico para um colaborador
          — o caso canônico de &quot;Reincidência de URA baixa&quot;: cada nova nota dispara a checagem histórica. Sempre Individual: o sujeito é o
          colaborador da medição; o valor do gatilho é o valor medido.
        </p>
        <ExampleCard title="Medição × fechamento oficial">
          O Trigger de Indicador reage a <strong>medições brutas</strong> (o dado que a operação envia com data/hora). Ele não reage a fechamentos
          mensais de atingimento/PRV/quartil — esses são lidos por Conditions e pela Agenda (ex.: &quot;todo dia 5, Q4 em 3 dos últimos 3
          fechamentos?&quot;). Ver <WikiLink href="/wiki/indicadores#medicoes-operacionais">Medições operacionais × fechamentos</WikiLink>.
        </ExampleCard>
      </WikiSection>

      <WikiSection id="agenda" title="Agenda de calendário" eyebrow="Quando executar — nunca o que analisar">
        <p>Diariamente, semanalmente, mensalmente, a cada X dias, múltiplos horários, último dia do mês — com fuso horário e prévia reais.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ExampleCard title="Diário">Todo dia às 09:00.</ExampleCard>
          <ExampleCard title="Semanal">Toda segunda às 09:00.</ExampleCard>
          <ExampleCard title="Mensal">Todo dia 5 às 09:00.</ExampleCard>
        </div>
        <p>
          É o único Trigger que pergunta o <strong className="font-medium text-foreground">Alvo da avaliação</strong>: Individual (uma execução por
          colaborador elegível) ou Consolidado (uma execução para a Estrutura Consolidada). Ver{" "}
          <WikiLink href="/wiki/workflows#agenda-individual-consolidado">Individual × Consolidado</WikiLink>. Em Agenda, o Workflow pode ainda pedir
          uma fonte de dados agendada para a IA — indicador num período, amostra de monitorias, ou fechamentos oficiais de performance (PRV, valor,
          meta, atingimento, peso, quartil) lidos prontos — a fonte certa para os especialistas de PRV/Performance.
        </p>
      </WikiSection>

      <WikiSection id="agenda-relativa" title="Agenda relativa ao expediente" eyebrow="Agenda — modo 2">
        <p>
          Calcula a execução <strong className="font-medium text-foreground">individualmente para cada colaborador</strong>, a partir da jornada
          PREVISTA dele (horário de entrada + carga horária) — nunca um horário global.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ExampleCard title="Após o início">X minutos após a entrada.</ExampleCard>
          <ExampleCard title="Percentual da jornada">0% = início · 50% = meio · 100% = fim.</ExampleCard>
          <ExampleCard title="Antes do fim">X minutos antes do término.</ExampleCard>
        </div>
        <Card className="bg-muted/30">
          <CardContent className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2">
            <div className="space-y-1 font-mono text-xs">
              <p className="font-semibold text-foreground">João</p>
              <p className="text-muted-foreground">entrada 08:00 · jornada 8h → 50% = 12:00</p>
            </div>
            <div className="space-y-1 font-mono text-xs">
              <p className="font-semibold text-foreground">Maria</p>
              <p className="text-muted-foreground">entrada 09:00 · jornada 6h → 50% = 12:00</p>
            </div>
          </CardContent>
        </Card>
        <WarningCallout title="Jornada prevista ≠ login real">
          Hoje o cálculo usa a jornada PREVISTA (entrada + carga horária cadastradas) — é a agenda programada de trabalho, não &quot;a hora em que
          logou no sistema&quot;. Não mede login, logout, pausas reais ou tempo conectado. Se no futuro existir telemetria real de sessão, será outra
          fonte de dado — nunca confundida com esta.
        </WarningCallout>
        <WarningCallout kind="tip" title="Colaborador sem jornada">
          Nunca dispara com um horário inventado. Fica de fora da matrícula, e a prévia mostra a contagem de quem tem jornada válida separada de
          quem não tem.
        </WarningCallout>
        <p>Sempre Individual — não existe jornada de Grupo, Subgrupo ou Liderança (ver <WikiLink href="/wiki/workflows#sempre-individual">Triggers sempre individuais</WikiLink>).</p>
      </WikiSection>

      <WikiSection id="manual" title="Manual (Executar agora)" eyebrow="Alguém decide a hora">
        <p>
          O Workflow <strong className="font-medium text-foreground">só começa quando alguém com permissão clica em Executar agora</strong> e escolhe
          UM colaborador. Não tem horário, flag nem chegada de indicador — e salvar, publicar, reiniciar o serviço ou ingerir dados nunca disparam
          um Workflow Manual. O gatilho declara quais <strong className="font-medium text-foreground">dados reais</strong> cada execução traz:
        </p>
        <FieldRow label="Colaborador" value="Só a pessoa. Os nós &quot;Chamar agente&quot; definem a fonte de dados (indicador ou monitoria no período, fechamentos oficiais) — como numa Agenda individual." />
        <FieldRow label="Interação do colaborador" value="Uma interação EXISTENTE dele, com transcrição — habilita monitoria, Avaliação de processo e feedback de monitoria, como a Flag de canal (mas sem valor de flag)." />
        <FieldRow label="Medição de indicador" value="Uma medição EXISTENTE do indicador escolhido no gatilho — habilita feedback e diagnóstico de indicador, como o gatilho por Indicador (o valor do gatilho é o valor da medição)." />
        <WarningCallout kind="tip" title="Mesmo motor, mesmas regras">
          O disparo só cria a execução normal do motor na versão publicada e ativa (a versão fica presa à execução). Condition, Agent, Orquestrador,
          Gerar feedback, Revisão humana, Espera e Output rodam exatamente como nos outros gatilhos — e a validação de publicação aplica as mesmas
          regras pela origem dos dados. Ver <WikiLink href="/wiki/workflows/execucao-manual">Execução manual</WikiLink>.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="trocar-tipo" title="Trocar o tipo do gatilho" eyebrow="Mudança estrutural">
        <WarningCallout title="Trocar o TIPO do Gatilho é uma mudança estrutural">
          Editar os detalhes do MESMO tipo (horário da Agenda, a Flag escolhida, o Indicador escolhido) salva na hora — e é a mesma configuração
          tanto no Sheet de Configurações quanto no nó Gatilho do canvas. Já trocar o TIPO em si (Agenda↔Flag↔Indicador↔Manual) pode invalidar a
          Estrutura Consolidada/Filtro Populacional e Conditions em modo &quot;Valor do gatilho&quot; — o editor mostra uma análise de impacto
          antes de aplicar, listando o que precisa ser revisado primeiro, nunca troca e apaga configuração silenciosamente. O backend continua
          validando de novo na gravação, mesmo por um payload manual.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="surface-nao-e-trigger" title="Surface não é Trigger" eyebrow="Duas coisas diferentes">
        <p>
          <strong className="font-medium text-foreground">Surface</strong> é onde algo aparece (Acompanhamento, Notificação, Avatar, Chat).{" "}
          <strong className="font-medium text-foreground">Trigger</strong> é o que inicia um Workflow. O chat e o avatar da INIA são interfaces de
          consumo/interação do operador — uma pergunta feita no chat nunca dispara um Workflow.
        </p>
        <SeeAlso
          links={[
            { href: "/wiki/workflows/conditions", label: "Conditions", hint: "o que avaliar depois do gatilho" },
            { href: "/wiki/workflows/outputs#surfaces", label: "Surfaces" },
            { href: "/wiki/seguranca#eligibility", label: "Elegibilidade", hint: "Abrangência ∩ Filtro Populacional" },
            { href: "/wiki/qa-lab#interacoes", label: "Interações no QA Lab", hint: "testar um gatilho por Flag com uma chamada real" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
