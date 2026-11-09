import type { Metadata } from "next"
import Link from "next/link"
import { FlaskConical } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SeeAlso, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { WIKI_NODES, WIKI_NODE_ORDER } from "@/components/wiki/wiki-reference"
import { DEMO_EXAMPLES, exampleBySlug, examplesTeachingNode, stepAnchorOf } from "@/components/wiki/workflow-demo/demo-catalog"
import { DemoExampleSection } from "@/components/wiki/workflow-demo/demo-example-section"
import { DemoGallery } from "@/components/wiki/workflow-demo/demo-gallery"

export const metadata: Metadata = {
  title: "Aprenda na prática",
  description: "Escolha um problema do dia a dia e acompanhe, etapa por etapa, como um Workflow o resolve: gatilho, período, condições, análise, entrega e desfechos. Demonstrações guiadas com dados fictícios.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "galeria", label: "Escolha um problema" },
  { id: "quatro-verbos", label: "Gerar, entregar, encaminhar, aguardar" },
  ...DEMO_EXAMPLES.map((example) => ({ id: example.slug, label: example.title })),
  { id: "por-no", label: "Encontre pelo nó" },
  { id: "limites", label: "O que a demonstração não faz" },
]

const VERBS = [
  { verb: "Gerar conteúdo", nodes: "Chamar agente, Orquestrador, Gerar feedback", what: "Produz uma análise ou uma mensagem. Ninguém vê nada ainda.", when: "Quando ainda falta o que dizer." },
  { verb: "Entregar", nodes: "Output", what: "Torna o conteúdo visível para alguém, numa superfície escolhida.", when: "Quando a mensagem está pronta." },
  { verb: "Encaminhar", nodes: "Escalonar", what: "Passa o caso para alguém da hierarquia e não espera resposta.", when: "Quando outra pessoa precisa assumir." },
  { verb: "Aguardar uma decisão", nodes: "Revisão humana", what: "Para o fluxo, sem prazo, até uma pessoa aprovar, reprovar ou escalar.", when: "Quando alguém precisa decidir antes de seguir." },
  { verb: "Aguardar um tempo", nodes: "Aguardar", what: "Pausa por uma duração fixa e retoma sozinho.", when: "Quando o próximo passo depende de um intervalo." },
]

