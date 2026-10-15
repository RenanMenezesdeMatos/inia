import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SeeAlso, StepList, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "IA / Modelos",
  description: "Como conectar uma IA com a própria chave, cadastrar modelo local, decidir qual modelo executa cada função da INIA, fallback, roteamento automático, custos, orçamentos e segurança das API keys.",
}

const TOC: WikiTocEntry[] = [
  { id: "conceitos", label: "Conceitos" },
  { id: "conectar", label: "Como conectar uma IA" },
  { id: "modelo-local", label: "Modelo local" },
  { id: "funcoes", label: "Funções da INIA (Use Cases)" },
  { id: "roteamento", label: "Como configurar o roteamento" },
  { id: "fallback", label: "Como funciona o fallback" },
  { id: "custos", label: "Como entender os custos" },
  { id: "orcamento", label: "Orçamentos" },
  { id: "quem-mais-usa", label: "Quem mais usa" },
  { id: "saude", label: "Saúde das conexões" },
  { id: "seguranca", label: "Segurança das API keys" },
  { id: "legado", label: "Configuração legada do ambiente" },
  { id: "limitacoes", label: "Limitações atuais" },
]

const CONCEPTS: { term: string; meaning: string }[] = [
  { term: "Provider", meaning: "O TIPO de integração (Google Gemini, OpenAI, xAI, Anthropic, servidor compatível com OpenAI, LM Studio, Ollama). Vem pronto na INIA; não é configurado." },
  { term: "Conexão", meaning: "Uma conexão da sua organização com um provider: nome, endpoint, credencial, tempo limite. Ex.: “OpenAI Produção”, “LM Studio da sala de servidores”." },
  { term: "Modelo", meaning: "Um modelo utilizável por uma conexão. O identificador do provider nunca muda; o nome amigável (alias) sim — ex.: “Modelo principal de análise”." },
  { term: "Função da INIA (Use Case)", meaning: "O que a INIA precisa fazer com IA (planejar uma investigação, extrair semântica de transcrições, responder no chat…). A regra de negócio pede a função, nunca um modelo." },
  { term: "Política de roteamento", meaning: "Qual modelo atende cada função: fixo, cadeia de fallback ou automático. Tem rascunho e versão ativa." },
  { term: "Evento de uso", meaning: "Registro de cada chamada: função, provider, modelo, tokens informados, custo estimado, latência, erro e rota escolhida — sem o texto da conversa." },
]

const USE_CASES: { name: string; requires: string; what: string }[] = [
  { name: "Planejamento da investigação", requires: "Ferramentas", what: "Rodadas em que o Agent escolhe quais ferramentas de investigação consultar." },
  { name: "Extração semântica", requires: "Saída estruturada", what: "Leitura de transcrições (inclusive de pares) e tradução de trechos da base em regras." },
  { name: "Síntese de padrões", requires: "Saída estruturada", what: "Promoção de achados e síntese de padrões entre interações." },
  { name: "Atribuição de resultado e procedimento", requires: "Saída estruturada", what: "Anota de quê cada necessidade dependeu e o significado normativo das afirmações." },
  { name: "Resposta do Agent", requires: "Saída estruturada", what: "Síntese final do Agent (feedback, resultado estruturado, texto) e a correção de evidência." },
  { name: "Resposta de especialista", requires: "—", what: "Resposta de um especialista acionado por um Orquestrador." },
  { name: "Roteamento do Orquestrador", requires: "Ferramentas", what: "Decisão de quais especialistas acionar." },
  { name: "Síntese do Orquestrador", requires: "—", what: "Resposta final do Orquestrador (chat, voz e Workflow)." },
  { name: "Síntese gerencial (pós-JOIN)", requires: "Saída estruturada", what: "Consolidação de um fan-out de Workflow." },
  { name: "Diagnóstico do motor de feedback", requires: "Saída estruturada", what: "Análise de uma chamada pelo motor de feedback (cenário, procedimento, caminho e cada critério com evidência), a revisão independente e a investigação de indicador." },
  { name: "Redação e verificação do feedback", requires: "Saída estruturada", what: "Escreve e confere o texto do feedback (motor, redatores e narrativas). Sem política, usa os modelos fixos de sempre; para gerar feedback sem a configuração do ambiente, configure esta função e a de diagnóstico." },
  { name: "Chat de texto", requires: "(streaming, se houver)", what: "Resposta do chat quando não há Orquestrador ativo." },
  { name: "Voz em tempo real", requires: "Áudio + streaming", what: "Sessão de voz do avatar — não configurável nesta versão (usa a configuração do ambiente)." },
  { name: "Voz do recado do avatar", requires: "Áudio + voz no modelo", what: "Lê o texto exato do recado e do “Ouvir com a INIA”. Sem política, a voz da conversa de sempre; com política, o modelo escolhido com a voz e o tom cadastrados nele (hoje: OpenAI e servidores compatíveis)." },
]

