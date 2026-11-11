"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { ExternalLink } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TABLE_FRAME } from "@/components/ui/table"
import { formatDateTime } from "@/lib/format/date"

import { DENIED, measureOf, type Block, type SuccessBlocks } from "./success-blocks"
import { DEFINITIONS } from "./success-definitions"
import { formatCount, plural } from "./success-format"

/**
 * 6. Cobertura dos dados — para cada indicador: a base considerada, quantos itens têm medida, quantos ficaram de fora e por quê, e as
 * limitações conhecidas (datas de início dos registros, períodos com o apoio desligado, coletas que não existem).
 */
type Row = {
  key: string
  name: string
  reference: string
  base: ReactNode
  measured: ReactNode
  outside: ReactNode
  notes: ReactNode
}

function rowOf<T>(block: Block<T>, name: keyof SuccessBlocks, build: (data: T) => Omit<Row, "key" | "name" | "reference">): Omit<Row, "key" | "name" | "reference"> {
  if (!block.allowed) return { base: "—", measured: "—", outside: "—", notes: DENIED[name] }
  if (block.query.isPending) return { base: "Carregando…", measured: "", outside: "", notes: "" }
  if (block.query.isError)
    return {
      base: "—",
      measured: "—",
      outside: "—",
      notes: "Não foi possível carregar este bloco.",
    }
  return build(block.query.data)
}

const since = (iso: string | null, what: string) => (iso ? `${what} desde ${formatDateTime(iso)}.` : `${what}: ainda sem nenhum registro.`)

