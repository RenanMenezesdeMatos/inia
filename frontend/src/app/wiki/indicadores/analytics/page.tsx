import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExampleCard, FieldRow, SeeAlso, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "A área Indicadores (analytics)",
  description: "Operador: PRV oficial, composição, indicadores, histórico e insights. Liderança: atingimento consolidado, distribuição por quartil, agrupar por, drill-down e tendências. Zero IA ao abrir a tela.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "operador", label: "Operador: PRV e indicadores" },
  { id: "consolidado", label: "Liderança: atingimento consolidado" },
  { id: "distribuicao", label: "Distribuição por quartil" },
  { id: "detalhe-indicador", label: "Detalhe do indicador" },
  { id: "agrupar-por", label: "Agrupar por" },
  { id: "drill-down", label: "Drill-down e trilha" },
  { id: "insights", label: "Análise da INIA (insights)" },
  { id: "sem-dados", label: "Sem dados" },
]

export default function AnalyticsPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="03 · Indicadores e Performance"
        title="A área Indicadores"
        lead="A aba Indicadores responde “como estou indo?” — para o operador, o próprio PRV e indicadores; para a liderança, a estrutura consolidada. É uma área de consulta: nada é gerado ao abrir a tela."
      >
        <WarningCallout title="Zero IA em page load">
          Abrir Indicadores ou Equipe nunca aciona a inteligência artificial. Todas as análises são fatos calculados a partir dos dados oficiais ou
          conteúdos já publicados anteriormente por Workflows.
        </WarningCallout>
      </WikiPageHeader>

      <WikiSection id="operador" title="Operador: PRV e indicadores" eyebrow="Visão pessoal">
        <FieldRow label="Topo" value="Meu PRV, meta (100%), quartil oficial (Q1 = melhor), variação em p.p. em relação à competência anterior e tendência." />
        <FieldRow label="Composição" value="Os indicadores com peso oficial na competência, com o peso e o atingimento de cada um — serve para explicar o valor; os pesos não são somados nem recalculados." />
        <FieldRow label="Histórico" value="Últimas seis competências, mês a mês, com a linha da meta em 100%. Meses sem fechamento aparecem como lacuna, nunca como zero." />
        <FieldRow label="Indicadores" value="Um card por indicador com o que existir na competência: resultado na unidade, meta vigente, atingimento oficial, peso no PRV, quartil, variação e tendência. Indicadores abaixo da referência aparecem primeiro." />
        <FieldRow label="Insights" value="Pontos positivos e de atenção por indicador e para o PRV, mais a Análise da INIA já publicada (feedback de indicador), quando existe." />
      </WikiSection>

      <WikiSection id="consolidado" title="Liderança: atingimento consolidado" eyebrow="Supervisor e acima">
        <p>Supervisores e cargos acima <strong className="font-medium text-foreground">não têm PRV individual</strong> nesta área; o topo mostra o atingimento consolidado da estrutura.</p>
        <ExampleCard title="Como é calculado">
          Média aritmética simples dos atingimentos oficiais de todos os pares colaborador × indicador da estrutura na competência. Sem peso de
          PRV. Colaboradores ou indicadores sem dado ficam fora da média — nunca contam como zero. Por indicador, o consolidado é a média dos
          atingimentos dos colaboradores naquele indicador. Nunca se misturam valores brutos de unidades diferentes (segundos, notas, percentuais):
          só o atingimento normalizado entra em qualquer média.
        </ExampleCard>
        <p>O mesmo método vale para todos os níveis — o que muda é o conjunto de pessoas: equipe direta do supervisor, ou toda a estrutura abaixo de um coordenador, gerente, gerente sênior ou diretor.</p>
      </WikiSection>

      <WikiSection id="distribuicao" title="Distribuição por quartil" eyebrow="Supervisor e acima">
        <p>O topo mostra quantas pessoas da estrutura estão em cada quartil de PRV oficial (Q1 é o melhor), além de quantas estão sem dado. No detalhe de cada indicador, a mesma distribuição aparece para o quartil daquele indicador.</p>
      </WikiSection>

      <WikiSection id="detalhe-indicador" title="Detalhe do indicador" eyebrow="Painel lateral">
        <p>Abrir um indicador mostra um painel lateral, sem sair da tela: atingimento, resultado, meta, peso, quartil, competência anterior, histórico mensal, pontos positivos e de atenção e — quando existir — a análise da INIA já publicada para aquele indicador.</p>
        <p>Para estruturas, o painel traz também os colaboradores naquele indicador, com busca, ordenação e paginação, e o acesso direto à ficha de cada um.</p>
      </WikiSection>

      <WikiSection id="agrupar-por" title="Agrupar por" eyebrow="Coordenador e acima">
        <p>O controle <strong className="font-medium text-foreground">Agrupar por</strong> reparte a estrutura pelos cargos estritamente abaixo do seu na cadeia, mais Grupo e Subgrupo — as opções derivam da ordem real da hierarquia:</p>
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Papel</TableHead>
                <TableHead>Opções</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Supervisor</TableCell>
                <TableCell>— (a equipe já são os operadores)</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Coordenador</TableCell>
                <TableCell>Supervisor, Grupo, Subgrupo</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Gerente</TableCell>
                <TableCell>Coordenador, Supervisor, Grupo, Subgrupo</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Gerente Sênior</TableCell>
                <TableCell>Gerente, Coordenador, Supervisor, Grupo, Subgrupo</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Diretor</TableCell>
                <TableCell>Gerente Sênior, Gerente, Coordenador, Supervisor, Grupo, Subgrupo</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>Cada grupo mostra pessoas, atingimento consolidado, variação, quantos estão em atenção, em evolução e sem dados, e os indicadores com menor atingimento. Quem não está sob nenhuma unidade da dimensão escolhida aparece em um grupo &quot;Sem …&quot; — ninguém some nem é contado duas vezes.</p>
      </WikiSection>

      <WikiSection id="drill-down" title="Drill-down e trilha" eyebrow="Navegação">
        <p>De qualquer grupo é possível &quot;Analisar&quot; a estrutura dele, descendo nível a nível até o colaborador. A trilha no topo mostra de quem são os números e permite voltar por qualquer nível. Período (competência), estrutura, indicador aberto e agrupamento ficam no endereço da página. Ver <WikiLink href="/wiki/estrutura#drill-down">Pessoas e Estrutura › Drill-down</WikiLink>.</p>
      </WikiSection>

      <WikiSection id="insights" title="Análise da INIA (insights)" eyebrow="Fatos + conteúdo já publicado">
        <p>
          Cada indicador, o PRV e a estrutura trazem pontos positivos e pontos de atenção gerados{" "}
          <strong className="font-medium text-foreground">somente a partir dos dados oficiais</strong>: acima/abaixo da meta, quartil, evolução ou queda
          relevante (5 p.p. ou mais), sequências de competências acima ou abaixo de 100%, colaboradores sem dado. A linguagem é descritiva, nunca
          disciplinar.
        </p>
        <p>
          Quando já existe uma análise da INIA publicada para aquele indicador (um feedback de indicador gerado por um Workflow e publicado no
          Acompanhamento), ela aparece como &quot;Análise da INIA&quot;, com a data em que foi publicada. Insights de tela são, portanto,{" "}
          <strong className="font-medium text-foreground">determinísticos</strong> e/ou <strong className="font-medium text-foreground">derivados de
          conteúdo já publicado</strong> — nunca uma chamada de IA por carregamento.
        </p>
      </WikiSection>

      <WikiSection id="sem-dados" title="Sem dados" eyebrow="Estado de primeira classe">
        <p>Uma competência sem fechamento, um indicador sem atingimento oficial ou um colaborador sem linhas aparecem como &quot;Sem dados&quot; — nunca como 0%. Médias e históricos ignoram o que não existe em vez de contar como zero.</p>
        <SeeAlso
          links={[
            { href: "/wiki/indicadores", label: "Indicadores e Performance", hint: "conceitos: valor, meta, atingimento, PRV, quartil" },
            { href: "/wiki/estrutura/equipe", label: "Equipe / Estrutura", hint: "situação por fato e ficha do colaborador" },
            { href: "/wiki/introducao/papeis", label: "Papéis", hint: "o que cada perfil vê" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
