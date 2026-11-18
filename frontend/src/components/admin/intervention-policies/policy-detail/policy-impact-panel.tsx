"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { AlertTriangle, BarChart3 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SectionLabel, StatusChip, type Tone } from "@/components/ui/surface"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TABLE_FRAME } from "@/components/ui/table"
import { formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { DECISION_LABELS, OUTCOME_LABELS, type ImpactPreview, type PolicyView } from "@/schemas/admin/intervention-policy.schema"
import { previewPolicyImpact } from "@/services/admin/intervention-policy-service"

import { IssuesPanel, Note, OptionSelect } from "../shared/fields"
import { errorMessage } from "../shared/helpers"

/**
 * PRÉVIA DE IMPACTO — o que a versão escolhida faria se rodasse AGORA, somado: quantas pessoas ganhariam um acompanhamento,
 * quantas só gerariam aviso, quantas ficam sem dado suficiente, o que nasceria por formato e quanto chega a cada líder.
 * Sem efeitos (o servidor só avalia) e só com quem o usuário já pode consultar. O rascunho é o SALVO, comparado com a em vigor.
 */
const people = (count: number) => `${count} ${count === 1 ? "pessoa" : "pessoas"}`

function Stat({ value, label, hint, tone = "neutral" }: { value: number; label: string; hint?: string; tone?: Tone }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className={cn("text-2xl font-semibold tabular-nums", tone === "warning" && value > 0 && "text-amber-700 dark:text-amber-400")}>{value}</p>
      <p className="text-sm font-medium">{label}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function ImpactResult({ result }: { result: ImpactPreview }) {
  const { summary, population, comparison } = result
  const outOfReach = population.inScope - population.reachable
  const nothing = summary.people.noMatch + summary.people.inconclusive + summary.people.notApplicable
  return (
    <div className="space-y-5" data-testid="policy-impact-result">
      <div className="space-y-2">
        <p className="text-sm">
          <span className="font-semibold">Versão {result.policyVersion.version}</span> · {people(population.evaluated)} avaliadas em {formatDateTime(result.asOf)}
          {outOfReach > 0 ? ` · ${people(outOfReach)} do escopo da política fora do que você pode consultar` : ""}
        </p>
        {population.truncated ? <Note tone="warning">A prévia parou no limite de tempo: avaliou {population.evaluated} de {population.requested} pessoas (por ordem de nome). Os números abaixo são só dessas — nada foi estimado para as demais.</Note> : null}
        {population.historyHidden > 0 ? <Note tone="warning">Para {people(population.historyHidden)} você não pode ver os acompanhamentos: a prévia delas não considera o que já está aberto nem a carência, e pode mostrar mais aberturas do que haveria.</Note> : null}
        {population.evaluated === 0 ? <Note>Nenhum colaborador ativo do escopo desta política está entre os que você pode consultar.</Note> : null}
      </div>
      {result.draftIssues.length > 0 ? <IssuesPanel title="O rascunho ainda tem pendências" issues={result.draftIssues} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat value={summary.people.withNewFollowUp} label="Ganhariam um acompanhamento" hint="Aberto, aguardando aprovação ou recomendado a quem lidera." />
        <Stat value={summary.people.onlyNotified} label="Só gerariam aviso ao líder" hint="Nenhuma ação criada." />
        <Stat value={summary.people.alreadyFollowed + summary.people.suppressed} label="Sem nada novo" hint={`${summary.people.alreadyFollowed} já em acompanhamento · ${summary.people.suppressed} na carência`} />
        <Stat value={summary.insufficientData} label="Sem dado suficiente para decidir" hint="Dado ausente não é desempenho ruim: a regra não é aplicada." tone="warning" />
        <Stat value={nothing} label="Nada aconteceria" hint={`${summary.people.noMatch} sem regra atendida · ${summary.people.inconclusive} sem dado`} />
        <Stat value={summary.leaders.distinct} label={summary.leaders.distinct === 1 ? "Líder receberia algo" : "Líderes receberiam algo"} />
      </div>

      {summary.continuitySuggestions > 0 ? (
        <Note tone="warning">
          <span className="font-semibold">{summary.continuitySuggestions} {summary.continuitySuggestions === 1 ? "sugestão" : "sugestões"} de avaliação de continuidade.</span> A INIA só sugere: cada uma vai para quem tem a permissão de decisão restrita, e nada muda na situação da pessoa sem essa decisão.
        </Note>
      ) : null}
      {summary.people.conflict > 0 ? <Note tone="warning">{people(summary.people.conflict)} com conflito entre formatos: nada seria aplicado a elas até a regra ser ajustada.</Note> : null}
      {summary.unresolvedRecipients > 0 ? (
        <Note tone="warning">
          {summary.unresolvedRecipients} {summary.unresolvedRecipients === 1 ? "ação ficaria" : "ações ficariam"} sem destinatário: não há, na cadeia de liderança do colaborador, quem ocupe o papel que o formato pede. Nesses casos nada é aberto.
        </Note>
      ) : null}
      {comparison ? (
        <Note>
          Em relação à versão {comparison.baselineVersion}, em vigor ({people(comparison.compared)} comparadas): <span className="font-semibold">{comparison.gained}</span> passariam a receber algo, <span className="font-semibold">{comparison.lost}</span> deixariam de receber e {comparison.kept} continuariam recebendo.
        </Note>
      ) : null}

      {summary.rules.length > 0 ? (
        <section className="space-y-2">
          <SectionLabel as="h3">Por regra</SectionLabel>
          <div className={TABLE_FRAME}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Regra</TableHead>
                  <TableHead>Atendida</TableHead>
                  <TableHead>Decidiu o que fazer</TableHead>
                  <TableHead>Sem dado suficiente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.rules.map((rule) => (
                  <TableRow key={rule.key}>
                    <TableCell>
                      <span className="text-muted-foreground tabular-nums">{rule.priority}.</span> {rule.name}
                    </TableCell>
                    <TableCell className="tabular-nums">{rule.met}</TableCell>
                    <TableCell className="tabular-nums">{rule.decided}</TableCell>
                    <TableCell className="tabular-nums">{rule.inconclusive}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">“Decidiu” pode ser menor que “Atendida”: quando a política para na primeira regra atendida, as de prioridade menor não decidem.</p>
        </section>
      ) : null}

      {summary.formats.length > 0 ? (
        <section className="space-y-2">
          <SectionLabel as="h3">O que nasceria, por formato</SectionLabel>
          <div className={TABLE_FRAME}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Formato</TableHead>
                  <TableHead>Abriria</TableHead>
                  <TableHead>Aguardando aprovação</TableHead>
                  <TableHead>Recomendaria</TableHead>
                  <TableHead>Só avisaria</TableHead>
                  <TableHead>Sem nada novo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.formats.map((format) => (
                  <TableRow key={format.typeKey}>
                    <TableCell>
                      {format.typeName}
                      {format.sensitive ? (
                        <StatusChip tone="warning" icon={AlertTriangle} className="ml-2">
                          Decisão humana restrita
                        </StatusChip>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">{format.created}</TableCell>
                    <TableCell className="tabular-nums">{format.pendingApproval}</TableCell>
                    <TableCell className="tabular-nums">{format.recommended}</TableCell>
                    <TableCell className="tabular-nums">{format.notified}</TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {format.existing} já ativa · {format.suppressed} na carência{format.conflict > 0 ? ` · ${format.conflict} em conflito` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      {summary.leaders.top.length > 0 ? (
        <section className="space-y-2">
          <SectionLabel as="h3">Quem receberia</SectionLabel>
          <div className={TABLE_FRAME}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quem conduz</TableHead>
                  <TableHead>Acompanhamentos novos</TableHead>
                  <TableHead>Avisos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.leaders.top.map((leader) => (
                  <TableRow key={leader.personId}>
                    <TableCell>{leader.name}</TableCell>
                    <TableCell className="tabular-nums">{leader.opened}</TableCell>
                    <TableCell className="tabular-nums">{leader.notified}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {summary.leaders.distinct > summary.leaders.top.length ? <p className="text-xs text-muted-foreground">Os {summary.leaders.top.length} que mais receberiam, de {summary.leaders.distinct}.</p> : null}
        </section>
      ) : null}

      {summary.affected.items.length > 0 ? (
        <section className="space-y-2">
          <SectionLabel as="h3">Colaboradores</SectionLabel>
          <div className={TABLE_FRAME}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Regra</TableHead>
                  <TableHead>O que aconteceria</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.affected.items.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell className="align-top">
                      <p className="font-medium">{person.name}</p>
                      {person.teamName ? <p className="text-xs text-muted-foreground">{person.teamName}</p> : null}
                    </TableCell>
                    <TableCell className="align-top text-sm">{person.rules.length > 0 ? person.rules.join(" · ") : "—"}</TableCell>
                    <TableCell className="align-top text-sm">
                      {person.decisions.length === 0 ? <span className="text-muted-foreground">{OUTCOME_LABELS[person.outcome]} — nada seria feito</span> : null}
                      {person.decisions.map((decision, index) => (
                        <p key={`${decision.typeName}:${index}`}>
                          {DECISION_LABELS[decision.status]}: {decision.typeName}
                        </p>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {summary.affected.total > summary.affected.items.length ? <p className="text-xs text-muted-foreground">Os {summary.affected.items.length} primeiros de {summary.affected.total}: quem teria alguma ação vem antes de quem só ficou sem dado.</p> : null}
        </section>
      ) : null}
    </div>
  )
}

export function PolicyImpactPanel({ policy }: { policy: PolicyView }) {
  const versionOptions = [
    ...(policy.draft ? [{ value: "DRAFT", label: `Rascunho (v${policy.draft.version}, como está salvo)` }] : []),
    ...(policy.inForce ? [{ value: "IN_FORCE", label: `Em vigor (v${policy.inForce.version})` }] : []),
  ]
  const [version, setVersion] = useState<string>(versionOptions[0]?.value ?? "IN_FORCE")
  const preview = useMutation({ mutationFn: () => previewPolicyImpact(policy.id, version) })
  return (
    <div className="space-y-4">
      <Note>
        O que esta política faria se rodasse agora, somado. Sem efeitos: nada é gravado, nenhum acompanhamento é aberto e ninguém é avisado. Entram os colaboradores ativos do escopo da política que você já pode consultar; quem ela alcança de verdade é a população do Workflow onde ela roda.
      </Note>
      <div className="flex flex-wrap items-end gap-3">
        <OptionSelect label="Versão" value={version} options={versionOptions} className="min-w-64" onChange={(value) => { setVersion(value); preview.reset() }} />
        <Button size="sm" disabled={versionOptions.length === 0 || preview.isPending} onClick={() => preview.mutate()}>
          <BarChart3 /> {preview.isPending ? "Calculando…" : "Calcular impacto"}
        </Button>
      </div>
      {versionOptions.length === 0 ? <p className="text-xs text-muted-foreground">Não há versão para conferir.</p> : null}
      {preview.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage(preview.error, "Não foi possível calcular o impacto.")}
        </p>
      ) : null}
      {preview.data ? <ImpactResult result={preview.data} /> : null}
    </div>
  )
}