export function SuccessCoverage({ blocks, links }: { blocks: SuccessBlocks; links: { href: string; label: string }[] }) {
  const rows: Row[] = [
    {
      key: "response-time",
      name: DEFINITIONS.responseTime.title,
      reference: DEFINITIONS.responseTime.reference,
      ...rowOf(blocks.responseTime, "responseTime", (data) => ({
        base: plural(data.text.questions, ["pergunta por texto", "perguntas por texto"]),
        measured: plural(data.text.measured, ["resposta medida", "respostas medidas"]),
        outside: `${formatCount(data.text.noReply)} sem resposta (erro) · ${formatCount(data.text.unpaired)} sem resposta gravada · ${formatCount(data.text.noKey)} registros antigos sem chave${data.text.invalid ? ` · ${formatCount(data.text.invalid)} com horário inconsistente` : ""}`,
        notes: `Voz sem medida confiável (${plural(data.voice.answers, ["resposta", "respostas"])}); ${plural(data.voice.typedQuestions, ["texto digitado", "textos digitados"])} com a voz ligada, respondidos pela voz, fora da base. Mede o servidor, não a tela.`,
      })),
    },
    {
      key: "replies",
      name: DEFINITIONS.positiveReplies.title,
      reference: DEFINITIONS.positiveReplies.reference,
      ...rowOf(blocks.replies, "replies", (data) => {
        const answers = measureOf(data.funnel.measures, "M1")?.main.value ?? 0
        const rated = measureOf(data.funnel.measures, "M2")?.main.numerator ?? 0
        return {
          base: plural(answers, ["resposta da INIA", "respostas da INIA"]),
          measured: plural(rated, ["avaliada", "avaliadas"]),
          outside: `${formatCount(answers - rated)} sem avaliação vigente`,
          notes: since(data.funnel.cutoffs.dislikeDetailsSince, "Motivo da descurtida coletado"),
        }
      }),
    },
    {
      key: "signals",
      name: DEFINITIONS.consultationSignals.title,
      reference: DEFINITIONS.consultationSignals.reference,
      ...rowOf(blocks.replies, "replies", (data) => {
        const answers = measureOf(data.funnel.measures, "M1")?.main.value ?? 0
        const withRow = measureOf(data.funnel.measures, "M6")?.main.denominator ?? 0
        return {
          base: plural(answers, ["resposta da INIA", "respostas da INIA"]),
          measured: plural(withRow, ["com registro de sinais", "com registro de sinais"]),
          outside: `${formatCount(answers - withRow)} sem registro (anteriores ao início do registro)`,
          notes: since(data.funnel.cutoffs.signalsSince, "Sinais registrados"),
        }
      }),
    },
    {
      key: "routes",
      name: DEFINITIONS.routes.title,
      reference: DEFINITIONS.routes.reference,
      ...rowOf(blocks.routes, "routes", (data) => ({
        base: plural(data.answers, ["resposta da INIA", "respostas da INIA"]),
        measured: plural(data.answers - data.withoutRoute.answers, ["com rota", "com rota"]),
        outside: `${formatCount(data.withoutRoute.answers)} sem especialista nem ferramenta`,
        notes: "Assunto como a INIA o entendeu (rota escolhida pela IA na hora da resposta), não classificação humana.",
      })),
    },
    {
      key: "support",
      name: DEFINITIONS.supportReasons.title,
      reference: DEFINITIONS.supportReasons.reference,
      ...rowOf(blocks.support, "support", (data) => {
        const coverage = measureOf(data.measures, "M14")?.coverage
        const ended = coverage?.denominator ?? 0
        const classified = coverage?.numerator ?? 0
        const disabled = data.disabledPeriods.map((period) => (period.to ? `${formatDateTime(period.from)} a ${formatDateTime(period.to)}` : `desde ${formatDateTime(period.from)}`))
        return {
          base: plural(ended, ["atendimento encerrado", "atendimentos encerrados"]),
          measured: plural(classified, ["classificado", "classificados"]),
          outside: `${formatCount(Math.max(0, ended - classified))} ainda sem classificação`,
          notes: `${disabled.length > 0 ? `Apoio desligado na organização: ${disabled.join("; ")}. ` : ""}Grupo/Subgrupo gravado no pedido. Não há classificação de correção da resposta da INIA.`,
        }
      }),
    },
    {
      key: "feedback",
      name: "Feedbacks: ciência, avaliação e contestação",
      reference: DEFINITIONS.contestation.reference,
      ...rowOf(blocks.feedback, "feedback", (data) => ({
        base: plural(data.counts.delivered, ["feedback disponibilizado", "feedbacks disponibilizados"]),
        measured: `${plural(data.counts.up + data.counts.down, ["avaliado", "avaliados"])} · ${plural(data.counts.acknowledged, ["com ciência", "com ciência"])}`,
        outside: `${formatCount(data.counts.delivered - data.counts.up - data.counts.down)} sem avaliação vigente (${formatCount(data.counts.withdrawn)} retiradas) · ${formatCount(data.counts.pending)} contestações aguardando revisão`,
        notes: "Concordância explícita: coleta ainda indisponível. Os seus próprios feedbacks não entram.",
      })),
    },
    {
      key: "compliance",
      name: DEFINITIONS.conformity.title,
      reference: DEFINITIONS.conformity.reference,
      ...rowOf(blocks.compliance, "compliance", (data) => ({
        base: plural(data.counts.checks, ["conferência", "conferências"]),
        measured: plural(data.counts.allowed + data.counts.violations, ["conclusiva", "conclusivas"]),
        outside: `${formatCount(data.counts.failed)} inconclusivas (a conferência falhou)`,
        notes: "Conformidade com regras, não correção. Com Grupo/Subgrupo, só conferências ligadas a uma conversa do recorte.",
      })),
    },
    {
      key: "assertiveness",
      name: DEFINITIONS.anjoAssertiveness.title,
      reference: "—",
      base: "—",
      measured: "Coleta indisponível",
      outside: "—",
      notes: "Nenhuma fonte classifica a resposta da INIA como correta, parcial, incorreta ou inconclusiva. Nada é estimado.",
    },
  ]
  return (
    <div className="space-y-3">
      <div className={TABLE_FRAME}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Indicador</TableHead>
              <TableHead>Base considerada</TableHead>
              <TableHead>Com medida</TableHead>
              <TableHead>Sem medida ou fora</TableHead>
              <TableHead>Limitações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key} className="align-top">
                <TableCell className="min-w-44 whitespace-normal">
                  <span className="font-medium">{row.name}</span>
                  <span className="block text-xs text-muted-foreground">Referência: {row.reference}</span>
                </TableCell>
                <TableCell className="whitespace-normal tabular-nums">{row.base}</TableCell>
                <TableCell className="whitespace-normal tabular-nums">{row.measured}</TableCell>
                <TableCell className="min-w-48 whitespace-normal text-muted-foreground tabular-nums">{row.outside}</TableCell>
                <TableCell className="min-w-64 whitespace-normal text-xs text-muted-foreground">{row.notes}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {links.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Registros que sustentam os números (abrem com o filtro padrão da tela: aplique o mesmo período lá):</span>
          {links.map((link) => (
            <Button key={link.href} asChild variant="outline" size="sm">
              <Link href={link.href}>
                <ExternalLink data-icon="inline-start" />
                {link.label}
              </Link>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
