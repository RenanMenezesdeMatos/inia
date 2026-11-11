"use client"

import { useState, type FormEvent } from "react"
import { SearchCode } from "lucide-react"

import { FailureSupport } from "@/components/error-states/support-details"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { PageHeader, SectionLabel, StatusChip, SURFACE_CARD, type Tone } from "@/components/ui/surface"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TABLE_FRAME } from "@/components/ui/table"
import { ApiError } from "@/lib/api/api-client"
import { formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useErrorCodeQuery, useErrorCodeSearchQuery, useErrorReferenceQuery } from "@/queries/error-diagnostics/use-error-diagnostics-queries"
import type { Explanation, Occurrence } from "@/schemas/error-diagnostics/error-diagnostics.schema"

/**
 * Administração › Plataforma › Diagnóstico de erros. Duas buscas no mesmo campo:
 *  - CÓDIGO (ex.: INIA-BANCO-INDISPONIVEL, FORBIDDEN, BUSINESS_DOMAIN_IN_USE): significado, causas prováveis com o sinal que confirma
 *    cada uma, verificações em ordem, onde buscar evidência (comandos da VM), recuperação e escalada — e as últimas ocorrências;
 *  - REFERÊNCIA (o que a pessoa copiou da tela): a(s) ocorrência(s) registrada(s) com os detalhes técnicos já sanitizados.
 * Fonte única: o catálogo do backend (o mesmo da CLI da VM e de docs/operacao/catalogo-de-erros.md).
 */
const SEVERITY_TONE: Record<string, Tone> = { info: "info", warning: "warning", error: "danger", critical: "danger" }
const SEVERITY_LABEL: Record<string, string> = { info: "Informativo", warning: "Atenção", error: "Erro", critical: "Crítico" }

/** Referência = UUID (x-request-id), `web-…`/`job-…`/`proc-…` ou digest numérico da interface; o resto é tratado como código. */
export function looksLikeReference(value: string): boolean {
  return /[0-9a-f]{8}-[0-9a-f]{4}/i.test(value) || /^\d+$/.test(value) || /^(web|job|proc)-/i.test(value)
}

export function looksLikeCode(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]{1,79}$/.test(value) && !looksLikeReference(value)
}

function Severity({ value }: { value: string }) {
  return <StatusChip tone={SEVERITY_TONE[value] ?? "neutral"}>{SEVERITY_LABEL[value] ?? value}</StatusChip>
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <SectionLabel as="h3">{title}</SectionLabel>
      {children}
    </section>
  )
}

function Command({ text }: { text: string }) {
  return <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap break-all">{text}</pre>
}