export default function AiModelsPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="10 · Administração e Segurança"
        title="IA / Modelos"
        lead="Conectar uma IA com a própria chave, decidir qual modelo executa cada função da INIA e acompanhar tokens, custo, latência e erros — sem editar arquivo de ambiente, sem reiniciar, sem deploy."
      />

      <WikiSection id="conceitos" title="Conceitos" eyebrow="Provider ≠ Conexão ≠ Modelo">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Termo</TableHead>
                <TableHead>O que é</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CONCEPTS.map((concept) => (
                <TableRow key={concept.term}>
                  <TableCell className="font-medium whitespace-nowrap">{concept.term}</TableCell>
                  <TableCell>{concept.meaning}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <WikiFlow
          compact
          steps={[
            { label: "Regra de negócio pede uma função", detail: "ex.: Extração semântica", tone: "core" },
            { label: "Política da organização para a função", detail: "fixo · cadeia de fallback · automático", tone: "ai" },
            { label: "Conexão → Modelo → Adapter do provider", detail: "credencial decifrada só no momento da chamada", tone: "ai" },
            { label: "Evento de uso", detail: "tokens, custo estimado, latência, rota", tone: "output" },
          ]}
        />
      </WikiSection>

      <WikiSection id="conectar" title="Como conectar uma IA" eyebrow="Plug and play">
        <StepList
          steps={[
            { title: "Nova conexão", detail: "Em Administração › IA / Modelos › Conexões, escolha o provider. Os campos mudam conforme ele: API key quando obrigatória, endpoint quando o provider não tem um fixo." },
            { title: "Informe a API key", detail: "A chave é gravada criptografada e nunca mais aparece — a tela mostra só “••••••••” com os 4 últimos caracteres. Depois, só é possível substituir ou remover." },
            { title: "Testar conexão", detail: "Faz uma verificação sem custo (lista os modelos do provider) e mostra o resultado: conectado, credencial recusada, rede, rate limit, endpoint inválido. Latência e horário ficam registrados." },
            { title: "Sincronizar modelos", detail: "Traz os modelos que o provider informa. Quando o provider não informa capacidades (OpenAI, xAI, servidores compatíveis), declare-as em cada modelo antes de usá-lo." },
            { title: "Atribuir a funções", detail: "Em Roteamento, escolha o modelo de cada função, salve o rascunho, teste o roteamento e ative. A partir da ativação a INIA passa a usar o modelo — na próxima chamada." },
          ]}
        />
      </WikiSection>

      <WikiSection id="modelo-local" title="Como cadastrar um modelo local" eyebrow="LM Studio · Ollama · servidor compatível">
        <p>
          Modelos locais são de primeira classe: escolha LM Studio, Ollama ou “Servidor compatível com OpenAI”, informe o endpoint (ex.: a porta do
          LM Studio ou do Ollama) e, se o servidor exigir, um token. Credencial não é obrigatória.
        </p>
        <WarningCallout title="“localhost” é o servidor da INIA, não o seu computador">
          O endpoint é chamado pelo <strong className="font-medium text-foreground">backend da INIA</strong>. Em uma instalação hospedada, “localhost”
          significa o próprio servidor da INIA — não o computador de quem está usando o navegador. O modelo local só funciona se o backend conseguir
          alcançar o endereço (mesma máquina, rede interna/LAN ou VPN). A INIA não acessa o computador do usuário pelo navegador.
        </WarningCallout>
        <p>
          Modelos locais raramente informam capacidades. Declare no modelo o que ele suporta (saída estruturada, ferramentas, streaming…). A origem de
          cada capacidade fica visível: <em>descoberta</em> (informada pelo provider), <em>manual</em> (declarada por você) ou <em>inferida</em> (deduzida
          pela INIA). Um modelo sem ferramentas declaradas nunca é escolhido para uma função que exige ferramentas.
        </p>
        <p>
          O contexto anunciado pelo modelo é uma capacidade dele; o limite de contexto usado de fato é do servidor local (no Ollama, a variável{" "}
          <code>OLLAMA_CONTEXT_LENGTH</code>). Prompts maiores que esse limite são cortados pelo servidor — ajuste-o antes de apontar uma função com
          prompts grandes para o modelo local. Com o modelo local, o conteúdo da chamada fica na máquina onde ele roda; isso vale só para as funções
          roteadas para ele.
        </p>
      </WikiSection>

      <WikiSection id="funcoes" title="Funções da INIA (Use Cases)" eyebrow="Derivadas das chamadas reais">
        <p>Cada função tem requisitos. O roteador nunca escolhe um modelo que não os declare como suportados.</p>
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Função</TableHead>
                <TableHead>Exige</TableHead>
                <TableHead>O que faz</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {USE_CASES.map((useCase) => (
                <TableRow key={useCase.name}>
                  <TableCell className="font-medium">{useCase.name}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{useCase.requires}</TableCell>
                  <TableCell>{useCase.what}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          Voz do recado: cadastre o modelo de voz do provider (ex.: gpt-4o-mini-tts), declare a capacidade Áudio e, em Configurar, informe a Voz
          (ex.: marin) e, se quiser, uma Instrução de tom. Trocar a voz, o tom ou a política gera o áudio de novo — o recado nunca toca a voz
          antiga como se fosse a nova.
        </p>
      </WikiSection>

      <WikiSection id="roteamento" title="Como configurar o roteamento" eyebrow="Fixo · Cadeia de fallback · Automático">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="font-medium text-foreground">Fixo (PINNED):</strong> a função sempre usa aquele modelo. Se ele estiver indisponível, a
            chamada falha com uma mensagem clara — nunca troca de modelo por conta própria.
          </li>
          <li>
            <strong className="font-medium text-foreground">Cadeia de fallback:</strong> 2 a 5 modelos em ordem; o próximo só é tentado quando o erro
            permite (veja abaixo).
          </li>
          <li>
            <strong className="font-medium text-foreground">Automático:</strong> a INIA ordena, de forma determinística, os modelos que você permitiu —
            por custo (preço configurado), por latência (medida nas chamadas reais dos últimos 7 dias), equilibrado (custo + latência) ou por
            qualidade (o <em>tier declarado por você</em>; não existe nota de qualidade inventada). Nunca é uma IA escolhendo outra IA.
          </li>
        </ul>
        <p>
          A política tem <strong className="font-medium text-foreground">rascunho</strong> e <strong className="font-medium text-foreground">versão ativa</strong>.
          “Testar roteamento” mostra qual modelo seria escolhido, por quê, a cadeia, as capacidades e os modelos descartados — sem nenhuma chamada paga.
          Só um rascunho válido pode ser ativado. Se um modelo de uma política ativa for desabilitado depois, a política aparece como inválida. “Desativar
          política” devolve a função à configuração do ambiente.
        </p>
        <p>
          Opcionalmente, um limite de custo por requisição descarta modelos caros. Antes da chamada só a entrada é estimável (o tamanho da resposta é
          desconhecido) — o limite considera apenas a entrada.
        </p>
      </WikiSection>

      <WikiSection id="fallback" title="Como funciona o fallback" eyebrow="Nem todo erro justifica trocar de modelo">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Erro</TableHead>
                <TableHead>Tenta o próximo?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>Rate limit, tempo esgotado, rede, erro interno do provider, modelo indisponível</TableCell><TableCell>Sim (configurável por política)</TableCell></TableRow>
              <TableRow><TableCell>Credencial recusada</TableCell><TableCell>Só se você marcar explicitamente — e fica registrado</TableCell></TableRow>
              <TableRow><TableCell>Requisição inválida, janela de contexto excedida</TableCell><TableCell>Não — trocar de provider não resolve</TableCell></TableRow>
              <TableRow><TableCell>Validação da INIA (resposta sem evidência, formato inválido)</TableCell><TableCell>Não é erro do provider; segue as regras de evidência de sempre</TableCell></TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          Cada tentativa vira um evento de uso com o mesmo identificador de correlação. Não há repetição escondida: a única nova tentativa é o próximo
          modelo da política.
        </p>
      </WikiSection>

      <WikiSection id="custos" title="Como entender os custos" eyebrow="Uso real × preço configurado">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Custo = tokens informados pelo provider × preço por milhão configurado no modelo, calculado pela INIA com precisão decimal — nunca por IA.</li>
          <li>
            Tokens aparecem separados (entrada, saída, raciocínio, cache, total) quando o provider informa. Campo não informado aparece como “não
            informado”, nunca como zero.
          </li>
          <li>
            Preço é versionado por vigência: um preço novo encerra o anterior sem apagá-lo. Cada chamada guarda a versão aplicada — o custo antigo continua
            reproduzível.
          </li>
          <li>Sem preço configurado, o custo fica “desconhecido” e é contado à parte. Preço manual serve para provider novo, contrato enterprise ou modelo local.</li>
          <li>
            Modelo local com preço zero mostra “custo de API 0 · custo computacional não medido” — a INIA não afirma que é grátis.
          </li>
          <li>
            Raciocínio: preencha o preço de raciocínio só quando o provider informa esses tokens fora da saída (Gemini — use o preço de saída). Se ele já
            vem dentro da saída (OpenAI), deixe vazio para não cobrar duas vezes.
          </li>
          <li>
            Funções ainda sem política também têm custo: se o modelo usado pela configuração do ambiente estiver cadastrado (mesmo provider e mesmo id) com
            preço, a chamada é precificada por essa tabela — a rota não muda, só a conta.
          </li>
          <li>Cada moeda aparece separada. Não há conversão de câmbio.</li>
        </ul>
        <p>
          A visão geral mostra gasto, requests, tokens, taxa de erro, latência e fallbacks por período, com custo por dia e quebras por provider, por
          modelo e por função — é a quebra por função que mostra onde a arquitetura gasta.
        </p>
      </WikiSection>

      <WikiSection id="orcamento" title="Orçamentos" eyebrow="Global · por função · por provider">
        <p>
          Um orçamento mensal tem moeda, valor e limiares de aviso (70%, 90% e 100% por padrão). Ao atingir um limiar, quem pode gerenciar a IA (papel Administrador geral) recebe um aviso
          no sino. Com o <strong className="font-medium text-foreground">bloqueio</strong> ligado, novas chamadas pagas do escopo são recusadas com o erro
          “orçamento de IA atingido” — nunca em silêncio. O gasto só é comparado com orçamentos da mesma moeda; chamadas sem custo conhecido são contadas à
          parte. O gasto é lido a cada poucos segundos: chamadas em andamento no instante do limite podem ultrapassá-lo levemente.
        </p>
      </WikiSection>

      <WikiSection id="quem-mais-usa" title="Quem mais usa" eyebrow="Diretoria · Gerência Sênior · Gerência · Grupo · Subgrupo · Supervisor">
        <p>
          A aba <strong className="font-medium text-foreground">Quem mais usa</strong> mostra um ranking do uso de IA pela estrutura. Escolha a visão
          (Diretoria, Gerência Sênior, Gerência, Grupo, Subgrupo ou Supervisor) e, se quiser, filtre por período, Grupo, origem, provider, modelo e
          função. Cada linha soma o uso da pessoa e de toda a estrutura abaixo dela — ou das pessoas do Grupo/Subgrupo — com chamadas, participação no
          total, tokens, custo por moeda e quantas pessoas usaram.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Uso de Workflow conta para o colaborador da execução (a IA trabalhou para ele); o resto conta para quem fez o pedido na tela.</li>
          <li>
            O que não chega a ninguém da visão aparece na linha <strong className="font-medium text-foreground">Sem vínculo</strong>, com o motivo: sem
            pessoa identificada, Workflow sem colaborador ou pessoa sem aquele nível acima dela. Esse uso nunca é atribuído a alguém nem some.
          </li>
          <li>
            Precisa da permissão “Ver quem mais usa a IA por estrutura” (vem com os papéis Administrador geral e Administrador). Quem tem escopo de Grupo ou
            Subgrupo vê só as pessoas desse escopo — de um ramo fora dele, nem o nome nem o número.
          </li>
          <li>A estrutura usada é a de hoje: quem mudou de equipe leva o uso antigo para a equipe atual.</li>
        </ul>
      </WikiSection>

      <WikiSection id="saude" title="Saúde das conexões" eyebrow="Sem verificação periódica cara">
        <p>
          Saudável, degradada, fora do ar ou desconhecida — calculada a partir do último “Testar conexão” e das chamadas reais das últimas 24 horas
          (erros, rate limit na última hora, último sucesso e último erro, latência). A INIA não fica testando o provider em intervalos.
        </p>
      </WikiSection>

      <WikiSection id="seguranca" title="Segurança das API keys" eyebrow="Gravar, substituir, remover — nunca ler">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>A chave é criptografada com a mesma proteção dos segredos da <WikiLink href="/wiki/central-de-dados">Central de Dados</WikiLink>, com a chave de criptografia fora do banco.</li>
          <li>Nenhuma tela, API, log, evento de uso ou auditoria devolve a chave. Mensagens de erro do provider são resumidas antes de chegar à tela.</li>
          <li>Tudo é da organização: outra organização não vê conexões, modelos, uso, custos, políticas nem orçamentos da sua.</li>
          <li>
            Só o papel Administrador geral grava conexões, chaves, políticas e orçamentos. O papel Administrador (em qualquer escopo) vê a configuração e o uso,
            sem alterar.
          </li>
          <li>Criação, troca de chave, desativação, mudança de roteamento, preço e orçamento ficam na auditoria — sem a chave.</li>
          <li>Conexão usada por uma política não pode ser excluída; desabilite-a ou remova-a da política antes.</li>
        </ul>
      </WikiSection>

      <WikiSection id="legado" title="Configuração legada do ambiente" eyebrow="Nada muda até você ativar uma política">
        <p>
          Antes deste módulo, os modelos eram definidos na configuração do servidor. Ela continua valendo para toda função sem política ativa — a tela mostra
          qual modelo cada função usa hoje e se a credencial do ambiente existe (nunca o valor). Nenhuma chave do ambiente é copiada para o banco, e
          nenhum modelo muda sozinho: a troca acontece quando o administrador ativa uma política.
        </p>
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="V1">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>A conversa por voz ainda usa a configuração do ambiente (o uso aparece como sessão iniciada, sem tokens). Com política na voz do recado, o recado pode soar com uma voz diferente da conversa.</li>
          <li>Voz do recado pela OpenAI: o custo fica como desconhecido (a resposta de áudio não informa tokens) e o texto vai até 4.096 caracteres por síntese.</li>
          <li>OpenAI e servidores compatíveis recebem o formato da resposta como orientação (sem imposição estrita); a INIA confere cada resposta antes de usá-la.</li>
          <li>Anthropic: sem streaming e com saída estruturada por instrução.</li>
          <li>OpenAI, xAI e servidores compatíveis não informam capacidades — o administrador declara.</li>
          <li>O limite de custo por requisição considera só a entrada; o bloqueio de orçamento tem uma janela de poucos segundos.</li>
          <li>Não há custo “exato” (nenhum provider informa o valor cobrado por chamada) nem conversão de moeda.</li>
          <li>Preços por modalidade (entrada de áudio) e o armazenamento de cache por hora não são modelados — o preço cadastrado é o de texto.</li>
          <li>Não há playground de chat; “Testar modelo” faz uma única requisição mínima real e avisa que pode gerar custo.</li>
          <li>Em “Quem mais usa”, os pedidos feitos antes de 15/10/2026 não guardavam quem pediu e aparecem como “Sem vínculo”.</li>
        </ul>
      </WikiSection>

      <SeeAlso
        links={[
          { href: "/wiki/administracao", label: "Administração", hint: "Todas as áreas do Admin" },
          { href: "/wiki/qa-lab", label: "QA Lab", hint: "Tokens e eficiência por execução" },
          { href: "/wiki/agents/ferramentas-investigacao", label: "Ferramentas de investigação", hint: "Onde as funções de investigação são usadas" },
          { href: "/wiki/seguranca", label: "Segurança e Escopo" },
        ]}
      />
    </WikiArticle>
  )
}
