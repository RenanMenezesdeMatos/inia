import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SeeAlso, StepList, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Domínios de negócio",
  description: "Catálogo administrável das áreas de conhecimento que classificam Agents especialistas e restringem o roteamento de Orchestrators. Domínio ≠ Grupo, ≠ Base de Conhecimento, ≠ Agent. Novo domínio é configuração, não desenvolvimento.",
}

const TOC: WikiTocEntry[] = [
  { id: "definicao", label: "O que é um domínio de negócio" },
  { id: "nao-e", label: "O que NÃO é" },
  { id: "tipo-vs-dominio", label: "Tipo de especialidade × Domínio" },
  { id: "catalogo", label: "O catálogo (tela Domínios de negócio)" },
  { id: "novo-dominio", label: "Novo domínio sem desenvolvimento" },
  { id: "exemplo-logistica", label: "Exemplo: Logística" },
  { id: "inativo", label: "Domínio inativo" },
  { id: "dependencias", label: "Dependências, código e exclusão" },
  { id: "limitacoes", label: "Limitações atuais" },
]

const CURRENT_EXAMPLES = [
  { code: "FATURAMENTO", name: "Faturamento" },
  { code: "RETENCAO", name: "Retenção e Cancelamento" },
  { code: "SUPORTE", name: "Suporte Técnico" },
  { code: "CADASTRO", name: "Cadastro e Titularidade" },
]

