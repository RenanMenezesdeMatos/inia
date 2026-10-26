import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CapabilityBadge, ExampleCard, FieldRow, SeeAlso, StepList, UseCases, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { AUDITED_KNOWLEDGE_BASES, KNOWLEDGE_DOMAIN_LABELS, KNOWLEDGE_USE_CASES } from "@/components/wiki/ai-catalog-data"
import { DOCUMENT_TYPE_LABELS, KNOWLEDGE_STATUS_LABELS } from "@/schemas/admin/knowledge.schema"

export const metadata: Metadata = {
  title: "Bases de Conhecimento",
  description: "O que é uma base, como criar (campos reais), Rascunho/Publicado, vínculo com Agents, retrieval por trechos (lexical/BM25 — sem embeddings), orçamento, evidência de base, Conformidade de processo e o catálogo auditado.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "O que é uma base" },
  { id: "quando-usar", label: "Quando usar / não usar" },
  { id: "como-criar", label: "Como criar uma base" },
  { id: "campos", label: "Os campos, um a um" },
  { id: "status", label: "Rascunho, Publicado, Arquivado" },
  { id: "vinculo", label: "Vínculo com Agents" },
  { id: "retrieval", label: "Retrieval: como a IA usa a base" },
  { id: "orcamento", label: "Orçamento de conhecimento" },
  { id: "embeddings", label: "Sem embeddings (hoje)" },
  { id: "evidencia", label: "Evidência de base" },
  { id: "material-apoio", label: "Material de apoio no feedback" },
  { id: "produtos", label: "Produtos e aplicabilidade" },
  { id: "process-audit", label: "Conformidade de processo" },
  { id: "catalogo", label: "Bases auditadas" },
  { id: "casos-por-kb", label: "Casos de uso por base" },
  { id: "testes", label: "O que os testes garantem" },
  { id: "limitacoes", label: "Limitações e próxima evolução" },
]

