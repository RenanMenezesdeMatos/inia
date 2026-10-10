import type { Metadata } from "next"

import { FieldRow, SeeAlso, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Pendências e Revisão humana",
  description: "Pendências é o que exige uma decisão sua: a Revisão humana de Workflow (aprovar, reprovar ou escalar) e a pendência de produção do calendário operacional (não trabalhou / dados não chegaram / corrigir escala) — e ler nunca é decidir.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "definicao", label: "Uma definição de pendente" },
  { id: "quem", label: "Quem tem a aba" },
  { id: "o-que-aparece", label: "O que aparece" },
  { id: "por-que-existe", label: "Por que a Revisão humana existe" },
  { id: "decidir", label: "Como aprovar, reprovar ou escalar" },
  { id: "o-que-acontece", label: "O que acontece com o Workflow" },
  { id: "ler-nao-e-decidir", label: "Ler não é decidir" },
  { id: "limitacoes", label: "Limitações atuais" },
]

export default function PendingPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="04 · Experiência do Colaborador"
        title="Pendências e Revisão humana"
        lead="Pendências é a aba do que exige uma DECISÃO sua. Dois tipos existem: a Revisão humana de Workflow (um Workflow chegou a um ponto em que uma pessoa precisa aprovar, reprovar ou — quando o Workflow prevê — escalar antes de continuar) e a pendência de produção do calendário operacional (um colaborador estava programado, o turno terminou e nenhuma evidência de produção chegou — você confirma o que aconteceu)."
      />

      <WikiSection id="definicao" title="Uma definição de pendente" eyebrow="Consistência">
        <p>
          &quot;Pendente&quot; tem <strong className="font-medium text-foreground">uma</strong> definição por tipo: uma execução de Workflow aguardando no node
          de Revisão humana endereçada a você, ou uma reconciliação de dia &quot;Produção não identificada&quot; ainda aberta endereçada a você (ver{" "}
          <WikiLink href="/wiki/indicadores/medicao-operacional#planejado-observado">Planejado × observado</WikiLink>). É a mesma definição usada pela lista, pelo badge da aba, pelo sino e pelos contadores da Equipe —
          nunca um alerta solto. Um Output na superfície &quot;Pendências&quot; não vira pendência (ver{" "}
          <WikiLink href="/wiki/workflows/outputs#surfaces">Surfaces</WikiLink>).
        </p>
      </WikiSection>

      <WikiSection id="quem" title="Quem tem a aba" eyebrow="Papéis">
        <FieldRow label="Sempre" value="Supervisor, Coordenador, Gerente, Gerente Sênior, Diretor — quem pode ser alvo de Revisão humana ou Escalonar." />
        <FieldRow label="Operador e quem está fora da hierarquia" value="Só enquanto houver uma pendência endereçada a ele." />
      </WikiSection>

      <WikiSection id="o-que-aparece" title="O que aparece" eyebrow="Fila e histórico">
        <FieldRow label="Fila" value="Só revisões endereçadas a você. “Aguardando sua decisão” em cima; “Histórico” (decididas ou que não estão mais disponíveis) embaixo. O badge na aba é a contagem real de revisões pendentes." />
        <FieldRow label="Cada item" value="Colaborador e grupo, nome do Workflow e do ponto de revisão, o motivo (instrução configurada no Workflow), a data da solicitação e o estado." />
        <FieldRow label="Detalhe" value="O que você precisa avaliar (instrução), o conteúdo a revisar (a proposta gerada pelo Workflow, formatada), o caso e as evidências, os resultados anteriores da mesma execução e a linha do tempo." />
        <FieldRow label="Produção não identificada" value="Só nasce depois de as fontes fecharem (SLA D-1/D-2 e RH dentro do prazo) — antes disso o dia fica 'aguardando dados' e fonte atrasada gera alerta administrativo, nunca pendência. Mostra colaborador e dia, o que estava planejado (escala, turno, exceção), as fontes de evidência consultadas, a disponibilidade dos dados e quatro decisões: Falta injustificada (classificação revisável; o dia continua esperado — indicadores com contribuição zero recebem 0 lógico, os demais ficam sem amostra), Ausência justificada (motivo — atestado, day off, banco de horas, folga extraordinária, outro — só o motivo é guardado), Trabalhou — dados não chegaram (nada é inventado; o dia continua esperado) e Corrigir planejamento (ajuste registrado por cima da escala da fonte). Uma pendência por colaborador × dia; produção que chega depois a resolve sozinha e supera uma classificação anterior, que fica no histórico." />
      </WikiSection>

      <WikiSection id="por-que-existe" title="Por que a Revisão humana existe" eyebrow="Humano no circuito">
        <p>
          Um Agent analisa, evidencia, resume e sugere acompanhamento — nunca decide punição. Quando o resultado vai ter efeito visível sobre uma
          pessoa (um feedback publicado, um escalonamento), a Revisão humana coloca um gestor no circuito antes: é ele quem confirma que a
          ocorrência realmente configura o que a análise apontou. Use quando o conteúdo é gerado por IA e vai ao operador, quando a nota é
          crítica, quando há risco de impacto na pessoa. Não use para o que pode ser publicado direto (ex.: uma orientação simples de TMA).
        </p>
      </WikiSection>

      <WikiSection id="decidir" title="Como aprovar, reprovar ou escalar" eyebrow="Passo a passo">
        <ol className="list-decimal space-y-2 pl-5">
          <li>Abra a aba <strong className="font-medium text-foreground">Pendências</strong> (ou clique na notificação &quot;Revisão pendente&quot; no sino, ou em &quot;N revisões aguardam você&quot; na linha do colaborador na Equipe).</li>
          <li>Clique na revisão. Abre um painel lateral com a instrução, o conteúdo a revisar, o caso e as evidências, os resultados anteriores da execução e a linha do tempo.</li>
          <li>No rodapé, escolha <strong className="font-medium text-foreground">Aprovar</strong>, <strong className="font-medium text-foreground">Reprovar</strong> ou <strong className="font-medium text-foreground">Escalar</strong> — só aparecem as decisões que o Workflow realmente prevê para aquele ponto (as conectadas no grafo).</li>
          <li>Confirme na caixa de diálogo. A decisão é registrada uma única vez e o Workflow continua a partir dela; o painel passa a mostrar &quot;Aprovada/Reprovada por ‹você› em ‹data›&quot;.</li>
          <li>A revisão sai da fila, o badge da aba e o sino são atualizados e a Equipe deixa de contar essa revisão.</li>
        </ol>
        <WarningCallout title="A decisão não pode ser desfeita">
          Se outra pessoa (ou outra aba sua) decidiu primeiro, a plataforma avisa e mantém a decisão original. Repetir a mesma decisão não a executa
          duas vezes — a rota de decisão é a mesma usada pelo Admin e é idempotente.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="o-que-acontece" title="O que acontece com o Workflow" eyebrow="Cada decisão é um ramo">
        <WikiFlow
          compact
          steps={[
            { label: "Execução parada no node Revisão humana (estado “aguardando”)", tone: "core" },
            { label: "Aprovar → segue pelo ramo Aprovado (normalmente um Output ao operador)", tone: "output" },
            { label: "Reprovar → segue pelo ramo Reprovado (normalmente Fim: não publica)", tone: "neutral" },
            { label: "Escalar → segue pelo ramo Escalar (Escalonar ao Gerente com o conteúdo analisado)", tone: "people" },
          ]}
        />
        <p>
          Num fan-out, cada Revisão humana pertence a UM colaborador — aprovar a de João nunca decide a de Maria; e uma revisão pendente segura o
          &quot;Consolidar resultados&quot; até a última decisão chegar. Detalhes do node em{" "}
          <WikiLink href="/wiki/workflows/human-review">Revisão humana e Escalonar</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="ler-nao-e-decidir" title="Ler não é decidir" eyebrow="Explícito">
        <WarningCallout kind="tip" title="Marcar notificação como lida ≠ aprovar/reprovar">
          Marcar como lida uma notificação de &quot;Revisão pendente&quot; só grava a leitura. A decisão só acontece dentro da revisão, em Pendências,
          com confirmação. Da mesma forma, ler um item do Acompanhamento não decide nada, e a ciência do colaborador não é aprovação.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="Transparência">
        <ul className="list-inside list-disc space-y-1">
          <li>Só existe um tipo de pendência: Revisão humana. Outros tipos (ex.: escalonamento aguardando resposta) não existem no produto.</li>
          <li>Não há prazo/SLA: uma revisão aguarda indefinidamente até ser decidida.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/notificacoes", label: "Notificações (sino)" },
            { href: "/wiki/workflows/human-review", label: "Revisão humana no Workflow", hint: "quem revisa, conteúdo, instrução, Escalonar" },
            { href: "/wiki/estrutura/equipe", label: "Equipe / Estrutura", hint: "contadores de revisões por colaborador" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
