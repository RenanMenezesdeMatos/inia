"use client"

import { useState } from "react"
import { CheckCircle2, SearchX } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EmptyState, InlineError } from "@/components/ui/states"
import { StatusChip, SURFACE_CARD } from "@/components/ui/surface"
import { networkSignals, networkVerdict } from "@/lib/access/network-access-labels"
import { cn } from "@/lib/utils"
import { useCheckNetworkLoginMutation } from "@/queries/access/use-access"
import type { IdentifiedUser, NetworkLoginCheck } from "@/schemas/access/access.schema"

import { LoginGuideLine } from "./login-guide"
import { NetworkSignalList } from "./network-signal-list"

/**
 * "Por que esta pessoa não entra?" — confere a matrícula como o login a trataria, sem senha e sem consultar o AD (nenhuma tentativa é
 * somada). Mostra o que impede a entrada, a trava temporária e a última resposta do AD registrada; habilita dali mesmo.
 */
export function NetworkLoginCheckDialog({ open, onOpenChange, onEnable }: { open: boolean; onOpenChange: (open: boolean) => void; onEnable: (user: IdentifiedUser) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">{open ? <CheckForm onClose={() => onOpenChange(false)} onEnable={onEnable} /> : null}</DialogContent>
    </Dialog>
  )
}

function CheckForm({ onClose, onEnable }: { onClose: () => void; onEnable: (user: IdentifiedUser) => void }) {
  const [matricula, setMatricula] = useState("")
  const check = useCheckNetworkLoginMutation()
  const run = (value: string) => { if (value.trim()) check.mutate(value.trim()) }
  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Conferir matrícula</DialogTitle>
        <DialogDescription>Digite a matrícula como a pessoa digita na tela de login. A INIA diz por que ela entra ou não, sem pedir senha e sem consultar o AD.</DialogDescription>
      </DialogHeader>
      <form noValidate className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); run(matricula) }}>
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="network-check-matricula">Matrícula de rede</Label>
          <Input id="network-check-matricula" value={matricula} maxLength={80} autoComplete="off" spellCheck={false} onChange={(event) => setMatricula(event.target.value)} autoFocus />
        </div>
        <Button type="submit" disabled={check.isPending || !matricula.trim()}>{check.isPending ? "Conferindo…" : "Conferir"}</Button>
      </form>
      <div aria-live="polite" className="space-y-3">
        {check.isError ? <InlineError message={check.error.message} /> : null}
        {check.data ? <CheckResult result={check.data} onEnable={onEnable} onTry={(value) => { setMatricula(value); run(value) }} /> : null}
      </div>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Fechar</Button></DialogFooter>
    </div>
  )
}

function CheckResult({ result, onEnable, onTry }: { result: NetworkLoginCheck; onEnable: (user: IdentifiedUser) => void; onTry: (matricula: string) => void }) {
  if (!result.networkLoginEnabled) return <p className="text-sm text-muted-foreground">O login pela rede está desligado: as pessoas entram com e-mail e senha da INIA.</p>
  if (!result.networkLogin) return <EmptyState icon={SearchX} title="Isto não é uma matrícula de rede" description="Só letras, números, ponto, hífen e sublinhado, sem espaço. Um e-mail ou o nome da pessoa não servem para entrar." />
  if (result.people.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState icon={SearchX} title={`Ninguém com a matrícula ${result.networkLogin}`} description="Ela não está no cadastro do seu alcance. Sem cadastro, a INIA recusa antes de consultar o AD." />
        {result.similar.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-sm">Com os mesmos números, o cadastro tem (a matrícula do cadastro precisa ser igual à da rede):</p>
            <ul className="flex flex-wrap gap-2">{result.similar.map((item) => <li key={item}><Button type="button" size="sm" variant="outline" onClick={() => onTry(item)}>{item}</Button></li>)}</ul>
          </div>
        ) : null}
        <NetworkSignalList signals={networkSignals(result.attempts)} />
      </div>
    )
  }
  return (
    <ul className="space-y-3" aria-label="Resultado da conferência">
      {result.people.map((user) => {
        const verdict = networkVerdict(user)
        return (
          <li key={user.personId} className={cn(SURFACE_CARD, "space-y-2 p-3")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{user.name}</p>
                <p className="text-xs text-muted-foreground">Matrícula {user.matricula}{user.team ? ` · ${user.team.name}` : ""}</p>
              </div>
              <StatusChip tone={verdict.ok ? "success" : "danger"} icon={verdict.ok ? CheckCircle2 : SearchX}>{verdict.ok ? "Pode entrar" : "Não entra agora"}</StatusChip>
            </div>
            {user.loginGuide ? <LoginGuideLine guide={user.loginGuide} personName={user.name} /> : null}
            <NetworkSignalList signals={verdict.signals} />
            {verdict.ok && verdict.signals.length === 0 ? <p className="text-xs text-muted-foreground">Cadastro, matrícula e acesso estão certos. Se ainda não entra, o que falta é a senha de rede.</p> : null}
            {user.accessStatus === "DISABLED" && user.personActive && !user.self && !user.networkIssue ? <Button type="button" size="sm" onClick={() => onEnable(user)}>Habilitar acesso</Button> : null}
          </li>
        )
      })}
    </ul>
  )
}
