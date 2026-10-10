import type { Metadata } from "next"

import { SeeAlso, WikiArticle, WikiLink, WikiPageHeader, WikiSection } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Erros, limitações e evoluções do Workflow Engine",
  description: "Comportamento real em exceções (não teórico), o que o Workflow Engine ainda não faz e as evoluções possíveis.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "erros", label: "Erros e exceções" },
  { id: "limitacoes", label: "O que ainda não fazemos" },
  { id: "evolucoes", label: "Evoluções possíveis" },
]

const ERRORS: [string, string][] = [
  ["Jornada não configurada", "Colaborador nunca é matriculado por Agenda relativa — sem horário inventado."],
  ["Nó sem aresta de saída", "Publish é bloqueado antes de acontecer em produção."],
  ["Branch desconectado", "Mesmo tratamento do nó sem aresta — bloqueado no publish."],
  ["Destinatário sem pessoa (individual)", "A hierarquia (quem reporta a quem) não chega no cargo pedido a partir do operador — a Ação/Output falha, com retry limitado; nunca escolhe outra pessoa."],
  ["Destinatário por estrutura NOT_FOUND / AMBIGUOUS", "Nenhuma ou mais de uma pessoa com o cargo pedido na estrutura — a publicação é bloqueada (a mesma função revalida em runtime e o QA Lab mostra o motivo)."],
  ["Resultado estruturado inválido / campo removido", "Condition que referencia o campo falha com mensagem clara, nunca falha silenciosa."],
  [
    "Histórico insuficiente",
    "Vira Sem Dados quando a Condition define um mínimo de amostras, quando Últimos N fechamentos pede mais fechamentos do que existem (Atingimento/PRV), ou quando um dos Últimos N meses fechados esperados (Valor) não tem medição suficiente — nunca Não, nunca uma média parcial, nunca substituído por um mês mais antigo.",
  ],
  ["Estrutura Consolidada com metas diferentes entre os membros", "Comparar com Meta vira Sem Dados quando os colaboradores da estrutura resolvem metas diferentes (Subgrupos distintos) — a engine nunca escolhe uma arbitrariamente."],
  ["Agent ou Orchestrator indisponível", "Falha controlada (ex.: chave de API ausente no ambiente), com retry limitado e mensagem específica."],
  ["Evidência não literal (feedback de monitoria)", "Se a IA parafraseia em vez de citar a transcrição, o resultado é descartado e a execução marcada como falha — texto gerado por IA nunca é evidência."],
  ["Etapa de conformidade sem citação", "CONFORME/NÃO CONFORME sem trecho literal é rebaixada por código para NÃO FOI POSSÍVEL CONFIRMAR."],
  ["Revisão Humana aguardando", "Execução fica em 'aguardando' até a decisão chegar pela rota dedicada — nunca expira sozinha hoje."],
  ["Execução falhou", "Retry automático até um limite; depois disso, a execução para definitivamente (nunca fica rodando para sempre)."],
  ["Join vazio (0 filhos)", "Não é erro: Consolidar resultados resolve com 0 esperados e o Orquestrador seguinte é pulado sem chamar IA."],
  ["Surface sem leitor", "Avatar, Chat e Pendências (como surface) são gravadas mesmo sem tela dedicada de consumo — ver Outputs › Surfaces."],
  [
    "Referência ou pessoa fora do grupo",
    "Trocar a Abrangência, publicar com um Orchestrator de outro grupo, ou apontar o Filtro Populacional/Estrutura Consolidada pra alguém fora do grupo — tudo bloqueado com mensagem clara, nunca uma inconsistência silenciosa.",
  ],
  [
    'Performance do colaborador ou Output "O próprio operador" em modo Consolidado',
    "Bloqueado ao trocar o Alvo da avaliação pra Consolidado (antes de gravar) e de novo no publish — nenhum dos dois tem definição segura sem um colaborador individual como sujeito.",
  ],
  [
    "Modo Consolidado numa Agenda relativa, ou num Trigger que não é Agenda",
    'Backend rejeita mesmo via payload manual — ao trocar o Alvo da avaliação diretamente, e também ao trocar só o Gatilho de um Workflow que já está Consolidado (ex.: Consolidado + Agenda·Calendário → Indicador é bloqueado, nunca vira "Consolidado + Indicador" silenciosamente).',
  ],
  ["Conformidade de processo sem transcrição", "Só é aceita com gatilho por Flag de canal — Workflows por Agenda ou Indicador não têm transcrição; o publish bloqueia."],
]

