import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CapabilityBadge, ExampleCard, FieldRow, SeeAlso, StepList, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { READ_ONLY_LABEL } from "@/schemas/admin/argument-script.schema"

export const metadata: Metadata = {
  title: "Alcance por vários Grupos",
  description: "Publicações, Alinhamentos, Argumentários, Bases, Agentes, Orquestradores, Workflows, Indicadores e Produtos num cadastro só para vários Grupos e Subgrupos: o seletor com busca, só Grupos e Subgrupos com operadores em produção, “Todos” explícito, universo e produto, quem administra um conteúdo compartilhado e a precedência entre alinhamentos e Orquestradores.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Um conteúdo, vários Grupos" },
  { id: "exemplo", label: "Exemplo-guia" },
  { id: "como-escolher", label: "Como escolher o alcance" },
  { id: "em-producao", label: "Só Grupos com operadores em produção" },
  { id: "global", label: "Escopo global é outra escolha" },
  { id: "por-cima", label: "Universo, produto e permissões" },
  { id: "por-conteudo", label: "Em cada tela" },
  { id: "quem-administra", label: "Quem administra um conteúdo compartilhado" },
  { id: "alinhamentos", label: "Alinhamentos que se cruzam" },
  { id: "orquestradores", label: "Orquestradores que se cruzam" },
  { id: "listas", label: "Listas, filtros e contagens" },
  { id: "limitacoes", label: "Limitações atuais" },
]

/** As telas que usam o mesmo seletor de alcance — rótulos copiados das telas. */
const SCREENS: { area: string; menu: string; field: string; global: string; when: string; href: string }[] = [
  {
    area: "Base de conhecimento",
    menu: "Atendimento com IA › Agentes › Base de conhecimento",
    field: "Alcance por grupo",
    global: "Todos os grupos",
    when: "Na criação, vale ao publicar. Na edição, incluir ou tirar um Grupo fica no rascunho e vale quando ele for publicado.",
    href: "/wiki/bases-conhecimento#campos",
  },
  {
    area: "Comunicado (Público específico)",
    menu: "Comunicação › Publicações",
    field: "Grupos (depois do Universo de atuação)",
    global: "“Todo o universo X” (com o universo escolhido). Para todos os universos, o público “Toda a empresa”.",
    when: "Antes de sair. Depois que o comunicado sai, o público não muda.",
    href: "/wiki/acompanhamento#comunicados",
  },
  {
    area: "Alinhamento operacional",
    menu: "Atendimento com IA › Alinhamentos operacionais",
    field: "Público",
    global: "Todo o universo (do alinhamento)",
    when: "Na versão: publicada, não muda mais; alterar cria uma nova versão.",
    href: "#alinhamentos",
  },
  {
    area: "Argumentário",
    menu: "Atendimento com IA › Argumentários",
    field: "Escopo",
    global: "Todos os grupos",
    when: "Na versão: mudar os Grupos vai para o rascunho e vale a partir da publicação.",
    href: "/wiki/administracao#areas",
  },
  {
    area: "Agente",
    menu: "Atendimento com IA › Agentes",
    field: "Alcance",
    global: "Todos os Grupos e Subgrupos (do universo do agente)",
    when: "Vai para o rascunho do agente e vale ao publicar a versão.",
    href: "/wiki/agents",
  },
  {
    area: "Orquestrador",
    menu: "Atendimento com IA › Orquestradores",
    field: "Alcance",
    global: "Todos os Grupos e Subgrupos (do universo do Orquestrador)",
    when: "Vale ao publicar a versão. Mesmo Grupo ou Subgrupo que outro Orquestrador ativo do chat = recusado.",
    href: "#orquestradores",
  },
  {
    area: "Workflow",
    menu: "Automação › Workflows",
    field: "Abrangência",
    global: "Todos os Grupos e Subgrupos (do universo do Workflow)",
    when: "Fica no rascunho e só vale ao Publicar, como o resto da configuração.",
    href: "/wiki/workflows",
  },
  {
    area: "Indicador",
    menu: "Dados › Indicadores",
    field: "Alcance",
    global: "Todos os Grupos e Subgrupos (do universo do indicador)",
    when: "Na hora. Vale só na Administração (listas, filtros e seleção); não muda cálculo, meta nem feedback.",
    href: "/wiki/indicadores",
  },
  {
    area: "Produto",
    menu: "Atendimento com IA › Produtos",
    field: "Alcance",
    global: "Todos os Grupos e Subgrupos (do universo do produto)",
    when: "Na hora. Vale só na Administração; o universo do produto continua sendo o do cadastro e a análise das chamadas não muda.",
    href: "/wiki/bases-conhecimento#produtos",
  },
]

