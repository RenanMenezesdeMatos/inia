"use client"

import { BlockBody, type SuccessBlocks } from "./success-blocks"
import { DEFINITIONS } from "./success-definitions"
import { formatCount, plural, rateWithBase } from "./success-format"
import { BarList, Panel, StatRow } from "./success-ui"

/**
 * 4. Motivos de procura — ranking das rotas que a própria INIA acionou para responder (especialista ou ferramenta). É o assunto como a
 * INIA o entendeu, não uma classificação humana: diferente do motivo da chamada do cliente e do motivo de uma avaliação negativa.
 */
export function SuccessRoutes({ blocks }: { blocks: SuccessBlocks }) {
  return (
    <Panel
      title="Assunto da procura, pela rota da INIA"
      definition={DEFINITIONS.routes}
      description="Especialista (com o domínio de negócio) ou ferramenta que a INIA acionou em cada resposta. Uma resposta pode ter mais de uma rota: as participações podem somar mais de 100%."
    >
      <BlockBody block={blocks.routes} name="routes" lines={5}>
        {(data) => (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <BarList
              items={data.routes.map((route) => ({
                key: route.key,
                label: route.label,
                detail: route.kind === "SPECIALIST" ? `Especialista${route.detail ? ` · ${route.detail}` : ""}` : "Ferramenta",
                count: route.answers,
                share: route.share,
              }))}
              series="replies"
              unit={["resposta", "respostas"]}
              emptyText="Nenhuma resposta da INIA no período."
            />
            <dl className="divide-y divide-border self-start">
              <StatRow
                label="Respostas da INIA no período"
                value={formatCount(data.answers)}
                hint={`${plural(data.byChannel.chat, ["por texto", "por texto"])} · ${plural(data.byChannel.voice, ["por voz", "por voz"])}`}
              />
              <StatRow label="Sem especialista nem ferramenta" hint="O Orquestrador respondeu sozinho" value={rateWithBase(data.withoutRoute.share, ["resposta", "respostas"])} />
              <StatRow label="Com duas ou mais rotas" value={formatCount(data.multiRoute)} />
              {data.others ? (
                <StatRow label={`Outras ${plural(data.others.routes, ["rota", "rotas"])}`} hint="Fora do ranking" value={plural(data.others.answers, ["participação", "participações"])} />
              ) : null}
            </dl>
          </div>
        )}
      </BlockBody>
    </Panel>
  )
}
