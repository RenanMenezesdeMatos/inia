import type { Metadata } from "next"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CapabilityBadge, ExampleCard, FieldRow, SeeAlso, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { DESIRED_DIRECTION_LABELS } from "@/schemas/admin/indicator-rule.schema"

export const metadata: Metadata = {
  title: "Indicadores e Performance",
  description: "Definição de indicador, direção desejada (HIGHER, LOWER, TARGET), valor × meta × atingimento, peso, PRV, quartil oficial, competência e o que a INIA calcula.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "definicao", label: "O que é um indicador" },
  { id: "direcao", label: "Direção desejada" },
  { id: "valor-meta-atingimento", label: "Valor × Meta × Atingimento" },
  { id: "competencia", label: "Competência e fechamento" },
  { id: "prv", label: "PRV" },
  { id: "peso", label: "Pesos" },
  { id: "quartil", label: "Quartil oficial" },
  { id: "referencia", label: "Dentro / abaixo da referência" },
  { id: "medicoes", label: "Medições × fechamentos" },
  { id: "medicoes-operacionais", label: "Medições operacionais (camada 1)" },
  { id: "agregacao", label: "Métodos de agregação" },
  { id: "quartil-operacional", label: "Quartil operacional" },
  { id: "calculado", label: "O que a INIA calcula" },
  { id: "configuracao", label: "Onde os indicadores são configurados" },
  { id: "limitacoes", label: "Limitações atuais" },
]

