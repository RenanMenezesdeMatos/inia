"use client"

import { BlockBody, measureOf, type SuccessBlocks } from "./success-blocks"
import { CountBars } from "./success-charts"
import { DEFINITIONS } from "./success-definitions"
import { formatCount, plural, rateBaseLine, rateValue, rateWithBase } from "./success-format"
import { BarList, BigNumber, BlockState, Panel, StatRow, type BarItem } from "./success-ui"

/**
 * 3. Qualidade das respostas — quatro leituras que nunca se misturam nem viram um índice único: a opinião de quem avaliou a resposta
 * no chat, o que o sistema registrou na consulta, o que o Anjo (pessoa) registrou ao atender e a conferência automática contra as regras.
 */
const MODE_LABELS: Record<string, string> = {
  ENFORCE: "Confere antes de entregar (bloqueia)",
  AUDIT: "Entrega e confere depois (só registra)",
  OFF: "Desligada",
}

const itemsOf = (
  breakdown:
    | readonly {
        key: string
        label: string
        count: number
        value?: number | null | undefined
      }[]
    | undefined,
  skip: readonly string[] = [],
): BarItem[] =>
  (breakdown ?? [])
    .filter((item) => item.count > 0 && !skip.includes(item.key))
    .sort((a, b) => b.count - a.count)
    .map((item) => ({
      key: item.key,
      label: item.label,
      count: item.count,
      share: item.value ?? null,
    }))

