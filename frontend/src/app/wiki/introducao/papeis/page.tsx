import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExampleCard, SeeAlso, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { WIKI_ROLES, WIKI_ROLE_ORDER } from "@/components/wiki/wiki-reference"

export const metadata: Metadata = {
  title: "Papéis e o que cada um vê",
  description: "Operador, Supervisor, Coordenador, Gerente, Gerente Sênior, Diretor e Administrador — o princípio de escopo e as abas de cada perfil.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Princípio" },
  { id: "papeis", label: "Os sete papéis" },
  { id: "abas", label: "As abas do perfil" },
  { id: "admin", label: "Administrador e escopo administrativo" },
]

export default function RolesPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="01 · Introdução"
        title="Papéis e o que cada um vê"
        lead="Cada perfil enxerga apenas o escopo permitido pela estrutura organizacional e pelas capacidades calculadas no backend. Não existe uma tela por cargo: a mesma tela atende todos, mudando o sujeito analisado e as permissões."
      >
        <WarningCallout kind="tip" title="Capabilities vêm do backend, nunca de um 'if cargo' na tela">
          O backend calcula, a cada consulta, o que aquele papel pode ver sobre aquele sujeito (modo pessoal ou estrutura, PRV, consolidado,
          distribuição, membros, drill-down, opções de agrupamento, abas). O frontend só lê essas flags — por isso esta página explica o
          princípio, não uma matriz gigante que ficaria desatualizada.
        </WarningCallout>
      </WikiPageHeader>

      <WikiSection id="papeis" title="Os sete papéis" eyebrow="Conceitualmente">
        <WikiTable caption="Rótulos exatamente como aparecem no produto. A aba de pessoas chama-se “Equipe” para o Supervisor (lidera operadores diretamente) e “Estrutura” acima disso.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Papel</TableHead>
                <TableHead>O que enxerga</TableHead>
                <TableHead>Aba de pessoas</TableHead>
                <TableHead>Aba Pendências</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {WIKI_ROLE_ORDER.map((role) => {
                const doc = WIKI_ROLES[role]
                return (
                  <TableRow key={role}>
                    <TableCell className="font-medium whitespace-nowrap">{doc.label}</TableCell>
                    <TableCell>{doc.sees}</TableCell>
                    <TableCell className="whitespace-nowrap">{doc.peopleTab ?? "—"}</TableCell>
                    <TableCell>{doc.pendingTab}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          A cadeia hierárquica real é Operador → Supervisor → (Coordenador) → Gerente → Gerente Sênior → Diretor; o Coordenador existe em
          algumas estruturas e não em outras — ver <WikiLink href="/wiki/estrutura">Pessoas e Estrutura</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="abas" title="As abas do perfil" eyebrow="Um shell para todos">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ExampleCard title="Acompanhamento">“Tenho algo para ler.” O que a INIA e a gestão entregam: feedbacks, monitorias, resultados de Workflow, escalonamentos.</ExampleCard>
          <ExampleCard title="Indicadores">“Como estou indo?” PRV oficial (operador) ou atingimento consolidado (estrutura), histórico, distribuição, pontos de atenção.</ExampleCard>
          <ExampleCard title="Equipe / Estrutura">“Onde preciso atuar?” Pessoas, unidades, situação, ciência e revisões — só para quem lidera.</ExampleCard>
          <ExampleCard title="Pendências">“Tenho algo para decidir.” Revisões humanas endereçadas a você. Um Operador só vê a aba enquanto tiver uma pendência.</ExampleCard>
        </div>
        <p>
          Fora das abas, o <strong className="font-medium text-foreground">sino</strong> avisa que algo novo aconteceu e leva ao lugar certo.
          Indicadores e Equipe são áreas de consulta — não recebem conteúdo gerado; ele sempre chega pelo Acompanhamento.
        </p>
      </WikiSection>

      <WikiSection id="admin" title="Administrador e escopo administrativo" eyebrow="Quem configura">
        <p>
          Acesso à Administração vem de <strong className="font-medium text-foreground">papéis</strong> atribuídos à conta — nunca do cargo ou do nível
          hierárquico. Um Supervisor sem papel não administra nada; uma Assistente com o papel QA de feedback revisa feedbacks do escopo dela. O{" "}
          <strong className="font-medium text-foreground">Administrador geral</strong> tem todas as permissões na organização inteira (e é o único com o
          QA Lab); o <strong className="font-medium text-foreground">Administrador</strong> pode ser da organização ou{" "}
          <strong className="font-medium text-foreground">restrito a um Grupo/Subgrupo</strong> — aí só vê, edita e publica Bases, Agents, Orchestrators
          e Workflows dentro do escopo, e a opção &quot;Todos os grupos&quot; não aparece; o{" "}
          <strong className="font-medium text-foreground">Administrador de acessos</strong> cuida só de contas e papéis; o{" "}
          <strong className="font-medium text-foreground">Administrador de dados</strong> abre só a{" "}
          <WikiLink href="/wiki/central-de-dados#configurar-com-senha">Central de Dados</WikiLink>, na organização inteira, e só o Administrador geral concede esse papel.
          Ver Indicadores e Equipe, os
          Dados da estrutura e o Calendário da equipe de outras pessoas também são permissões: estão no Administrador geral (organização) e no
          Administrador (no escopo dele); o Administrador de acessos, o Administrador de dados e o QA de feedback não as recebem. O que alguém administra não depende do Grupo a
          que pertence: para administrar vários Grupos, a conta recebe o papel uma vez para cada Grupo (ver{" "}
          <WikiLink href="/wiki/administracao#usuarios">Usuários e acessos</WikiLink>).
        </p>
        <SeeAlso
          links={[
            { href: "/wiki/seguranca", label: "Segurança e Escopo", hint: "o backend valida organização, hierarquia, escopo e capability" },
            { href: "/wiki/estrutura", label: "Pessoas e Estrutura", hint: "hierarquia com e sem Coordenador" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