export default function IndicatorsPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="03 · Indicadores e Performance"
        title="Indicadores e Performance"
        lead="Tudo que a INIA mostra sobre performance parte de números oficiais fechados pela fonte corporativa: valor, meta, atingimento, peso, quartil e PRV por competência. A INIA lê, agrega e explica — nunca recalcula o que é oficial."
      >
        <div className="flex flex-wrap gap-2 pt-2">
          <CapabilityBadge label="PRV oficial persistido" />
          <CapabilityBadge label="Atingimento e quartil oficiais" />
          <CapabilityBadge label="Meta vigente por Grupo/Subgrupo" />
          <CapabilityBadge label="Consolidado por média simples" />
          <CapabilityBadge label="Medição operacional por janela" />
          <CapabilityBadge label="Quartil operacional" />
        </div>
      </WikiPageHeader>

      <WikiSection id="definicao" title="O que é um indicador" eyebrow="Definição">
        <p>
          Um <strong className="font-medium text-foreground">indicador</strong> é uma métrica oficial da operação — TMA, Qualidade, Aderência, Nota da
          Pesquisa na URA, FCR, Produtividade… Cada indicador tem código, nome, unidade e uma direção desejada. Indicadores pertencem ao
          Grupo/Subgrupo: cada um pode ter regras de cálculo, periodicidade de apuração e meta próprias.
        </p>
        <FieldRow label="Valor" value="O resultado na unidade do indicador (segundos, nota, percentual…)." />
        <FieldRow label="Meta" value="A referência vigente para aquele Grupo/Subgrupo naquela data." />
        <FieldRow label="Atingimento" value="Percentual oficial de cumprimento da meta (100% = na meta), já normalizado pela fonte." />
        <FieldRow label="Peso" value="Com quanto o indicador compõe o PRV do colaborador na competência." />
        <FieldRow label="Quartil" value="Posição oficial no fechamento: Q1 melhor → Q4 pior." />
      </WikiSection>

      <WikiSection id="direcao" title="Direção desejada" eyebrow="O que é 'melhor'">
        <WikiTable caption="Rótulos exatamente como aparecem no cadastro de Indicadores do Admin.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Direção</TableHead>
                <TableHead>Rótulo no produto</TableHead>
                <TableHead>Significa</TableHead>
                <TableHead>Exemplo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-mono text-xs">HIGHER</TableCell>
                <TableCell>{DESIRED_DIRECTION_LABELS.HIGHER}</TableCell>
                <TableCell>Quanto maior o valor, melhor.</TableCell>
                <TableCell>Qualidade, FCR, Aderência</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-mono text-xs">LOWER</TableCell>
                <TableCell>{DESIRED_DIRECTION_LABELS.LOWER}</TableCell>
                <TableCell>Quanto menor o valor, melhor.</TableCell>
                <TableCell>TMA, tempo de silêncio, rechamada</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-mono text-xs">TARGET</TableCell>
                <TableCell>{DESIRED_DIRECTION_LABELS.TARGET}</TableCell>
                <TableCell>Meta por faixa/alvo — não existe um único &quot;maior/menor é melhor&quot;.</TableCell>
                <TableCell>Ocupação dentro de uma faixa</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          A direção decide o que é <strong className="font-medium text-foreground">melhor/pior</strong> num ranking, o que é{" "}
          <strong className="font-medium text-foreground">evolução/queda</strong> numa comparação com o período anterior (para LOWER, o número
          caindo é evolução) e a regra de <strong className="font-medium text-foreground">dentro/abaixo da referência</strong> quando não há
          atingimento oficial. Indicadores TARGET não têm Melhores/Piores nem Evolução/Queda disponíveis — a INIA nunca inventa uma direção.
        </p>
      </WikiSection>

      <WikiSection id="valor-meta-atingimento" title="Valor × Meta × Atingimento" eyebrow="Três números diferentes">
        <Card className="bg-muted/30">
          <CardContent className="grid grid-cols-1 gap-3 pt-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase">Indicador</p>
              <p className="font-medium">TMA</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Valor</p>
              <p className="font-mono">480 s</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Meta</p>
              <p className="font-mono">500 s · Menor é melhor</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Atingimento</p>
              <p className="font-mono">valor oficial fornecido pela fonte (ex.: 104%)</p>
            </div>
          </CardContent>
        </Card>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Valor</strong> é o resultado bruto na unidade do indicador.</li>
          <li><strong className="font-medium text-foreground">Meta</strong> é a referência vigente. Ao comparar com a Meta vigente, cada colaborador resolve primeiro a meta do SEU Subgrupo; sem uma específica, cai para a meta do Grupo.</li>
          <li><strong className="font-medium text-foreground">Atingimento</strong> é o percentual oficial, já normalizado pela direção — a INIA não o deriva de valor ÷ meta. Se a fonte não entregou atingimento, a tela diz que não há.</li>
        </ul>
        <ExampleCard title="Meta por Subgrupo">
          João (Subgrupo A, meta Qualidade = 85) e Maria (Subgrupo B, meta Qualidade = 90) sob a mesma Condition &quot;Qualidade &lt; Meta&quot; — João
          compara com 85, Maria com 90. Numa estrutura consolidada que mistura Subgrupos com metas diferentes, a engine nunca escolhe uma
          arbitrariamente: a comparação com a Meta vira SEM DADOS (a comparação por Atingimento continua funcionando, porque já normaliza).
        </ExampleCard>
      </WikiSection>

      <WikiSection id="competencia" title="Competência e fechamento" eyebrow="Período">
        <p>
          A fonte oficial de performance fecha resultados <strong className="font-medium text-foreground">por mês</strong>: uma competência (ex.:
          Setembro 2026) é um fechamento com atingimento por indicador, peso, quartil e PRV. Indicadores e Equipe trabalham por competência, e um
          único seletor governa todos os cards da tela. A tela abre na competência mais recente com dado oficial; meses sem fechamento aparecem
          como lacuna, nunca como zero.
        </p>
        <p>
          &quot;Últimos N fechamentos&quot; em Conditions e rankings conta competências <strong className="font-medium text-foreground">realmente
          persistidas</strong> — nunca aproxima por dias. Não existe fechamento semanal em nenhuma origem hoje.
        </p>
      </WikiSection>

      <WikiSection id="prv" title="PRV" eyebrow="Resultado oficial persistido">
        <WarningCallout title="A INIA NÃO recalcula o PRV oficial">
          O PRV (Programa de Remuneração Variável) exibido é exatamente o valor fechado pela fonte oficial do programa, com o seu próprio quartil. A
          INIA não calcula, não estima e não recompõe o PRV — se a competência ainda não foi fechada, a tela diz &quot;Não há dados de PRV para esta
          competência&quot;. Médias sobre PRVs já persistidos (ex.: numa Condition &quot;PRV médio dos últimos 3 fechamentos&quot;) são operações
          legítimas de leitura; a fórmula oficial nunca é reexecutada a partir dos pesos.
        </WarningCallout>
        <FieldRow label="Só por colaborador" value="PRV existe oficialmente por colaborador. Supervisor e acima não têm PRV — mostram atingimento consolidado (ver a área Indicadores)." />
        <FieldRow label="Variação" value="Entre competências é mostrada em pontos percentuais (p.p.): sair de 96% para 98% é +2 p.p., não +2%." />
      </WikiSection>

      <WikiSection id="peso" title="Pesos" eyebrow="weight_percent">
        <p>
          Cada indicador tem, na competência, um <strong className="font-medium text-foreground">peso</strong> oficial com que compõe o PRV. A INIA
          usa o peso para <strong className="font-medium text-foreground">explicar a composição</strong> (&quot;o que mais pesa para recuperar o
          atingimento&quot;), para auditoria e como contexto para o Especialista de PRV — mas isso não significa que ela deva recalcular o PRV: os
          pesos não são somados nem recompostos pela INIA.
        </p>
      </WikiSection>

      <WikiSection id="quartil" title="Quartil oficial" eyebrow="Q1 melhor · Q4 pior">
        <p>
          O quartil oficial vem do fechamento da fonte corporativa, por indicador e para o PRV: <strong className="font-medium text-foreground">Q1 é o
          melhor</strong>, <strong className="font-medium text-foreground">Q4 o pior</strong>. A INIA lê o quartil gravado; nunca o calcula a partir
          dos valores. Em Conditions, &quot;Quartil = Q4 em 3 dos últimos 3 fechamentos&quot; conta quantos snapshots mensais já persistidos têm aquele
          quartil — menos snapshots do que os N pedidos vira SEM DADOS, nunca uma contagem parcial.
        </p>
      </WikiSection>

      <WikiSection id="referencia" title="Dentro / abaixo da referência" eyebrow="Uma regra só">
        <p>
          <strong className="font-medium text-foreground">Dentro da referência</strong> = atingimento oficial de 100% ou mais. Só quando não há
          atingimento oficial a INIA compara valor com meta respeitando a direção do indicador. É a mesma regra em Indicadores, Equipe e insights —
          nunca duas definições.
        </p>
      </WikiSection>

      <WikiSection id="medicoes" title="Medições × fechamentos" eyebrow="Duas fontes, dois usos">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead></TableHead>
                <TableHead>Medição (bruta)</TableHead>
                <TableHead>Fechamento (oficial)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">O que é</TableCell>
                <TableCell>O valor de um indicador para um colaborador num intervalo (dia, mês, hora, interação), com granularidade e componentes de agregação — a camada operacional.</TableCell>
                <TableCell>Resultado mensal por competência: atingimento, peso, quartil, PRV.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Quem usa</TableCell>
                <TableCell>Trigger de Indicador (chegou uma medição), Conditions históricas (contar/agregar em janela móvel ou calendário), rankings por Valor.</TableCell>
                <TableCell>Área Indicadores, Equipe, Conditions de Atingimento/PRV/Quartil, rankings por Atingimento, Especialistas de Performance/PRV.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Período</TableCell>
                <TableCell>Últimos N dias, dia/semana/mês/bimestre/trimestre/quadrimestre/semestre corrente ou anterior, últimos N meses fechados (calendário civil).</TableCell>
                <TableCell>Competência mais recente ou últimos N fechamentos (competências reais).</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          Detalhes de janelas e agregações em <WikiLink href="/wiki/workflows/conditions#historico">Conditions › Histórico</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="medicoes-operacionais" title="Medições operacionais (camada 1)" eyebrow="Medição operacional ≠ fechamento oficial">
        <WarningCallout kind="tip" title="Duas camadas que nunca se misturam">
          <strong>Camada 1 — medição operacional</strong>: o valor de um indicador para um colaborador num intervalo (dia, mês, hora, interação ou
          personalizado), com granularidade declarada e componentes de agregação (numerador, denominador, amostra). É o que Conditions e rankings
          agregam numa janela — &quot;TMA dos últimos 7 dias&quot;. <strong>Camada 2 — fechamento oficial</strong>: atingimento, peso, quartil e
          PRV por competência mensal, recebidos prontos — &quot;atingimento de TMA de agosto&quot;. Nada da camada 1 produz atingimento, PRV,
          quartil oficial ou peso.
        </WarningCallout>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="TMA últimos 7 dias = medição operacional agregada">Σ segundos ÷ Σ contatos dos dias 09/09 a 15/09, calculado pela INIA na hora, pela janela e pelo método do indicador.</ExampleCard>
          <ExampleCard title="Atingimento de TMA de agosto = fechamento oficial">O percentual fechado pela fonte corporativa para a competência 2026-08 — lido, nunca recalculado.</ExampleCard>
        </div>
        <p>
          Granularidade, componentes, quais indicadores suportam medição diária, janelas temporais e a evidência do cálculo estão na página
          dedicada <WikiLink href="/wiki/indicadores/medicao-operacional">Medição operacional × Fechamento oficial</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="agregacao" title="Métodos de agregação" eyebrow="Por que indicadores agregam diferente">
        <p>
          Cada indicador declara como vários períodos se combinam numa janela — nunca inferido do nome ou da unidade:{" "}
          <strong className="font-medium text-foreground">Média ponderada</strong> (Σ total ÷ Σ volume — TMA, notas por respostas/avaliações),{" "}
          <strong className="font-medium text-foreground">Taxa</strong> (Σ ocorrências ÷ Σ elegíveis — FCR, Aderência),{" "}
          <strong className="font-medium text-foreground">Média simples</strong>, <strong className="font-medium text-foreground">Soma</strong> e{" "}
          <strong className="font-medium text-foreground">Último valor</strong> (snapshot — Backlog). É essa semântica que impede &quot;TMA da
          semana&quot; virar média dos TMAs diários ignorando volumes. O editor só oferece as agregações compatíveis e a publicação rejeita o resto;
          Atingimento e PRV (camada 2) continuam só com Média, Mínimo e Máximo. Tabela completa em{" "}
          <WikiLink href="/wiki/indicadores/medicao-operacional#agregacao">Agregação por semântica</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="quartil-operacional" title="Quartil operacional" eyebrow="“Q4 operacional — últimos 7 dias” ≠ “Q4 oficial de agosto”">
        <p>
          O <strong className="font-medium text-foreground">quartil operacional</strong> é calculado pela INIA sobre valores operacionais de UMA
          população, UM indicador, UMA janela e UMA agregação — usado em &quot;Selecionar colaboradores › Por ranking › Quartil operacional&quot;.
          Q1 = melhor 25% … Q4 = pior 25% pela direção oficial do indicador; empate = mesma posição; SEM DADOS fica fora (nunca vira Q4 por
          omissão); população mínima de 4 com valor; indicadores TARGET não têm quartil operacional. É um conceito explicitamente distinto do
          quartil oficial do fechamento, que a INIA nunca recalcula. Regras e exemplos em{" "}
          <WikiLink href="/wiki/indicadores/medicao-operacional#quartil">Quartil operacional × quartil oficial</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="calculado" title="O que a INIA calcula" eyebrow="Por regra, reproduzível">
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Atingimento consolidado</strong> de uma estrutura: média aritmética simples dos atingimentos oficiais de todos os pares colaborador × indicador — sem peso; SEM DADOS fica fora.</li>
          <li><strong className="font-medium text-foreground">Situação do colaborador</strong> (sem dados / abaixo da referência / em evolução / dentro da referência) e tendência.</li>
          <li><strong className="font-medium text-foreground">Insights</strong> de tela (pontos positivos e de atenção) a partir dos dados oficiais — zero IA ao abrir a tela.</li>
          <li><strong className="font-medium text-foreground">Medições operacionais agregadas</strong> em janelas (Condition, ranking, contexto de Agent) pelo método do indicador, e o <strong className="font-medium text-foreground">quartil operacional</strong> de uma população numa janela.</li>
          <li><strong className="font-medium text-foreground">Variação</strong> entre competências (p.p.) e entre períodos (valor ou percentual).</li>
        </ul>
      </WikiSection>

      <WikiSection id="configuracao" title="Onde os indicadores são configurados" eyebrow="Admin › Indicadores">
        <p>
          Em <strong className="font-medium text-foreground">Admin › Indicadores</strong>: &quot;Novo indicador&quot; pede Código, Unidade, Nome e Direção
          desejada. Cada indicador tem abas <strong className="font-medium text-foreground">Regras de cálculo</strong> (por Grupo/Subgrupo:
          Periodicidade de apuração, Como o indicador é calculado neste grupo, Regra de atingimento opcional) e{" "}
          <strong className="font-medium text-foreground">Glossário</strong> (Descrição, Como interpretar, Boas práticas associadas, Orientação para o
          feedback) — o glossário alimenta os Agents de feedback de indicador. As <strong className="font-medium text-foreground">metas</strong> com
          vigência por Grupo/Subgrupo e os fechamentos oficiais vêm do cadastro corporativo — não são editados dentro da INIA.
        </p>
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="O que ainda não existe">
        <ul className="list-inside list-disc space-y-1">
          <li>A área Indicadores do perfil mostra só fechamentos oficiais (camada 2) — as medições operacionais aparecem em Conditions, rankings e no QA Lab, não como gráfico diário no perfil.</li>
          <li>Medição diária por colaborador só para os indicadores marcados como suportados; quartil operacional exige população mínima de 4 e não existe para indicadores TARGET.</li>
          <li>Não existe PRV oficial de estrutura — por isso a área fala sempre em &quot;atingimento consolidado&quot;; se o programa definir uma consolidação ponderada oficial, ela substituirá a média simples.</li>
          <li>Fechamento é só mensal — nenhuma origem tem competência semanal.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/indicadores/analytics", label: "A área Indicadores", hint: "o que operador e liderança veem" },
            { href: "/wiki/workflows/conditions", label: "Conditions", hint: "fontes, períodos e SEM DADOS" },
            { href: "/wiki/workflows/ranking", label: "Ranking", hint: "Melhores/Piores dependem da direção" },
            { href: "/wiki/glossario", label: "Glossário" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
