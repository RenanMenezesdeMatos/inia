import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FieldRow, SeeAlso, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Equipe / Estrutura (aba de gestão)",
  description: "Resumo por fatos, membros, dentro/abaixo da referência, evolução, sem dados, acompanhamentos aguardando ciência, revisões, drill-down e ficha do colaborador.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "resumo", label: "Resumo por fatos" },
  { id: "membros", label: "Membros e unidades" },
  { id: "situacao", label: "Situação do colaborador" },
  { id: "filtros", label: "Filtros e ordenação" },
  { id: "acompanhamentos-revisoes", label: "Acompanhamentos e revisões" },
  { id: "ficha", label: "Ficha do colaborador" },
  { id: "sem-dados", label: "Sem dados" },
]

export default function TeamPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="02 · Pessoas e Estrutura"
        title="Equipe / Estrutura"
        lead="A aba de gestão responde “onde preciso atuar?”: quem compõe a sua estrutura, a situação de cada um por fato, quem ainda não confirmou ciência e quais revisões aguardam a sua decisão. Chama-se Equipe para o Supervisor e Estrutura para os cargos acima."
      />

      <WikiSection id="resumo" title="Resumo por fatos" eyebrow="Topo da aba">
        <p>
          O topo resume, por fatos: <strong className="font-medium text-foreground">dentro da referência</strong>,{" "}
          <strong className="font-medium text-foreground">abaixo da referência</strong>, <strong className="font-medium text-foreground">em evolução</strong>,{" "}
          <strong className="font-medium text-foreground">sem dados</strong>, <strong className="font-medium text-foreground">feedbacks aguardando ciência do colaborador</strong> e{" "}
          <strong className="font-medium text-foreground">revisões aguardando a sua decisão</strong>. Cada número é um atalho: os quatro primeiros filtram a
          lista; &quot;aguardando ciência&quot; também; &quot;revisões&quot; abre a aba Pendências.
        </p>
      </WikiSection>

      <WikiSection id="membros" title="Membros e unidades" eyebrow="Por papel">
        <FieldRow label="Supervisor" value="Lista dos colaboradores da equipe direta: situação, PRV oficial, atingimento médio dos indicadores, tendência, indicadores em atenção e, por pessoa, quantos acompanhamentos ela tem, quantos ainda aguardam a ciência dela (clique abre o Acompanhamento dela já filtrado) e quantas revisões sobre ela aguardam você (clique abre Pendências)." />
        <FieldRow label="Gerente e acima" value="Primeiro as unidades subordinadas (o nível de gestão mais alto presente; quem não tem coordenador cai no próximo nível). Abrir uma unidade desce até chegar aos colaboradores. Operadores ligados diretamente à estrutura são listados à parte." />
        <WarningCallout title="Atingimento médio não é PRV" kind="tip">
          Na lista, &quot;atingimento médio&quot; é a média dos atingimentos oficiais dos indicadores do colaborador na competência — uma leitura rápida. O
          PRV é a coluna própria, lida da fonte oficial (ver <WikiLink href="/wiki/indicadores#prv">PRV</WikiLink>).
        </WarningCallout>
      </WikiSection>

      <WikiSection id="situacao" title="Situação do colaborador" eyebrow="Determinística, por fato">
        <p>Não existe uma classificação oficial de &quot;dentro do esperado&quot;; a INIA usa categorias por fato, com prioridade fixa e reproduzíveis a partir dos números mostrados:</p>
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Situação</TableHead>
                <TableHead>Quando</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Sem dados</TableCell>
                <TableCell>Nenhum dado oficial (indicador ou PRV) na competência.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Abaixo da referência</TableCell>
                <TableCell>Algum indicador com atingimento oficial abaixo de 100%, ou PRV no Q4.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Em evolução</TableCell>
                <TableCell>Atingimento médio subiu 5 p.p. ou mais em relação à competência anterior (e nada abaixo da referência).</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Dentro da referência</TableCell>
                <TableCell>Todos os indicadores com dado estão em 100% ou mais.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>A tendência (em alta, em queda, estável) é mostrada separadamente da situação — uma pessoa pode estar abaixo da referência e em alta ao mesmo tempo.</p>
      </WikiSection>

      <WikiSection id="filtros" title="Filtros e ordenação" eyebrow="Lista">
        <FieldRow label="Filtros" value="Busca por nome, Grupo, Subgrupo, situação, indicador em atenção e 'com pendências'." />
        <FieldRow label="Ordenação" value="Situação, nome, atingimento médio, PRV ou variação — com paginação." />
      </WikiSection>

      <WikiSection id="acompanhamentos-revisoes" title="Acompanhamentos e revisões" eyebrow="Contadores, não cópias">
        <p>
          Na Equipe e nos Indicadores aparecem só contadores e atalhos; os objetos vivem no <WikiLink href="/wiki/acompanhamento">Acompanhamento</WikiLink> e
          em <WikiLink href="/wiki/pendencias">Pendências</WikiLink> — não há uma segunda cópia. &quot;Pendente&quot; tem UMA definição (uma revisão humana
          aguardando você), usada pela lista, pelo badge da aba, pelo sino e pelos contadores da Equipe.
        </p>
      </WikiSection>

      <WikiSection id="ficha" title="Ficha do colaborador" eyebrow="A mesma em todo o produto">
        <p>
          Abrir um colaborador leva à mesma ficha em qualquer lugar do produto, com três abas: <strong className="font-medium text-foreground">Acompanhamentos</strong> (os feedbacks e
          monitorias publicados para ele), <strong className="font-medium text-foreground">Indicadores</strong> (a mesma visão de PRV e indicadores que o próprio
          colaborador vê) e <strong className="font-medium text-foreground">Visão geral</strong> (perfil, planos de ação, monitorias processadas e escalonamento). A
          trilha permite voltar à estrutura de onde você veio.
        </p>
      </WikiSection>

      <WikiSection id="sem-dados" title="Sem dados" eyebrow="Estado de primeira classe">
        <p>
          Uma competência sem fechamento, um indicador sem atingimento oficial ou um colaborador sem linhas aparecem como &quot;Sem dados&quot; — nunca como
          0%. Médias e históricos ignoram o que não existe em vez de contar como zero.
        </p>
        <SeeAlso
          links={[
            { href: "/wiki/indicadores/analytics", label: "A área Indicadores", hint: "consolidado, distribuição, agrupar por" },
            { href: "/wiki/acompanhamento#ciencia", label: "Ciência do colaborador" },
            { href: "/wiki/pendencias", label: "Pendências e Revisão humana" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
