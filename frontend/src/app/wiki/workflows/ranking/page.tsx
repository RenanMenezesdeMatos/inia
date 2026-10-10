import type { Metadata } from "next"
import { ArrowRight, UsersRound } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExampleCard, SeeAlso, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Selecionar colaboradores e Ranking",
  description: "Por critério e Por ranking: VALUE e CHANGE, Melhores/Piores × Maiores/Menores, direção do indicador, partição por Grupo/Subgrupo (N por partição), sem dados, menos que N e empates.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "filtro-vs-colecao", label: "Filtro Populacional × Coleção" },
  { id: "por-criterio", label: "Por critério" },
  { id: "refinamento", label: "Refinamento (encadeamento)" },
  { id: "por-ranking", label: "Por ranking" },
  { id: "value", label: "Ranquear por Valor (VALUE)" },
  { id: "melhores-piores", label: "Melhores/Piores ≠ Maiores/Menores" },
  { id: "change", label: "Ranquear por Evolução (CHANGE)" },
  { id: "partition", label: "Separar ranking por Grupo/Subgrupo" },
  { id: "sem-dados", label: "Sem dados, menos que N, empates" },
  { id: "quartil", label: "Quartil operacional no ranking" },
  { id: "qa-lab", label: "No QA Lab" },
  { id: "fora-de-escopo", label: "Fora de escopo nesta versão" },
]

