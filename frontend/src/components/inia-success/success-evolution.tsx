"use client"

import { BlockBody, type SuccessBlocks } from "./success-blocks"
import { RateTrend, SecondsTrend } from "./success-charts"
import { DEFINITIONS } from "./success-definitions"
import { Panel } from "./success-ui"

/**
 * 2. Evolução — pequenos múltiplos: um gráfico por indicador, uma série e um eixo cada (nunca dois eixos no mesmo gráfico); as taxas
 * no mesmo eixo de 0 a 100% para comparar entre gráficos. Por dia até 31 dias, por semana acima (semanas parciais marcadas).
 */
export function SuccessEvolution({ blocks, granularity }: { blocks: SuccessBlocks; granularity: "DAY" | "WEEK" | null }) {
  const per = granularity === "WEEK" ? "por semana (segunda a domingo; as pontas podem ser parciais)" : "por dia"
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Tempo médio até a resposta completa (texto)" definition={DEFINITIONS.responseTime} description={`Média ${per}, ponderada pelas respostas medidas de cada ponto.`}>
        <BlockBody block={blocks.responseTime} name="responseTime">
          {(data) => (
            <SecondsTrend
              name="Tempo médio de resposta"
              series="replies"
              unit={["resposta medida", "respostas medidas"]}
              baseUnit={["pergunta", "perguntas"]}
              points={data.series.map((point) => ({
                bucket: point.bucket,
                average: point.average,
                base: point.questions,
              }))}
            />
          )}
        </BlockBody>
      </Panel>
      <Panel title="Respostas úteis no chat" definition={DEFINITIONS.positiveReplies} description={`Respostas marcadas como úteis entre as avaliadas, ${per}.`}>
        <BlockBody block={blocks.replies} name="replies">
          {(data) => (
            <RateTrend
              name="Respostas úteis"
              series="replies"
              unit={["resposta avaliada", "respostas avaliadas"]}
              points={data.series.map((point) => ({
                bucket: point.bucket,
                rate: point.positive,
              }))}
            />
          )}
        </BlockBody>
      </Panel>
      <Panel
        title="Respostas com falha na consulta"
        definition={DEFINITIONS.consultationSignals}
        description={`Respostas com sinal registrado pelo sistema (não encontrou, bases insuficientes, consulta não concluída, especialista impedido), ${per}.`}
      >
        <BlockBody block={blocks.replies} name="replies">
          {(data) => (
            <RateTrend
              name="Respostas com falha na consulta"
              series="consultation"
              unit={["resposta com registro de sinais", "respostas com registro de sinais"]}
              points={data.series.map((point) => ({
                bucket: point.bucket,
                rate: point.signalRate,
              }))}
            />
          )}
        </BlockBody>
      </Panel>
      <Panel title="Feedbacks contestados" definition={DEFINITIONS.contestation} description={`Contestados entre os disponibilizados, ${per} (data da disponibilização).`}>
        <BlockBody block={blocks.feedback} name="feedback">
          {(data) => (
            <RateTrend
              name="Feedbacks contestados"
              series="feedback"
              unit={["feedback disponibilizado", "feedbacks disponibilizados"]}
              points={data.series.map((point) => ({
                bucket: point.bucket,
                rate: point.contestation,
              }))}
            />
          )}
        </BlockBody>
      </Panel>
    </div>
  )
}
