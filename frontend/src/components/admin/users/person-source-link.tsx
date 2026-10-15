"use client"

import { useState } from "react"
import { Link2 } from "lucide-react"

import { ListSearchInput } from "@/components/admin/shared/list/list-filters"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { formatDateTime } from "@/lib/format/date"
import { useLinkUserToSourcePersonMutation, useUserAccountsPageQuery } from "@/queries/admin/use-user-account-queries"
import type { UserAccount, UserDetail } from "@/schemas/admin/user-account.schema"

/**
 * Identidade da pessoa na ficha ("Pertence a"): veio da base (matrícula), foi cadastrada à mão, ou já foi vinculada à pessoa
 * da base. Para a cadastrada à mão, a ação "Vincular à pessoa da base" corrige o duplicado — diálogo discreto com busca e
 * confirmação dos efeitos; o backend confere escopo, custódia da credencial e as pré-condições.
 */
export function PersonSourceIdentity({ detail, canLink, onLinked }: { detail: UserDetail; canLink: boolean; onLinked: () => void }) {
  if (detail.linkedTo) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="person-linked-to">
        Vinculada a <span className="font-medium text-foreground">{detail.linkedTo.name}</span>
        {detail.linkedTo.matricula ? ` (matrícula ${detail.linkedTo.matricula})` : ""} em {formatDateTime(detail.linkedTo.at)} — a conta e os papéis
        foram para a pessoa da base; este cadastro ficou inativo.
      </p>
    )
  }
  if (detail.matricula) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
      <span className="text-muted-foreground">Cadastrada à mão na INIA (sem matrícula): a base do cliente não manda neste cadastro.</span>
      {canLink ? <PersonSourceLinkAction person={detail} onLinked={onLinked} /> : null}
    </div>
  )
}

function PersonSourceLinkAction({ person, onLinked }: { person: UserDetail; onLinked: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setOpen(true)}>
        <Link2 className="size-3.5" aria-hidden />
        Vincular à pessoa da base
      </Button>
      <DialogContent className="sm:max-w-lg">{open ? <LinkDialogBody person={person} onDone={() => { setOpen(false); onLinked() }} onCancel={() => setOpen(false)} /> : null}</DialogContent>
    </Dialog>
  )
}

function LinkDialogBody({ person, onDone, onCancel }: { person: UserDetail; onDone: () => void; onCancel: () => void }) {
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const [target, setTarget] = useState<UserAccount | null>(null)
  // Só quem veio da base (matrícula) e ainda não tem conta de login pode receber a conta desta pessoa.
  const candidates = useUserAccountsPageQuery({ search: debouncedSearch || undefined, role: [], hasAccount: false, hasMatricula: true, lastLoginAt: {}, page: 1, pageSize: 8 })
  const mutation = useLinkUserToSourcePersonMutation(person.id)

  if (target) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Vincular {person.name} a {target.name}?</DialogTitle>
          <DialogDescription>Use quando as duas são a mesma pessoa: uma cadastrada à mão aqui e outra que chegou pela base.</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1.5 pl-5 text-sm" aria-label="O que acontece">
          {person.accountId ? (
            <>
              <li>A conta de login{person.email ? ` (${person.email})` : ""} e os papéis de acesso passam para {target.name}{target.matricula ? ` (matrícula ${target.matricula})` : ""}; a base do cliente passa a mandar no cadastro.</li>
              <li>As sessões abertas são encerradas: a pessoa entra de novo, com a mesma senha.</li>
            </>
          ) : (
            <li>{person.name} não tem conta de login: nenhum acesso muda.</li>
          )}
          <li>{person.name} fica inativa e marcada como vinculada a {target.name}. O vínculo fica na auditoria.</li>
          <li>Conversas, avisos e o histórico de {person.name} continuam com ela — não são movidos.</li>
        </ul>
        {mutation.isError ? <p className="text-sm text-destructive" role="alert">{(mutation.error as Error).message}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setTarget(null)} disabled={mutation.isPending}>Voltar</Button>
          <Button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate(target.id, { onSuccess: onDone })}>
            {mutation.isPending ? "Vinculando..." : "Vincular"}
          </Button>
        </DialogFooter>
      </>
    )
  }

  const items = candidates.data?.items ?? []
  return (
    <>
      <DialogHeader>
        <DialogTitle>Vincular à pessoa da base</DialogTitle>
        <DialogDescription>Escolha a pessoa que chegou pela base e é a mesma que {person.name}. Só aparecem pessoas com matrícula e ainda sem conta de login.</DialogDescription>
      </DialogHeader>
      <ListSearchInput value={search} onChange={setSearch} placeholder="Buscar por nome ou matrícula" ariaLabel="Buscar pessoa da base" pending={search.trim() !== debouncedSearch} />
      {candidates.isPending ? <Skeleton className="h-24 w-full" /> : null}
      {candidates.isError ? <p className="text-sm text-destructive" role="alert">{(candidates.error as Error).message}</p> : null}
      {candidates.data && items.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma pessoa da base sem conta com essa busca.</p> : null}
      {items.length > 0 ? (
        <ul className="max-h-72 divide-y overflow-y-auto rounded-md border" aria-label="Pessoas da base sem conta">
          {items.map((candidate) => (
            <li key={candidate.id}>
              <button type="button" className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted/60" onClick={() => setTarget(candidate)}>
                <span className="font-medium">{candidate.name}</span>
                <span className="text-xs text-muted-foreground">Matrícula {candidate.matricula}{candidate.teamName ? ` · ${candidate.teamName}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
      </DialogFooter>
    </>
  )
}