export function SuccessQuality({ blocks }: { blocks: SuccessBlocks }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel
        title="Avaliação das respostas no chat"
        definition={DEFINITIONS.positiveReplies}
        description="Curtir/descurtir do próprio colaborador nas respostas da INIA. É percepção — não validação humana nem prova de correção."
      >
        <BlockBody block={blocks.replies} name="replies">
          {(data) => {
            const answers = measureOf(data.funnel.measures, "M1")
            const rated = measureOf(data.funnel.measures, "M2")
            const positive = measureOf(data.funnel.measures, "M3")
            const reasons = measureOf(data.funnel.measures, "M4")
            const stillNeeds = measureOf(data.funnel.measures, "M5")
            if (!answers || !rated || !positive || !reasons || !stillNeeds) return <BlockState kind="empty" />
            return (
              <div className="space-y-4">
                <BigNumber
                  value={rateValue(positive.main)}
                  muted={positive.main.status !== "OK"}
                  base={rateBaseLine(positive.main, ["resposta avaliada", "respostas avaliadas"], "Nenhuma resposta avaliada no período")}
                />
                <dl className="divide-y divide-border">
                  <StatRow label="Respostas da INIA no período" value={formatCount(answers.main.value ?? 0)} />
                  <StatRow label="Avaliadas" value={rateWithBase(rated.main, ["resposta", "respostas"])} />
                  {data.byChannel.map((channel) => (
                    <StatRow key={channel.channel} label={channel.channel === "chat" ? "Úteis · texto" : "Úteis · voz"} value={rateWithBase(channel.positive, ["avaliada", "avaliadas"])} />
                  ))}
                  <StatRow label="Ainda precisavam de ajuda" hint="Entre as descurtidas com motivo" value={rateWithBase(stillNeeds.main, ["descurtida", "descurtidas"])} />
                </dl>
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground">Motivo da avaliação negativa (um por descurtida)</h4>
                  <BarList items={itemsOf(reasons.breakdown)} series="replies" unit={["descurtida", "descurtidas"]} emptyText="Nenhuma descurtida no período." />
                </div>
              </div>
            )
          }}
        </BlockBody>
      </Panel>

      <Panel
        title="Falhas registradas na consulta"
        definition={DEFINITIONS.consultationSignals}
        description="Registrado por código no momento da resposta, sem IA e sem ler o texto: a INIA não encontrou, achou as bases insuficientes, não concluiu ou teve o especialista impedido."
      >
        <BlockBody block={blocks.replies} name="replies">
          {(data) => {
            const signals = measureOf(data.funnel.measures, "M6")
            if (!signals) return <BlockState kind="empty" />
            const noReply = signals.breakdown?.find((item) => item.key === "NO_REPLY")?.count ?? 0
            return (
              <div className="space-y-4">
                <BigNumber
                  value={rateValue(signals.main)}
                  muted={signals.main.status !== "OK"}
                  base={rateBaseLine(signals.main, ["resposta com registro de sinais", "respostas com registro de sinais"], "Nenhuma resposta com registro de sinais no período")}
                />
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground">Por sinal (uma resposta pode ter mais de um: as parcelas podem somar mais de 100%)</h4>
                  <BarList items={itemsOf(signals.breakdown, ["NO_REPLY"])} series="consultation" unit={["resposta", "respostas"]} emptyText="Nenhuma resposta com falha registrada no período." />
                </div>
                <p className="text-xs text-muted-foreground">{plural(noReply, ["pergunta ficou", "perguntas ficaram"])} sem resposta (turno terminou em erro) — contadas na pergunta, fora da taxa.</p>
              </div>
            )
          }}
        </BlockBody>
      </Panel>

      <Panel
        title="Apoio com Anjo: por que o operador precisou de ajuda"
        definition={DEFINITIONS.supportReasons}
        description="O Anjo é uma pessoa do apoio humano. Ao encerrar, ele registra o motivo do pedido e o resultado do atendimento — não julga se a resposta da INIA estava certa."
      >
        <BlockBody block={blocks.support} name="support">
          {(data) => {
            const reasons = measureOf(data.measures, "M14")
            const outcomes = measureOf(data.measures, "M15")
            const resolved = measureOf(data.measures, "M16")
            const requests = measureOf(data.measures, "M8")
            const stars = measureOf(data.measures, "M17")
            if (!reasons || !outcomes || !resolved || !requests) return <BlockState kind="empty" />
            return (
              <div className="space-y-4">
                <dl className="divide-y divide-border">
                  <StatRow
                    label="Pedidos de apoio no período"
                    hint={
                      (requests.breakdown ?? [])
                        .filter((item) => item.count > 0)
                        .map((item) => `${item.label}: ${item.count}`)
                        .join(" · ") || undefined
                    }
                    value={formatCount(requests.main.value ?? 0)}
                  />
                  {reasons.coverage ? <StatRow label="Atendimentos classificados" value={rateWithBase(reasons.coverage, ["encerrado", "encerrados"])} /> : null}
                  {resolved.coverage ? <StatRow label="Avaliados pelo operador" value={rateWithBase(resolved.coverage, ["encerrado", "encerrados"])} /> : null}
                  {stars ? (
                    <StatRow
                      label="Estrelas do atendimento (1 a 5)"
                      hint="Média das notas do operador ao Anjo; só com 5 notas ou mais"
                      value={
                        stars.main.status === "OK" && stars.main.value !== null
                          ? `${stars.main.value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} · ${plural(stars.main.denominator ?? 0, ["nota", "notas"])}`
                          : stars.main.status === "SMALL_SAMPLE"
                            ? `Amostra pequena · ${plural(stars.main.denominator ?? 0, ["nota", "notas"])}`
                            : "Sem base para cálculo"
                      }
                    />
                  ) : null}
                </dl>
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground">Motivo do pedido de apoio (um por atendimento)</h4>
                  <BarList items={itemsOf(reasons.breakdown)} series="support" unit={["atendimento", "atendimentos"]} emptyText="Nenhum atendimento classificado no período." />
                </div>
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground">Resultado declarado pelo Anjo</h4>
                    <BarList items={itemsOf(outcomes.breakdown)} series="support" unit={["atendimento", "atendimentos"]} emptyText="Sem classificações." />
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground">Dúvida resolvida, segundo o operador</h4>
                    <BarList items={itemsOf(resolved.breakdown)} series="support" unit={["resposta", "respostas"]} emptyText="Nenhuma avaliação do atendimento." />
                  </div>
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-muted-foreground">Atendimentos classificados ao longo do período</h4>
                  <CountBars
                    name="Atendimentos classificados"
                    series="support"
                    unit={["atendimento", "atendimentos"]}
                    points={data.series.map((point) => ({
                      bucket: point.bucket,
                      count: point.classified,
                    }))}
                  />
                </div>
              </div>
            )
          }}
        </BlockBody>
      </Panel>

      <Panel
        title="Conformidade das respostas (conferência automática)"
        definition={DEFINITIONS.conformity}
        description="Confere as respostas contra os assuntos proibidos e os limites de atuação do Agent. Mede conformidade com regras, não correção."
      >
        <BlockBody block={blocks.compliance} name="compliance">
          {(data) => (
            <div className="space-y-4">
              <BigNumber
                value={rateValue(data.conformity)}
                muted={data.conformity.status !== "OK"}
                base={rateBaseLine(data.conformity, ["conferência conclusiva", "conferências conclusivas"], "Nenhuma conferência conclusiva no período")}
              />
              <dl className="divide-y divide-border">
                <StatRow label="Conferências no período" value={formatCount(data.counts.checks)} />
                <StatRow
                  label="Com violação"
                  hint={`${formatCount(data.counts.blocked)} barradas antes de chegar à pessoa · ${formatCount(data.counts.recorded)} só registradas`}
                  value={rateWithBase(data.violation, ["conclusiva", "conclusivas"])}
                />
                <StatRow label="Conferência que falhou (inconclusiva)" value={rateWithBase(data.inconclusive, ["conferência", "conferências"])} />
                {data.bySurface.map((surface) => (
                  <StatRow key={surface.surface} label={`Violações · ${surface.label}`} value={rateWithBase(surface.violation, ["conclusiva", "conclusivas"])} />
                ))}
                <StatRow label="Modo em vigor agora" value={MODE_LABELS[data.mode] ?? data.mode} />
              </dl>
            </div>
          )}
        </BlockBody>
      </Panel>
    </div>
  )
}