export function ExplanationView({ explanation }: { explanation: Explanation }) {
  if (explanation.kind === "DOMAIN") {
    const { domain, family } = explanation
    return (
      <article className={cn(SURFACE_CARD, "space-y-4 p-4 sm:p-6")} aria-label={`Código ${domain.code}`}>
        <header className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-lg font-semibold">{domain.code}</h2>
          <Severity value={family.severity} />
          <span className="text-sm text-muted-foreground">Módulo {domain.module} · HTTP {domain.statuses.join(", ") || "—"}</span>
        </header>
        <Block title="Regra (mensagem do módulo)">
          <ul className="list-disc space-y-1 pl-5 text-sm">{domain.messages.length ? domain.messages.map((message) => <li key={message}>{message}</li>) : <li>Mensagem montada no código.</li>}</ul>
        </Block>
        <Block title={`Família: ${family.title}`}>
          <p className="text-sm">{family.meaning}</p>
        </Block>
        <CausesAndChecks causes={family.probableCauses} checks={family.checks} evidence={family.evidence} recovery={family.recovery} escalation={family.escalation} />
        <Block title="Onde nasce no código">
          <ul className="space-y-1 font-mono text-xs">{domain.refs.map((ref) => <li key={ref}>{ref}</li>)}</ul>
        </Block>
      </article>
    )
  }
  const { entry } = explanation
  return (
    <article className={cn(SURFACE_CARD, "space-y-4 p-4 sm:p-6")} aria-label={`Código ${entry.code}`}>
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-mono text-lg font-semibold">{entry.code}</h2>
          <Severity value={entry.severity} />
          <span className="text-sm text-muted-foreground">{entry.module} · origem {entry.origin} · HTTP {entry.httpStatus ?? "—"}</span>
        </div>
        {explanation.viaAlias ? <p className="text-xs text-muted-foreground">Você buscou {explanation.requested}, que é coberto por esta entrada.</p> : null}
        {entry.aliases?.length ? <p className="text-xs text-muted-foreground">Também cobre: {entry.aliases.join(", ")}</p> : null}
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <Block title="Quando dispara">
          <p className="text-sm">{entry.trigger}</p>
        </Block>
        <Block title="O que a pessoa vê">
          <p className="text-sm">{entry.publicMessage}</p>
          <p className="text-sm text-muted-foreground">Ação segura: {entry.safeAction}</p>
        </Block>
      </div>
      <Block title="Descrição técnica">
        <p className="text-sm">{entry.technicalDescription}</p>
      </Block>
      <CausesAndChecks causes={entry.probableCauses} checks={entry.checks} evidence={entry.evidence} recovery={entry.recovery} escalation={entry.escalation} />
      <Block title="Código-fonte">
        <ul className="space-y-1 font-mono text-xs">{entry.codeRefs.map((ref) => <li key={ref}>{ref}</li>)}</ul>
      </Block>
      {entry.example ? (
        <Block title="Exemplo sanitizado">
          <Command text={entry.example} />
        </Block>
      ) : null}
    </article>
  )
}

