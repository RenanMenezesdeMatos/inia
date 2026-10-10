"use client"

import Link from "next/link"

import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import { describeBusinessDomain, type BusinessDomainRef } from "@/schemas/admin/business-domain.schema"
import { describeRoutingPolicy, ROUTING_POLICY_LABELS, type RoutingPolicy } from "@/schemas/admin/orchestrator-policy"

/**
 * "Como este Orquestrador pode escolher especialistas?" — UMA pergunta, duas respostas (forma alvo,
 * migration 057): Domínios específicos (1..N — um domínio é o antigo "de domínio", vários o antigo
 * "multidomínio") ou Qualquer assunto autorizado (OPEN — a lista explícita de especialistas continua
 * sendo a autorização; é o caso do chat/voz). ONDE ele é acionado é outra pergunta, em outro campo.
 *
 * Os domínios vêm do CATÁLOGO administrável (`domains`, carregado pelo pai em Domínios de negócio —
 * migration 060): um domínio criado lá aparece aqui sem deploy. Só ativos são oferecidos; um domínio
 * desativado que o registro já tinha continua marcado, como "(desativado)", e nunca some sozinho.
 *
 * Registro legado (TRANSVERSAL/MANAGERIAL ou sem política) aparece TRADUZIDO, sem obrigar o admin a
 * corrigir na hora: só ao escolher uma das duas respostas ele passa para a forma nova.
 */
export function OrchestratorPolicyFields({ routing, domains, domainsLoading = false, onChange }: { routing: RoutingPolicy; domains: BusinessDomainRef[]; domainsLoading?: boolean; onChange: (next: RoutingPolicy) => void }) {
  const selected = routing.kind === "DOMAINS" || routing.kind === "OPEN" ? routing.kind : ""
  const chosen = routing.kind === "DOMAINS" ? routing.domains : []
  // Catálogo ativo + o que o registro já tinha (mesmo desativado ou ainda só como código legado).
  const options: BusinessDomainRef[] = [...domains.filter((domain) => domain.active), ...chosen.filter((domain) => !domains.some((candidate) => candidate.active && candidate.code === domain.code))]
  return (
    <div className="space-y-2">
      <Label>Como este Orquestrador pode escolher especialistas?</Label>
      <RadioGroup
        value={selected}
        onValueChange={(value) => onChange(value === "OPEN" ? { kind: "OPEN" } : { kind: "DOMAINS", domains: routing.kind === "DOMAINS" ? routing.domains : [] })}
        aria-label="Como este Orquestrador pode escolher especialistas?"
      >
        <label className="flex items-start gap-2 text-sm">
          <RadioGroupItem value="DOMAINS" aria-label={ROUTING_POLICY_LABELS.DOMAINS} className="mt-0.5" />
          <span>
            <span className="font-medium">{ROUTING_POLICY_LABELS.DOMAINS}</span>
            <span className="block text-xs text-muted-foreground">Só especialistas dos domínios marcados (1 ou vários) + transversais que você adicionar.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <RadioGroupItem value="OPEN" aria-label={ROUTING_POLICY_LABELS.OPEN} className="mt-0.5" />
          <span>
            <span className="font-medium">{ROUTING_POLICY_LABELS.OPEN}</span>
            <span className="block text-xs text-muted-foreground">Pode rotear entre os especialistas explicitamente autorizados, independentemente do domínio (chat/voz, casos realmente abertos).</span>
          </span>
        </label>
      </RadioGroup>
      {routing.kind === "DOMAINS" ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Domínios autorizados</Label>
          {options.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="routing-domains-empty">
              {domainsLoading ? "Carregando domínios de negócio…" : (
                <>
                  Nenhum domínio de negócio ativo. Cadastre um em <Link href="/admin/business-domains" className="underline underline-offset-2">Domínios de negócio</Link>.
                </>
              )}
            </p>
          ) : (
            <ToggleGroup
              type="multiple"
              className="flex-wrap justify-start"
              value={chosen.map((domain) => domain.code)}
              onValueChange={(codes) => onChange({ kind: "DOMAINS", domains: codes.map((code) => options.find((domain) => domain.code === code) ?? chosen.find((domain) => domain.code === code)).filter((domain): domain is BusinessDomainRef => Boolean(domain)) })}
              aria-label="Domínios autorizados"
            >
              {options.map((domain) => (
                <ToggleGroupItem key={domain.code} value={domain.code}>
                  {describeBusinessDomain(domain)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          <p className="text-xs text-muted-foreground">
            A lista vem do catálogo de <Link href="/admin/business-domains" className="underline underline-offset-2">Domínios de negócio</Link> — um domínio novo aparece aqui assim que for criado.
          </p>
        </div>
      ) : null}
      {routing.kind === "LEGACY" || routing.kind === null ? (
        <p className="text-xs text-muted-foreground" data-testid="routing-legacy">
          {describeRoutingPolicy(routing)}. Escolha uma das opções acima para migrar este registro para a forma nova — não é obrigatório agora.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        A lista de especialistas continua sendo a autorização explícita. Agents de performance são chamados direto pelo Workflow e Agents de síntese rodam
        depois de &quot;Consolidar resultados&quot; — nenhum dos dois entra como especialista de um Orquestrador por domínios. A regra vale no servidor ao salvar.
      </p>
    </div>
  )
}
