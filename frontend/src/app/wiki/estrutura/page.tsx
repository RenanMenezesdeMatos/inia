import type { Metadata } from "next"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExampleCard, SeeAlso, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Pessoas e Estrutura",
  description: "Colaborador, quem reporta a quem, Grupo e Subgrupo, cadeia hierárquica com e sem Coordenador, drill-down e escopo organizacional.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "colaborador", label: "Colaborador e quem reporta a quem" },
  { id: "hierarquia", label: "A cadeia hierárquica" },
  { id: "com-sem-coordenador", label: "Com e sem Coordenador" },
  { id: "grupo-subgrupo", label: "Grupo × Subgrupo × hierarquia" },
  { id: "escopo", label: "Escopo organizacional" },
  { id: "estruturas", label: "As sete estruturas (âncoras)" },
  { id: "drill-down", label: "Drill-down e trilha" },
  { id: "inativos", label: "Inativos e não operadores" },
  { id: "massa-demo", label: "Ambiente de demonstração" },
]

export default function StructurePage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="02 · Pessoas e Estrutura"
        title="Pessoas e Estrutura"
        lead="A INIA lê a estrutura real da operação — quem reporta a quem, Grupo e Subgrupo de cada colaborador — e deriva daí escopo, agrupamentos, destinatários e elegibilidade. Nada disso é configurado à mão dentro da INIA: vem do cadastro corporativo."
      />

      <WikiSection id="colaborador" title="Colaborador e quem reporta a quem" eyebrow="Fatos de cadastro">
        <p>Cada pessoa cadastrada tem, no mínimo:</p>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Nível hierárquico</strong> — Operador, Supervisor, Coordenador, Gerente, Gerente Sênior, Diretor ou Fora da hierarquia. É a posição na cadeia; não concede acesso nenhum (acesso vem dos papéis da conta — ver <WikiLink href="/wiki/seguranca">Segurança e Escopo</WikiLink>).</li>
          <li><strong className="font-medium text-foreground">A quem reporta</strong> — a pessoa imediatamente acima na cadeia. É a única definição de &quot;quem está acima de quem&quot;.</li>
          <li><strong className="font-medium text-foreground">Grupo</strong> e, opcionalmente, <strong className="font-medium text-foreground">Subgrupo</strong> — unidades organizacionais (ex.: FATURAS, RETENÇÃO B2C).</li>
          <li><strong className="font-medium text-foreground">Ativo/inativo</strong> — inativos nunca entram em Workflows nem em destinatários.</li>
          <li>Jornada prevista (horário de entrada e carga horária), quando cadastrada — usada só pela Agenda relativa ao expediente.</li>
        </ul>
      </WikiSection>

      <WikiSection id="hierarquia" title="A cadeia hierárquica" eyebrow="Do topo à base">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">Estrutura completa (com Coordenador)</p>
            <WikiFlow compact steps={[{ label: "Diretor", tone: "people" }, { label: "Gerente Sênior", tone: "people" }, { label: "Gerente", tone: "people" }, { label: "Coordenador", tone: "people" }, { label: "Supervisor", tone: "people" }, { label: "Operador", tone: "neutral" }]} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Estrutura sem Coordenador</p>
            <WikiFlow compact steps={[{ label: "Diretor", tone: "people" }, { label: "Gerente Sênior", tone: "people" }, { label: "Gerente", tone: "people" }, { label: "Supervisor", tone: "people" }, { label: "Operador", tone: "neutral" }]} />
          </div>
        </div>
        <p>
          A ordem real é <span className="font-mono text-xs">Diretor → Gerente Sênior → Gerente → Coordenador → Supervisor → Operador</span>. As
          opções de &quot;Agrupar por&quot;, o rótulo da aba (Equipe × Estrutura), o sujeito padrão de cada papel e a checagem de escopo derivam
          dessa ordem — nunca de listas por cargo espalhadas pelas telas.
        </p>
      </WikiSection>

      <WikiSection id="com-sem-coordenador" title="Com e sem Coordenador" eyebrow="Duas formas reais">
        <p>
          O Coordenador é um elo <strong className="font-medium text-foreground">opcional</strong> entre Gerente e Supervisor. Algumas gerências
          têm Coordenadores; outras têm Supervisores reportando direto ao Gerente. A INIA trata as duas formas sem configuração extra:
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>Na aba Estrutura, o Gerente vê primeiro &quot;o nível de gestão mais alto presente&quot; — Coordenadores onde existem; onde não, os Supervisores.</li>
          <li>Num Workflow, um destinatário &quot;Coordenador&quot; numa estrutura sem Coordenador não resolve para ninguém (NOT_FOUND) — nunca cai silenciosamente para o Gerente.</li>
          <li>Em &quot;Agrupar por&quot;, quem não está sob nenhuma unidade da dimensão escolhida aparece em um grupo &quot;Sem …&quot; — ninguém some nem é contado duas vezes.</li>
        </ul>
      </WikiSection>

      <WikiSection id="grupo-subgrupo" title="Grupo × Subgrupo × hierarquia" eyebrow="Não são a mesma coisa">
        <WarningCallout title="Grupo/Subgrupo não é a cadeia hierárquica">
          Grupo e Subgrupo são atributos do colaborador (unidade organizacional). A cadeia hierárquica é quem reporta a quem. Um Supervisor pode ter
          colaboradores em mais de um Grupo/Subgrupo; um Grupo pode ter operadores de vários Supervisores e até de dois Gerentes diferentes. A INIA
          nunca assume um único Grupo por Supervisor nem um único responsável por Grupo.
        </WarningCallout>
        <WikiTable caption="Onde cada conceito manda.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Área</TableHead>
                <TableHead>Grupo / Subgrupo</TableHead>
                <TableHead>Cadeia hierárquica</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Analytics</TableCell>
                <TableCell>Dimensão de &quot;Agrupar por&quot; e filtro de membros.</TableCell>
                <TableCell>Escopo (a subárvore de quem olha) e os níveis de drill-down.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Ranking</TableCell>
                <TableCell>&quot;Separar ranking por Grupo/Subgrupo&quot; — N é por partição; quem não tem vira &quot;Sem grupo/subgrupo&quot;.</TableCell>
                <TableCell>A população vem da estrutura (Equipe de Supervisor, estrutura de Gerente…).</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Workflow</TableCell>
                <TableCell>Abrangência (em quais grupos atua), metas por Subgrupo, Estrutura Consolidada ancorada em Grupo/Subgrupo.</TableCell>
                <TableCell>Estrutura Consolidada ancorada em pessoa (Equipe de Supervisor, estrutura de Coordenador/Gerente/Gerente Sênior/Diretor); Filtro Populacional.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Destinatários</TableCell>
                <TableCell>Grupo/Subgrupo não têm &quot;dono&quot;: o destinatário de gestão são os ancestrais dos operadores membros — se houver mais de um, é ambíguo.</TableCell>
                <TableCell>Sobe a cadeia do operador (individual) ou resolve pela âncora da estrutura (consolidado).</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Escopo administrativo</TableCell>
                <TableCell>Um admin pode ser restrito a Grupos/Subgrupos específicos.</TableCell>
                <TableCell>Um gestor enxerga só a própria subárvore.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="escopo" title="Escopo organizacional" eyebrow="Quem vê o quê">
        <p>
          Cada pessoa enxerga somente a si mesma e a estrutura abaixo dela na hierarquia. Um supervisor não abre a equipe de outro supervisor; um
          gerente não vê a estrutura de outro gerente nem a do diretor. Grupos e subgrupos só aparecem no recorte que pertence à sua estrutura. O
          escopo é resolvido pelo backend a cada consulta contra a subárvore real — o sujeito pedido pelo navegador nunca é confiado. Tentar abrir
          uma estrutura fora do seu escopo resulta em &quot;Sem acesso a esta estrutura&quot;.
        </p>
        <p>
          Além da própria estrutura, só amplia a visão um <strong className="font-medium text-foreground">papel de acesso</strong> com a permissão da tela
          e o escopo dela: “Ver Indicadores e Equipe do escopo” numa organização, Grupo ou Subgrupo mostra exatamente essas pessoas — um Administrador
          do Subgrupo Contas não vê Cobrança. O nível hierárquico “Fora da hierarquia” (o antigo “Admin”) não amplia nada por si.
        </p>
      </WikiSection>

      <WikiSection id="estruturas" title="As sete estruturas (âncoras)" eyebrow="Usadas por Analytics e Workflow">
        <p>Uma &quot;estrutura&quot; é sempre uma destas sete âncoras — as mesmas em Indicadores, Equipe/Estrutura e no Workflow Engine:</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            ["Equipe de Supervisor", "os operadores que reportam ao Supervisor"],
            ["Estrutura de Coordenador", "toda a subárvore abaixo do Coordenador"],
            ["Estrutura de Gerente", "toda a subárvore abaixo do Gerente"],
            ["Estrutura de Gerente Sênior", "toda a subárvore abaixo do Gerente Sênior"],
            ["Estrutura de Diretor", "toda a subárvore abaixo do Diretor"],
            ["Grupo", "os operadores com aquele Grupo"],
            ["Subgrupo", "os operadores com aquele Subgrupo"],
          ].map(([name, meaning]) => (
            <Card key={name} className="bg-muted/30">
              <CardContent className="pt-4 text-sm">
                <p className="font-medium text-foreground">{name}</p>
                <p className="text-muted-foreground">{meaning}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <ExampleCard title="Âncora em pessoa × âncora em Grupo">
          Estruturas ancoradas em pessoa têm um responsável natural (a própria âncora) — por isso os modelos consolidados de Workflow que entregam
          &quot;ao Gerente&quot; ou &quot;ao Diretor&quot; são ancorados em pessoa. Grupo/Subgrupo não têm responsável: o destinatário é resolvido pela
          hierarquia real dos membros e precisa ser inequívoco.
        </ExampleCard>
      </WikiSection>

      <WikiSection id="drill-down" title="Drill-down e trilha" eyebrow="Navegação">
        <p>
          De qualquer grupo é possível &quot;Analisar&quot; a estrutura dele, descendo nível a nível: Diretoria → Gerência Sênior → Gerência →
          Coordenação → Supervisão → colaborador. A trilha no topo mostra sempre de quem são os números e permite voltar por qualquer nível.
          Período (competência), estrutura, indicador aberto e agrupamento ficam no endereço da página — dá para compartilhar o link ou usar o botão
          &quot;voltar&quot;. Abrir um colaborador leva à mesma ficha em qualquer lugar do produto (ver{" "}
          <WikiLink href="/wiki/estrutura/equipe#ficha">Ficha do colaborador</WikiLink>).
        </p>
      </WikiSection>

      <WikiSection id="inativos" title="Inativos e não operadores" eyebrow="Regra real">
        <ul className="list-inside list-disc space-y-1">
          <li>Só pessoas com papel <strong className="font-medium text-foreground">Operador</strong> e <strong className="font-medium text-foreground">ativas</strong> são elegíveis para um Workflow (por Flag, Indicador, Agenda ou Manual) — inativos e cargos de gestão nunca são matriculados.</li>
          <li>A população de uma estrutura (Equipe, Grupo, Subgrupo…) é sempre o conjunto de operadores ativos dela.</li>
          <li>Destinatários de gestão consideram pessoas ativas; um cargo sem ninguém ativo é NOT_FOUND.</li>
          <li>Colaborador sem jornada cadastrada nunca é matriculado por Agenda relativa ao expediente — sem horário inventado.</li>
        </ul>
      </WikiSection>

      <WikiSection id="massa-demo" title="Ambiente de demonstração" eyebrow="Para desenvolvimento">
        <p>
          Existe uma massa demonstrativa determinística para desenvolvimento e QA — uma estrutura completa (Diretor → Gerentes Sêniores → Gerentes
          com e sem Coordenador → Supervisores → Operadores), Grupos e Subgrupos com metas, seis competências de fechamentos oficiais e milhares de
          interações com transcrição e flags. Ela só entra por comando explícito em ambiente de desenvolvimento e nunca em produção. Credenciais e
          detalhes ficam na documentação interna de desenvolvimento — não nesta Wiki.
        </p>
        <SeeAlso
          links={[
            { href: "/wiki/estrutura/equipe", label: "Equipe / Estrutura (aba de gestão)" },
            { href: "/wiki/estrutura/minha-estrutura", label: "Organograma (aba do perfil)" },
            { href: "/wiki/indicadores/analytics#agrupar-por", label: "Agrupar por e drill-down em Indicadores" },
            { href: "/wiki/workflows/outputs#destinatarios", label: "Resolução de destinatários" },
            { href: "/wiki/seguranca#escopo", label: "Escopo e validação no backend" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
