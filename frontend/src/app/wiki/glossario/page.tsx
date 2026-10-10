import type { Metadata } from "next"
import Link from "next/link"

import { WikiArticle, WikiPageHeader, WikiSection } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { GLOSSARY } from "@/components/wiki/glossary-data"

export const metadata: Metadata = {
  title: "Glossário",
  description: "Os termos da INIA, com o mesmo significado usado em todas as telas: Abrangência, Alvo, População, PRV, Quartil, Fechamento, Agent, Orchestrator, Retrieval, Workflow, Trigger, Node, Condition, Fan-out, Fan-in, Human Review, Output, Surface, Acompanhamento, Ciência, Pendência, QA Run, Snapshot, SEM DADOS.",
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" })
const SORTED = [...GLOSSARY].sort((a, b) => collator.compare(a.term, b.term))

function slugify(term: string): string {
  return term
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

const TOC: WikiTocEntry[] = [{ id: "visao-geral", label: "Glossário" }, ...SORTED.map((entry) => ({ id: `termo-${slugify(entry.term)}`, label: entry.term }))]

export default function GlossaryPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader eyebrow="13 · Glossário" title="Glossário" lead="Os termos do produto, em ordem alfabética, com o mesmo significado usado em todas as telas — cada um aponta para a página que o aprofunda." />

      <WikiSection id="termos" title={`${SORTED.length} termos`} eyebrow="A–Z">
        <dl className="divide-y divide-border rounded-lg border border-border px-4">
          {SORTED.map((entry) => (
            <div key={entry.term} id={`termo-${slugify(entry.term)}`} className="grid scroll-mt-24 grid-cols-1 gap-1 py-3 sm:grid-cols-[220px_1fr] sm:gap-4">
              <dt className="font-medium text-foreground">
                {entry.term}
                {entry.aliases?.length ? <span className="block text-xs font-normal text-muted-foreground">também: {entry.aliases.join(", ")}</span> : null}
              </dt>
              <dd className="text-sm text-foreground/90">
                {entry.definition}{" "}
                <Link href={entry.href} className="whitespace-nowrap font-medium text-primary underline-offset-2 hover:underline">
                  Ver mais →
                </Link>
              </dd>
            </div>
          ))}
        </dl>
      </WikiSection>
    </WikiArticle>
  )
}