export default function WorkflowExamplesPage() {
  const notaUra = exampleBySlug("nota-ura-baixa")
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="05 · Workflow Engine"
        title="Aprenda na prática"
        lead="Escolha um problema do dia a dia e acompanhe, etapa por etapa, como um Workflow o resolve: o que inicia a jornada, de onde vêm os dados, como o caminho é decidido e o que cada pessoa recebe."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1 border-amber-500/40 bg-amber-500/10 font-medium text-amber-900 dark:text-amber-200">
            <FlaskConical className="size-3" aria-hidden /> Demonstração com dados fictícios
          </Badge>
          <span className="text-sm text-muted-foreground">Nada é publicado, executado ou enviado por esta página.</span>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-foreground/80">
          Os exemplos usam as mesmas opções do editor. Cada um é conferido, nos testes da plataforma, contra a mesma validação do botão Publicar: se o módulo deixar de aceitar uma jornada, o exemplo precisa mudar junto. Para a referência completa de cada peça, veja <WikiLink href="/wiki/workflows/nodes">Nodes</WikiLink>; para montar do zero, <WikiLink href="/wiki/workflows/criacao">Como criar um Workflow</WikiLink>.
        </p>
      </WikiPageHeader>

      <WikiSection id="galeria" title="Escolha um problema" eyebrow="Exemplos por objetivo">
        <DemoGallery />
      </WikiSection>

      <WikiSection id="quatro-verbos" title="Gerar, entregar, encaminhar, aguardar" eyebrow="Antes de começar">
        <p>A maior parte das dúvidas em um Workflow vem de misturar estas ações. Cada uma é feita por um nó diferente:</p>
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>O que acontece</TableHead>
                <TableHead>Quem faz</TableHead>
                <TableHead>Na prática</TableHead>
                <TableHead>Quando usar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {VERBS.map((row) => (
                <TableRow key={row.verb}>
                  <TableCell className="font-medium">{row.verb}</TableCell>
                  <TableCell>{row.nodes}</TableCell>
                  <TableCell>{row.what}</TableCell>
                  <TableCell>{row.when}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <WarningCallout kind="tip" title="O momento do disparo não é o período analisado">
          O gatilho diz quando a jornada começa. O período é uma escolha de outro lugar: da fonte de dados do agente ou da Condição. Uma Agenda de hoje às 09:00 pode olhar o dia de hoje, os últimos 7 dias ou o fechamento do mês anterior.
        </WarningCallout>
      </WikiSection>

      {DEMO_EXAMPLES.map((example) => (
        <DemoExampleSection key={example.slug} example={example}>
          {example.slug === notaUra.slug ? (
            <WikiTable caption="O limite de 2 é só um exemplo. Metas e limites reais são definidos por cada operação.">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead />
                    <TableHead>Uma avaliação (este exemplo)</TableHead>
                    <TableHead>Agregado no período</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">A medida</TableCell>
                    <TableCell>Flag VOICE · nota_ura, de uma chamada</TableCell>
                    <TableCell>Indicador Nota da Pesquisa na URA, nas medições do período</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">O gatilho</TableCell>
                    <TableCell>Flag de canal</TableCell>
                    <TableCell>Por agenda ou Indicador</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">A condição</TableCell>
                    <TableCell>Valor do gatilho, é menor ou igual a 2</TableCell>
                    <TableCell>Indicador / PRV, Média ponderada dos últimos 7 dias, comparada à Meta vigente ou a um valor fixo</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Os caminhos</TableCell>
                    <TableCell>Sim e Não</TableCell>
                    <TableCell>Sim, Não e Sem dados</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Sem nota</TableCell>
                    <TableCell>O Workflow nem começa</TableCell>
                    <TableCell>Cai em Sem dados: <Link href="#orientar-e-reavaliar" className="font-medium text-primary underline underline-offset-2">veja um exemplo com TMA</Link></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </WikiTable>
          ) : null}
        </DemoExampleSection>
      ))}

      <WikiSection id="por-no" title="Encontre pelo nó" eyebrow="Do catálogo aos exemplos">
        <p>Quer ver uma peça específica funcionando? Cada link abre a demonstração nessa etapa. A referência completa fica em <WikiLink href="/wiki/workflows/nodes#catalogo">Nodes</WikiLink>, com um guia prático em cada nó.</p>
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nó</TableHead>
                <TableHead>Para que serve</TableHead>
                <TableHead>Veja na prática</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {WIKI_NODE_ORDER.map((type) => {
                const node = WIKI_NODES[type]
                const uses = examplesTeachingNode(type)
                return (
                  <TableRow key={type}>
                    <TableCell className="font-medium">
                      <WikiLink href={`/wiki/workflows/nodes#no-${type}`}>{node.label}</WikiLink>
                    </TableCell>
                    <TableCell>{node.summary}</TableCell>
                    <TableCell>
                      <ul className="space-y-0.5">
                        {uses.map((use) => (
                          <li key={use.slug}>
                            <a href={`#${stepAnchorOf(use.slug, use.nodeId)}`} className="font-medium text-primary underline underline-offset-2">{use.title}</a>
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </WikiTable>
        <p className="text-sm text-muted-foreground">
          As modalidades têm guias próprios: <WikiLink href="/wiki/workflows/nodes#gatilho-modalidades">as do Gatilho</WikiLink>, incluindo Manual e Agenda relativa ao expediente, e <WikiLink href="/wiki/workflows/nodes#acao-tipos">as da Ação</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="limites" title="O que a demonstração não faz" eyebrow="Para não confundir">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Não executa nada. Cada desfecho é um roteiro já escrito, com resultado fixo; escolher outro só troca de cena.</li>
          <li>Não publica Workflow, não chama agente nem modelo de IA, e não envia feedback, aviso ou mensagem a ninguém.</li>
          <li>Não usa dados reais. Pessoas, notas, metas e limites são fictícios e não são política oficial.</li>
          <li>Não substitui o teste de verdade. Para testar um Workflow com dados reais e sem efeito para ninguém, use o <WikiLink href="/wiki/qa-lab">QA Lab</WikiLink>.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/workflows/criacao", label: "Como criar um Workflow", hint: "passo a passo no editor" },
            { href: "/wiki/workflows/nodes", label: "Nodes", hint: "a referência de cada peça" },
            { href: "/wiki/workflows/erros-limitacoes", label: "Erros e limitações" },
            { href: "/wiki/casos-praticos/workflows", label: "Modelos de Workflow", hint: "os modelos prontos do produto" },
            { href: "/wiki/qa-lab", label: "QA Lab", hint: "testar sem efeito" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
