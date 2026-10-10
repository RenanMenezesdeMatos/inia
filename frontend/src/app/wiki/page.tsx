import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PlatformDiagram } from "@/components/wiki/platform-diagram"
import { WikiFlow, WikiLink } from "@/components/wiki/wiki-primitives"
import { WIKI_SECTIONS } from "@/components/wiki/wiki-nav"
import { SPECIALIST_AGENTS, DOMAIN_ORCHESTRATORS, WORKFLOW_TEMPLATES } from "@/components/wiki/ai-catalog-data"

export const metadata: Metadata = {
  title: "Wiki INIA — documentação oficial da plataforma",
  description: "O que é a INIA, para que serve, quem usa, como os módulos se relacionam e onde configurar cada coisa: Indicadores, Equipe, Acompanhamento, Workflows, Agents, Orchestrators, Bases de Conhecimento, QA Lab, Segurança e Casos práticos.",
}

/** Atalhos que a Home precisa deixar visíveis de imediato (regra 142): o leitor identifica cada
 * grande área em um olhar. Hrefs vêm do sitemap único — nunca digitados aqui de novo. */
const QUICK_LINKS: { label: string; href: string }[] = [
  { label: "Indicadores", href: "/wiki/indicadores" },
  { label: "Equipe", href: "/wiki/estrutura/equipe" },
  { label: "Acompanhamento", href: "/wiki/acompanhamento" },
  { label: "Workflows", href: "/wiki/workflows" },
  { label: "Agents", href: "/wiki/agents" },
  { label: "Orchestrators", href: "/wiki/orchestrators" },
  { label: "Bases de Conhecimento", href: "/wiki/bases-conhecimento" },
  { label: "QA Lab", href: "/wiki/qa-lab" },
  { label: "Segurança", href: "/wiki/seguranca" },
  { label: "Casos práticos", href: "/wiki/casos-praticos" },
]

const CAPABILITIES: { title: string; description: string; href: string }[] = [
  { title: "Ler dados oficiais, nunca recalculá-los", description: "PRV, atingimento, peso e quartil chegam fechados da fonte corporativa. A INIA lê, agrega e explica — não inventa número.", href: "/wiki/indicadores" },
  { title: "Decidir por regra antes de chamar IA", description: "Conditions e rankings são determinísticos (TRUE / FALSE / SEM DADOS). A IA só entra onde há análise a fazer.", href: "/wiki/workflows/conditions" },
  { title: "Analisar com especialistas de IA", description: "Agents por domínio, com bases de conhecimento autorizadas e evidência literal verificada por código; Orchestrators só para coordenar ou sintetizar.", href: "/wiki/agents" },
  { title: "Automatizar com Workflows", description: "Trigger → Condição → IA → Revisão humana → Output, com fan-out por colaborador e consolidação para a gestão.", href: "/wiki/workflows" },
  { title: "Testar antes de publicar", description: "QA Lab simula Workflows, Agents e Orchestrators com dados reais e zero efeito operacional — inclusive sem gastar IA.", href: "/wiki/qa-lab" },
  { title: "Entregar no lugar certo", description: "Acompanhamento para ler, Pendências para decidir, sino para avisar. Ler nunca é decidir; ciência é do próprio colaborador.", href: "/wiki/acompanhamento" },
]

export default function WikiHomePage() {
  return (
    <div className="space-y-14">
      <header className="space-y-4">
        <Badge variant="outline" className="font-mono text-[11px]">
          Documentação oficial
        </Badge>
        <h1 className="text-balance font-heading text-3xl font-bold tracking-tight sm:text-4xl">INIA — Supervisora Virtual com IA para operações</h1>
        <p className="max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
          A INIA identifica sinais operacionais, reúne evidências, produz diagnósticos explicáveis, recomenda ações, acompanha a evolução e escala
          casos quando necessário — para operadores, supervisores e toda a liderança de uma operação de atendimento.
        </p>
        <p className="max-w-2xl text-sm leading-relaxed text-foreground/80">
          Esta Wiki explica a plataforma como produto: do dado de entrada até a decisão e a entrega ao usuário. Tudo aqui descreve o que existe de
          fato hoje — quando algo é só planejado, está marcado como limitação ou próxima evolução.
        </p>
        <nav aria-label="Atalhos das áreas" className="flex flex-wrap gap-2 pt-1">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs font-medium tracking-wide text-foreground uppercase transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>

      <section className="space-y-4">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">O que a INIA faz</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {CAPABILITIES.map((capability) => (
            <Link key={capability.href + capability.title} href={capability.href} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full transition-shadow group-hover:shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">{capability.title}</CardTitle>
                  <CardDescription>{capability.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">Fluxo geral da plataforma</h2>
        <PlatformDiagram />
        <p className="text-sm text-foreground/90">
          A jornada canônica de todo caso é a mesma: <span className="font-mono text-xs">detecção → diagnóstico → evidência → recomendação →
          acompanhamento → escalonamento ou encerramento</span>. O <strong className="font-medium text-foreground">caso de supervisão</strong> é
          a unidade central: alertas, evidências, feedbacks, planos e escalonamentos pertencem a um caso, rastreável de ponta a ponta.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">Como uma chamada vira um feedback</h2>
        <p className="text-sm text-foreground/90">
          O exemplo de ponta a ponta que a Wiki responde em três níveis — o que é, como usar e como tudo se conecta:
        </p>
        <WikiFlow
          compact
          steps={[
            { label: "Interação de voz chega com transcrição e flags já calculadas", detail: "ex.: flag rechamada = true", tone: "input" },
            { label: "Trigger por Flag de canal matricula o operador da chamada num Workflow", tone: "core" },
            { label: "Condition determinística decide se vale analisar", detail: "TRUE / FALSE / SEM DADOS — sem IA", tone: "core" },
            { label: "Chamar agente: o Especialista do domínio recebe a transcrição e só os trechos pertinentes da Base de Conhecimento", tone: "ai" },
            { label: "Revisão humana: o Supervisor aprova, reprova ou escala em Pendências", tone: "people" },
            { label: "Output publica o feedback no Acompanhamento do operador; o sino avisa", tone: "output" },
            { label: "O operador lê e confirma ciência — o gestor acompanha o estado", tone: "people" },
          ]}
        />
        <p className="text-sm text-muted-foreground">
          Leia a versão completa em <WikiLink href="/wiki/introducao/como-as-pecas-se-conectam">Como as peças se conectam</WikiLink>.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">Áreas da documentação</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {WIKI_SECTIONS.map((section) => (
            <Card key={section.id} className="h-full">
              <CardHeader>
                <div className="flex items-center gap-2.5">
                  <section.icon className="size-5 text-primary" aria-hidden />
                  <span className="font-mono text-xs text-muted-foreground">{section.number}</span>
                  <CardTitle className="text-base">{section.title}</CardTitle>
                </div>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {section.pages.map((page) => (
                    <li key={page.href}>
                      <Link href={page.href} className="font-medium text-primary underline-offset-2 hover:underline">
                        {page.title} <ArrowRight className="ml-0.5 inline size-3.5" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-4 text-sm">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Números do catálogo configurado</h2>
        <p className="text-foreground/90">
          {SPECIALIST_AGENTS.length} Agents especialistas, {DOMAIN_ORCHESTRATORS.length} Orchestrators e {WORKFLOW_TEMPLATES.length} modelos de
          Workflow documentados a partir do que está configurado no produto — a Wiki lê o mesmo catálogo que os testes de consistência conferem
          contra o banco de referência. Nomes, bases e contratos nunca são digitados à mão em duas listas.
        </p>
      </section>
    </div>
  )
}