export default function RankingPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="05 · Workflow Engine"
        title="Selecionar colaboradores e Ranking"
        lead="“Selecionar colaboradores” cria uma coleção com um subconjunto da estrutura — não executa ninguém ainda. Dois modos, ambos 100% determinísticos: Por critério (quais atendem a esta condição?) e Por ranking (quais são os N primeiros depois de ordenar?)."
      >
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3.5 py-3 font-mono text-xs sm:text-sm">
          <span className="rounded bg-background px-2 py-1">Estrutura</span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="rounded bg-background px-2 py-1">Selecionar colaboradores</span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="rounded bg-background px-2 py-1">Coleção de colaboradores</span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="rounded bg-background px-2 py-1">Aplicar individualmente</span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="rounded bg-background px-2 py-1">Colaborador individual</span>
        </div>
      </WikiPageHeader>

      <WikiSection id="filtro-vs-colecao" title="Filtro Populacional × Coleção" eyebrow="Perguntas diferentes">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ExampleCard title="Filtro Populacional — «Quem pode ENTRAR no Workflow?»">
            Decidido ANTES da execução começar (ver <WikiLink href="/wiki/workflows#abrangencia">Escopo/Abrangência</WikiLink>) — restringe a
            população elegível em modo Individual. Nunca muda depois que o Workflow começou a rodar.
          </ExampleCard>
          <ExampleCard title="Coleção — «Quem foi selecionado DURANTE esta execução?»">
            Só existe dentro de um Workflow em modo <strong className="font-medium text-foreground">Consolidado</strong>: reduz a Estrutura
            Consolidada (ou uma coleção anterior) a um subconjunto, usando um critério — a MESMA engine determinística das Conditions, nunca uma
            segunda avaliadora.
          </ExampleCard>
        </div>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <UsersRound className="size-4 text-teal-600 dark:text-teal-300" />
              <CardTitle className="text-sm">Selecionar colaboradores</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Cria uma coleção apenas com um subconjunto da população — não cria nenhuma execução individual ainda.</p>
            <p>
              Dois modos de seleção: <strong className="font-medium text-foreground">Por critério</strong> (reaproveita o mesmo builder de Condition) ou{" "}
              <strong className="font-medium text-foreground">Por ranking</strong>. A Abrangência nunca é reperguntada aqui (já vem do Workflow).{" "}
              <strong className="font-medium text-foreground">Zero IA</strong> nos dois modos — determinístico, reproduzível, auditável.
            </p>
          </CardContent>
        </Card>
      </WikiSection>

      <WikiSection id="por-criterio" title="Por critério" eyebrow="Quais atendem a esta condição?">
        <p>
          TRUE entra na coleção; FALSE e SEM DADOS ficam fora — mas os três são contados separadamente, pra explicabilidade. Nunca existe uma
          opção &quot;incluir sem dados&quot; nesta versão.
        </p>
        <Card className="bg-muted/30">
          <CardContent className="space-y-1.5 pt-4 font-mono text-xs">
            <p className="text-foreground/90">10 candidatos avaliados · 4 selecionados · 3 não atenderam · 3 sem dados</p>
          </CardContent>
        </Card>
        <p>
          Zero selecionados não é um erro — produz uma coleção vazia; se o fluxo chegar em &quot;Aplicar individualmente&quot;, o fan-out é de 0
          execuções, sem efeito colateral nenhum.
        </p>
        <ExampleCard title="Exemplo completo">
          Agenda mensal, Estrutura &quot;Equipe do Supervisor Carlos&quot; → Selecionar colaboradores (Quartil de Qualidade, Q4 em 3 dos últimos 3
          fechamentos) → resultado: João, Maria, Pedro → Aplicar individualmente → Chamar agente (&quot;Analise o histórico deste
          colaborador&quot;) → Revisão Humana. Cada Revisão Humana pertence individualmente a UM colaborador — aprovar a de João nunca decide a de
          Maria ou Pedro.
        </ExampleCard>
      </WikiSection>

      <WikiSection id="refinamento" title="Refinamento — uma segunda seleção nunca reexpande" eyebrow="Encadeamento">
        <p>
          &quot;Selecionar colaboradores&quot; aceita como origem tanto a Estrutura quanto uma coleção já produzida antes — um segundo filtro avalia{" "}
          <strong className="font-medium text-foreground">só quem já está na primeira coleção</strong>, nunca volta a olhar pra Estrutura inteira.
          Vale para critério → critério, critério → ranking e ranking → ranking.
        </p>
        <Card className="bg-muted/30">
          <CardContent className="space-y-1.5 pt-4 font-mono text-xs">
            <p className="text-foreground/90">Equipe Carlos (10 pessoas) → Selecionar (Q4, 3/3) → 6 pessoas</p>
            <p className="text-foreground/90">→ Selecionar (PRV &lt; 80%) → 4 pessoas — só dentre as 6, nunca das 10 originais</p>
            <p className="text-muted-foreground">→ Aplicar individualmente → 4 execuções</p>
            <p className="text-foreground/90">Equipe Vanessa (20) → Por critério: PRV &lt; 80% → 10 → Por ranking: 5 piores em Qualidade → 5 (só dentre os 10)</p>
          </CardContent>
        </Card>
      </WikiSection>

      <WikiSection id="por-ranking" title="Por ranking" eyebrow="Quais são os N primeiros depois de ordenar?">
        <p>
          &quot;Por ranking&quot; responde uma pergunta diferente de &quot;Por critério&quot;: em vez de &quot;quais atendem a esta condição?&quot;,
          pergunta <strong className="font-medium text-foreground">&quot;quais são os N primeiros depois de ordenar a população por uma
          métrica?&quot;</strong>. Não é um node novo — é um segundo modo do mesmo &quot;Selecionar colaboradores&quot;, e continua produzindo uma
          Coleção de colaboradores (nunca um contexto novo).
        </p>
        <ExampleCard title="Exemplo">
          Equipe da Vanessa (20 colaboradores) → Selecionar colaboradores → Por ranking → 5 piores em Qualidade, pela Média, dos últimos 3 meses →
          resultado: os 5 colaboradores com a menor média de Qualidade no período, entre os que têm dados → Aplicar individualmente → 5 execuções.
        </ExampleCard>
        <p>
          O ranking é 100% determinístico: resolve o valor de cada candidato com o MESMO resolvedor que uma Condition histórica já usa (mesmo
          indicador, mesma agregação, mesmo período dão o mesmo número nos dois lugares), depois ordena e corta em N. Zero chamada de IA.
        </p>
        <h3 className="pt-2 font-heading text-lg font-semibold">Fontes, agregação e período</h3>
        <ul className="list-inside list-disc space-y-2 text-sm text-foreground/90">
          <li><strong className="font-medium text-foreground">Fontes</strong>: Valor do indicador, Atingimento do indicador ou Atingimento do PRV — as mesmas três de uma Condition histórica.</li>
          <li><strong className="font-medium text-foreground">Agregação</strong>: para Valor do indicador, a compatível com o método do indicador (Média ponderada pelo volume, Média simples, Soma, Último valor, Mínimo, Máximo); para Atingimento/PRV, Média, Mínimo ou Máximo — nunca Quantidade de ocorrências (ranking de performance é sobre o VALOR, não sobre quantas medições existem).</li>
          <li><strong className="font-medium text-foreground">Período</strong>: a mesma infraestrutura de sempre (Últimos X dias/semanas/meses, Este/Último mês, trimestre, etc.) — nenhum calendário novo.</li>
        </ul>
      </WikiSection>

      <WikiSection id="value" title="Ranquear por Valor (VALUE)" eyebrow="O valor agregado do período">
        <p>Ordena pelo valor agregado do período e corta em N. Exemplos:</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ExampleCard title="Piores TMA">Valor do indicador TMA, Média, últimos 30 dias, 5 piores — como TMA é &quot;menor é melhor&quot;, são os 5 MAIORES valores.</ExampleCard>
          <ExampleCard title="Melhores Qualidade">Valor do indicador Qualidade, Média, mês anterior, 3 melhores — os 3 maiores valores.</ExampleCard>
          <ExampleCard title="Maior PRV">Atingimento do PRV, Média, últimos 3 fechamentos, 1 melhor — o maior atingimento.</ExampleCard>
        </div>
      </WikiSection>

      <WikiSection id="melhores-piores" title="“Melhores”/“Piores” ≠ “Maiores”/“Menores”" eyebrow="Direção do indicador">
        <p>Estes quatro conceitos NÃO são sinônimos, e o sistema nunca finge que são:</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ExampleCard title="Maiores valores / Menores valores — matemático">
            Ordem crescente/decrescente pura pelo número, sem nenhum julgamento de negócio. Sempre disponível, qualquer indicador.
          </ExampleCard>
          <ExampleCard title="Melhores / Piores — desempenho">
            Depende da direção OFICIAL do indicador (a mesma que aparece em Indicadores — <WikiLink href="/wiki/indicadores#direcao">Direção desejada</WikiLink>).
            Qualidade: maior é melhor, então &quot;5 piores&quot; = 5 menores valores. TMA (menor é melhor): &quot;5 piores&quot; = 5 MAIORES valores.
          </ExampleCard>
        </div>
        <WarningCallout title="Sem direção oficial, sem Melhores/Piores">
          Quando o indicador está configurado com meta por faixa/alvo (TARGET, sem um único &quot;maior é melhor&quot; ou &quot;menor é
          melhor&quot;), &quot;Melhores&quot;/&quot;Piores&quot; simplesmente não aparece como opção pra ele — nunca inventamos uma direção. Use
          Maiores/Menores valores nesse caso. Atingimento do indicador e Atingimento do PRV sempre têm Melhores/Piores disponível (maior
          percentual de atingimento é sempre melhor, por definição).
        </WarningCallout>
      </WikiSection>

      <WikiSection id="change" title="Ranquear por Evolução (CHANGE)" eyebrow="Janela atual vs período anterior">
        <p>
          Além de &quot;Valor&quot;, &quot;Ranquear por&quot; oferece <strong className="font-medium text-foreground">Evolução</strong>: ranqueia pela
          VARIAÇÃO entre o período atual e o período IMEDIATAMENTE anterior equivalente (nunca dois seletores de data independentes — &quot;Últimos
          30 dias&quot; compara sempre contra os 30 dias imediatamente anteriores; &quot;Este mês&quot; contra o mês anterior; etc.). Reaproveita
          exatamente a mesma infraestrutura de &quot;Comparar com período anterior&quot; que a Condition histórica já usa — a mesma fórmula
          ((atual − anterior) / anterior), a mesma política de Sem Dados quando o período anterior é zero.
        </p>
        <ExampleCard title="Exemplo">
          Equipe da Vanessa → Selecionar colaboradores → Por ranking → Evolução → Qualidade, Média, últimos 30 dias vs 30 dias anteriores →
          Selecionar 2 maiores quedas → resultado: os 2 colaboradores cuja performance mais PIOROU no período.
        </ExampleCard>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ExampleCard title="Maiores evoluções — só quem melhorou de verdade">
            Filtra por evolução de performance &gt; 0 (melhorou), ordena da maior melhora pra menor. Se TODOS pioraram, o resultado é uma coleção
            vazia — nunca seleciona &quot;quem piorou menos&quot; fingindo que é evolução.
          </ExampleCard>
          <ExampleCard title="Maiores quedas — só quem piorou de verdade">
            Filtra por evolução de performance &lt; 0 (piorou), ordena da maior piora pra menor. Se TODOS melhoraram, o resultado é uma coleção
            vazia — nunca seleciona &quot;quem melhorou menos&quot; fingindo que é queda. Variação exatamente 0% não conta como evolução nem como
            queda.
          </ExampleCard>
        </div>
        <WarningCallout title="Evolução matemática ≠ evolução de performance (performanceChange)">
          Para um indicador &quot;menor é melhor&quot; (ex.: TMA), o número CAINDO é uma evolução, não uma queda — a mesma direção oficial que
          resolve Melhores/Piores em VALUE também inverte a interpretação aqui: a variação matemática é convertida numa variação de performance
          antes de ordenar. Atingimento do indicador e Atingimento do PRV são sempre &quot;maior é melhor&quot; (já normalizados). Indicadores com
          direção TARGET não têm Evolução/Queda disponível nesta versão — publicar fica bloqueado, com mensagem explicando o porquê. &quot;Últimos N
          fechamentos&quot; também não está disponível pra Evolução (não tem um período anterior equivalente resolvível corretamente) — a UI já
          não oferece essa opção nesse modo.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="partition" title="Separar ranking por Grupo/Subgrupo" eyebrow="Partition">
        <p>
          &quot;Separar ranking por&quot; funciona nos dois modos (Valor e Evolução) e reaproveita os mesmos conceitos de Grupo/Subgrupo já usados no
          resto do Workflow — nunca uma hierarquia nova. É diferente do Filtro Populacional: Filtro Populacional decide QUEM PARTICIPA; a separação
          decide COMO os participantes são divididos ANTES de ordenar. Opções: <strong className="font-medium text-foreground">Nenhum</strong>,{" "}
          <strong className="font-medium text-foreground">Grupo</strong> ou <strong className="font-medium text-foreground">Subgrupo</strong>.
        </p>
        <WarningCallout title="N é POR PARTIÇÃO, nunca total">
          &quot;2 piores&quot; sem separação seleciona até 2 no total. &quot;2 piores por Subgrupo&quot; com 4 Subgrupos seleciona até{" "}
          <strong className="font-medium text-foreground">8</strong> — 2 de cada balde, independentemente. O card do node e o resumo de configuração
          sempre deixam isso explícito (&quot;2 piores por Subgrupo&quot;, nunca só &quot;2 piores&quot;).
        </WarningCallout>
        <Card className="bg-muted/30">
          <CardContent className="space-y-1.5 pt-4 font-mono text-xs">
            <p className="text-foreground/90">Equipe Vanessa → Por ranking → Evolução → 2 maiores quedas em Qualidade → por Subgrupo</p>
            <p className="text-foreground/90">Subgrupo A: João -18%, Maria -12%</p>
            <p className="text-foreground/90">Subgrupo B: Pedro -21%, Ana -8%</p>
            <p className="text-foreground/90">Subgrupo C: Lucas -15%, Carla -10%</p>
            <p className="text-muted-foreground">→ 6 selecionados, 6 execuções em &quot;Aplicar individualmente&quot;</p>
          </CardContent>
        </Card>
        <p>
          Um Supervisor com colaboradores em mais de um Grupo/Subgrupo funciona normalmente — o ranking particiona a população real (nunca assume
          um único Grupo por Supervisor). Quem não tem Grupo/Subgrupo preenchido vira um balde explícito &quot;Sem grupo&quot;/&quot;Sem
          subgrupo&quot; — nunca descartado silenciosamente. Menos elegíveis do que N numa partição seleciona só os disponíveis (não é erro); uma
          partição sem nenhum dado tem 0 selecionados (também não é erro). O resultado fica congelado por partição no momento da seleção — se
          alguém trocar de Grupo depois, a execução já feita continua registrando o balde original.
        </p>
      </WikiSection>

      <WikiSection id="sem-dados" title="Sem dados, menos que N, empates" eyebrow="Casos de borda">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ExampleCard title="Sem dados fica fora">Colaborador sem medição válida no período nunca entra no ranking — nem como &quot;pior&quot; por omissão.</ExampleCard>
          <ExampleCard title="Menos que N com dados">Pediu 5, só 3 têm dados válidos → seleciona os 3. Não é erro; a UI mostra Solicitados=5, Com dados=3, Selecionados=3.</ExampleCard>
          <ExampleCard title="Empate tem desempate estável">
            Corte é sempre EXATO (Top 3 nunca vira 4 por empate). Em caso de empate no valor, o desempate usa o identificador do colaborador — o
            mesmo snapshot de dados sempre produz a mesma coleção.
          </ExampleCard>
        </div>
      </WikiSection>

      <WikiSection id="quartil" title="Quartil operacional no ranking" eyebrow="Q1/Q2/Q3/Q4 de uma janela e de uma população">
        <p>
          Além de Melhores/Piores e Maiores/Menores, &quot;Por ranking&quot; oferece <strong className="font-medium text-foreground">Quartil
          operacional</strong>: seleciona quem está num quartil (Q1 = melhor 25% … Q4 = pior 25%) calculado pela INIA sobre a população candidata,
          o indicador, a janela e a agregação escolhidos. Entram TODOS os colaboradores do quartil — não há N nesse modo. Com &quot;Separar ranking
          por&quot;, o quartil é calculado por partição.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ExampleCard title="Só Valor do indicador numa janela">Nunca sobre fechamentos (Atingimento/PRV já trazem o quartil oficial) e nunca com &quot;Últimos N fechamentos&quot; — precisa de dias, semana ou mês.</ExampleCard>
          <ExampleCard title="Regras">Direção oficial (LOWER: maior TMA é pior); SEM DADOS fica fora; empate = mesma posição; mínimo 4 com valor, senão ninguém é classificado; TARGET bloqueado.</ExampleCard>
          <ExampleCard title="Oficial × operacional">&quot;Q4 operacional — últimos 7 dias&quot; muda a cada janela. &quot;Q4 oficial de agosto&quot; é o fechamento: use &quot;Por critério: Quartil = Q4&quot; (com ou sem Recorrência).</ExampleCard>
        </div>
        <p>Detalhes em <WikiLink href="/wiki/indicadores#quartil-operacional">Indicadores › Quartil operacional</WikiLink>.</p>
      </WikiSection>

      <WikiSection id="qa-lab" title="No QA Lab" eyebrow="Explicabilidade sem IA">
        <p>
          Executar até &quot;Selecionar colaboradores&quot; mostra o ranking completo — zero requests de IA. Sem separação, a lista aparece achatada
          (Avaliados/Com dados/Sem dados/Solicitados/Selecionados + posição/valor de cada selecionado). Com separação, aparece uma seção por
          Grupo/Subgrupo, cada uma com sua própria contagem. Em Evolução, cada linha mostra anterior → atual e a evolução/queda em %, nunca só um
          número solto. Para Valor do indicador, cada linha traz a evidência do cálculo: janela, método, amostra, dias com dado e cobertura; no modo
          Quartil operacional, a posição e o quartil atribuído (ou o motivo de ninguém ser classificado). No modo Por critério, aparecem
          Avaliados/Selecionados/Não atenderam/Sem dados e os membros selecionados.
        </p>
      </WikiSection>

      <WikiSection id="fora-de-escopo" title="Fora de escopo nesta versão" eyebrow="Limitações reais">
        <p className="text-sm text-muted-foreground">
          Tendência/regressão linear, Top-N por score composto, ranking multi-indicador com pesos (o PRV já usa peso oficial por indicador
          internamente, mas o Workflow ainda não compõe rankings com ele), IA escolhendo o ranking, incluir todos os empatados na posição de corte,
          percentil/Top X%, ranking global fora da população do Workflow, separação por Supervisor/Coordenador/Gerente (só Grupo/Subgrupo),
          seleção por IA/ranking semântico, coleção de estruturas e coleções aninhadas.
        </p>
        <SeeAlso
          links={[
            { href: "/wiki/workflows/fan-out-fan-in", label: "Fan-out e Fan-in", hint: "o que vem depois da coleção" },
            { href: "/wiki/workflows/conditions", label: "Conditions", hint: "o mesmo resolvedor" },
            { href: "/wiki/estrutura#grupo-subgrupo", label: "Grupo × Subgrupo × hierarquia" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