function CausesAndChecks({ causes, checks, evidence, recovery, escalation }: { causes: { hypothesis: string; signal: string }[]; checks: string[]; evidence: { where: string; command?: string | undefined }[]; recovery: string; escalation: string }) {
  return (
    <>
      <Block title="Causas prováveis — hipóteses, confirme pelo sinal">
        <div className={TABLE_FRAME}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hipótese</TableHead>
                <TableHead>Sinal que confirma</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {causes.map((cause) => (
                <TableRow key={cause.hypothesis}>
                  <TableCell className="whitespace-normal align-top">{cause.hypothesis}</TableCell>
                  <TableCell className="whitespace-normal align-top">{cause.signal}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Block>
      <Block title="Verificações, em ordem">
        <ol className="list-decimal space-y-1 pl-5 text-sm">{checks.map((check) => <li key={check}>{check}</li>)}</ol>
      </Block>
      <Block title="Onde buscar evidência">
        <ul className="space-y-2 text-sm">
          {evidence.map((item) => (
            <li key={`${item.where}${item.command ?? ""}`} className="space-y-1">
              <p>{item.where}</p>
              {item.command ? <Command text={item.command} /> : null}
            </li>
          ))}
        </ul>
      </Block>
      <div className="grid gap-4 md:grid-cols-2">
        <Block title="Recuperação">
          <p className="text-sm">{recovery}</p>
        </Block>
        <Block title="Escalar para">
          <p className="text-sm">{escalation}</p>
        </Block>
      </div>
    </>
  )
}

function OccurrenceTable({ occurrences, onOpenReference }: { occurrences: Occurrence[]; onOpenReference?: (reference: string) => void }) {
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Quando</TableHead>
            <TableHead>Referência</TableHead>
            <TableHead>Origem</TableHead>
            <TableHead>Rota</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Versão</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {occurrences.map((occurrence) => (
            <TableRow key={`${occurrence.reference}-${occurrence.occurredAt}-${occurrence.source}`}>
              <TableCell title={occurrence.occurredAt}>{formatDateTime(occurrence.occurredAt)}</TableCell>
              <TableCell className="font-mono text-xs">
                {onOpenReference ? (
                  <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => onOpenReference(occurrence.reference)}>
                    {occurrence.reference}
                  </button>
                ) : (
                  occurrence.reference
                )}
              </TableCell>
              <TableCell>{occurrence.source} · {occurrence.service}</TableCell>
              <TableCell className="max-w-72 truncate font-mono text-xs" title={occurrence.route ?? ""}>{occurrence.route ?? "—"}</TableCell>
              <TableCell>{occurrence.httpStatus ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">{occurrence.release}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function CodeResult({ code, onOpenReference }: { code: string; onOpenReference: (reference: string) => void }) {
  const query = useErrorCodeQuery(code)
  if (query.isLoading) return <LoadingState label="Buscando o código…" />
  if (query.isError || !query.data) {
    // 404 = o código não existe no catálogo desta versão; qualquer outra falha é a consulta que não respondeu (não o código).
    const missing = query.error instanceof ApiError && query.error.status === 404
    return missing ? (
      <EmptyState icon={SearchCode} title={`O código ${code} não está no catálogo.`} description="Confira a grafia (copie da tela). Códigos de módulos são inventariados do código-fonte; um código ausente indica versão diferente da API." />
    ) : (
      <ErrorState message="Não foi possível consultar o catálogo agora." description="Pelo terminal da VM a consulta funciona sem a interface: node dist\main\diagnostico-de-erros.js <código>." onRetry={() => void query.refetch()} support={<FailureSupport error={query.error} />} />
    )
  }
  const { explanation, occurrences } = query.data
  return (
    <div className="space-y-4">
      <ExplanationView explanation={explanation} />
      <section className="space-y-2">
        <SectionLabel>Ocorrências recentes ({occurrences.total24h} nas últimas 24 h)</SectionLabel>
        {occurrences.recent.length ? <OccurrenceTable occurrences={occurrences.recent} onOpenReference={onOpenReference} /> : <p className="text-sm text-muted-foreground">Nenhuma ocorrência registrada deste código no período de guarda.</p>}
      </section>
    </div>
  )
}

function ReferenceResult({ reference, onOpenCode }: { reference: string; onOpenCode: (code: string) => void }) {
  const query = useErrorReferenceQuery(reference)
  if (query.isLoading) return <LoadingState label="Buscando a ocorrência…" />
  if (query.isError || !query.data) return <ErrorState message="Não foi possível buscar esta referência agora." description={`Sem a interface, procure nos logs da VM: Select-String -Path "$INIA\\logs\\INIA-*.log" -SimpleMatch <referência>`} onRetry={() => void query.refetch()} support={<FailureSupport error={query.error} />} />
  const { occurrences, explanations } = query.data
  if (occurrences.length === 0) {
    return (
      <article className={cn(SURFACE_CARD, "space-y-3 p-4 sm:p-6")}>
        <h2 className="text-lg font-semibold">Nenhuma ocorrência registrada com a referência {reference}</h2>
        <p className="text-sm">Isso não quer dizer que nada aconteceu. Hipóteses, nesta ordem:</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>A tela mostrou a referência como <strong>local</strong> (navegador sem conexão): ela só chega ao servidor quando a rede volta.</li>
          <li>A falha nasceu no <strong>proxy (IIS)</strong>, antes da API: procure no log do IIS (campo x-request-id).</li>
          <li>O banco estava fora no momento: a ocorrência está só no log do serviço.</li>
          <li>Passou do prazo de guarda (padrão 30 dias) ou é de outra organização.</li>
        </ol>
        <Command text={`Select-String -Path "$INIA\\logs\\INIA-*.log" -SimpleMatch "${reference}"`} />
        <Command text={`Select-String -Path "C:\\inetpub\\logs\\LogFiles\\W3SVC*\\u_ex*.log" -SimpleMatch "${reference}"`} />
      </article>
    )
  }
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <SectionLabel>Ocorrência {reference}</SectionLabel>
        {occurrences.map((occurrence) => (
          <article key={`${occurrence.occurredAt}-${occurrence.source}-${occurrence.code}`} className={cn(SURFACE_CARD, "space-y-3 p-4")}>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="font-mono text-base font-semibold text-primary underline-offset-2 hover:underline" onClick={() => onOpenCode(occurrence.code)}>
                {occurrence.code}
              </button>
              <Severity value={occurrence.severity} />
              <span className="text-sm text-muted-foreground">{occurrence.source} · {occurrence.service} · versão {occurrence.release}</span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Horário (UTC)</dt>
              <dd className="font-mono text-xs">{occurrence.occurredAt}</dd>
              <dt className="text-muted-foreground">Rota</dt>
              <dd className="font-mono text-xs break-all">{occurrence.route ?? "—"}</dd>
              <dt className="text-muted-foreground">Status HTTP</dt>
              <dd>{occurrence.httpStatus ?? "— (sem resposta HTTP)"}</dd>
              <dt className="text-muted-foreground">Sessão</dt>
              <dd>{occurrence.authenticated ? "autenticada" : "sem sessão"}</dd>
            </dl>
            {Object.keys(occurrence.details).length ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium">Detalhes técnicos (sanitizados)</summary>
                <Command text={JSON.stringify(occurrence.details, null, 2)} />
              </details>
            ) : null}
          </article>
        ))}
      </section>
      {Object.values(explanations).map((explanation) => (explanation ? <ExplanationView key={explanation.requested} explanation={explanation} /> : null))}
    </div>
  )
}

export function ErrorDiagnosticsPage({ initialQuery = "" }: { initialQuery?: string }) {
  const [draft, setDraft] = useState(initialQuery)
  const [submitted, setSubmitted] = useState(initialQuery.trim())
  const search = useErrorCodeSearchQuery(looksLikeCode(draft.trim()) ? draft.trim().toUpperCase() : "")
  const open = (value: string) => {
    const next = value.trim()
    setDraft(next)
    setSubmitted(next)
    // Só a URL (para copiar o link da busca): nada a refazer no servidor — a busca é toda no navegador.
    window.history.replaceState(null, "", `?q=${encodeURIComponent(next)}`)
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    open(draft)
  }
  const normalized = submitted.trim()
  const asCode = looksLikeCode(normalized) ? normalized.toUpperCase() : null

  return (
    <div className="space-y-6">
      <PageHeader icon={SearchCode} title="Diagnóstico de erros" description="Cole o código ou a referência que a pessoa copiou da tela de erro. O código mostra o significado, as causas prováveis e o que verificar; a referência mostra a ocorrência registrada." />
      <form onSubmit={onSubmit} className={cn(SURFACE_CARD, "flex flex-col gap-3 p-4 sm:flex-row sm:items-end")} role="search">
        <div className="flex-1 space-y-1">
          <Label htmlFor="diagnostico-busca">Código ou referência</Label>
          <Input id="diagnostico-busca" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ex.: INIA-BANCO-INDISPONIVEL ou 3f6c…" autoComplete="off" spellCheck={false} list="diagnostico-sugestoes" />
          <datalist id="diagnostico-sugestoes">{search.data?.results.map((result) => <option key={result.code} value={result.code}>{result.module}</option>)}</datalist>
        </div>
        <Button type="submit" disabled={!draft.trim()}>Buscar</Button>
      </form>
      {!normalized ? (
        <EmptyState icon={SearchCode} title="Comece pelo código e pela referência copiados da tela" description={`O catálogo também está em docs/operacao/catalogo-de-erros.md e no terminal da VM: node dist\\main\\diagnostico-de-erros.js <código|referência>.`} />
      ) : asCode ? (
        <CodeResult key={asCode} code={asCode} onOpenReference={open} />
      ) : (
        <ReferenceResult key={normalized} reference={normalized} onOpenCode={open} />
      )}
    </div>
  )
}
