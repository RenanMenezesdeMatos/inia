import type { Metadata } from "next"

import { Badge } from "@/components/ui/badge"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExampleCard, SeeAlso, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Conditions",
  description: "Regras determinísticas do Workflow: TRUE / FALSE / SEM DADOS, os modos (valor simples, E/OU, Indicador/PRV), as fontes reais (medição, atingimento, PRV, quartil), períodos, histórico e comparação com Meta ou período anterior.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "tres-saidas", label: "TRUE / FALSE / SEM DADOS" },
  { id: "modos", label: "Os modos de Condition" },
  { id: "fontes", label: "As fontes reais" },
  { id: "sem-dados", label: "SEM DADOS em profundidade" },
  { id: "historico", label: "Histórico: janelas × fechamentos" },
  { id: "periodos", label: "Períodos disponíveis" },
  { id: "comparar-com", label: "Comparar com: fixo, Meta ou período anterior" },
  { id: "meta-subgrupo", label: "Meta por Subgrupo" },
  { id: "prv-consolidado", label: "PRV em estrutura Consolidada" },
  { id: "recorrencia-quartil", label: "Recorrência de Quartil" },
  { id: "e-ou", label: "Condition E/OU" },
  { id: "qa-lab", label: "No QA Lab" },
]

export default function ConditionsPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="05 · Workflow Engine"
        title="Conditions"
        lead="Uma Condition é uma regra determinística — a Workflow Engine resolve sozinha se 2,84 < 3,3, se Q4 == Q4 ou se 78% < 80%, sem depender de Agent ou Orchestrator pra isso. “Comparar com” não é uma instrução pra IA: é a lógica que a própria Condition usa pra decidir Sim/Não/Sem dados."
      >
        <p className="max-w-2xl text-sm text-foreground/80">
          A IA só entra DEPOIS, se o branch Sim/Não chamar um Agent ou Orchestrator — aí sim ela pode receber o valor calculado, a regra e o
          resultado, e explicar o motivo. Não use IA para uma comparação numérica que uma Condition resolve.
        </p>
      </WikiPageHeader>

      <WikiSection id="tres-saidas" title="TRUE / FALSE / SEM DADOS" eyebrow="Três ramos, nunca dois">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ExampleCard title="TRUE (Sim)">A regra bateu. Ex.: média 2,8 &lt; 3,3.</ExampleCard>
          <ExampleCard title="FALSE (Não)">A regra não bateu. Ex.: média 4,2 &lt; 3,3.</ExampleCard>
          <ExampleCard title="SEM DADOS">Não há informação suficiente para decidir. Ex.: colaborador sem histórico no período. Não é 0 e não é FALSE.</ExampleCard>
        </div>
        <WarningCallout title="Sem Dados ≠ Não">
          Uma média sem nenhuma medição, um colaborador sem jornada válida na Agenda relativa, ou uma Recorrência de Quartil pedindo mais
          fechamentos do que o colaborador tem — nada disso vira automaticamente &quot;Não&quot;. Exemplo: média &lt; 3,3 — João (2,8) é Sim; Maria
          (4,2) é Não; Carlos, sem histórico, é Sem Dados. Isso vale igualmente pra ausência de PRV e histórico insuficiente. O ramo Sem dados só
          existe onde faz sentido: Quantidade de ocorrências nunca tem Sem dados (zero ocorrências é uma resposta válida, FALSE).
        </WarningCallout>
      </WikiSection>

      <WikiSection id="modos" title="Os modos de Condition" eyebrow="Um por node, nunca misturados">
        <Accordion type="single" collapsible className="rounded-lg border border-border px-4">
          <AccordionItem value="simples">
            <AccordionTrigger>Valor simples</AccordionTrigger>
            <AccordionContent>Compara o valor bruto do gatilho, um resultado de node anterior (ex.: um campo do resultado estruturado de um Orchestrator) ou uma variável, com um comparador (maior, menor, igual, contém…).</AccordionContent>
          </AccordionItem>
          <AccordionItem value="grupo">
            <AccordionTrigger>Grupo E/OU</AccordionTrigger>
            <AccordionContent>
              Combina várias regras simples com <span className="font-mono">Todas (E)</span> ou <span className="font-mono">Qualquer (OU)</span>. Real, mas com uma
              restrição: só compõe valores do contexto de execução (gatilho, node anterior, variável) — nunca Histórico ou Performance diretamente.
              Quando o Workflow real precisa de um OU entre duas consultas de performance, o desenho usa duas Conditions em sequência convergindo
              no mesmo próximo node.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="indicador">
            <AccordionTrigger>Indicador / PRV — &quot;O que deseja analisar?&quot;</AccordionTrigger>
            <AccordionContent className="space-y-2">
              <p>Depois de escolher esse modo, a UI pergunta o que exatamente analisar, cada um mostrando só os campos que fazem sentido:</p>
              <ul className="list-inside list-disc space-y-1">
                <li><strong className="font-medium text-foreground">Valor do indicador</strong> — as medições operacionais agregadas (Quantidade de ocorrências, Média ponderada pelo volume, Média simples, Soma, Último valor, Mínimo ou Máximo — conforme a semântica do indicador), numa janela móvel ou num período de calendário.</li>
                <li><strong className="font-medium text-foreground">Atingimento do indicador</strong> — o percentual de atingimento já normalizado, agregado no mesmo período (Média/Mínimo/Máximo — nunca Quantidade, atingimento não é contado por ocorrência).</li>
                <li><strong className="font-medium text-foreground">Atingimento consolidado do PRV</strong> — igual ao anterior, mas sobre o PRV (não depende de escolher um indicador).</li>
                <li><strong className="font-medium text-foreground">Quartil do indicador</strong> / <strong className="font-medium text-foreground">Quartil do PRV</strong> — o quartil mais recente (Q1 melhor → Q4 pior), ou, com Recorrência, quantos dos últimos N fechamentos bateram um quartil-alvo.</li>
              </ul>
              <p>Individual-only: em Workflow Consolidado, Quartil do indicador/PRV só aparece entre &quot;Aplicar individualmente&quot; e &quot;Consolidar resultados&quot;, onde há um colaborador como sujeito. Fora desse trecho, Valor/Atingimento continuam disponíveis, agregados sobre a estrutura inteira.</p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </WikiSection>

      <WikiSection id="fontes" title="As fontes reais" eyebrow="De onde vem o número">
        <WikiTable caption="Quartil operacional não é uma fonte de Condition — ele existe em “Selecionar colaboradores › Por ranking”. Numa Condition, quartil é sempre o oficial do fechamento.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fonte</TableHead>
                <TableHead>O que é</TableHead>
                <TableHead>Agregações</TableHead>
                <TableHead>Períodos</TableHead>
                <TableHead>Sem dados?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">Valor do indicador (MEASUREMENT)</TableCell>
                <TableCell>Medições operacionais do colaborador (ou da estrutura), agregadas na janela pelo método do indicador (camada 1).</TableCell>
                <TableCell>Quantidade de ocorrências (com filtro por valor), Média ponderada pelo volume, Média simples dos períodos, Soma, Último valor, Mínimo, Máximo — o editor só oferece as compatíveis com a semântica do indicador</TableCell>
                <TableCell>Janela móvel, calendário, últimos N meses fechados</TableCell>
                <TableCell>Sim (exceto Quantidade)</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">Atingimento do indicador (INDICATOR_ACHIEVEMENT)</TableCell>
                <TableCell>Atingimento oficial por competência.</TableCell>
                <TableCell>Média, Mínimo, Máximo</TableCell>
                <TableCell>Janela móvel, calendário, últimos N fechamentos</TableCell>
                <TableCell>Sim</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">Atingimento do PRV (PRV_ACHIEVEMENT)</TableCell>
                <TableCell>PRV oficial por competência.</TableCell>
                <TableCell>Média, Mínimo, Máximo</TableCell>
                <TableCell>Janela móvel, calendário, últimos N fechamentos</TableCell>
                <TableCell>Sim</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">Quartil operacional (OPERATIONAL_QUARTILE)</TableCell>
                <TableCell>Posição do colaborador entre a população do Workflow (Abrangência ∩ Filtro populacional, ou a coleção anterior) sobre medições de uma janela operacional — mesmo cálculo do Ranking por quartil (direção oficial, empates na mesma posição, mínimo de 4 com dados). Individual-only. Nunca é o quartil do fechamento.</TableCell>
                <TableCell>Média ponderada, Média, Soma, Último valor, Mínimo, Máximo (nunca Quantidade); comparação só &quot;É igual a&quot;/&quot;É diferente de&quot; + Q1..Q4</TableCell>
                <TableCell>Janela móvel ou calendário (nunca fechamentos)</TableCell>
                <TableCell>Sim — população &lt; 4, sem medição, abaixo da cobertura mínima ou indicador TARGET</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">Quartil do indicador / do PRV (oficial)</TableCell>
                <TableCell>Quartil gravado no fechamento mais recente, ou contagem de fechamentos num quartil-alvo (Recorrência).</TableCell>
                <TableCell>Mais recente, ou contagem em N fechamentos</TableCell>
                <TableCell>Fechamento mais recente ou últimos N (2 a 24)</TableCell>
                <TableCell>Sim</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">Valor do gatilho · resultado de node · variável</TableCell>
                <TableCell>O contexto da execução.</TableCell>
                <TableCell>—</TableCell>
                <TableCell>—</TableCell>
                <TableCell>Não</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          Conceitos de indicador, atingimento, PRV e quartil em <WikiLink href="/wiki/indicadores">Indicadores e Performance</WikiLink>; as
          semânticas de agregação (média ponderada, taxa, soma, último valor) em{" "}
          <WikiLink href="/wiki/indicadores#agregacao">Métodos de agregação</WikiLink>. A publicação rejeita uma agregação incompatível com o
          indicador (ex.: soma de TMA) e agregações operacionais sobre Atingimento/PRV (só Média/Mínimo/Máximo).
        </p>
      </WikiSection>

      <WikiSection id="sem-dados" title="SEM DADOS em profundidade" eyebrow="Ausência ou insuficiência">
        <ul className="list-inside list-disc space-y-1.5">
          <li>Média/Mínimo/Máximo sem nenhuma medição no período → Sem dados.</li>
          <li>&quot;Últimos N fechamentos&quot; com menos fechamentos do que N → Sem dados (nunca uma média parcial).</li>
          <li>&quot;Últimos N meses fechados&quot; com um mês sem medição suficiente → Sem dados (nunca substituído por um mês mais antigo).</li>
          <li>Comparar com Meta numa estrutura cujos membros têm metas diferentes → Sem dados (a engine nunca escolhe uma).</li>
          <li>Comparar com período anterior quando o período anterior é zero/inexistente → Sem dados.</li>
          <li>Recorrência de Quartil com menos snapshots do que os N pedidos → Sem dados.</li>
          <li>Cobertura mínima de dias configurada e cobertura abaixo dela (dias com medição ÷ dias úteis elegíveis desde a admissão) → Sem dados — nunca 0, nunca Q4. Ver <WikiLink href="/wiki/indicadores/medicao-operacional#cobertura">Cobertura mínima</WikiLink>.</li>
          <li>Quartil operacional com menos de 4 colaboradores com dados na população, colaborador sem medição na janela ou indicador sem direção HIGHER/LOWER → Sem dados.</li>
          <li>Colaborador sem jornada na Agenda relativa → nem é matriculado.</li>
        </ul>
        <p>Em &quot;Selecionar colaboradores&quot; e nos rankings, Sem dados fica fora da coleção e é contado separadamente — ver <WikiLink href="/wiki/workflows/ranking#sem-dados">Ranking › Sem dados</WikiLink>.</p>
      </WikiSection>

      <WikiSection id="historico" title="Histórico: janela móvel, calendário e fechamento" eyebrow="Sobre qual período">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Janela móvel</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">Os N dias de calendário terminando hoje, com hoje parcial (até 186 dias): &quot;últimos 7 dias&quot; em 15/09 = 09/09 00:00 → 15/09 agora. Uma medição entra se o intervalo dela sobrepõe a janela.</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Período de calendário</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">Dia, semana, mês, bimestre, trimestre, quadrimestre ou semestre civil — corrente/parcial (&quot;este mês&quot;, &quot;hoje&quot;) ou anterior completo (&quot;mês passado&quot;).</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Últimos N fechamentos</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Atingimento do indicador e Atingimento do PRV: conta linhas de competência (&quot;AAAA-MM&quot;) REALMENTE persistidas pela fonte,
              nunca aproxima por dias (Média/Mínimo/Máximo, nunca Quantidade de ocorrências).
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Últimos N meses fechados</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Valor do indicador (medição bruta): os N MESES DE CALENDÁRIO civis já encerrados imediatamente antes do mês corrente — nunca
              &quot;fechamentos&quot;, nome reservado pra Atingimento/PRV/Quartil.
            </CardContent>
          </Card>
        </div>
        <WarningCallout title="3 meses ≠ 90 dias — e 'meses fechados' ≠ 'meses com dado'">
          O período de calendário (ex.: Trimestre) continua sendo uma APROXIMAÇÃO por data — útil, mas não garante que existiram 3 fechamentos
          reais no meio do caminho. Pra Atingimento do indicador/PRV, &quot;Últimos N fechamentos&quot; resolve isso contando as linhas de
          competência já persistidas pela fonte — nunca inventadas. Pra Valor do indicador (medição bruta, sem competência própria na fonte), a
          semântica é diferente por definição — nunca chamada de &quot;fechamento&quot;:{" "}
          <strong className="font-medium text-foreground">&quot;Últimos N meses fechados&quot;</strong> são exatamente os N meses de calendário civis
          COMPLETOS imediatamente anteriores ao mês corrente — o mês corrente nunca entra, mesmo parcial, e os N meses são sempre CONSECUTIVOS. Se
          faltar medição suficiente num desses meses, o resultado é Sem Dados — a engine nunca busca um mês mais antigo pra completar a quantidade
          pedida, e nunca troca &quot;os últimos N meses&quot; por &quot;os últimos N meses que têm dado&quot;. Exemplo: hoje é 15/09, existem dados
          em Junho, Agosto e Setembro, mas Julho está vazio — pedindo os últimos 3 meses fechados (Junho/Julho/Agosto), o resultado é Sem Dados,
          nunca uma média calculada só com Junho e Agosto.
        </WarningCallout>
        <WarningCallout kind="tip" title="Fechamento semanal — limitação documentada, nunca inventado">
          Tanto &quot;Últimos N fechamentos&quot; quanto &quot;Últimos N meses fechados&quot; só existem com granularidade MENSAL. A fonte não tem
          competência semanal real hoje pra nenhuma origem (Atingimento/PRV são sempre mensais; Valor não tem competência nenhuma, só timestamps)
          — nunca inventamos uma só pra oferecer a opção.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="periodos" title="Períodos disponíveis" eyebrow="Só os reais">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead>Significado</TableHead>
                <TableHead>Disponível para</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Últimos N dias</TableCell>
                <TableCell>Janela móvel terminando agora, hoje parcial incluído (1 a 186 dias).</TableCell>
                <TableCell>Valor, Atingimento, PRV; ranking por Valor e Evolução</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Hoje · Esta semana · Este mês · Este bimestre · Este trimestre · Este quadrimestre · Este semestre</TableCell>
                <TableCell>Período de calendário corrente (parcial).</TableCell>
                <TableCell>Idem</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Ontem · Semana anterior · Mês anterior · Bimestre anterior · Trimestre anterior · Quadrimestre anterior · Semestre anterior</TableCell>
                <TableCell>Período de calendário anterior completo.</TableCell>
                <TableCell>Idem</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Últimos N fechamentos</TableCell>
                <TableCell>N competências mensais reais (2 a 24).</TableCell>
                <TableCell>Atingimento, PRV, Quartil com Recorrência — não disponível para Evolução no ranking</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Últimos N meses fechados</TableCell>
                <TableCell>N meses civis completos, consecutivos, antes do mês corrente.</TableCell>
                <TableCell>Valor do indicador</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          Para a fonte de dados agendada da IA (Chamar agente por agenda), as janelas são: Hoje, Ontem (D-1), Semana anterior, Mês anterior e
          Trimestre anterior — ou os últimos 1 a 3 fechamentos oficiais.
        </p>
      </WikiSection>

      <WikiSection id="comparar-com" title="Comparar com — Valor fixo, Meta ou Período anterior" eyebrow="Contra o quê">
        <p>
          Além de comparar contra um valor fixo digitado, uma Condition de Valor/Atingimento (Média/Mínimo/Máximo) pode comparar contra a{" "}
          <strong className="font-medium text-foreground">Meta vigente</strong> (consultada na hora, nunca digitada à mão) ou contra o{" "}
          <strong className="font-medium text-foreground">mesmo período anterior</strong> (nunca disponível junto de Últimos N fechamentos/meses
          fechados). Comparação com período anterior tem dois modos: <span className="font-mono text-xs">Valor</span> compara os dois números
          diretamente (maior/menor já respondem aumentou/diminuiu); <span className="font-mono text-xs">Variação percentual</span> compara a
          variação calculada — &quot;TMA aumentou pelo menos 10%&quot; nunca dispara por uma oscilação de 420s → 421s.
        </p>
        <p>
          Vínculo dinâmico com a Meta vigente só existe pra Média/Mínimo/Máximo — Quantidade de ocorrências continua com limiar fixo.
        </p>
      </WikiSection>

      <WikiSection id="meta-subgrupo" title="Meta por Subgrupo" eyebrow="Hierarquia real do indicador">
        <p>Indicadores pertencem ao Subgrupo/Grupo. Cada medição de performance recebida da fonte já vem com:</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">valor</Badge>
          <Badge variant="secondary">meta</Badge>
          <Badge variant="secondary">atingimento</Badge>
          <Badge variant="secondary">peso</Badge>
          <Badge variant="secondary">quartil (Q1 melhor → Q4 pior)</Badge>
        </div>
        <p>
          Cada Subgrupo pode ter sua própria meta, indicador a indicador. Ao comparar com a Meta vigente, cada colaborador resolve primeiro a meta
          do SEU Subgrupo; sem uma meta específica de Subgrupo, cai pra meta do Grupo (retrocompatibilidade — nenhum Workflow existente quebra).
          Numa estrutura Consolidada, a Condition só resolve um valor de meta quando <strong className="font-medium text-foreground">TODOS</strong> os
          membros concordam na mesma meta efetiva — se a estrutura mistura Subgrupos com metas diferentes, a engine nunca escolhe uma
          arbitrariamente, vira Sem Dados (a Condition baseada em Atingimento continua funcionando normalmente nesse caso, já que atingimento já
          normaliza a relação com a meta).
        </p>
        <Card className="bg-muted/30">
          <CardContent className="space-y-1.5 pt-4 font-mono text-xs">
            <p className="text-foreground/90">João (Subgrupo A, meta Qualidade = 85) · Maria (Subgrupo B, meta Qualidade = 90)</p>
            <p className="text-muted-foreground">Mesma Condition &quot;Qualidade &lt; Meta&quot; — João compara com 85, Maria com 90</p>
          </CardContent>
        </Card>
        <p>
          <strong className="font-medium text-foreground">A engine nunca calcula</strong> atingimento, peso, PRV ou quartil — só lê e agrega o que a
          fonte já entregou pronto (Média/Mínimo/Máximo sobre valores já persistidos são operações legítimas; a FÓRMULA oficial de PRV nunca é
          recalculada a partir dos pesos).
        </p>
      </WikiSection>

      <WikiSection id="prv-consolidado" title="Nomenclatura do PRV em estrutura Consolidada" eyebrow="Dois nomes, dois significados">
        <p>
          Em modo Individual, &quot;Atingimento consolidado do PRV&quot; é o PRV do PRÓPRIO colaborador — correto chamar de consolidado, já que o
          PRV em si já é uma consolidação dos indicadores dele. Numa estrutura (Consolidado), o rótulo vira{" "}
          <strong className="font-medium text-foreground">&quot;Atingimento do PRV da estrutura&quot;</strong> (mesmo padrão pra Atingimento do
          indicador) — deixa claro que é uma MÉDIA calculada pela engine sobre os PRVs individuais dos membros, nunca um PRV oficial da estrutura
          (que não existe na fonte hoje). Os dois nomes nunca devem ser confundidos.
        </p>
        <p>
          O que define é quem está sendo avaliado naquele ponto do fluxo, não o modo do Workflow. Em um Workflow Consolidado, uma Condition entre
          &quot;Aplicar individualmente&quot; e &quot;Consolidar resultados&quot; olha só a pessoa daquela execução: o rótulo e o cálculo são os do
          colaborador. O quartil operacional, nesse trecho, compara a pessoa com a coleção selecionada.
        </p>
      </WikiSection>

      <WikiSection id="recorrencia-quartil" title="Recorrência de Quartil — “Q4 em 3 dos últimos 3 fechamentos”" eyebrow="Contar, nunca calcular">
        <p>
          Além do fechamento mais recente, Quartil do indicador/PRV pode perguntar por uma janela de fechamentos: escolha quantos (2 a 24), qual
          quartil-alvo, e uma quantidade mínima/exata desses fechamentos que precisam bater o alvo. A engine{" "}
          <strong className="font-medium text-foreground">conta</strong> quantos dos últimos N snapshots mensais já persistidos têm aquele quartil —
          nunca infere ou recalcula quartil nenhum, só lê o que já está gravado. Menos snapshots no histórico do que os N pedidos vira Sem Dados,
          nunca uma contagem parcial disfarçada de resultado.
        </p>
      </WikiSection>

      <WikiSection id="e-ou" title="Condition E/OU — o que compõe e o que não" eyebrow="Limitação real">
        <p>
          Grupo E/OU só compõe valores do contexto de execução (gatilho, node anterior, variável) — nunca Histórico ou Performance diretamente.
          Para &quot;Q4 no indicador OU Q4 no PRV&quot;, o desenho usa duas Conditions em sequência convergindo no mesmo próximo node (é assim no
          Workflow operacional &quot;Q4 persistente&quot;).
        </p>
      </WikiSection>

      <WikiSection id="qa-lab" title="No QA Lab" eyebrow="Explicabilidade">
        <p>
          Cada Condition executada mostra, no passo a passo, o valor resolvido, a regra aplicada e o ramo escolhido — para Valor do indicador, também
          a janela (datas), o método (&quot;Σ 142.639 s ÷ Σ 287 contatos&quot;), a amostra, os dias com dado e a cobertura; com &quot;Meta resolvida&quot; e
          &quot;Origem da meta&quot; (Subgrupo ou Grupo) quando compara com a Meta, &quot;Período anterior&quot; e &quot;Variação&quot; quando
          compara com o período anterior, &quot;Fechamentos: N de M esperados&quot; e o motivo do Sem dados quando houver. Os seletores de teste
          têm uma &quot;Prévia por Condition&quot; para checar o resultado antes de executar. Tudo isso sem gastar IA.
        </p>
        <SeeAlso
          links={[
            { href: "/wiki/indicadores", label: "Indicadores e Performance", hint: "valor, meta, atingimento, PRV, quartil" },
            { href: "/wiki/workflows/ranking", label: "Ranking", hint: "usa o MESMO resolvedor das Conditions" },
            { href: "/wiki/qa-lab#trace", label: "Trace do QA Lab" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