export default function BusinessDomainsWikiPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="06 · Agents"
        title="Domínios de negócio"
        lead="Domínio de negócio é uma área de conhecimento usada para classificar Agents especialistas e restringir o roteamento de Orchestrators. É um catálogo administrável: a lista é dado, não código."
      />

      <WikiSection id="definicao" title="O que é um domínio de negócio" eyebrow="Área de conhecimento / processo">
        <p>
          Um domínio responde <em>em qual assunto de negócio</em> um especialista atua — Faturamento, Retenção e Cancelamento, Suporte Técnico,
          Cadastro e Titularidade são os exemplos que existem hoje. Cada domínio tem um <strong className="font-medium text-foreground">Código</strong>{" "}
          estável (letras maiúsculas, números e <code>_</code>, ex.: <code>LOGISTICA</code>), um <strong className="font-medium text-foreground">Nome</strong> de
          apresentação (pode mudar sem quebrar nada), uma <strong className="font-medium text-foreground">Descrição</strong> curta e um{" "}
          <strong className="font-medium text-foreground">Status</strong> (Ativo/Inativo).
        </p>
        <WikiFlow steps={[{ label: "Domínio de negócio", tone: "core" }, { label: "Agent · Especialista de domínio", tone: "ai" }, { label: "Bases de Conhecimento do Agent", tone: "input" }]} compact />
      </WikiSection>

      <WikiSection id="nao-e" title="O que NÃO é" eyebrow="Três confusões comuns">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conceito</TableHead>
                <TableHead>O que é</TableHead>
                <TableHead>Exemplo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">Domínio de negócio</TableCell>
                <TableCell>Área de conhecimento / processo. Classifica o que o Agent sabe.</TableCell>
                <TableCell>Retenção e Cancelamento</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">Grupo</TableCell>
                <TableCell>
                  Posição na <WikiLink href="/wiki/estrutura">estrutura organizacional</WikiLink> (quem atende, sob qual gestão). Um domínio pode ser usado por Agents que atendem
                  estruturas diferentes; um Grupo nunca vira domínio automaticamente.
                </TableCell>
                <TableCell>Grupo &quot;Retenção Varejo&quot; (uma posição na estrutura)</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">Base de Conhecimento</TableCell>
                <TableCell>
                  Fonte autorizada que um <em>Agent</em> consulta. A relação é Domínio → Agent → Bases; a base não é ligada ao domínio diretamente.
                </TableCell>
                <TableCell>Política de Retenção e Descontos</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">Agent</TableCell>
                <TableCell>Especialista de IA. Um domínio pode ter um Agent — ou vários (Troca de Titularidade, Troca de Gestor, Alteração Cadastral dentro de Cadastro).</TableCell>
                <TableCell>Especialista de Cadastro e Titularidade</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="tipo-vs-dominio" title="Tipo de especialidade × Domínio" eyebrow="Duas perguntas diferentes">
        <p>
          No Agent, <strong className="font-medium text-foreground">Tipo de especialidade</strong> responde <em>que tipo de especialista este Agent é</em>{" "}
          (<WikiLink href="/wiki/agents#especialidade">Especialista de domínio, transversal, Performance ou Síntese</WikiLink>). &quot;Especialista de domínio&quot;
          não é &quot;Faturamento&quot;: é só o tipo. O campo <strong className="font-medium text-foreground">Domínio de negócio</strong>, que aparece
          apenas para esse tipo, responde <em>qual</em> assunto — escolhido no catálogo. Transversal, Performance e Síntese não têm domínio.
        </p>
        <p>
          No Orchestrator, &quot;Domínios específicos&quot; recebe 1 ou vários domínios do mesmo catálogo: um especialista de domínio só entra se o seu domínio
          estiver na lista; transversais entram se forem adicionados; performance e síntese nunca entram. &quot;Qualquer assunto autorizado&quot; não usa domínio
          — a lista explícita de especialistas é a autorização (é o caso do chat/voz). A regra vale no servidor ao salvar (422), não só na tela.
        </p>
      </WikiSection>

      <WikiSection id="catalogo" title="O catálogo (tela Domínios de negócio)" eyebrow="Administração → Atendimento com IA → Agentes → Domínios de negócio">
        <p>
          A lista mostra Domínio, Código, quantos Agents e quantos Orchestrators usam cada um, Status e Ações (ativar/desativar, editar, excluir). Há busca por
          nome ou código e filtro Ativos / Inativos / Todos. &quot;Novo domínio&quot; pede Nome, Código (sugerido a partir do nome), Descrição e Status. Ao abrir
          um domínio, &quot;Utilizado por&quot; lista os Agents e Orchestrators vinculados.
        </p>
        <WikiTable caption="Domínios que existem hoje no catálogo demo — exemplos, não um limite: a lista é administrável.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Nome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CURRENT_EXAMPLES.map((domain) => (
                <TableRow key={domain.code}>
                  <TableCell className="font-mono text-xs">{domain.code}</TableCell>
                  <TableCell>{domain.name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="novo-dominio" title="Novo domínio sem desenvolvimento" eyebrow="Configuração, não código">
        <p>
          A plataforma conhece só os <em>tipos</em> (Especialista de domínio, transversal, Performance, Síntese; Domínios específicos, Qualquer assunto). Os
          domínios concretos são registros. Criar Logística, Cobrança, Backoffice, Fidelização ou Portabilidade não exige migration, enum, alteração de
          código nem deploy: o domínio novo aparece automaticamente no seletor do Agent e do Orchestrator.
        </p>
        <WarningCallout kind="tip" title="Backend é a autoridade">
          O formulário só filtra; quem valida é o servidor: domínio inexistente, domínio desativado em configuração nova ou especialista fora da fronteira do
          Orchestrator são recusados com o motivo — nunca ignorados em silêncio.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="exemplo-logistica" title="Exemplo: Logística" eyebrow="Do catálogo ao Orchestrator, sem código novo">
        <StepList
          steps={[
            { title: "Criar o domínio", detail: <>Domínios de negócio → Novo domínio: Nome &quot;Logística&quot;, Código <code>LOGISTICA</code>, Descrição &quot;Processos relacionados a logística, rastreamento e entrega.&quot;</> },
            { title: "Criar o Agent", detail: <>Agentes → Novo agente: Tipo de especialidade &quot;Especialista de domínio&quot;, Domínio de negócio &quot;Logística&quot; (já aparece no select), bases de conhecimento do assunto.</> },
            { title: "Criar o Orchestrator", detail: <>Orquestrador da INIA → Novo: &quot;Domínios específicos&quot; com Logística marcado. O Agent de Logística entra; um especialista de Faturamento aparece desabilitado com o motivo — até que Faturamento também seja marcado.</> },
            { title: "Conferir dependências", detail: <>De volta ao domínio: 1 Agent, 1 Orchestrator. Excluir fica bloqueado; desativar continua possível.</> },
          ]}
        />
      </WikiSection>

      <WikiSection id="inativo" title="Domínio inativo" eyebrow="Não usar em novas configurações">
        <p>
          Desativar um domínio significa &quot;não oferecer em novas configurações&quot;: ele some do seletor de Agents novos e de domínios novos num Orchestrator.
          Não significa desligar o que existe — Agents e Orchestrators que já o referenciam continuam válidos, abrindo e salvando, com o rótulo
          &quot;(desativado)&quot; ao lado do nome. Reativar devolve o domínio aos seletores.
        </p>
      </WikiSection>

      <WikiSection id="dependencias" title="Dependências, código e exclusão" eyebrow="Proteções aplicadas pelo servidor">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Nome, Descrição e Status são sempre editáveis.</li>
          <li>Código é protegido quando há dependências (&quot;Este código já é utilizado por Agents ou Orchestrators.&quot;); sem dependências, pode ser alterado.</li>
          <li>Excluir só com zero dependências — com Agents ou Orchestrators vinculados a resposta é um bloqueio, nunca exclusão em cascata.</li>
          <li>Código único por organização; formato validado na criação (2 a 40 caracteres, começando por letra).</li>
          <li>Criar, editar, ativar, desativar e excluir ficam registrados na trilha de auditoria administrativa.</li>
        </ul>
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="O que ainda não existe">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Sem cor, ícone, prompt, hierarquia entre domínios ou ordenação manual — o catálogo é deliberadamente enxuto.</li>
          <li>Bases de Conhecimento não são vinculadas ao domínio diretamente (só ao Agent).</li>
          <li>Os campos legados de código nos Agents e Orchestrators continuam gravados em paralelo por compatibilidade; serão removidos numa evolução futura.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/agents#especialidade", label: "Tipo de especialidade do Agent" },
            { href: "/wiki/orchestrators#roteamento", label: "Como o Orchestrator escolhe especialistas" },
            { href: "/wiki/estrutura", label: "Pessoas e Estrutura (Grupo ≠ domínio)" },
            { href: "/wiki/administracao", label: "Administração" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
