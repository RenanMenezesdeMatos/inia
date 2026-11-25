"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2, Network, PlugZap, ShieldAlert, ShieldCheck, UserX, XCircle } from "lucide-react"

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { EmptyState, ErrorState, InlineError, LoadingState } from "@/components/ui/states"
import { SectionLabel, StatusChip, toneSurface } from "@/components/ui/surface"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError } from "@/lib/api/api-client"
import { formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useNetworkLoginStatusQuery, useProbeNetworkLoginMutation, useSetNetworkLoginMutation } from "@/queries/access/use-network-login"
import type { NetworkLoginStatus, NetworkServerProbe } from "@/schemas/access/network-login.schema"

/**
 * Usuários e acessos › Login pela rede. Com ele ligado, as pessoas entram com a matrícula e a senha de rede (conferidas no AD);
 * o e-mail e a senha local ficam só para as contas de emergência. Os servidores do AD vêm da instalação (AD_* no ambiente) —
 * aqui só se confere e liga/desliga. Quem decide continua sendo a INIA: a conta precisa estar habilitada.
 */
export function NetworkLoginView() {
  const status = useNetworkLoginStatusQuery()
  const probe = useProbeNetworkLoginMutation()
  const toggle = useSetNetworkLoginMutation()
  const [confirming, setConfirming] = useState<boolean | null>(null)

  if (status.isPending) return <LoadingState label="Carregando o login pela rede…" />
  if (status.isError) {
    const forbidden = status.error instanceof ApiError && status.error.status === 403
    return forbidden ? (
      <ErrorState forbidden message="Só quem administra os acessos da organização inteira vê e muda o login pela rede." />
    ) : (
      <ErrorState message="Não foi possível carregar o login pela rede agora." onRetry={() => void status.refetch()} />
    )
  }
  const data = status.data
  const activeEmergency = data.emergencyAccounts.filter((account) => account.active)
  const blockers = enableBlockers(data, activeEmergency.length)
  const ambiguous = data.ambiguousMatriculas
  const toggleError = toggle.error instanceof ApiError ? toggle.error.message : toggle.error ? "Não foi possível mudar agora." : null

  return (
    <div className="space-y-4">
      <section className={cn(toneSurface(data.enabled ? "success" : "neutral"), "space-y-3 p-4")} aria-label="Situação do login pela rede">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <SectionLabel className="flex items-center gap-1.5"><Network className="size-3.5" aria-hidden />Login pela rede (AD)</SectionLabel>
            <p className="text-sm">
              {data.enabled
                ? "Ligado: as pessoas entram com a matrícula e a senha de rede. E-mail e senha valem só para as contas de emergência."
                : "Desligado: as pessoas entram com e-mail e senha da INIA."}
            </p>
            {data.changedAt ? <p className="text-xs text-muted-foreground">Última mudança em {formatDateTime(data.changedAt)}{data.changedBy ? ` por ${data.changedBy}` : ""}.</p> : null}
          </div>
          <StatusChip tone={data.enabled ? "success" : "neutral"} icon={data.enabled ? CheckCircle2 : XCircle}>{data.enabled ? "Ligado" : "Desligado"}</StatusChip>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Ter conta de rede não dá acesso: a conta da pessoa precisa estar habilitada aqui em Acessos, e a matrícula do cadastro precisa ser o login de rede.</li>
          <li>Depois de {data.maxFailures} senhas erradas seguidas (cada uma a menos de 15 minutos da anterior), a INIA para de tentar até passarem 15 minutos sem erro — o mesmo tempo em que o AD zera o contador —, bem antes do limite que bloqueia a conta de rede.</li>
          <li>Se o AD ficar fora do ar, ninguém entra pela rede; quem já está dentro continua até a sessão vencer. As contas de emergência entram por “Entrar com e-mail (administrador)”.</li>
        </ul>
        {data.enabled ? (
          <Button variant="outline" onClick={() => setConfirming(false)} disabled={toggle.isPending}>Desligar o login pela rede</Button>
        ) : (
          <div className="space-y-2">
            {blockers.length > 0 ? (
              <ul className="space-y-1 text-sm" aria-label="O que falta para ligar">
                {blockers.map((blocker) => <li key={blocker} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />{blocker}</li>)}
              </ul>
            ) : null}
            <Button onClick={() => setConfirming(true)} disabled={blockers.length > 0 || toggle.isPending}>Ligar o login pela rede</Button>
          </div>
        )}
        {toggleError ? <InlineError message={toggleError} /> : null}
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-label="Servidores do AD">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <SectionLabel className="flex items-center gap-1.5"><PlugZap className="size-3.5" aria-hidden />Servidores do AD</SectionLabel>
            <p className="text-xs text-muted-foreground">
              {data.configured ? <>Domínio <span className="font-medium text-foreground">{data.domain}</span>. Definidos na instalação (AD_LDAP_URLS); a INIA tenta na ordem e só passa ao seguinte se o anterior não responder.</> : "Nenhum servidor configurado nesta instalação (AD_LDAP_URLS e AD_DOMAIN no ambiente da API)."}
            </p>
            {data.shortLoginFormats.length > 0 ? <p className="text-xs text-muted-foreground">Matrículas {data.shortLoginFormats.join("; ")}: se o AD recusar a matrícula inteira, a INIA confere sem o último dígito e só deixa entrar se a ID funcional da conta for a da matrícula.</p> : null}
            {data.weakKeyAllowed ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldAlert className="size-3.5 text-amber-600 dark:text-amber-400" aria-hidden />Chave RSA de 1024 bits aceita só na conexão com o AD (risco aceito; a cadeia e o nome do servidor continuam conferidos).</p> : null}
          </div>
          {data.configured ? <Button variant="outline" onClick={() => probe.mutate()} disabled={probe.isPending}>{probe.isPending ? "Conferindo…" : "Conferir servidores"}</Button> : null}
        </div>
        {data.configured ? <ServersTable servers={data.servers} probes={probe.data?.servers ?? null} /> : null}
        {probe.isError ? <InlineError message="Não foi possível conferir os servidores agora." onRetry={() => probe.mutate()} /> : null}
      </section>

      {ambiguous.length > 0 ? (
        <section className={cn(toneSurface("warning"), "space-y-3 p-4")} aria-label="Matrículas repetidas">
          <div className="space-y-1">
            <SectionLabel className="flex items-center gap-1.5"><UserX className="size-3.5" aria-hidden />Matrículas repetidas</SectionLabel>
            <p className="text-sm">
              Estas matrículas aparecem em mais de uma conta, com grafias diferentes (maiúscula ou espaço). Enquanto estiverem repetidas, ninguém entra por elas e o login pela rede não pode ser ligado. Corrija o cadastro das pessoas (Usuários ou a carga de pessoas).
            </p>
          </div>
          <ul className="flex flex-wrap gap-2" aria-label="Matrículas repetidas">
            {ambiguous.map((item) => (
              <li key={item.matricula}><StatusChip tone="warning">{item.matricula} · {item.accounts} contas</StatusChip></li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-label="Contas de emergência">
        <div className="space-y-1">
          <SectionLabel className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" aria-hidden />Contas de emergência</SectionLabel>
          <p className="text-xs text-muted-foreground">Entram com e-mail e senha local mesmo com o login pela rede ligado. Cada entrada fica na auditoria e avisa quem administra os acessos. Para criar outra: <code className="rounded bg-muted px-1">npm run admin:create</code> no servidor.</p>
        </div>
        {data.emergencyAccounts.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Nenhuma conta de emergência" description="Sem ela, o login pela rede não pode ser ligado. Crie uma com npm run admin:create no servidor." />
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {data.emergencyAccounts.map((account) => (
              <li key={account.accountId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span><span className="font-medium">{account.name}</span> <span className="text-muted-foreground">· {account.email}</span></span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {account.lastLoginAt ? `Último acesso ${formatDateTime(account.lastLoginAt)}` : "Nunca entrou"}
                  <StatusChip tone={account.active ? "success" : "neutral"}>{account.active ? "Habilitada" : "Desabilitada"}</StatusChip>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => (open ? null : setConfirming(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming ? "Ligar o login pela rede?" : "Desligar o login pela rede?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming
                ? "A partir de agora as pessoas entram com a matrícula e a senha de rede, e a ciência dos feedbacks também passa a ser confirmada com elas. E-mail e senha valem só para as contas de emergência. Quem já está dentro continua até a sessão vencer."
                : "As pessoas voltam a entrar com e-mail e senha da INIA. Quem só entrou pela rede não tem senha local: vai precisar de uma senha temporária gerada aqui em Acessos."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirming !== null) toggle.mutate(confirming)
                setConfirming(null)
              }}
            >
              {confirming ? "Ligar" : "Desligar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function enableBlockers(data: NetworkLoginStatus, activeEmergency: number): string[] {
  const blockers: string[] = []
  if (!data.configured) blockers.push("Configure os servidores do AD na instalação (AD_LDAP_URLS, AD_DOMAIN e AD_CA_FILE).")
  if (data.httpsRequiredButMissing) blockers.push("Ligue o HTTPS: a senha de rede não pode passar sem criptografia.")
  if (activeEmergency === 0) blockers.push("Crie ao menos uma conta de emergência habilitada (npm run admin:create), para entrar se o AD cair.")
  if (data.ambiguousMatriculas.length > 0) blockers.push("Corrija as matrículas repetidas com grafias diferentes (lista abaixo).")
  return blockers
}

function ServersTable({ servers, probes }: { servers: string[]; probes: NetworkServerProbe[] | null }) {
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Servidor</TableHead>
            <TableHead>Conexão</TableHead>
            <TableHead>Chave</TableHead>
            <TableHead>Certificado vence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {servers.map((url) => {
            const probe = probes?.find((item) => item.url === url) ?? null
            return (
              <TableRow key={url}>
                <TableCell className="font-mono text-xs">{url}</TableCell>
                <TableCell>
                  {probe === null ? (
                    <span className="text-xs text-muted-foreground">Não conferido</span>
                  ) : probe.reachable && probe.trusted ? (
                    <StatusChip tone="success" icon={CheckCircle2}>Responde e a cadeia confere</StatusChip>
                  ) : (
                    <span className="space-y-1">
                      <StatusChip tone="danger" icon={XCircle}>{probe.reachable ? "Certificado recusado" : "Sem resposta"}</StatusChip>
                      {probe.error ? <span className="block text-xs text-muted-foreground">{probe.error}</span> : null}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs">{probe?.keyBits ? `${probe.keyBits} bits` : "—"}</TableCell>
                <TableCell className="text-xs">{probe?.validUntil ? formatDateTime(probe.validUntil) : "—"}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