export default function MultiGroupScopePage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="10 · Administração e Segurança"
        title="Alcance por vários Grupos"
        lead="Publicações, Alinhamentos operacionais, Argumentários, Bases de Conhecimento, Agentes, Orquestradores, Workflows, Indicadores e Produtos podem valer para vários Grupos e Subgrupos com um cadastro só: o mesmo conteúdo, o mesmo histórico e uma única edição. Você escolhe Grupos inteiros, Subgrupos avulsos ou “Todos”."
      >
        <div className="flex flex-wrap gap-2 pt-2">
          <CapabilityBadge label="Vários Grupos num cadastro" />
          <CapabilityBadge label="Grupo inteiro ou só alguns Subgrupos" />
          <CapabilityBadge label="Busca por nome, sem acento" />
          <CapabilityBadge label="Só com operadores em produção" />
          <CapabilityBadge label="Resumo “Vale para” antes de salvar" />
          <CapabilityBadge label="Validado no servidor" />
        </div>
      </WikiPageHeader>

      <WikiSection id="visao-geral" title="Um conteúdo, vários Grupos" eyebrow="O que mudou">
        <p>
          Antes, cada base, comunicado de público específico, alinhamento ou argumentário valia para <em>um</em> Grupo ou <em>um</em> Subgrupo — e o
          mesmo procedimento usado por duas áreas precisava ser cadastrado duas vezes. Agora o alcance é uma lista: o mesmo conteúdo pode valer para o
          Grupo A inteiro, para dois Subgrupos do Grupo B e para o Grupo C inteiro, tudo no mesmo cadastro. Mudar o texto muda para todos; o histórico
          é um só.
        </p>
        <p>
          Cada item do alcance aponta para um Grupo e, quando há recorte, para um Subgrupo <strong className="font-medium text-foreground">daquele</strong>{" "}
          Grupo — a INIA confere, no servidor, que o Subgrupo pertence ao Grupo. <strong className="font-medium text-foreground">Grupo inteiro</strong>{" "}
          vale para todos os Subgrupos dele, inclusive os que forem criados depois.
        </p>
      </WikiSection>

      <WikiSection id="exemplo" title="Exemplo-guia" eyebrow="Grupo A inteiro + Subgrupo B1">
        <ExampleCard title="A mesma base para o Grupo A inteiro e só para o Subgrupo B1 do Grupo B">
          <p>
            No campo <em>Alcance por grupo</em>, adicione o Grupo A e deixe <em>Grupo inteiro</em>; adicione o Grupo B, escolha{" "}
            <em>Só alguns Subgrupos</em> e marque B1. Antes de salvar, a tela mostra:{" "}
            <strong className="font-medium text-foreground">Vale para: Grupo A (Grupo inteiro) · Grupo B: só B1</strong>.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Quem está no Grupo A, em qualquer Subgrupo dele, usa a base.</li>
            <li>Quem está no Subgrupo B1 usa a base.</li>
            <li>Quem está no Subgrupo B2 (o outro Subgrupo do Grupo B) não usa.</li>
            <li>Quem está no Grupo C, que não foi escolhido, não usa.</li>
          </ul>
          <p className="mt-2">
            O mesmo vale, com as mesmas palavras, para um comunicado, um alinhamento ou um argumentário com esse alcance.
          </p>
        </ExampleCard>
      </WikiSection>

      <WikiSection id="como-escolher" title="Como escolher o alcance" eyebrow="O mesmo seletor em todas as telas">
        <StepList
          steps={[
            { title: "Escolha o universo, quando a tela pede", detail: "Escolhido o universo de atuação, só aparecem Grupos e Subgrupos dele. O que já estava escolhido e não cabe mais fica marcado “Fora do universo”, com o botão “Remover os que não cabem” — nada some em silêncio." },
            { title: "Grupos e Subgrupos específicos ou Todos", detail: "Duas opções lado a lado. “Todos os Grupos e Subgrupos” diz no próprio rótulo o que alcança e inclui os que forem criados depois; só quem administra a organização inteira escolhe." },
            { title: "Adicionar Grupo ou Subgrupo", detail: "Abre a busca, com duas abas: Grupos e Subgrupos. Digite parte do nome, sem se preocupar com maiúsculas e acentos; na aba Subgrupos, vale também o nome do Grupo (“cobrança tarde”). A lista mostra o Grupo de cada Subgrupo, o universo e quantos operadores estão em produção, e carrega mais conforme você rola." },
            { title: "Marque quantos quiser", detail: "Escolher um Grupo vale para o Grupo inteiro; escolher um Subgrupo vale só para ele, nunca para os outros Subgrupos do mesmo Grupo. Subgrupo de um Grupo já escolhido inteiro aparece como “Já incluído”. Buscar de novo, rolar ou trocar de aba não desfaz nada do que já foi marcado." },
            { title: "Confira os escolhidos e o resumo “Vale para”", detail: "Cada escolha vira um selo com o X para tirá-la. O resumo fica sempre visível antes de salvar, por exemplo “Grupo A (Grupo inteiro) · Grupo B › B1”. Sem nenhuma escolha, a tela pede ao menos uma." },
          ]}
        />
        <FieldRow label="Teclado" value="Na busca, ↑ e ↓ percorrem as opções, Enter marca ou desmarca e Esc fecha. “Carregar mais” também é um botão." />
        <WarningCallout kind="tip" title="O servidor é quem decide">
          A tela ajuda, mas quem valida é o servidor, também por chamada direta à API. São recusados: o mesmo Grupo ou Subgrupo duas vezes, um Subgrupo
          junto do próprio Grupo inteiro (o Grupo inteiro já o inclui), um Subgrupo que não é do Grupo indicado, um Grupo de outra organização,
          “todos” junto com Grupos e um alcance por Grupos sem nenhum Grupo.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="em-producao" title="Só Grupos com operadores em produção" eyebrow="Para novas escolhas">
        <p>
          A busca oferece só Grupos e Subgrupos com <strong className="font-medium text-foreground">ao menos um operador ativo com a situação “Em produção”</strong>.
          No Grupo, contam os operadores dele e os de qualquer Subgrupo dele — por isso um Grupo aparece mesmo quando só um dos Subgrupos tem gente em
          produção; os Subgrupos sem ninguém em produção não aparecem. Com universo escolhido, contam só os operadores daquele universo. O servidor
          aplica a mesma regra ao salvar: um Grupo ou Subgrupo novo sem operador em produção é recusado, também por chamada direta à API.
        </p>
        <FieldRow label="Na edição" value="O que já estava salvo continua na lista dos escolhidos, mesmo que tenha perdido os operadores em produção, marcado “Sem operadores em produção”. Você pode manter e salvar ou tirar. Tirado, só volta quando tiver operador em produção de novo." />
        <FieldRow label="Filtros e relatórios" value="A regra vale para escolher o alcance de um cadastro. Filtros de listas, relatórios e o histórico continuam mostrando todos os Grupos e Subgrupos." />
      </WikiSection>

      <WikiSection id="global" title="Escopo global é outra escolha" eyebrow="Nunca por ausência">
        <p>
          Valer para todos — <em>Todos os Grupos e Subgrupos</em> do universo do cadastro (agente, Orquestrador, Workflow, indicador, produto, base,
          argumentário), <em>Todo o universo</em> num alinhamento ou numa publicação — é uma opção própria do seletor, ao lado de{" "}
          <em>Grupos e Subgrupos específicos</em>, e só quem administra a organização inteira consegue salvá-la (o servidor recusa dos demais). Ela não
          se mistura com Grupos: ou o cadastro vale para todos, ou tem uma lista de Grupos e Subgrupos. E não é “marcar tudo o que está na lista”: um
          Grupo criado depois entra sozinho.
        </p>
        <p>
          <strong className="font-medium text-foreground">Universos continuam separados.</strong> Cada cadastro pertence a um universo; “Todos” vale
          para os Grupos e Subgrupos daquele universo, e Grupos de outro universo são recusados. Só a publicação, que não pertence a um universo, alcança
          todos os universos — pelo público “Toda a empresa”.
        </p>
        <p>
          <strong className="font-medium text-foreground">Conteúdo sem Grupo nunca vira “todos”.</strong> Se um Grupo ou Subgrupo deixa de existir, o
          conteúdo perde aquele item do alcance — não passa a valer para a organização. Na publicação de público específico, “Todo o universo X” é
          uma opção marcada à parte, que só aparece depois de escolher o universo.
        </p>
      </WikiSection>

      <WikiSection id="por-cima" title="Universo, produto e permissões" eyebrow="Continuam valendo por cima">
        <p>
          Valer para vários Grupos, sozinho, não libera nada além disso. Tudo o que já filtrava o conteúdo continua filtrando, no mesmo lugar de antes:
        </p>
        <FieldRow label="Universo de atuação" value={<>Um alinhamento só alcança quem está no universo dele, e cada Grupo do público precisa ser desse universo. Ver <WikiLink href="/wiki/estrutura">Pessoas e Estrutura</WikiLink>.</>} />
        <FieldRow label="Produto (Vale para)" value={<>O produto é outra dimensão, escolhida à parte. Uma base do Grupo A só para o produto X vale para quem está no Grupo A e nas chamadas do produto X. Ver <WikiLink href="/wiki/bases-conhecimento#produtos">Produtos e aplicabilidade</WikiLink>.</>} />
        <FieldRow label="Agents" value="Pôr uma base em mais um Grupo não liga a base a nenhum Agent: o vínculo Agent ↔ base continua explícito, em Admin › Agentes. Uma base com alcance em um Subgrupo conta para o Agent do Grupo daquele Subgrupo. Tirar um Grupo do alcance tira a base da busca dos Agents daquele Grupo já na consulta seguinte." />
        <FieldRow label="Situação e permissões" value="Rascunho, arquivado, encerrado, fora da vigência e excluído continuam fora, e cada tela mantém a sua permissão própria." />
      </WikiSection>

      <WikiSection id="por-conteudo" title="Em cada tela" eyebrow="Onde fica e quando passa a valer">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conteúdo</TableHead>
                <TableHead>Onde</TableHead>
                <TableHead>Campo</TableHead>
                <TableHead>Valer para todos</TableHead>
                <TableHead>Quando a mudança vale</TableHead>
                <TableHead>Wiki</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SCREENS.map((screen) => (
                <TableRow key={screen.area}>
                  <TableCell className="font-medium">{screen.area}</TableCell>
                  <TableCell className="text-muted-foreground">{screen.menu}</TableCell>
                  <TableCell>{screen.field}</TableCell>
                  <TableCell>{screen.global}</TableCell>
                  <TableCell>{screen.when}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <WikiLink href={screen.href}>Abrir</WikiLink>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <FieldRow label="Argumentário: a história não muda" value="Os Grupos do argumentário fazem parte da versão. Mudar os Grupos de um argumentário publicado cria um rascunho, e o novo alcance só vale a partir da publicação dele. Chamadas antigas continuam avaliadas pela versão que valia na data da chamada, com os Grupos daquela versão." />
        <FieldRow label="Comunicado: público fixo" value="Recebe quem está, no cadastro de hoje, no universo escolhido e em um dos Grupos (inteiro) ou Subgrupos marcados. A tela estima quantas pessoas receberiam, contando cada pessoa uma vez. Depois que o comunicado sai, o público não muda. Público específico exige o papel de comunicados da empresa." />
        <FieldRow label="Base: versão fora do alcance" value="No histórico, uma versão que valia para Grupos fora do seu escopo aparece só com número, situação e “Sem acesso a esta versão”." />
      </WikiSection>

      <WikiSection id="quem-administra" title="Quem administra um conteúdo compartilhado" eyebrow="Todos os Grupos no seu escopo">
        <p>
          Para alterar um conteúdo — texto, alcance, publicar, encerrar — você precisa administrar <strong className="font-medium text-foreground">todos</strong>{" "}
          os Grupos e Subgrupos do alcance, os que já estão e os que você quer incluir. Quem administra só parte deles tem outro tratamento, conforme
          o conteúdo:
        </p>
        <FieldRow label="Base e Argumentário" value={<>Vê o conteúdo, porque ele vale para um Grupo seu, mas sem alterar: a tela mostra como somente leitura (no argumentário, “{READ_ONLY_LABEL}”) e o servidor recusa a alteração.</>} />
        <FieldRow label="Alinhamento operacional" value="Ver é administrar: quem não administra todo o público do alinhamento não o vê na lista nem consegue abri-lo. Pede a quem administra o público inteiro." />
        <FieldRow label="Comunicado" value="Só quem publicou edita a própria publicação; público específico exige o papel de comunicados da empresa (organização inteira)." />
        <ExampleCard title="No exemplo-guia">
          Quem administra só o Grupo A vê a base do exemplo, mas não a altera — ela também vale para o Subgrupo B1, que não é dele. Quem administra os
          Grupos A e B altera normalmente.
        </ExampleCard>
      </WikiSection>

      <WikiSection id="alinhamentos" title="Alinhamentos que se cruzam" eyebrow="Prevalece o recorte mais específico para cada pessoa">
        <p>
          Dois alinhamentos do <em>mesmo ponto</em> podem alcançar as mesmas pessoas. Para cada pessoa, prevalece o recorte mais específico que a
          alcança: Subgrupo, depois Grupo, depois o universo inteiro. Como um alinhamento pode ter vários Grupos, a mesma versão pode ser “de Grupo”
          para uma pessoa e “de Subgrupo” para outra.
        </p>
        <ExampleCard title="Grupo inteiro × Subgrupo">
          O alinhamento X vale para o Grupo A inteiro e para o Subgrupo B1; o alinhamento Y, do mesmo ponto, vale só para o Subgrupo A1. Para quem
          está em A1, prevalece Y (Subgrupo é mais específico que o Grupo A inteiro); para o resto do Grupo A e para B1, vale X. Não é conflito.
        </ExampleCard>
        <FieldRow label="Conflito" value="Quando os dois têm o mesmo Grupo inteiro ou o mesmo Subgrupo (ou os dois valem para o universo inteiro), no mesmo ponto, com o mesmo produto e períodos que se cruzam, ninguém é mais específico: a publicação é recusada." />
        <FieldRow label="Na publicação" value="A INIA lista os alinhamentos que se cruzam e diz, para cada um, quem prevalece: “este, mais específico, prevalece”, “o outro, mais específico, prevalece”, “depende do Subgrupo: em cada um prevalece o recorte mais específico” ou “mesmo recorte para as mesmas pessoas: conflito, não publica”." />
        <FieldRow label="Produto" value="Um alinhamento só para um produto nunca derruba o geral: os dois valem e, para aquele produto, o específico prevalece." />
      </WikiSection>

      <WikiSection id="orquestradores" title="Orquestradores que se cruzam" eyebrow="Uma resposta por pessoa">
        <p>
          No chat, cada pessoa é atendida por um Orquestrador só: vale o que tem o recorte mais específico <em>para ela</em> — um Subgrupo dela, depois
          o Grupo dela inteiro, depois “Todos” —, do universo dela; no empate, o mais recente. Por isso a INIA recusa salvar um Orquestrador do chat
          ativo com o mesmo Grupo inteiro ou o mesmo Subgrupo de outro Orquestrador do chat ativo, do mesmo universo, e mostra quais se cruzam.
        </p>
        <ExampleCard title="Grupo inteiro × Subgrupo">
          O Orquestrador X vale para o Grupo A inteiro; o Y, só para o Subgrupo A1. Quem está em A1 é atendido por Y; o resto do Grupo A, por X. Não é
          conflito. Se Y também tivesse o Grupo A inteiro, a gravação seria recusada.
        </ExampleCard>
      </WikiSection>

      <WikiSection id="listas" title="Listas, filtros e contagens" eyebrow="Uma linha por conteúdo, uma pessoa uma vez">
        <FieldRow label="Lista" value="Mostra todos os Grupos e Subgrupos do alcance (por exemplo, “Grupo A · Grupo B › B1”). Filtrar por um Grupo ou Subgrupo traz os conteúdos com algum item do alcance ali, cada um uma vez." />
        <FieldRow label="Quem consome" value="O mesmo conteúdo alcançado por dois itens do alcance aparece uma vez para a pessoa — no chat, no Acompanhamento, na monitoria ou no material de apoio." />
        <FieldRow label="Indicadores de sucesso" value="No bloco de alinhamentos, a contagem “por área” conta o alinhamento uma vez em cada Grupo que ele alcança." />
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="O que ainda não faz">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Quem recebe é decidido pelo Grupo e Subgrupo do cadastro <em>atual</em> da pessoa: quem muda de Grupo passa a ver ou deixa de ver.</li>
          <li>Uma base sem nenhum alcance cadastrado só aparece para quem administra a organização inteira; ao editar, ela abre com “Nenhum Grupo” e pede um alcance antes de salvar.</li>
          <li>As Boas práticas mantêm a regra própria do módulo: uma base sem alcance entra no corpus de comparação.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/bases-conhecimento", label: "Bases de Conhecimento" },
            { href: "/wiki/acompanhamento#comunicados", label: "Comunicados e Publicações" },
            { href: "/wiki/administracao", label: "Administração", hint: "Argumentários e Alinhamentos operacionais" },
            { href: "/wiki/agents", label: "Agentes" },
            { href: "/wiki/workflows", label: "Workflows" },
            { href: "/wiki/seguranca", label: "Segurança e Escopo" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