export default function ErrorsLimitationsPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="05 · Workflow Engine"
        title="Erros, limitações e evoluções"
        lead="Comportamento real, não teórico: o que acontece em cada exceção, o que o Workflow Engine ainda não faz e o que pode vir depois."
      />

      <WikiSection id="erros" title="Erros e exceções" eyebrow="Comportamento real">
        <div className="grid grid-cols-1 gap-3">
          {ERRORS.map(([title, description]) => (
            <div key={title} className="grid grid-cols-1 gap-1 rounded-lg border border-border p-3.5 sm:grid-cols-[220px_1fr] sm:gap-4">
              <p className="font-mono text-sm font-medium text-foreground">{title}</p>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </WikiSection>

      <WikiSection id="limitacoes" title="O que ainda não fazemos" eyebrow="Limitações reais">
        <ul className="list-inside list-disc space-y-2 text-sm text-foreground/90">
          <li>Login/logout real — Agenda relativa usa jornada PREVISTA, nunca telemetria de sessão.</li>
          <li>Banco de horas, intervalo intrajornada, escala 6x1 completa, múltiplos turnos no mesmo dia, jornada fracionada.</li>
          <li>Troca de turno em tempo real, férias, afastamentos, feriados.</li>
          <li>Sem SQL, fórmula arbitrária ou cálculo de PRV/quartil/atingimento/peso próprios — sempre vêm prontos da fonte; a engine só lê, conta e agrega (Média/Mínimo/Máximo/contagem de fechamentos).</li>
          <li>Medição operacional diária só existe para os indicadores marcados como suportados; quartil operacional só para Valor do indicador numa janela (nunca sobre fechamentos) e com população mínima de 4.</li>
          <li>Condition E/OU não compõe Histórico/Performance diretamente — só valores do contexto de execução.</li>
          <li>
            Vínculo dinâmico com a Meta vigente (Comparação) só existe pra Média/Mínimo/Máximo do Histórico — Quantidade de ocorrências continua
            com limiar fixo, e Performance do colaborador (Quartil do indicador/PRV) continua individual, sem versão agregada por grupo —
            Valor/Atingimento continuam disponíveis agregados sobre a estrutura inteira.
          </li>
          <li>Modo Consolidado só existe pra Agenda de calendário — Flag, Indicador, Agenda relativa ao expediente e Manual continuam sempre Individual, por definição.</li>
          <li>O gatilho Manual executa para um colaborador por disparo, só pelo editor do Workflow e sempre com efeitos reais (para ensaiar, use o QA Lab) — ver <WikiLink href="/wiki/workflows/execucao-manual#limitacoes">Execução manual</WikiLink>.</li>
          <li>&quot;Últimos N fechamentos&quot;/&quot;Últimos N meses fechados&quot; só têm granularidade MENSAL — não existe competência semanal real na fonte pra nenhuma origem hoje.</li>
          <li>
            &quot;Últimos N meses fechados&quot; pra Valor do indicador considera exatamente os N meses de calendário civis COMPLETOS imediatamente
            anteriores ao mês corrente — sempre consecutivos, mês corrente nunca incluído, e um mês sem dado suficiente nunca é substituído por um
            mês mais antigo (vira Sem Dados).
          </li>
          <li>As superfícies Avatar, Chat e Pendências (como surface de Output) são gravadas, mas ainda não têm tela de consumo — Acompanhamento e Notificação têm.</li>
          <li>SLA/timeout de Revisão Humana, loops, scripts, paralelismo entre branches.</li>
          <li>
            Coleção de colaboradores (Selecionar/Aplicar/Consolidar): sem Action consumindo uma coleção/resultado consolidado diretamente (só o
            Orchestrator ganhou esse suporte); sem seleção por IA/ranking semântico; sem coleção de estruturas nem coleções aninhadas; sem fan-out
            dentro de outro fan-out (nested); sem limite operacional explícito de tamanho de fan-out.
          </li>
          <li>
            Ranking (Por ranking): Valor e Evolução (variação percentual vs período anterior), com ou sem separação por Grupo/Subgrupo — sem
            tendência/regressão linear, Top-N por score composto, ranking multi-indicador com pesos, incluir todos os empatados na posição de
            corte, percentil/Top X%, ranking global fora da população do Workflow, ou separação por Supervisor/Coordenador/Gerente.
          </li>
          <li>
            Consolidar resultados (fan-in/JOIN): sem quorum/timeout/fail-fast configuráveis; o Orchestrator pós-JOIN roda sem Specialists (síntese
            pura), porque todo Specialist hoje é single-operador; efeitos simulados de cada colaborador no QA Lab ainda aparecem agregados na aba
            &quot;Efeitos simulados&quot; (cosmético).
          </li>
          <li>Roteamento dinâmico &quot;pelo problema identificado&quot; dentro de um mesmo Workflow: o especialista de um node é fixo (use o Orquestrador do domínio/multidomínio ou instâncias por grupo).</li>
          <li>Não existe biblioteca de templates reutilizáveis nem versionamento visual — os 20 modelos são Workflows reais em rascunho, duplicáveis à mão.</li>
        </ul>
      </WikiSection>

      <WikiSection id="evolucoes" title="Evoluções possíveis" eyebrow="Já suportado × possível depois">
        <ul className="list-inside list-disc space-y-2 text-sm text-foreground/90">
          <li>Trigger por login/logout real, quando existir telemetria de sessão.</li>
          <li>SLA e timeout configuráveis para Revisão Humana.</li>
          <li>Avatar e chat consumindo as superfícies de Output hoje só persistidas.</li>
          <li>Biblioteca/templates de Workflows reutilizáveis e versionamento visual.</li>
          <li>Comparação contra Meta/Período anterior também pra Quantidade de ocorrências e Performance do colaborador, não só Média/Mínimo/Máximo.</li>
          <li>Fechamento semanal, se algum dia existir competência real na fonte pra medição bruta ou performance.</li>
          <li>Meta por estrutura mais específica que Subgrupo (ex.: por Equipe de Supervisor), se algum dia fizer sentido no domínio.</li>
          <li>Modo Consolidado também pra Flag e Indicador, quando fizer sentido um sujeito diferente do próprio evento.</li>
          <li>Aprovação multi-etapas configurável visualmente (hoje possível só encadeando Revisões Humanas manualmente).</li>
          <li>Specialists multi-operador para o Orchestrator pós-JOIN.</li>
          <li>Novas superfícies de entrega, além de Acompanhamento/Pendências/Notificação/Avatar/Chat.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/workflows", label: "Visão geral do Workflow Engine" },
            { href: "/wiki/workflows/outputs#surfaces", label: "Surfaces", hint: "estado de consumo de cada uma" },
            { href: "/wiki/bases-conhecimento#limitacoes", label: "Limitações da camada de IA" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
