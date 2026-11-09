import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExampleCard, SeeAlso, StepList, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { DATA_HUB_CONNECTORS } from "@/components/wiki/data-hub-catalog-data"

export const metadata: Metadata = {
  title: "Conectores da Central de Dados",
  description: "CSV, Excel, API Pull (autenticação, paginação, checkpoint), API Push (endpoint, token, Idempotency-Key, rate limit), SFTP (autenticação, host key, padrão de arquivo, deduplicação) e bancos de dados (SQL Server, PostgreSQL, MariaDB, MySQL).",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Os cinco conectores" },
  { id: "csv", label: "CSV" },
  { id: "excel", label: "Excel" },
  { id: "api-pull", label: "API Pull" },
  { id: "api-push", label: "API Push" },
  { id: "sftp", label: "SFTP" },
  { id: "banco-de-dados", label: "Banco de dados" },
  { id: "wizard", label: "O wizard Nova fonte" },
  { id: "adicionar-feed", label: "Uma fonte, muitos feeds" },
  { id: "futuros", label: "Conectores futuros" },
]

export default function DataHubConnectorsPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="11 · Central de Dados"
        title="Conectores"
        lead="O conector responde COMO buscar ou receber. Cinco existem hoje — importação manual (CSV/Excel), API Pull, API Push, SFTP e banco de dados — e todos entregam registros brutos para a mesma cadeia de mapeamento, contrato, validação e writer."
      />

      <WikiSection id="visao-geral" title="Os cinco conectores" eyebrow="Lado a lado">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conector</TableHead>
                <TableHead>Quem faz o quê</TableHead>
                <TableHead>Configuração</TableHead>
                <TableHead>Autenticação</TableHead>
                <TableHead>Não duplica porque</TableHead>
                <TableHead>Cadência</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DATA_HUB_CONNECTORS.map((connector) => (
                <TableRow key={connector.kind}>
                  <TableCell className="whitespace-nowrap font-medium">{connector.label}</TableCell>
                  <TableCell>{connector.answers}</TableCell>
                  <TableCell className="text-xs">{connector.how}</TableCell>
                  <TableCell className="text-xs">{connector.auth}</TableCell>
                  <TableCell className="text-xs">{connector.dedup}</TableCell>
                  <TableCell className="text-xs">{connector.cadence}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="csv" title="CSV" eyebrow="Importação manual">
        <ul className="list-inside list-disc space-y-1">
          <li>Extensão <code className="font-mono text-xs">.csv</code> (também .txt/.tsv), até 50 MB, com cabeçalho na primeira linha (colunas vazias viram <code className="font-mono text-xs">coluna_N</code>).</li>
          <li>Codificação configurável: UTF-8 (com ou sem BOM), Windows-1252 (Excel brasileiro) ou Latin-1 — decodificação real, nunca &quot;adivinhada&quot; byte a byte.</li>
          <li>Separador <code className="font-mono text-xs">,</code> <code className="font-mono text-xs">;</code> tab ou <code className="font-mono text-xs">|</code>: autodetecção pelas primeiras linhas (respeitando aspas) com override.</li>
          <li>Aspas duplas com escape <code className="font-mono text-xs">&quot;&quot;</code> e quebra de linha dentro de aspas são preservadas.</li>
          <li>Decimal <code className="font-mono text-xs">123.45</code> ou <code className="font-mono text-xs">123,45</code> (autodetecção; a transformação &quot;Interpretar decimal&quot; força um separador). Datas ISO por padrão; dd/MM/yyyy e dd/MM/yyyy HH:mm:ss pela transformação &quot;Interpretar data&quot;.</li>
          <li>Preview de até 20 registros antes de importar; o arquivo fica retido 30 dias para reprocessamento.</li>
        </ul>
      </WikiSection>

      <WikiSection id="excel" title="Excel" eyebrow=".xlsx">
        <ul className="list-inside list-disc space-y-1">
          <li>Só <code className="font-mono text-xs">.xlsx</code>. Arquivos .xls e .xlsm são recusados; macros nunca são executadas — a leitura é só de células (fórmulas entram pelo valor já calculado no arquivo).</li>
          <li>Seleção da aba (sheet); vazio = primeira aba. Datas de célula viram ISO; números continuam números.</li>
          <li>Mesmo fluxo do CSV: upload → tipo de dado → aba → mapeamento → validação → importar → resultado.</li>
        </ul>
      </WikiSection>

      <WikiSection id="api-pull" title="API Pull" eyebrow="A INIA consulta o cliente">
        <p>
          Na <strong>fonte</strong>: Base URL, autenticação (Sem autenticação, Bearer Token, API Key em header, Basic Auth, OAuth2 Client Credentials com Token URL,
          Client ID e scope), headers adicionais e timeout. Em cada <strong>feed</strong>: método (GET/POST), endpoint relativo, query params fixos, caminho dos
          registros (dot path até a lista), paginação e checkpoint.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="Paginação">
            Por número de página (parâmetro da página, do tamanho e tamanho), por offset/limit ou por cursor (parâmetro enviado e caminho do próximo cursor na
            resposta). A INIA para quando a página vem vazia, menor que o tamanho ou sem próximo cursor — com teto de páginas por carga.
          </ExampleCard>
          <ExampleCard title="Checkpoint (watermark)">
            Escolha um campo de data/sequência na resposta e o parâmetro a enviar (ex.: <code className="font-mono text-xs">atualizadoEm</code> → <code className="font-mono text-xs">since</code>). A INIA guarda
            o maior valor visto e só o <strong>avança depois de aplicar com sucesso</strong>; a carga registra checkpoint antes e depois.
          </ExampleCard>
        </div>
        <ul className="list-inside list-disc space-y-1">
          <li>Segredo (token, chave, senha, client secret) cifrado; sai do cofre direto para o header da requisição — nunca para log ou trace. Rotacionar credencial revoga a anterior.</li>
          <li>401/403 = DATA_SOURCE_AUTH_FAILED (fonte fica em Erro até rotacionar e retomar); 5xx/429/rede = DATA_SOURCE_UNREACHABLE (retry com backoff); JSON inválido ou caminho errado = DATA_SOURCE_RESPONSE_INVALID.</li>
          <li>O payload consolidado de cada carga é retido (30 dias) para reprocessamento.</li>
        </ul>
      </WikiSection>

      <WikiSection id="api-push" title="API Push" eyebrow="O cliente envia para a INIA">
        <p>
          O wizard gera o endpoint, o token e o payload de exemplo (do próprio contrato). O cliente chama{" "}
          <code className="font-mono text-xs">POST /api/v1/data-ingestion/&lt;id-público-da-fonte&gt;/&lt;chave-do-feed&gt;</code> com{" "}
          <code className="font-mono text-xs">Authorization: Bearer &lt;token&gt;</code>, <code className="font-mono text-xs">Content-Type: application/json</code> e{" "}
          <code className="font-mono text-xs">Idempotency-Key: &lt;id do lote&gt;</code>; o corpo é <code className="font-mono text-xs">{"{ \"records\": [ ... ] }"}</code> (ou o caminho configurado no feed).
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>Resposta <strong>202</strong> com o id da carga: o processamento é assíncrono, nunca dentro do request. Corpo até 10 MB.</li>
          <li>Mesmo lote com a mesma Idempotency-Key devolve a <em>mesma</em> carga (<code className="font-mono text-xs">deduplicated: true</code>) — nada duplica.</li>
          <li>
            A mesma Idempotency-Key com um corpo <em>diferente</em> é recusada com <strong>422</strong> (<code className="font-mono text-xs">DATA_PUSH_IDEMPOTENCY_CONFLICT</code>): lote novo
            precisa de chave nova — antes ele se perderia em silêncio.
          </li>
          <li>Token por fonte (ou restrito a um feed): só o hash é guardado; o valor aparece uma vez; revogar e rotacionar na aba Visão geral da fonte. Erros de credencial são genéricos de propósito (não revelam se a fonte existe).</li>
          <li>
            Cada token tem <strong>validade</strong> (90 dias a 2 anos; padrão 1 ano) e, se quiser, uma lista de <strong>IPs autorizados</strong> (um IP ou uma rede, como{" "}
            <code className="font-mono text-xs">10.0.0.0/24</code>). Vencido ou chamado de outro endereço, o token recebe a mesma recusa de um token inexistente.
            Rotacionar mantém a validade e os IPs. Tokens antigos, criados antes disso, seguem sem validade até serem rotacionados.
          </li>
          <li>O token é conferido <em>antes</em> de o corpo ser lido: quem não tem token válido nunca faz a INIA ler 10 MB.</li>
          <li>Fonte pausada ou feed inativo respondem 409 com a orientação.</li>
          <li>Limite por token: 60 requisições por minuto, somadas entre todas as APIs da instalação.</li>
          <li>
            <strong>Baixar OpenAPI</strong> (na fonte, ao lado dos tokens) gera na hora a especificação OpenAPI 3.1 dos envios desta fonte: um caminho por
            feed, os nomes de campo do sistema do cliente (pelo mapeamento), os tipos do contrato e as respostas de erro. Serve para o time que integra
            importar no Postman ou no Swagger; não leva token nem segredo.
          </li>
        </ul>
      </WikiSection>

      <WikiSection id="sftp" title="SFTP" eyebrow="A INIA busca arquivos">
        <ul className="list-inside list-disc space-y-1">
          <li>Fonte: host, porta, usuário, diretório remoto, autenticação por senha ou chave privada (PEM, com passphrase opcional), timeout e fingerprint SHA-256 da host key.</li>
          <li>Host key: com fingerprint configurada, a conexão só é aceita se bater (DATA_SOURCE_AUTH_FAILED caso contrário). Sem fingerprint, a verificação não é desligada silenciosamente — a recomendação é fixá-la assim que o servidor for confirmado.</li>
          <li>Feed: padrão de arquivo (glob simples: <code className="font-mono text-xs">employees_*.csv</code>, <code className="font-mono text-xs">medicoes_????.xlsx</code>), formato e opções de CSV/Excel. Cada padrão é um feed; o wizard lista os arquivos remotos e usa o mais recente como amostra.</li>
          <li>A cada carga entra <strong>um</strong> arquivo: o mais antigo do padrão ainda não processado. Deduplicação por checksum do conteúdo (mais caminho/tamanho/data como pré-filtro): o mesmo arquivo nunca é reprocessado sem pedido explícito.</li>
          <li>Um arquivo só é marcado como processado depois de uma carga Concluída ou Parcial — se a carga falhar, ele volta a ser candidato.</li>
        </ul>
        <WarningCallout kind="tip" title="Testes não dependem de internet">
          Os testes automatizados usam um servidor HTTP simulado e um SFTP em memória com o mesmo contrato dos adaptadores reais — inclusive para provar dedup,
          checkpoint e falha de credencial.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="banco-de-dados" title="Banco de dados" eyebrow="A INIA lê o banco do cliente">
        <p>
          <strong>Administração › Central de Dados › Conectar banco de dados</strong> abre um assistente próprio: banco (SQL Server, PostgreSQL, MariaDB ou MySQL),
          conexão e <strong>Testar conexão</strong> (obrigatório), tabela ou visão, conjunto de dados da INIA e como ler, amostra e mapeamento, validação e ativação.
          A conexão parte do servidor da INIA, não do navegador — bancos em rede privada precisam estar acessíveis a partir dele.
        </p>
        <p>
          O SQL das tabelas que o cliente precisa criar e o significado de cada campo estão em <WikiLink href="/wiki/central-de-dados/banco-do-cliente">Tabelas no banco do cliente</WikiLink>.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="Incremental — só o que mudou">
            Um campo de data/hora (ou número) que muda sempre que a linha muda, mais uma chave de desempate (já vem a chave primária). Cada carga lê só o que vem
            depois da última posição aplicada; a posição avança junto com cada página aplicada — falhou no meio, a próxima carga retoma dali sem duplicar.
          </ExampleCard>
          <ExampleCard title="Leitura completa">
            Sem campo confiável de atualização, cada carga relê a tabela inteira e a INIA só aplica o que mudou. Com chave, a leitura é em páginas e também retoma do
            meio. Passou do limite por carga, a continuação entra sozinha na fila.
          </ExampleCard>
        </div>
        <ul className="list-inside list-disc space-y-1">
          <li>Só tabelas e visões escolhidas na tela — nunca SQL livre. Para filtrar ou juntar tabelas, o cliente cria uma visão no próprio banco.</li>
          <li>A INIA nunca cria, altera ou apaga nada no banco do cliente: só consultas de leitura, com a sessão aberta em modo somente leitura e limites de tempo e de volume. Use um usuário com permissão só de leitura.</li>
          <li>Senha cifrada e nunca exibida; em branco na edição = manter a guardada. Criptografia (TLS) e instância nomeada (SQL Server) ficam nas opções avançadas.</li>
          <li>Uma conexão alimenta vários conjuntos: &quot;Adicionar outro conjunto desta conexão&quot; começa direto na escolha da tabela.</li>
          <li>Cada carga confere a tabela de novo: coluna mapeada que sumiu = DATA_SCHEMA_CHANGED; permissão retirada = DATA_SOURCE_PERMISSION_DENIED; certificado recusado = DATA_SOURCE_TLS_FAILED.</li>
          <li>No conjunto de dados, &quot;Ler tudo de novo na próxima carga&quot; zera a posição — o upsert evita duplicar.</li>
        </ul>
      </WikiSection>

      <WikiSection id="wizard" title="O wizard Nova fonte" eyebrow="11 etapas">
        <StepList
          steps={[
            { title: "Tipo da conexão", detail: "Importação manual, API Pull, API Push ou SFTP (banco de dados tem assistente próprio: Conectar banco de dados)." },
            { title: "Configurar conexão", detail: "Nome, descrição, parâmetros não secretos e credenciais (guardadas cifradas)." },
            { title: "Testar conexão", detail: "API Pull e SFTP; fontes passivas pulam esta etapa." },
            { title: "Adicionar feed", detail: "Nome, chave, contrato de dados e conector (endpoint/paginação/checkpoint, padrão de arquivo, aba/separador, caminho do JSON)." },
            { title: "Buscar amostra", detail: "Até 20 registros da própria fonte (ou do arquivo/payload de exemplo)." },
            { title: "Mapear campos", detail: "Sugestão por nome + transformações declarativas; o usuário confirma." },
            { title: "Validar", detail: "Preview ✓/✕ por registro e por campo, zero efeito." },
            { title: "Frequência", detail: "Cadência, modo de carga, fonte autoritativa, carga íntegra, namespace de origem." },
            { title: "Revisar", detail: "Resumo de tudo." },
            { title: "Ativar", detail: "Cria e ativa o feed (e a fonte); para API Push gera o token e mostra endpoint + payload de exemplo." },
          ]}
        />
        <p>
          A importação de arquivo tem um fluxo próprio, mais curto: <WikiLink href="/wiki/central-de-dados/guias#csv">Como importar um CSV</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="adicionar-feed" title="Uma fonte, muitos feeds" eyebrow="Adicionar feed a uma fonte existente">
        <p>
          Uma fonte é a conexão (host, autenticação, segredos); cada feed é um conjunto de dados dessa conexão. A mesma API de RH costuma servir vários contratos:
        </p>
        <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">{`API RH (API Pull, Bearer)
├── Colaboradores            (EMPLOYEES)            /v1/employees        a cada 1h
├── Ausências de colaboradores (EMPLOYEE_ABSENCES)  /v1/absences?since=  a cada 1h
├── Jornadas de trabalho     (WORK_SCHEDULES)       /v1/shifts           diário
└── Escalas de trabalho      (WORK_SCHEDULE_DAYS)   /v1/schedule-days    a cada 1h (snapshot D-7 a D+30)`}</pre>
        <p>
          Na fonte, aba <strong>Feeds</strong>, o botão <strong>+ Adicionar feed</strong> abre o mesmo wizard começando em <em>Adicionar feed</em>: tipo, conexão e teste
          são pulados porque já existem — nada de credencial de novo. O que cada feed tem de próprio: em API Pull, endpoint, caminho do JSON, paginação e checkpoint;
          em SFTP, o padrão de nome de arquivo; em Importação manual, aba/separador. Mapeamento, validação, frequência, revisão e ativação seguem iguais. Um novo feed
          nunca altera os feeds já ativos da fonte.
        </p>
      </WikiSection>

      <WikiSection id="futuros" title="Conectores futuros" eyebrow="Arquitetura preparada">
        <p>
          Um conector novo (por exemplo, um data lake com API própria) é um adaptador que entrega registros brutos — o resto (contratos, mapeamento,
          validação, writers, cargas, quarentena, linhagem) não muda. Conectores específicos de fornecedor (Salesforce, SAP, Genesys, Google Drive) não
          existem nesta versão.
        </p>
      </WikiSection>

      <SeeAlso
        links={[
          { href: "/wiki/central-de-dados", label: "Central de Dados", hint: "conceito, contratos, cargas, quarentena, linhagem" },
          { href: "/wiki/central-de-dados/guias", label: "Guias e troubleshooting" },
          { href: "/wiki/seguranca", label: "Segurança e Escopo" },
        ]}
      />
    </WikiArticle>
  )
}
