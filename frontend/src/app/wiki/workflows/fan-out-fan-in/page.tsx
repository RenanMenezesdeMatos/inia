import type { Metadata } from "next"
import { ArrowRight, GitMerge, Split } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExampleCard, SeeAlso, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Fan-out e Fan-in",
  description: "Aplicar individualmente (1 coleção → N execuções) e Consolidar resultados (N execuções → 1 resultado consolidado): pareamento, zero filhos, falhas, Orchestrator pós-JOIN e QA Lab.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "fan-out", label: "Aplicar individualmente (fan-out)" },
  { id: "fan-in", label: "Consolidar resultados (fan-in)" },
  { id: "pareamento", label: "Pareamento — um Join por Apply" },
  { id: "zero-filhos", label: "Zero filhos" },
  { id: "falhas", label: "Falha de um filho" },
  { id: "orchestrator-pos-join", label: "IA pós-JOIN: Agent de síntese" },
  { id: "revisao-em-fan-out", label: "Revisão humana num fan-out" },
  { id: "qa-lab", label: "No QA Lab" },
  { id: "limitacoes", label: "O que não faz" },
]

export default function FanOutFanInPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="05 · Workflow Engine"
        title="Fan-out e Fan-in"
        lead="“Aplicar individualmente” faz 1 → N (fan-out): uma execução real por colaborador da coleção. “Consolidar resultados” faz N → 1 (fan-in): espera todas terminarem e continua a execução consolidada exatamente uma vez, com um resultado tipado."
      >
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3.5 py-3 font-mono text-xs sm:text-sm">
          <span className="rounded bg-background px-2 py-1">Coleção</span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="rounded bg-background px-2 py-1">Aplicar individualmente</span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="rounded bg-background px-2 py-1">N × Colaborador individual</span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="rounded bg-background px-2 py-1">Consolidar resultados</span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="rounded bg-background px-2 py-1">Resultado consolidado</span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="rounded bg-background px-2 py-1">Orquestrador / Output</span>
        </div>
      </WikiPageHeader>

      <WikiSection id="fan-out" title="Aplicar individualmente (fan-out)" eyebrow="1 → N">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Split className="size-4 text-orange-600 dark:text-orange-300" />
              <CardTitle className="text-sm">Aplicar individualmente</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Cria uma execução separada, de verdade, para cada colaborador da coleção — 1 execução por colaborador.</p>
            <p>
              Cada filho continua o resto do grafo a partir do node SEGUINTE (nunca reinicia no Gatilho), na MESMA versão publicada do pai. O pai
              fica concluído logo depois do fan-out — nunca segue tentando processar nodes que esperam um colaborador individual — ou espera no
              Join, quando existe &quot;Consolidar resultados&quot;.
            </p>
          </CardContent>
        </Card>
        <p>
          Só existe em modo Consolidado, depois de uma coleção (<WikiLink href="/wiki/workflows/ranking">Selecionar colaboradores</WikiLink>). Sem
          configuração própria.
        </p>
      </WikiSection>

      <WikiSection id="fan-in" title="Consolidar resultados (fan-in / JOIN)" eyebrow="N → 1">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <GitMerge className="size-4 text-cyan-600 dark:text-cyan-300" />
              <CardTitle className="text-sm">Consolidar resultados</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Sem configuração própria (mesmo padrão de &quot;Aplicar individualmente&quot;) — a origem é resolvida da topologia do grafo, nunca
              escolhida à mão: o painel mostra qual &quot;Aplicar individualmente&quot; alimenta este Join.
            </p>
            <p>
              Cada execução filha, ao chegar aqui, só registra a chegada e termina — quem continua o grafo depois do Join é sempre a execução
              consolidada (o &quot;pai&quot;), uma única vez, quando o último filho pendente resolve.
            </p>
            <p>
              O resultado consolidado é tipado: estrutura original, coleção e o resultado de cada colaborador (decisão de Revisão humana, resultado
              de Agent/Action, status de falha), com nomes resolvidos — nunca a pessoa-âncora da Estrutura fingindo representar a equipe inteira.
            </p>
          </CardContent>
        </Card>
        <ExampleCard title="Exemplo completo">
          Equipe do Supervisor Carlos → Selecionar colaboradores (Q4 em 3 dos últimos 3 fechamentos) → João, Maria, Pedro → Aplicar individualmente
          → cada um roda Chamar agente (diagnóstico) → Revisão Humana → Consolidar resultados → quando os três terminam, Orquestrador · Gerencial
          (&quot;Resuma os três diagnósticos e decisões das revisões&quot;) → Output pro Supervisor Carlos.
        </ExampleCard>
        <WarningCallout title="Consolidar resultados é opcional">
          &quot;Aplicar individualmente&quot; continua funcionando sem nenhum Join — cada filho termina sozinho. Vários fan-outs sequenciais também
          funcionam (Apply A → Join A → Selecionar de novo → Apply B → Join B), cada Join pareado ao seu próprio Apply, nunca misturando filhos de
          fases diferentes.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="pareamento" title="Pareamento — um Join por Apply" eyebrow="Validação de publicação">
        <p>
          Cada &quot;Consolidar resultados&quot; precisa estar associado a exatamente um &quot;Aplicar individualmente&quot;, resolvido andando pra
          trás no grafo — nunca configurado à mão. O publish bloqueia topologias ambíguas ou perigosas:
        </p>
        <ul className="list-inside list-disc space-y-2 text-sm text-foreground/90">
          <li>Um Join sem nenhum &quot;Aplicar individualmente&quot; antes dele.</li>
          <li>Um Join alcançado por mais de um &quot;Aplicar individualmente&quot; diferente — origem ambígua.</li>
          <li>Um &quot;Aplicar individualmente&quot; que alcança mais de um Join diferente — só um Join é permitido por fan-out.</li>
          <li>
            Um caminho individual que <strong className="font-medium text-foreground">escapa</strong> do fan-out sem passar pelo Join (ex.: um ramo de
            Condition indo direto pro Fim) — deixaria o Join esperando pra sempre por um filho que nunca chega.
          </li>
        </ul>
        <p>
          Branches convergindo no MESMO Join são válidos: um Condition com dois ramos, cada um levando a um node diferente, ambos terminando no
          mesmo &quot;Consolidar resultados&quot;, publica normalmente.
        </p>
      </WikiSection>

      <WikiSection id="zero-filhos" title="Zero filhos" eyebrow="Coleção vazia">
        <p>
          Se nenhum colaborador foi selecionado, a coleção é vazia e &quot;Aplicar individualmente&quot; faz um fan-out de 0 execuções — sem efeito
          colateral nenhum, não é erro. Se existe um &quot;Consolidar resultados&quot;, ele resolve imediatamente com 0 esperados e um{" "}
          <strong className="font-medium text-foreground">Orquestrador pós-JOIN é pulado sem chamar IA</strong> (motivo registrado no trace:
          fan-in vazio). Um Output depois do Join com a lista consolidada vazia continua sendo entregue com a contagem zerada.
        </p>
      </WikiSection>

      <WikiSection id="falhas" title="Falha de um filho" eyebrow="Nunca trava o Join">
        <p>
          Falha de um filho nunca trava o Join pra sempre: um filho que falhou definitivamente conta como terminal (falhou), assim como um filho
          concluído normalmente — o resultado consolidado distingue os dois (Esperados / Concluídos / Falharam).
        </p>
      </WikiSection>

      <WikiSection id="orchestrator-pos-join" title="IA pós-JOIN: Agent de síntese" eyebrow="A única IA em contexto consolidado">
        <p>
          Depois de &quot;Consolidar resultados&quot; a IA que roda é um <strong className="font-medium text-foreground">Chamar agente</strong> com um
          Agent de especialidade <strong className="font-medium text-foreground">Síntese</strong> (ex.: Especialista de Síntese Gerencial): ele recebe a
          estrutura original, a coleção e os resultados de cada colaborador (decisão de Revisão Humana, resultado de Agent/Action, status de falha), com
          nomes resolvidos, nunca IDs crus, e devolve um contrato estruturado (padrões, riscos, pontos fortes, tendências, ações, colaboradores sem
          análise) em uma única request. O node tem uma &quot;Missão da síntese&quot; e só aceita Agents que declaram aceitar o resultado consolidado —
          um especialista que analisa um colaborador por vez é recusado na publicação. O node Orquestrador continua aceito aqui só por compatibilidade
          (legado: sintetizava sem coordenar ninguém); ver{" "}
          <WikiLink href="/wiki/orchestrators#gerencial">Orchestrators › pós-JOIN</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="revisao-em-fan-out" title="Revisão humana num fan-out" eyebrow="Cada decisão pertence a UMA pessoa">
        <p>
          Cada Revisão humana dentro do fan-out pertence a um colaborador — aprovar a de João nunca decide a de Maria. Todas as decisões (Aprovado,
          Reprovado, Escalar) precisam convergir no MESMO Join: Aprovado → Output ao operador → Join; Reprovado → Join; Escalar → Escalonar ao
          Gerente com &quot;Continuar&quot; → Join. Uma revisão pendente segura o Join até a última decisão chegar.
        </p>
      </WikiSection>

      <WikiSection id="qa-lab" title="No QA Lab" eyebrow="Simulação">
        <p>
          Executar até &quot;Aplicar individualmente&quot; mostra o fan-out simulado — nunca cria nada operacional (matrículas, Revisão Humana, Output
          ou Pendência reais). O passo a passo agrupa &quot;Aplicar individualmente — N colaborador(es)&quot; com a execução de cada um. O simulador
          mostra a barreira aguardando (Esperados/Concluídos/Falharam) enquanto algum colaborador ainda não terminou — Revisão Humana pendente de um
          segura o Join normalmente, e ele libera sozinho assim que a última decisão é simulada. O orçamento de requests de IA continua{" "}
          <strong className="font-medium text-foreground">global</strong> pro QA Run inteiro, nunca reiniciado por colaborador nem depois do Join:
          com um limite de 2, João e Maria consomem 1 cada, e Pedro pausa antes da IA.
        </p>
      </WikiSection>

      <WikiSection id="limitacoes" title="O que não faz nesta versão" eyebrow="Limitações reais">
        <ul className="list-inside list-disc space-y-2 text-sm text-foreground/90">
          <li>Loop genérico (&quot;For Each&quot;), coleção de estruturas, coleções aninhadas, fan-out dentro de um fan-out (nested).</li>
          <li>Action consumindo uma coleção/resultado consolidado diretamente — continua exigindo um colaborador individual (só o Orchestrator ganhou suporte a resultado consolidado).</li>
          <li>Sem quorum/timeout/fail-fast configuráveis no Join — aguarda todos os filhos ficarem terminalmente resolvidos, sempre.</li>
          <li>Sem limite operacional explícito de tamanho de fan-out configurado nesta versão.</li>
          <li>Efeitos simulados de cada colaborador no QA Lab ainda aparecem agregados na aba &quot;Efeitos simulados&quot; (cosmético).</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/workflows/ranking", label: "Selecionar colaboradores", hint: "a coleção que alimenta o fan-out" },
            { href: "/wiki/workflows/outputs#output-consolidado", label: "Output consolidado", hint: "destinatário de gestão pós-JOIN" },
            { href: "/wiki/orchestrators#gerencial", label: "Orquestrador gerencial" },
            { href: "/wiki/casos-praticos#guia-2", label: "Guia: análise individual + resumo gerencial" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