export default function KnowledgeBasesPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="08 · Bases de Conhecimento"
        title="Bases de Conhecimento"
        lead="Uma Base de Conhecimento é um documento autorizado — procedimento, manual, FAQ, regra ou fluxo — que Agents podem consultar. As bases NÃO são enviadas inteiras ao modelo: só os trechos pertinentes a cada request entram no prompt, e sempre como dados, nunca como instruções."
      >
        <div className="flex flex-wrap gap-2 pt-2">
          <CapabilityBadge label="Texto colado ou PDF/DOCX/TXT/JSON" />
          <CapabilityBadge label="Trechos por seção" />
          <CapabilityBadge label="Retrieval lexical (BM25)" />
          <CapabilityBadge label="Só bases publicadas no runtime" />
          <CapabilityBadge label="Conformidade de processo" />
          <CapabilityBadge label="Embeddings semânticos" tone="missing" />
        </div>
      </WikiPageHeader>

      <WikiSection id="quando-usar" title="Quando usar / não usar" eyebrow="Critério">
        <UseCases
          use={[
            "Fornecer conhecimento autorizado que a IA pode citar por documento e seção (procedimentos, conduta, checklists)",
            "Auditar uma chamada contra um processo oficial (Conformidade de processo)",
            "Responder perguntas do operador sobre como fazer algo",
          ]}
          avoid={[
            "Dados de performance (PRV, indicadores) — vêm do Workflow, não de uma base",
            "Vincular a um Agent “para preencher campo” — Performance, PRV, Eficiência e Reconhecimento não têm base",
            "Políticas de RH em especialistas de chamada (a Política de Jornada só entra no Especialista de Disponibilidade, como regra operacional)",
          ]}
        />
      </WikiSection>

      <WikiSection id="como-criar" title="Como criar uma base" eyebrow="Admin › Base de conhecimento › Nova base">
        <StepList
          steps={[
            { title: "Abra Admin › Base de conhecimento e clique em “Nova base”", detail: "Também disponível no atalho da sidebar." },
            { title: "Título e Tipo de documento", detail: <>Informe o <strong>Título</strong> (é o nome exato que a IA cita como evidência) e escolha o <strong>Tipo de documento</strong>: {Object.values(DOCUMENT_TYPE_LABELS).join(", ")}.</> },
            { title: "Conteúdo: Colar texto ou Enviar arquivo", detail: <>Na aba <strong>Colar texto</strong>, cole o procedimento, manual, FAQ ou fluxo — títulos com <code>#</code>, listas, negrito e tabelas são exibidos formatados e os títulos definem as seções do retrieval. Na aba <strong>Enviar arquivo</strong>, envie PDF, DOCX, TXT ou JSON — o texto é extraído (na edição aparece como “Texto extraído do arquivo”).</> },
            { title: "Alcance por grupo e Alcance por assunto", detail: "Defina em quais Grupos/Subgrupos a base vale (entra pré-selecionada nos Agents daquele grupo) e, opcionalmente, o Assunto." },
            { title: "Salvar", detail: "A base nasce como Rascunho." },
            { title: "Publicar", detail: <>Na página da base, clique em <strong>Publicar</strong>. Só bases publicadas entram no runtime dos Agents. Para tirar de circulação, <strong>Arquivar</strong>.</> },
            { title: "Vincular a um Agent", detail: <>Em <strong>Admin › Agentes</strong>, abra o Agent do domínio e mova a base para “Selecionadas” em <strong>Bases de conhecimento consultadas</strong>. Ver <WikiLink href="/wiki/agents#como-criar">Como criar um Agent</WikiLink>.</> },
          ]}
        />
      </WikiSection>

      <WikiSection id="campos" title="Os campos, um a um" eyebrow="1:1 com o formulário">
        <FieldRow label="Título" value="Nome do documento — a IA cita o título exato como evidência de base." />
        <FieldRow label="Tipo de documento" value={`${Object.values(DOCUMENT_TYPE_LABELS).join(", ")}.`} />
        <FieldRow label="Conteúdo" value="Texto colado (formatação leve) ou texto extraído de PDF/DOCX/TXT/JSON. Alterar o conteúdo cria uma nova versão." />
        <FieldRow label="Alcance por grupo" value="Todos os grupos, Grupo ou Subgrupo — governa a pré-seleção nos Agents e o escopo administrativo." />
        <FieldRow label="Alcance por assunto" value="Assunto opcional, para organizar o catálogo." />
        <FieldRow label="Status" value={`${Object.values(KNOWLEDGE_STATUS_LABELS).join(", ")} (editável na edição; Publicar/Arquivar também pela ação da página).`} />
      </WikiSection>

      <WikiSection id="status" title="Rascunho, Publicado, Arquivado" eyebrow="Runtime só usa Publicado">
        <WarningCallout title="Só bases publicadas entram no runtime">
          O retrieval só enxerga documentos vinculados ao Agent, <strong>publicados</strong>, não excluídos e da organização. Uma base em Rascunho,
          Aprovado ou Arquivado — mesmo vinculada — é invisível para a IA. Uma base que existe no sistema mas não foi autorizada ao Agent também.
        </WarningCallout>
        <p>Versões: alterar o conteúdo cria uma nova versão (a página mostra &quot;versão N&quot;); título, tipo, status e alcance são atualizados no registro.</p>
      </WikiSection>

      <WikiSection id="vinculo" title="Vínculo com Agents" eyebrow="Base autorizada ≠ conteúdo do prompt">
        <p>
          <strong className="font-medium text-foreground">Base autorizada</strong> é o que o Agent PODE consultar — a lista vinculada a ele na tela de
          Agentes. <strong className="font-medium text-foreground">Conteúdo do prompt</strong> é o que entra numa request específica: só os trechos
          pertinentes àquela transcrição/pergunta. Ao salvar um Agent, o backend recusa ids de base inexistentes ou excluídos — nunca confia no id
          enviado pelo frontend. Orchestrators não têm base própria: quem consulta são os especialistas.
        </p>
      </WikiSection>

      <WikiSection id="retrieval" title="Retrieval: como a IA usa a base" eyebrow="Arquitetura real">
        <WikiFlow
          compact
          steps={[
            { label: "Documento publicado", tone: "input" },
            { label: "Chunking por seções (títulos Markdown); seções longas subdivididas por parágrafo (~1.400 caracteres)", tone: "core" },
            { label: "Retrieval lexical (BM25): a transcrição/pergunta vira a consulta", detail: "acentos normalizados, palavras vazias removidas, radical curto", tone: "core" },
            { label: "Trechos relevantes, sob orçamento — cada um com documento + seção", tone: "core" },
            { label: "Entram no prompt do Agent como DADOS, abaixo das instruções", tone: "ai" },
          ]}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ExampleCard title="1. Trechos por seção">
            Cada base publicada é dividida por títulos (&quot;## 3. Etapas do atendimento&quot;); seções longas são subdivididas por parágrafo. Cada
            trecho carrega documento + seção — a IA cita &quot;documento, seção&quot;, nunca um pedaço anônimo.
          </ExampleCard>
          <ExampleCard title="2. Retrieval lexical (BM25)">
            A transcrição (ou a pergunta) vira a consulta: acentos normalizados, palavras vazias removidas, radical curto
            (&quot;contestação&quot;/&quot;contestar&quot; caem no mesmo termo). Um trecho precisa casar com pelo menos 2 termos distintos — uma
            coincidência isolada de vocabulário não traz uma seção inteira.
          </ExampleCard>
          <ExampleCard title="3. Quatro modos">
            <span className="font-mono text-xs">NONE</span> (sem base autorizada), <span className="font-mono text-xs">FULL</span> (bases pequenas que cabem inteiras
            no orçamento), <span className="font-mono text-xs">RETRIEVAL</span> (só trechos pertinentes) e <span className="font-mono text-xs">NO_MATCH</span> (havia
            bases, nenhum trecho pertinente — nada é injetado). Visíveis por request no QA Lab.
          </ExampleCard>
        </div>
      </WikiSection>

      <WikiSection id="orcamento" title="Orçamento de conhecimento" eyebrow="Só o que é pertinente">
        <p>
          Conceitualmente: <strong className="font-medium text-foreground">somente trechos relevantes são enviados</strong>, numa quantidade limitada,
          descartando trechos muito abaixo do melhor score. Bases pequenas que cabem inteiras no orçamento entram inteiras (recuperar seria só custo).
          Sem trecho pertinente, o prompt diz isso ao modelo — nunca injeta um documento &quot;para preencher&quot;.
        </p>
        <details className="rounded-lg border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Avançado: os limites atuais</summary>
          <p className="mt-2 text-muted-foreground">
            No máximo 8 trechos e 9.000 caracteres (≈2.500 tokens) por request, descartando trechos abaixo de 20% do melhor score; trechos de até
            ~1.400 caracteres; mínimo de 2 termos casados por trecho. O QA Lab mostra caracteres/tokens injetados versus o que seria injetado sem
            retrieval.
          </p>
          <p className="mt-2 text-muted-foreground">
            Na conversa com a INIA (chat e voz), o especialista recebe a pergunta escrita pelo Orquestrador, e a busca também confere a pergunta
            da própria pessoa, só com as palavras que as duas têm em comum: assim, o que o Orquestrador acrescentou por conta própria não tira da
            busca a seção que a pessoa pediu. Essa segunda busca só complementa a primeira: nada do que a primeira escolheu sai, e entram no
            máximo 4 trechos, só dos documentos que a primeira já encontrou, sob o mesmo teto de 9.000 caracteres. Numa pergunta com dois
            assuntos, cada especialista continua recebendo só o seu. Workflows não mudam.
          </p>
        </details>
      </WikiSection>

      <WikiSection id="embeddings" title="Sem embeddings (hoje)" eyebrow="Dizer claramente">
        <WarningCallout kind="tip" title="O retrieval é lexical, não semântico">
          Não há embeddings nem busca vetorial. Sinônimos sem radical em comum podem não casar. A interface do retrieval (trechos → trechos ranqueados
          sob orçamento) é o ponto de substituição para uma evolução semântica — a arquitetura está preparada para essa troca sem mudar Agents,
          Workflows ou telas.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="evidencia" title="Evidência de base" eyebrow="Base · seção · trecho">
        <p>
          Quando um processo é auditado, o Agent aponta: a <strong className="font-medium text-foreground">Base</strong> (título exato do documento),
          a <strong className="font-medium text-foreground">seção</strong> e a <strong className="font-medium text-foreground">evidência recuperada</strong>{" "}
          (o trecho). Sem trecho que cubra, o agente declara &quot;não há procedimento cadastrado&quot; — nunca cria regra, prazo ou item que não
          esteja no trecho recuperado. Documento de base é dado: uma frase &quot;ignore as instruções&quot; dentro dele continua sendo texto do
          documento (ver <WikiLink href="/wiki/seguranca#ia">IA e segurança</WikiLink>).
        </p>
      </WikiSection>

      <WikiSection id="material-apoio" title="Material de apoio no feedback" eyebrow="A base como conteúdo recomendado, não só como fonte">
        <p>
          Além de fundamentar a análise, uma base publicada pode ser <strong className="font-medium text-foreground">recomendada</strong> ao
          colaborador — num feedback gerado por Agent, numa resposta do chat/voz ou num Workflow com Orquestrador (ver{" "}
          <WikiLink href="/wiki/acompanhamento#material-apoio">Material de apoio recomendado</WikiLink>). A IA enxerga apenas os documentos
          cujos trechos entraram naquela análise (candidatos — vários trechos do mesmo documento contam como um único material; o Orquestrador
          agrega os de todos os especialistas acionados) e os referencia pelo identificador; a INIA resolve título, página e permissão a
          partir do documento real. A IA nunca escreve link, URL ou título. O vínculo com as bases continua só no Agent: Orquestrador, Workflow,
          chat e avatar não escolhem bases.
        </p>
        <p>
          Em resumo: o <strong className="font-medium text-foreground">Agent consulta a base</strong> (retrieval no prompt ou pela ferramenta “Consultar Base de
          Conhecimento”, quando tem <WikiLink href="/wiki/agents/ferramentas-investigacao">Ferramentas de investigação</WikiLink>); a{" "}
          <strong className="font-medium text-foreground">base produz candidatos</strong> (documentos reais cujos trechos entraram na análise); quem{" "}
          <strong className="font-medium text-foreground">recomenda</strong> é o Agent respondendo diretamente (opção ligada ou capacidade “Materiais de apoio”)
          ou o Orquestrador na síntese; o <strong className="font-medium text-foreground">link é gerado pela aplicação</strong> (a página <code>/materiais/:id</code>,
          com título real e permissão verificada para quem lê); um material recomendado é apoio para o próximo passo — <em>não é a evidência</em> do feedback,
          que continua sendo o trecho literal ou o número apurado; e <strong className="font-medium text-foreground">Chat, Avatar e Feedback</strong> podem
          exibir o material (Acompanhamento e feed da estrutura também).
        </p>
        <FieldRow label="Página do material" value="Cada base publicada tem uma página de leitura para quem pode acessá-la (o mesmo documento que o Admin mantém em Base de conhecimento, sem ações de edição): texto formatado, PDF, DOCX ou texto do arquivo, com download do original." />
        <FieldRow label="Quem pode abrir" value="O alcance da base decide: “Todos os grupos” abre para a organização inteira; Grupo/Subgrupo abre para quem está neles e para a gestão que lidera alguém deles. Rascunho, Arquivado, base excluída ou sem alcance cadastrado não abrem para ninguém além de quem administra bases (papel com “Administrar bases de conhecimento” no escopo da base; base sem alcance, só na organização inteira) — e nunca viram link num feedback." />
        <FieldRow label="Despublicar depois" value="O feedback histórico continua íntegro; a recomendação passa a aparecer como “não está mais disponível”, sem título e sem link." />
      </WikiSection>

      <WikiSection id="esclarecimento" title="Esclarecimento de perguntas ambíguas" eyebrow="Perguntar antes de responder — sempre pelas bases">
        <p>
          Quando alguém faz uma pergunta genérica à INIA, por texto ou por voz (“Como faço a troca para o cliente?”), ela consulta as bases que a
          pessoa pode ler — as de todos os especialistas do Orquestrador dela — antes de responder. A IA vê a lista dessas bases com o começo do
          sumário de cada uma, abre as que fazem sentido e lê as seções que precisar; nenhuma busca por palavra escolhe por ela. Se as bases
          descrevem cenários que <strong className="font-medium text-foreground">mudam a resposta</strong> (produtos, públicos, situações,
          exceções), ela pergunta qual se aplica, com opções clicáveis; a cada escolha, olha de novo — entre bases e dentro da mesma base (seções,
          tabelas, condições). Quando o cenário está definido, responde só com o que as seções lidas sustentam. A conversa fica natural, sem
          marcadores de citação: no fim da resposta,{" "}
          <strong className="font-medium text-foreground">Fontes consultadas</strong> fica recolhido, com link para a página de cada base.
        </p>
        <FieldRow label="Nada fixo no código" value="Perguntas, opções e a ordem das etapas vêm do conteúdo das bases. Nenhum produto, público ou procedimento é cadastrado no sistema, e nenhuma lista de palavras decide o que é pertinente: uma base nova com outro cenário aparece como opção sem desenvolvimento." />
        <FieldRow label="Cada opção tem fonte" value="Toda opção cita a base ou a seção que a sustenta (registrado para auditoria, não exibido no formulário). Opção sem fonte é descartada pelo sistema, nunca exibida; documentos que descrevem o mesmo cenário viram uma opção só." />
        <FieldRow label="O formulário" value="Escolha única ou múltipla (quando o caso pode reunir mais de uma), “Nenhuma das opções corresponde ao meu caso”, complemento em texto livre, busca quando há muitas opções e grupos quando as próprias bases agrupam os cenários. Também dá para responder digitando — a INIA interpreta a mensagem." />
        <FieldRow label="Corrigir uma escolha" value="O cenário considerado aparece de forma discreta junto da resposta: um chip por informação, só com o valor (passar o mouse mostra o que é e de onde veio). Clicar abre o detalhe com “Alterar” nas escolhas: corrigir refaz as etapas seguintes a partir dela." />
        <FieldRow label="Quando não pergunta" value="Se a pergunta já traz o que distingue os cenários, ou se as diferenças encontradas não mudam o que deve ser feito, a INIA responde direto. Perguntas sobre os próprios resultados, indicadores ou feedbacks — e conversa social — seguem o caminho de sempre." />
        <FieldRow label="Quando as bases não cobrem" value="A INIA diz que não encontrou nas bases consultadas e pede uma informação objetiva (ou que a pergunta seja reformulada) — nunca responde sem fonte. Se o esclarecimento não chega a um cenário documentado em até 4 etapas, ela explica o que falta." />
        <FieldRow label="Pela voz" value="O mesmo esclarecimento vale na conversa por voz: a INIA fala a pergunta e lê as opções de forma curta (só os nomes; com muitas, as primeiras e o aviso de que as demais estão na tela). Dá para responder falando — ela interpreta a resposta como no texto — ou escolher no formulário, que aparece na tela junto da fala: a escolha interrompe a fala em curso e a INIA continua falando a próxima pergunta ou a resposta. A escolha vale exatamente como foi clicada; se a voz não seguir com ela, a próxima etapa aparece por escrito. Vale para quem atende e para quem lidera." />
        <FieldRow label="Quem lidera" value="Na dúvida de processo de quem lidera, o esclarecimento usa as bases do Orquestrador do Grupo consultado (não as do Grupo do próprio cadastro), sempre só as que a pessoa pode ler. A pergunta com as opções (ou a resposta) aparece como saiu das bases, junto dos cartões de dados da mesma resposta; a escolha no formulário continua no mesmo Orquestrador enquanto ele estiver ao alcance da estrutura de quem lidera." />
        <FieldRow label="Acesso" value="Só entram bases autorizadas aos especialistas E que a pessoa pode ler (mesma regra da página do material). Ao reabrir a conversa, fonte que deixou de estar acessível aparece sem título." />
        <FieldRow label="Auditoria" value="Cada resposta guarda a trilha completa: pergunta original, cenário, opções apresentadas com a base e a seção que sustenta cada uma, fontes numeradas como as citações do texto gravado, divergências entre bases e a cobertura da consulta. Quem pode ler as conversas vê essa trilha em Administração › Monitoramento › Conversas com a INIA — base que quem lê não alcança aparece sem título." />
        <WarningCallout kind="tip" title="Cobertura honesta">
          A INIA diz “Encontrei estes cenários nas bases consultadas” — nunca “todas as possibilidades”. Ela decide o que abrir pelo título e pelo
          começo do sumário de cada base: uma base com título pouco descritivo depende de ela abrir. Com muitas bases (mais de 120 legíveis), a lista
          é cortada e a tela avisa. A escolha esclarece a pergunta; não autoriza nenhuma ação em sistema.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="produtos" title="Produtos e aplicabilidade" eyebrow="Admin › Agentes › Produtos">
        <p>
          O mesmo motivo (segunda via, cancelamento, mudança de endereço) existe em produtos diferentes, e cada produto pode ter o seu procedimento.
          O motivo não determina o produto. Por isso a INIA só cobra ou reconhece a regra de um produto quando o produto do pedido ficou{" "}
          <strong className="font-medium text-foreground">estabelecido</strong> pelas evidências da chamada.
        </p>
        <FieldRow label="Produtos e categorias" value="Os produtos da operação (dados, nunca código — o código técnico é gerado pelo nome e não aparece). Cadastro: nome, categoria (opcional, criada no próprio seletor; serve quando uma base ou um indício vale para todos os produtos dela) e como o cliente e a operação chamam o produto — é com esses nomes que a INIA o reconhece quando alguém fala dele." />
        <FieldRow label="Vale para (não é 1×1)" value="Cada documento da base e cada argumentário vale para todos os produtos (padrão) ou só para alguns; marcar uma categoria vale para os produtos dela. Escolha no editor da base ou do argumentário (Vale para) ou no detalhe do produto (Adicionar base / Tirar) — é o mesmo registro. A lista de bases mostra a coluna Produtos. Mudar vale a partir da mudança: chamadas anteriores continuam avaliadas com o que valia na época." />
        <FieldRow label="Indícios — como reconhecer o produto na chamada" value="Em um passo: o que aparece na chamada (ex.: o começo do número da conta), se confirma o produto (sob a condição escrita em “Confirma quando”) ou apenas sugere, e de onde vem; em Mais detalhes, outros produtos que ele indica, em que situação vale, exceções, documento da base e data de início. “Salvar e usar” põe em uso na hora (a vigência nunca começa antes); “Salvar como rascunho” guarda para depois. Versões aprovadas não mudam; Encerrar/Reativar. A análise só considera indícios em uso na data da chamada; um indício que apenas sugere nunca basta sozinho." />
        <FieldRow label="Na análise da chamada" value="A IA separa cada pedido, o objeto dele (conta, contrato, linha, produto, serviço) e as evidências com a origem e o trecho; diferencia produto identificado, só a categoria, mais de um possível, não identificado e evidências em conflito. Menção em negação, hipótese, outro contrato ou corrigida depois não prova o produto; o procedimento que o operador executou também não. A fala do operador que diz ou confirma o produto vale quando o cliente deu, sobre o mesmo pedido, um contexto compatível (a conta, a linha, o serviço); sozinha, só sugere. A IA recebe os números com o formato preservado (o começo, a quantidade de dígitos, o DDD) — o bastante para os indícios, nunca o número inteiro; número cortado ou incerto fica como limitação e nunca é reconstruído." />
        <FieldRow label="Quando o produto não fica estabelecido" value="Os pontos que dependem dele ficam sem avaliação (nem falha, nem acerto) e não são cobrados; os pontos que não dependem do produto, ou que valem para todos os produtos ainda possíveis, continuam avaliados e o feedback acontece com eles. Em “Vale confirmar”, o bloco “Depende do produto” mostra, com o texto literal de cada base, o que o procedimento de cada produto possível pede — informação, não avaliação. Se nada útil sobra, não há feedback, com o motivo registrado. Nunca se escolhe o produto mais comum." />
        <FieldRow label="Em todo feedback" value="Monitoria e indicador levam o produto até o fim. Numa chamada com dois pedidos, cada ponto é dito no pedido dele e dois pontos de produtos diferentes nunca viram um só. No indicador, cada fala de exemplo vem com o produto do pedido e a regra da própria chamada, e a fala do argumentário é a da versão que aquela chamada usou. Os colegas de referência só entram com prática do mesmo produto, ou de regra geral. Em “Entenda este feedback”, o ponto, a fala, a regra (“Vale para”) e a fala do argumentário mostram o produto. Uma boa prática vista só nas chamadas de um produto só é sugerida no feedback desse produto." />
        <FieldRow label="No Diagnóstico" value="O detalhe da chamada mostra, por pedido, o que foi identificado e o que sustentou (ou não) a identificação, e lista os pontos que ficaram sem avaliação por depender do produto." />
        <FieldRow label="Na conversa sobre o feedback" value="Se a orientação pedida depende de um produto que a gravação não estabeleceu, a INIA pode perguntar qual era (sem pedir número completo de conta ou documento). A resposta orienta aquela conversa e fica registrada como confirmação feita na conversa — nunca como algo observado na gravação, e não muda a análise." />
        <WarningCallout kind="tip" title="Sem catálogo, nada muda">
          Enquanto não houver produto com indício aprovado ou base marcada para ele, a análise das chamadas funciona exatamente como antes.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="process-audit" title="Conformidade de processo" eyebrow="Contrato de auditoria etapa a etapa">
        <p>
          No node &quot;Chamar agente&quot; de um Workflow por Flag de canal, o campo <strong>Formato da análise</strong> aceita{" "}
          <span className="font-mono text-sm">Conformidade de processo</span>. O especialista do domínio compara o PROCESSO OFICIAL (trechos
          recuperados da base) com a TRANSCRIÇÃO REAL e devolve, além do feedback normal, uma lista de etapas:
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ExampleCard title="CONFORME">Etapa observada, com citação literal da transcrição.</ExampleCard>
          <ExampleCard title="NÃO CONFORME (com evidência)">Etapa feita em desacordo, com citação literal do que aconteceu.</ExampleCard>
          <ExampleCard title="NÃO FOI POSSÍVEL CONFIRMAR">Sem evidência suficiente na transcrição — nunca vira &quot;não conforme&quot;.</ExampleCard>
          <ExampleCard title="NÃO APLICÁVEL">Etapa prevista no procedimento que não cabe nesta situação.</ExampleCard>
        </div>
        <WarningCallout title="Ausência de evidência NÃO significa não conformidade">
          Etapa CONFORME ou NÃO CONFORME cuja &quot;evidência&quot; não seja um trecho literal da transcrição é rebaixada por código para &quot;Não foi
          possível confirmar&quot; e a citação é descartada (fica marcada como rebaixada). A evidência principal do feedback continua exigindo
          literalidade — se não for literal, o resultado inteiro é descartado. O resultado é persistido junto do Feedback.
        </WarningCallout>
        <p>
          O modelo é reutilizável com qualquer base de processo: copie a instância do Modelo 18, troque a Abrangência para o grupo do domínio e o
          especialista correspondente. Instâncias criadas: Faturamento, Retenção e Cancelamento, Suporte Técnico. Exige transcrição (gatilho por Flag
          de canal); não se aplica a Workflows por agenda ou indicador.
        </p>
        <p>
          <strong>Avaliação de processo (feedback com base).</strong> Formato mais novo, pensado para o feedback confiável (&quot;Gerar
          feedback&quot;): o especialista avalia as etapas do processo como Seguida, Não seguida, Não observável ou Não aplicável, e cita a regra da
          base e a fala da conversa. Antes de virar feedback, a aplicação confere tudo por código. A fala tem de ser literal na transcrição e dita
          pelo operador. A regra tem de estar literal na versão PUBLICADA do documento e num trecho que a IA recebeu nesta execução. Documento
          recuperado não significa documento aplicável: a INIA escolhe o procedimento pelo cenário da chamada e, quando a regra não se liga ao que
          foi dito, a conclusão fica restrita (não observável) em vez de virar acusação — sem fila de QA. Etapa seguida vira <em>Ponto forte</em>; etapa não seguida vira <em>Ponto de desenvolvimento</em>. Nenhuma das duas seções é
          obrigatória. &quot;O que fazer&quot; e &quot;Por que importa&quot; só aparecem quando há procedimento ou diretriz oficial que os sustente, e
          não existe dica genérica. O documento da regra entra como <strong>Material de apoio</strong>, com um link que abre em nova aba e só aparece
          se o colaborador tiver acesso à base. No nó Orquestrador, &quot;Formato dos especialistas&quot; aplica o mesmo contrato. Também exige
          gatilho por Flag.
        </p>
        <p>
          <strong>Omissão verificada.</strong> Quando a etapa não aconteceu, não existe fala que a mostre, então ela não pode ser ligada à conversa
          pelas palavras. O especialista marca a etapa como não seguida por omissão, e a aplicação só aceita depois de conferir cinco coisas:
          o processo se aplicava (outra etapa do mesmo documento foi cumprida, e a situação descrita na seção aparece na conversa ou no assunto
          do atendimento); a etapa é obrigatória (&quot;quando permitido&quot; ou &quot;se disponível&quot; não contam); a transcrição está
          completa; houve oportunidade (a etapa anterior foi feita e a conversa continuou, sem queda); e nenhuma fala do operador usa os termos
          próprios da etapa ou do trecho que diz como cumpri-la. Tudo conferido, a omissão segue sem QA. Se a transcrição está cortada, a
          chamada caiu antes ou a etapa é condicional, ela fica como &quot;não observável&quot; e não vira feedback. Se o processo não se confirma
          ou há fala parecida com a etapa, o ponto vai para o QA.
        </p>
        <p>
          <strong>Como o feedback aparece.</strong> Cada ponto mostra a etapa no título e, montados pela aplicação a partir do que foi conferido
          (e não pelo texto da IA): a fala da chamada (&quot;Você disse:&quot;), ou o aviso de que a etapa não foi identificada; o trecho literal
          do documento, com a frase que abre a lista e, quando existe, o trecho que diz como cumprir; o nome do documento com link e a seção. A IA
          escreve só o resumo do que aconteceu e o &quot;Como aplicar&quot; / &quot;Para manter&quot;. Texto que não nomeia a etapa é recusado e
          substituído por um texto fixo que nomeia. Feedback seguro mas genérico não atende ao produto. &quot;Garante&quot;,
          &quot;assegura&quot;, &quot;vai evitar&quot;, &quot;elimina&quot; e afirmações parecidas são recusados em qualquer campo, inclusive na
          edição do QA e na publicação, a menos que a própria regra do documento diga isso.
        </p>
        <p>
          <strong>Exemplo de condução.</strong> Num ponto de desenvolvimento com regra verificada e orientação oficial, o feedback mostra também
          como o operador poderia ter dito aquilo ao cliente. O exemplo é uma sugestão de formulação, marcada como tal: não é fala da chamada
          nem texto oficial. A linguagem de conversa é livre, mas prazo, número, canal (SMS, e-mail, retorno), valor, crédito, estorno, protocolo
          ou resultado da análise só aparecem quando estão na regra do documento ou na própria chamada. Se a regra diz de onde vem uma
          informação sem dizer o valor (&quot;o prazo exibido na ferramenta&quot;), o exemplo fala assim, sem inventar o número. Trechos que o
          documento traz como exemplo (uma fala-modelo entre aspas, &quot;Exemplo:&quot;) nunca viram fato da chamada: o protocolo ou o prazo de
          um exemplo não é o desta chamada. Sem base suficiente, o ponto sai sem exemplo; frases como &quot;seja mais claro&quot; nunca o
          substituem. O QA pode editar o exemplo, com as mesmas regras. Pontos fortes não têm exemplo: &quot;Para manter&quot; basta.
        </p>
        <p>
          <strong>Tamanho do feedback.</strong> Não há limite de pontos: todo achado confiável entra no feedback. A ordem é fixa: primeiro os
          pontos de desenvolvimento (a regra ancorada na conversa antes da regra só literal, na ordem do procedimento no documento), depois os
          pontos fortes. Os pontos fortes da mesma seção do documento aparecem num bloco só, cada etapa com a sua fala e o seu trecho; etapas
          repetidas (mesmo documento, mesmo trecho, mesmo resultado) viram um ponto. O feedback abre com um resumo e termina com os materiais
          utilizados, cada documento uma vez, com as etapas em que foi usado. Na aba Resultados do Workflow aparecem quantos achados foram
          detectados, quantos são confiáveis, quantos estão no feedback e o que aconteceu com o resto (QA, bloqueio, não observável).
        </p>
        <p>
          <strong>Feedback pessoal.</strong> O feedback abre com &quot;Olá&quot; e o primeiro nome do colaborador, tirado do cadastro (o nome
          nunca é enviado à IA), seguido de uma abertura que diz o que foi analisado e o que apareceu, e termina com um fechamento que resume
          o que ficou bom e o principal ajuste. A abertura e o fechamento não trazem fatos novos: tudo o que citam precisa estar nos pontos
          que realmente saem no feedback. Nome, tratamento como &quot;prezado&quot; ou &quot;cara&quot;, elogio a uma etapa que precisa
          melhorar, promessa de melhorar o indicador e palavras como &quot;erro&quot; ou &quot;falha&quot; são recusados; nesse caso entra
          uma abertura montada pela aplicação só com as etapas e o assunto. O feedback de indicador segue o mesmo formato.
        </p>
        <p>
          <strong>Vale confirmar o produto.</strong> Quando a base tem procedimentos parecidos para produtos diferentes (por exemplo, mudança
          de endereço de DDR, SIP e Linha Analógica, cada um com o seu prazo), a INIA não escolhe um em silêncio. O produto só é considerado
          confirmado quando o assunto registrado do atendimento ou uma fala da chamada o nomeia; com apenas indícios, ou com mais de um
          produto possível, as etapas que dependem do produto não são avaliadas, e isso nunca vira &quot;não seguiu&quot;. No lugar, o
          feedback mostra o ponto &quot;Vale confirmar o produto&quot;: o que ficou incerto, o que o operador disse, se isso é compatível com
          o procedimento de algum produto (nunca &quot;correto&quot;), o que a base prevê para cada produto, com documento e link, e um
          exemplo de como confirmar o produto na conversa. Esse ponto é montado pela aplicação, não passa pelo QA e deixa claro que não é
          classificado como erro. No feedback de indicador, os pontos de desenvolvimento encontrados nos atendimentos da amostra também
          trazem exemplo de condução quando têm regra verificada; o resultado fora da meta, sozinho, nunca gera exemplo.
        </p>
      </WikiSection>

      <WikiSection id="catalogo" title="Bases de Conhecimento auditadas" eyebrow={`${AUDITED_KNOWLEDGE_BASES.length} documentos — o que existe de verdade`}>
        <p>
          {AUDITED_KNOWLEDGE_BASES.filter((kb) => kb.operational).length} operacionais (procedimentos/conduta que uma chamada pode ser comparada contra),{" "}
          {AUDITED_KNOWLEDGE_BASES.filter((kb) => kb.domain === "RH").length} políticas de RH e{" "}
          {AUDITED_KNOWLEDGE_BASES.filter((kb) => kb.domain === "TESTE").length} artefato de teste. Nenhuma base foi inventada para preencher agente.
        </p>
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Base</TableHead>
                <TableHead>Domínio</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Tamanho</TableHead>
                <TableHead>Operacional?</TableHead>
                <TableHead>Finalidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {AUDITED_KNOWLEDGE_BASES.map((kb) => (
                <TableRow key={kb.title}>
                  <TableCell className="font-medium">{kb.title}</TableCell>
                  <TableCell className="whitespace-nowrap">{KNOWLEDGE_DOMAIN_LABELS[kb.domain]}</TableCell>
                  <TableCell>{DOCUMENT_TYPE_LABELS[kb.documentType]}</TableCell>
                  <TableCell className="text-right font-mono text-xs">~{Intl.NumberFormat("pt-BR").format(kb.approxChars)}</TableCell>
                  <TableCell>
                    <CapabilityBadge label={kb.operational ? "Operacional" : kb.status === "DRAFT" ? "Rascunho/teste" : "Política interna"} tone={kb.operational ? "supported" : "missing"} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{kb.purpose}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <p className="text-sm text-muted-foreground">
          Bases de RH ficam fora dos especialistas de chamada; a Política de Jornada é autorizada só ao Especialista de Disponibilidade, e só como
          regra operacional — nunca para inferir motivo pessoal ou saúde.
        </p>
      </WikiSection>

      <WikiSection id="casos-por-kb" title="Casos de uso por Base de Conhecimento" eyebrow="Pelo menos um por base operacional">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Base</TableHead>
                <TableHead>Agent especialista</TableHead>
                <TableHead>Orquestrador</TableHead>
                <TableHead>Exemplos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {KNOWLEDGE_USE_CASES.map((useCase) => (
                <TableRow key={useCase.knowledgeBase}>
                  <TableCell className="font-medium">{useCase.knowledgeBase}</TableCell>
                  <TableCell>{useCase.agent}</TableCell>
                  <TableCell>{useCase.orchestrator}</TableCell>
                  <TableCell>
                    <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                      {useCase.examples.map((example) => (
                        <li key={example}>{example}</li>
                      ))}
                    </ul>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="testes" title="O que os testes garantem" eyebrow="Precisão e isolamento">
        <ul className="list-inside list-disc space-y-1">
          <li><strong>Precisão:</strong> agente com Faturamento, Contestação e Parcelamento; pergunta sobre contestação recupera as etapas de contestação e não injeta parcelamento.</li>
          <li><strong>Isolamento:</strong> o Especialista de Faturamento nunca vê a Política de Férias, mesmo com a pergunta sendo sobre férias — e uma coincidência de uma única palavra não traz seção nenhuma.</li>
          <li><strong>Processo:</strong> transcrição com etapas 1, 2 e 4 → etapa 3 &quot;Não foi possível confirmar&quot;, nunca &quot;Não conforme&quot;.</li>
          <li><strong>Não-invenção:</strong> evidência parafraseada é rebaixada (etapa) ou descarta o resultado (feedback).</li>
          <li><strong>Orçamento:</strong> quantidade e caracteres respeitados; bases pequenas entram inteiras (FULL); sem pertinência = NO_MATCH.</li>
          <li><strong>Catálogo:</strong> toda base autorizada a um Agent ou Orquestrador nesta Wiki existe na auditoria; nenhum Agent concentra mais de um domínio de processo; bases de RH só no Especialista de Disponibilidade.</li>
        </ul>
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações e próxima evolução" eyebrow="Transparência">
        <ul className="list-inside list-disc space-y-1">
          <li>Retrieval é lexical (BM25 sobre trechos), não semântico: sinônimos sem radical em comum podem não casar. Embeddings ficam como evolução — a interface não muda.</li>
          <li>Conformidade de processo exige transcrição (gatilho por Flag de canal).</li>
          <li>Não há versionamento visual/diff entre versões de uma base — só o número da versão atual.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/agents", label: "Agents", hint: "quem consulta a base" },
            { href: "/wiki/qa-lab#knowledge-trace", label: "Rastro de conhecimento no QA Lab", hint: "bases autorizadas × trechos recuperados" },
            { href: "/wiki/casos-praticos#guia-kb", label: "Guia: vincular uma Base de Conhecimento" },
            { href: "/wiki/casos-praticos#guia-auditoria", label: "Guia: auditar uma chamada contra um processo" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
