import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExampleCard, SeeAlso, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { DATA_HUB_CONTRACTS, DATA_HUB_RUN_STATES } from "@/components/wiki/data-hub-catalog-data"

export const metadata: Metadata = {
  title: "Central de Dados",
  description: "A porta única de entrada dos dados do cliente: Fonte, Feed, Contrato de Dados, Mapeamento, Validação, Domain Writer, Cargas, Quarentena, Linhagem, Saúde × Atualidade e Segurança.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "O que é" },
  { id: "principio", label: "Princípio: sem integração por indicador" },
  { id: "camadas", label: "As camadas" },
  { id: "fonte", label: "Fonte" },
  { id: "feed", label: "Feed" },
  { id: "periodicidade", label: "Periodicidade das cargas" },
  { id: "contrato", label: "Contrato de Dados" },
  { id: "catalogo", label: "Catálogo de contratos" },
  { id: "mapping", label: "Mapeamento e transformações" },
  { id: "validacao", label: "Validação e referências" },
  { id: "writer", label: "Domain Writer e efeitos" },
  { id: "master-event", label: "Dado mestre × dado de evento" },
  { id: "situacao-funcional", label: "Situação funcional" },
  { id: "escalas", label: "Escalas de trabalho" },
  { id: "cargas", label: "Cargas (Runs)" },
  { id: "quarentena", label: "Quarentena e qualidade" },
  { id: "severidades", label: "Erros × avisos × rejeitados" },
  { id: "lineage", label: "Linhagem" },
  { id: "saude-freshness", label: "Saúde × Atualidade" },
  { id: "configurar-com-senha", label: "Configurar exige a senha da fonte" },
  { id: "consultar-dados", label: "Consultar dados" },
  { id: "cancelar-registros", label: "Cancelar registros" },
  { id: "itens-excluidos", label: "Itens excluídos" },
  { id: "registro", label: "Registro" },
  { id: "seguranca", label: "Segurança" },
  { id: "limitacoes", label: "Limitações atuais" },
]

export default function DataHubPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="11 · Central de Dados"
        title="Central de Dados"
        lead="Como os dados do cliente entram na INIA — não &quot;como importar uma planilha&quot;. Colaboradores, estrutura, medições, fechamentos, PRV, interações, transcrições e flags entram por uma única porta, com contratos genéricos, mapeamento, validação, cargas rastreáveis, quarentena e linhagem."
      />

      <WikiSection id="visao-geral" title="O que é" eyebrow="Porta única de entrada">
        <p>
          A Central de Dados (Admin › Dados › Central de Dados) centraliza conexões, integrações, arquivos, mapeamentos, validações, execuções de
          carga, qualidade, erros, status, observabilidade, linhagem e histórico. Tudo o que a INIA precisa receber do cliente passa por ela; tudo o que
          a INIA <em>produz</em> (feedbacks, alertas, resultados de Workflow, QA Runs) não entra aqui — não é dado de entrada só porque existe no banco.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="Perguntas que cada peça responde">
            <ul className="list-inside list-disc space-y-0.5 text-sm">
              <li><strong>Conector</strong>: como buscar/receber.</li>
              <li><strong>Feed</strong>: qual conjunto de dados.</li>
              <li><strong>Contrato</strong>: qual formato a INIA entende.</li>
              <li><strong>Mapeamento</strong>: como o formato do cliente vira o da INIA.</li>
              <li><strong>Validador</strong>: o dado é válido?</li>
              <li><strong>Domain Writer</strong>: como ele entra no domínio.</li>
              <li><strong>Linhagem</strong>: de onde esse dado veio?</li>
              <li><strong>Carga</strong>: o que aconteceu nessa execução?</li>
              <li><strong>Saúde</strong>: está funcionando? · <strong>Atualidade</strong>: os dados estão atualizados?</li>
            </ul>
          </ExampleCard>
          <ExampleCard title="A Home responde primeiro">
            Está tudo funcionando? Quando os dados foram atualizados? Alguma fonte com erro? Algum conjunto atrasado? Quanto chegou hoje? Quanto foi
            rejeitado? — e só depois entra em configuração. É uma tela operacional, não um BI.
          </ExampleCard>
        </div>
      </WikiSection>

      <WikiSection id="principio" title="Princípio: sem integração por indicador" eyebrow="Novo indicador não exige novo conector">
        <WikiFlow
          compact
          steps={[
            { label: "API / arquivo do cliente", detail: "o formato dele", tone: "input" },
            { label: "Feed “Medições operacionais”", detail: "um conjunto de dados da fonte", tone: "core" },
            { label: "Mapeamento", detail: "matricula → externalEmployeeId, indicador → indicatorCode…", tone: "core" },
            { label: "Contrato INDICATOR_MEASUREMENTS", detail: "o formato que a INIA entende", tone: "core" },
            { label: "Medições no domínio", detail: "mesmo caminho da ingestão em tempo real", tone: "output" },
          ]}
        />
        <p>
          Não existe &quot;uma integração para cada indicador&quot;, &quot;um endpoint para TMA&quot; nem &quot;uma tabela para FCR&quot;. O mesmo feed de
          medições recebe TMA, FCR, Taxa Digital ou um indicador criado amanhã: o código do indicador é <strong>dado</strong> (
          <code className="font-mono text-xs">indicatorCode</code>), resolvido contra o catálogo de indicadores. Se o indicador existe e está ativo, a medição
          entra imediatamente — e os componentes exigidos (valor, numerador, denominador) vêm da{" "}
          <WikiLink href="/wiki/indicadores/configuracao">estratégia configurada no catálogo</WikiLink>, nunca de uma regra repetida na Central. O mesmo vale
          para Grupos: um Grupo novo é configuração, não conector.
        </p>
      </WikiSection>

      <WikiSection id="camadas" title="As camadas" eyebrow="Nada conecta direto no domínio">
        <WikiFlow
          steps={[
            { label: "Fonte", detail: "de onde os dados vêm (API RH, banco de dados, data lake, SFTP, importação manual)", tone: "input" },
            { label: "Feed", detail: "que conjunto de dados a fonte entrega (colaboradores, medições…)", tone: "input" },
            { label: "Conector", detail: "CSV/Excel, API Pull, API Push, SFTP, banco de dados — como buscar/receber", tone: "core" },
            { label: "Raw / Staging", detail: "conteúdo bruto retido (30 dias) para amostra, validação e reprocessamento", tone: "core" },
            { label: "Mapeamento", detail: "campo de origem → campo INIA, com transformações declarativas", tone: "core" },
            { label: "Contrato de Dados", detail: "campos, tipos, obrigatórios, chave natural, dependências, política", tone: "core" },
            { label: "Validação", detail: "estrutura + regras do contrato + referências em lote", tone: "core" },
            { label: "Domain Writer", detail: "upsert idempotente pelos mesmos caminhos canônicos do domínio", tone: "output" },
            { label: "Carga + Quarentena + Linhagem", detail: "o que aconteceu, o que foi rejeitado, de onde cada registro veio", tone: "output" },
          ]}
        />
        <WarningCallout title="Nenhum conector escreve direto em tabela">
          Um CSV nunca vira INSERT em pessoas; uma API nunca vira INSERT em medições. Tudo passa por mapeamento → contrato → validação → writer, e o
          writer usa os mesmos serviços do domínio (matrícula de Workflows por indicador/flag, evento de transcrição recebida, situação funcional
          canônica). A Central não cria um caminho paralelo que burle elegibilidade, eventos ou validações.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="fonte" title="Fonte" eyebrow="De onde os dados vêm">
        <p>
          Uma Fonte tem tipo (Importação manual, API Pull, API Push, SFTP, Banco de dados), nome, configuração <em>não secreta</em> (base URL, host, autenticação escolhida) e
          credenciais guardadas à parte, cifradas. Uma fonte pode ter <strong>vários feeds</strong>: a mesma API corporativa entrega{" "}
          <code className="font-mono text-xs">/employees</code>, <code className="font-mono text-xs">/interactions</code> e{" "}
          <code className="font-mono text-xs">/measurements</code> como três feeds da mesma conexão — nunca uma conexão por dataset.
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Status</strong> (decisão administrativa + falha): Rascunho · Ativa · Pausada · Erro (credencial recusada).</li>
          <li><strong className="font-medium text-foreground">Conexão</strong> (consigo chegar/autenticar?): Conexão OK · Conexão com erro · Não testada.</li>
          <li><strong className="font-medium text-foreground">Ações</strong>: Testar conexão, Sincronizar agora, Pausar, Retomar, Editar, Rotacionar credencial, Remover.</li>
        </ul>
        <p>Detalhe da fonte: Visão geral (última carga, último sucesso, último dado, próxima sincronização, registros, rejeitados), Feeds, Cargas, Qualidade e Configuração.</p>
      </WikiSection>

      <WikiSection id="feed" title="Feed" eyebrow="Qual conjunto de dados">
        <p>
          Um Feed aponta para <strong>um</strong> Contrato de Dados (com versão), tem uma chave (usada na URL do push e nos logs), a configuração do conector
          (endpoint/padrão de arquivo/aba/separador), o mapeamento, o modo de carga, a cadência e a política de rejeição. Estados: Rascunho (mapeamento
          incompleto), Ativo, Pausado e <strong>Degradado</strong> — a origem deixou de entregar uma coluna obrigatória (mudança de esquema).
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Cadência</strong> (API Pull, SFTP e banco de dados): quando a carga roda, das opções prontas a dias e horários escolhidos, sempre no fuso da operação (<WikiLink href="#periodicidade">Periodicidade das cargas</WikiLink>). Arquivo e push são sob demanda.</li>
          <li><strong className="font-medium text-foreground">Modo de carga</strong>: Delta (só o que veio muda) ou Snapshot (estado completo). Em ambos, ausência de um registro <strong>nunca</strong> desativa nada nesta versão; desfazer é sempre explícito (<strong>Vigente? = não</strong> em Ausências e em Exceções de calendário).</li>
          <li><strong className="font-medium text-foreground">Fonte autoritativa</strong>: um único feed autoritativo ativo por contrato de dado mestre por organização — duas fontes nunca brigam pelo mesmo cadastro.</li>
          <li><strong className="font-medium text-foreground">Exigir carga íntegra</strong>: qualquer rejeição impede a carga inteira (opt-in por feed).</li>
          <li><strong className="font-medium text-foreground">Namespace de origem</strong>: identidade da origem em medições e fechamentos (coluna <code className="font-mono text-xs">source</code>); padrão = id público da fonte.</li>
          <li><strong className="font-medium text-foreground">Remover</strong> (lixeira no detalhe do feed): o conjunto de dados sai da Central e para de sincronizar; a conexão e os outros feeds dela continuam, o histórico de cargas e a linhagem ficam para auditoria e os dados já aplicados continuam existindo.</li>
        </ul>
      </WikiSection>

      <WikiSection id="periodicidade" title="Periodicidade das cargas" eyebrow="Quando a carga roda">
        <p>
          Cada feed de API Pull, SFTP ou banco de dados escolhe a sua, no assistente ou em <strong>Conector e frequência</strong> no detalhe do feed. Ela deve acompanhar a atualização
          daquela tabela e cair depois das rotinas do cliente. A tela mostra a frase do resultado e as próximas execuções antes de salvar, calculadas da mesma forma que o agendador.
        </p>
        <WikiTable caption="Formas de periodicidade. Todos os horários estão no fuso da operação.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Forma</TableHead>
                <TableHead>O que se escolhe</TableHead>
                <TableHead>Exemplo na tela</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Manual</TableCell>
                <TableCell>Nada: só roda em Sincronizar agora.</TableCell>
                <TableCell>Manual</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>A cada 15 min, 1 h ou 6 h</TableCell>
                <TableCell>Opção pronta.</TableCell>
                <TableCell>A cada 6h</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>A cada N minutos ou horas</TableCell>
                <TableCell>De 15 minutos a 24 horas.</TableCell>
                <TableCell>A cada 45 min</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Diário</TableCell>
                <TableCell>Um ou mais horários.</TableCell>
                <TableCell>Diário às 06:00 e 18:00</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>A cada N dias</TableCell>
                <TableCell>De 1 a 90 dias, a data de início e um ou mais horários. A contagem parte dessa data e não muda com uma carga manual.</TableCell>
                <TableCell>A cada 3 dias às 06:00</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Em dias da semana</TableCell>
                <TableCell>Os dias e um ou mais horários.</TableCell>
                <TableCell>Seg a sex às 06:00 e 18:00</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Em um dia do mês</TableCell>
                <TableCell>Um dia de 1 a 31, ou o último dia do mês, e um ou mais horários. Mês sem o dia escolhido (31 em abril) não tem carga; para rodar todo mês, use o último dia.</TableCell>
                <TableCell>Todo dia 5 às 06:00</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Limites</strong>: pelo menos 15 minutos entre cargas, também entre dois horários escolhidos (inclusive 23:55 e 00:05), porque um intervalo menor pesa no banco do cliente; até 12 horários. O backend recusa o que passar disso. Um feed gravado antes dessa regra com intervalo menor continua rodando e salvando; só não aceita outro valor abaixo do mínimo.</li>
          <li><strong className="font-medium text-foreground">Intervalo × horário escolhido</strong>: o intervalo conta a partir do fim da carga anterior, então o horário do dia varia. Para não cair em cima de uma rotina do cliente, escolha dias e horários.</li>
          <li><strong className="font-medium text-foreground">Cargas nunca se empilham</strong>: se a anterior ainda está rodando, ou esperando uma nova tentativa, aquele horário é pulado.</li>
          <li><strong className="font-medium text-foreground">Processamento parado no horário</strong>: a carga perdida roda uma única vez assim que ele volta, mesmo fora do horário escolhido.</li>
          <li><strong className="font-medium text-foreground">Retomar uma fonte pausada</strong>: quem escolheu horários espera o próximo; intervalo roda em seguida. Para carregar na hora, use Sincronizar agora.</li>
          <li><strong className="font-medium text-foreground">Atrasado segue a agenda real</strong>: com dias e horários, um horário perdido é tolerado, e o feed fica Atrasado uma hora depois do segundo horário perdido. Seg a sex com sucesso na sexta segue Atualizado o fim de semana inteiro. Com intervalo, vale 2× o intervalo. Manual nunca atrasa.</li>
          <li><strong className="font-medium text-foreground">Periodicidade ≠ disponibilidade (SLA)</strong>: a periodicidade diz quando a carga roda; o SLA diz quando o dado de um dia já deveria ter chegado. Um não ajusta o outro: com carga de seg a sex e SLA D-1, a fonte pode aparecer atrasada no SLA do fim de semana. Configure os dois de forma coerente.</li>
        </ul>
      </WikiSection>

      <WikiSection id="contrato" title="Contrato de Dados" eyebrow="O formato que a INIA entende">
        <p>
          Cada conjunto de dados tem <strong>uma</strong> definição canônica, versionada (<code className="font-mono text-xs">EMPLOYEES@1</code>): campos, tipos,
          obrigatórios, campo identidade, chave natural, dependências, semântica de escrita (upsert de dado mestre ou evento idempotente), política de
          aplicação (parcial ou atômica), campo de tempo de negócio e exemplos. Feeds e cargas guardam contrato + versão. A tela Contratos de dados mostra
          tudo isso e o payload de exemplo do API Push, gerado do próprio contrato.
        </p>
        <p>
          Mudar um contrato cria uma <strong>versão nova</strong>, e feed nenhum muda de versão em silêncio: feed novo nasce na versão atual; feed criado antes
          continua lendo pela versão dele (o detalhe do feed avisa) e passa para a atual quando o mapeamento é salvo de novo — a troca fica na auditoria. Exemplos:{" "}
          <code className="font-mono text-xs">EMPLOYEE_ABSENCES@2</code> acrescentou o campo opcional <strong>Vigente?</strong> às Ausências;{" "}
          <code className="font-mono text-xs">INTERACTIONS@2</code> acrescentou o <strong>Submotivo</strong> às Interações.
        </p>
        <ExampleCard title="Identidade: identificador externo estável, nunca nome">
          Colaborador = matrícula (<code className="font-mono text-xs">externalEmployeeId</code>); Grupo/Subgrupo = código externo (
          <code className="font-mono text-xs">externalCode</code>, único na organização); interação = <code className="font-mono text-xs">externalInteractionId</code>;
          indicador = <code className="font-mono text-xs">indicatorCode</code> do catálogo.
        </ExampleCard>
        <ExampleCard title="Interações: Motivo × Submotivo">
          <strong>Motivo</strong> (obrigatório) é a categoria genérica do contato — ex.: Fatura. <strong>Submotivo</strong> (opcional, até 200
          caracteres) é o recorte específico dentro dele — ex.: Segunda via, Dúvidas sobre faturamento. Os dois entram como a fonte cadastrou: a INIA
          nunca deriva um do outro nem classifica com IA. Submotivo vazio mantém o que já foi recebido para a interação; texto longo demais vai para a
          quarentena. Na sugestão de mapeamento, uma coluna &quot;Submotivo&quot; ou &quot;Subassunto&quot; já vira o campo. Nas comparações, o
          assunto é o Submotivo (sem submotivo, o Motivo); o Motivo continua disponível como um recorte a mais.
        </ExampleCard>
      </WikiSection>

      <WikiSection id="catalogo" title="Catálogo de contratos" eyebrow="Fonte única: registro do backend">
        <WikiTable caption="Contratos suportados hoje — o teste do backend garante que esta tabela e o registro coincidem.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contrato</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead>Chave natural</TableHead>
                <TableHead>Depende de</TableHead>
                <TableHead>Política</TableHead>
                <TableHead>Observações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DATA_HUB_CONTRACTS.map((contract) => (
                <TableRow key={contract.key}>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-medium">{contract.label}</span>
                    <br />
                    <span className="font-mono text-xs text-muted-foreground">
                      {contract.key}@{contract.version ?? 1}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{contract.category}</TableCell>
                  <TableCell>{contract.target}</TableCell>
                  <TableCell className="font-mono text-xs">{contract.naturalKey}</TableCell>
                  <TableCell className="font-mono text-xs">{contract.dependsOn.join(", ") || "—"}</TableCell>
                  <TableCell>{contract.policy}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{contract.notes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <WarningCallout kind="tip" title="Por que não existe contrato de Definição de indicador">
          O catálogo de indicadores é <em>configuração interna</em> da INIA (unidade, direção, estratégia, capacidades), protegido por bloqueio semântico com
          histórico. Recebê-lo por carga permitiria reinterpretar o histórico por acidente. Novo indicador = cadastro na tela Indicadores; medição =
          contrato de medições.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="mapping" title="Mapeamento e transformações" eyebrow="Determinístico, sem IA">
        <p>
          Depois de escolher o contrato, a Central mostra campo de origem → campo INIA. A sugestão automática é por <strong>nome</strong> (exato normalizado
          e sinônimos comuns: matrícula, nome_colaborador, gestor_matricula…), e o usuário confirma — nenhum LLM sugere coluna. Origem pode ser uma coluna
          (CSV/Excel) ou um dot path no JSON (<code className="font-mono text-xs">data.items[0].id</code>).
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>Transformações seguras e declarativas: remover espaços, maiúsculas/minúsculas, interpretar data (ISO, dd/MM/yyyy, dd/MM/yyyy HH:mm:ss, MM/dd/yyyy, yyyyMMdd), interpretar decimal (vírgula ou ponto), mapear sim/não, valor padrão quando vazio, valor fixo, mapear códigos (Atendente → OPERATOR).</li>
          <li>Nunca: JavaScript arbitrário, eval ou expressão executável.</li>
          <li>Data/hora sem fuso é interpretada no fuso da organização; decimal sem transformação é autodetectado (123,45 e 1.234,56 são BR).</li>
          <li><strong className="font-medium text-foreground">Preview</strong>: até 20 registros da amostra, ✓ válido ou ✕ com erro por campo (&quot;Linha 18 · externalEmployeeId obrigatório&quot;, &quot;Linha 31 · indicatorCode XYZ não existe&quot;). Zero efeito: nenhuma carga, nenhuma escrita, nenhum Workflow.</li>
          <li><strong className="font-medium text-foreground">Fingerprint do esquema</strong>: as colunas observadas ficam guardadas no feed; se a origem remover uma coluna mapeada para campo obrigatório, a carga falha com DATA_SCHEMA_CHANGED e o feed fica Degradado.</li>
        </ul>
      </WikiSection>

      <WikiSection id="validacao" title="Validação e referências" eyebrow="Antes de aplicar, em lote">
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Estrutura</strong>: tipos, obrigatórios, &quot;ao menos um de&quot; (data ou período) e regras do contrato (fim depois do início, confiança entre 0 e 1…).</li>
          <li><strong className="font-medium text-foreground">Referências</strong>: colaborador, indicador, Grupo, Subgrupo, interação e flag são resolvidos <em>em lote</em> (uma consulta por tipo por carga — zero N+1). Referência inexistente vai para a quarentena; a Central <strong>nunca</strong> cria pessoa, indicador, grupo ou interação implicitamente.</li>
          <li><strong className="font-medium text-foreground">Catálogo</strong>: medição diária exige indicador com medição operacional habilitada; fechamento exige fechamento oficial habilitado; Taxa/Média ponderada exigem numerador e denominador e o valor precisa conferir com numerador ÷ denominador; em Soma, Média simples e Último valor, a linha com numerador e denominador vai para a quarentena, na medição e no fechamento.</li>
          <li><strong className="font-medium text-foreground">Duplicidade na carga</strong>: a mesma chave natural repetida no mesmo lote — a primeira vale, as demais vão para a quarentena.</li>
          <li><strong className="font-medium text-foreground">Ordem de dependências</strong>: se o filho chega antes do pai (flag antes da interação, medição antes do colaborador), fica na quarentena — nunca um pai fake.</li>
        </ul>
      </WikiSection>

      <WikiSection id="writer" title="Domain Writer e efeitos" eyebrow="Mesmos serviços canônicos">
        <p>
          O writer de cada contrato aplica em lotes de 1.000 registros (inserção multi-linha, nunca um INSERT por registro), com upsert pela chave natural
          que só reescreve o que mudou — por isso a carga conta inseridos, atualizados e inalterados. O que mudou de verdade dispara os efeitos normais do
          domínio:
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>Medição nova/alterada → matrícula em Workflows por Indicador (mesma função da ingestão em tempo real). Medição inalterada não rematricula.</li>
          <li>Flag nova/alterada → matrícula em Workflows por Flag. Transcrição nova/alterada → evento de transcrição recebida (QA Lab, Agents e retrieval continuam funcionando sem saber por onde o dado entrou).</li>
          <li>Situação funcional (férias/afastamento) → serviço canônico de situação, único que escreve o histórico.</li>
          <li>Preview, amostra e teste de conexão nunca disparam nada: só uma carga aplicada tem efeito.</li>
        </ul>
        <p>
          <strong className="font-medium text-foreground">Atomicidade</strong>: contratos parciais aplicam lote a lote em transações próprias — uma falha de banco no
          lote N deixa N−1 lotes aplicados, a carga fica Falhou com as contagens reais e o reprocessamento é idempotente. Contratos atômicos (Estrutura
          organizacional) ou feeds com &quot;exigir carga íntegra&quot; só aplicam sem nenhuma rejeição, numa transação única.
        </p>
      </WikiSection>

      <WikiSection id="master-event" title="Dado mestre × dado de evento" eyebrow="Autoridade da fonte">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="Dado mestre (Colaboradores, Estrutura, Grupos, Subgrupos, Jornadas, Ausências)">
            Upsert controlado pela identidade externa. Campo opcional ausente mantém o atual. Uma fonte autoritativa ativa por contrato por organização;
            uma segunda é bloqueada explicitamente — sem MDM completo nesta versão. Campo de pessoa que Colaboradores ou Estrutura organizacional traz
            fica só leitura na INIA para quem a carga já aplicou: corrige-se na origem (ver{" "}
            <WikiLink href="/wiki/administracao#usuarios">Usuários e acessos</WikiLink>).
          </ExampleCard>
          <ExampleCard title="Dado de evento (Medições, Interações, Transcrições, Flags, Fechamentos, PRV)">
            Idempotência por identificador externo + namespace de origem: várias fontes podem coexistir se mantiverem identidades claras. Mesmo arquivo ou
            mesmo lote duas vezes nunca duplica.
          </ExampleCard>
        </div>
        <p>
          <strong>Identidade em Colaboradores.</strong> A matrícula é a identidade da pessoa. Uma matrícula nova que chega com o e-mail da conta de
          login de uma pessoa cadastrada à mão na INIA (sem matrícula) é gravada nessa pessoa, em vez de criar outra: login e papéis continuam, e a
          carga registra o aviso <code>DATA_PERSON_LINKED_BY_EMAIL</code>, com auditoria e linhagem. E-mail repetido na mesma carga não liga ninguém.
          Nome igual ao de uma pessoa ativa cadastrada à mão, sem o e-mail, <strong>não</strong> junta: a pessoa nova entra e a carga avisa <code>DATA_POSSIBLE_DUPLICATE_PERSON</code> com os dois
          ids. O duplicado se corrige em <WikiLink href="/wiki/administracao#usuarios">Usuários e acessos › Vincular à pessoa da base</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="situacao-funcional" title="Situação funcional: Colaboradores + Ausências" eyebrow="Uma camada canônica, duas portas de entrada">
        <p>
          <strong>Colaboradores</strong> traz um <em>snapshot</em>: &quot;hoje esta pessoa está EM PRODUÇÃO / de FÉRIAS / em INSS / TRANSFERIDA…&quot;, com uma data de vigência opcional.{" "}
          <strong>Ausências de colaboradores</strong> traz <em>períodos explícitos</em> de situações temporais (FÉRIAS, INSS, MATERNIDADE, PATERNIDADE, ATIVIDADE OFF): &quot;férias de 10/09 a 21/09&quot;. TRANSFERIDO, PILOTO e APOSENTADO vêm pelo cadastro, não são ausências. Os dois alimentam a MESMA camada canônica de
          períodos de situação funcional — a mesma que o perfil, os Workflows (dias elegíveis) e o Analytics leem. Ausências <strong>complementam</strong> o cadastro; nenhuma
          delas substitui a outra, e nada é gravado direto na tabela: tudo passa pelo mesmo serviço.
        </p>
        <p>
          As nove situações reais (EM PRODUÇÃO, TRANSFERIDO, FÉRIAS, INSS, PILOTO, MATERNIDADE, PATERNIDADE, APOSENTADO, ATIVIDADE OFF) são reconhecidas pelo código ou pelo rótulo. Valores próprios da
          fonte (&quot;PROD&quot;, &quot;FER&quot;, &quot;LIC&quot;) entram por <strong>Mapear códigos</strong> no feed — transformação declarativa, sem código. Valor desconhecido vai para a quarentena como{" "}
          <code>DATA_EMPLOYMENT_STATUS_UNKNOWN</code>: a INIA nunca converte desconhecido em &quot;em produção&quot;. A pré-visualização mostra lado a lado o valor de origem (FER) e o normalizado (FÉRIAS). O texto original fica sempre
          guardado (<code>raw_status</code>). Só EM PRODUÇÃO é elegível operacionalmente — ver <WikiLink href="/wiki/indicadores/medicao-operacional#elegibilidade">Dias elegíveis e situação funcional</WikiLink>.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="Precedência: período explícito vence inferência">
            Um período com início <em>e</em> fim vindos da fonte tem mais evidência do que um snapshot (&quot;está de férias&quot;, sem fim). Empate de evidência: feed
            autoritativo vence; depois, a evidência mais nova (data de atualização na origem, senão a observação). O snapshot nunca &quot;apaga&quot; um período explícito
            futuro, e um período explícito nunca é substituído silenciosamente.
          </ExampleCard>
          <ExampleCard title="Conflito nunca é silencioso">
            Quando duas evidências discordam, a carga aplica a vencedora e registra um aviso na quarentena (<code>DATA_EMPLOYMENT_STATUS_CONFLICT</code>) com o motivo
            (&quot;período explícito vence&quot;, &quot;fonte autoritativa vence&quot;, &quot;evidência mais nova vence&quot;) — o registro conta como aviso, não como rejeição. A
            linhagem da carga aponta para o período criado ou corrigido.
          </ExampleCard>
          <ExampleCard title="Exemplo: cargas segunda e quinta">
            Colaboradores carrega na segunda (Ana ATIVA) e na quinta (Ana FÉRIAS, vigente desde terça). A INIA grava o período a partir de <strong>terça</strong> —
            a data de vigência informada — e fecha o período ATIVO anterior. Sem data de vigência, o período começa na observação (quinta) e fica marcado como
            &quot;início inferido&quot;: a INIA nunca inventa retroatividade.
          </ExampleCard>
          <ExampleCard title="O tempo passa sem carga nova">
            Um job diário (fuso da organização, idempotente, sem IA) projeta o estado corrente: férias com fim explícito voltam a ATIVO sozinhas; um afastamento sem
            fim continua. Depois do fim de um período explícito sem carga nova, o retorno é <strong>presumido</strong> (ACTIVE, base &quot;presumido após período&quot;) —
            mostrado como tal, nunca como certeza.
          </ExampleCard>
        </div>
        <p>
          <strong>Freshness da situação funcional</strong> (Atualizada · Fonte atrasada · não configurada) é derivada dos feeds de Colaboradores/Ausências — cadência esperada
          × última carga bem-sucedida — sem um terceiro painel. Quando a fonte está atrasada, os dias <em>depois</em> da última carga que não estão cobertos por um período
          explícito viram &quot;presumidos, não confirmados&quot;: uma medição real continua valendo (nunca é invalidada), mas ausência de medição nesses dias deixa de ser
          &quot;não produziu&quot; e vira <strong>&quot;não sei com segurança&quot;</strong> (motivo <code>EMPLOYMENT_STATUS_STALE</code> em Condition/Ranking), separado de
          &quot;não deveria produzir&quot; (férias/afastamento confirmados). O perfil mostra &quot;Situação funcional atualizada pela última vez em…&quot; só quando isso importa;
          um período explícito que cobre a data (férias com fim futuro) dispensa o aviso.
        </p>
        <p>
          <strong>Ausência cancelada pela fonte.</strong> Quando o RH cancela umas férias inteiras, a mesma fonte reenvia a ausência — matrícula, tipo e início
          iguais — com <strong>Vigente? = não</strong>. O período sai da situação funcional, a carga conta 1 &quot;desativado&quot; e o registro completo fica na
          auditoria (<code>DATA_HUB_EMPLOYEE_ABSENCE_CANCELLED</code>, com o que voltou a valer). Os dias voltam a seguir as outras fontes: o EM PRODUÇÃO do
          cadastro, que as férias tinham dividido, volta a ser um período só; sem outra evidência, os dias ficam EM PRODUÇÃO presumido — nunca uma situação
          inventada. Cancelar de novo, ou cancelar uma ausência que nunca chegou, não muda nada; reenviar como vigente recria o período. Ausência registrada por
          outra origem (outra fonte, ajuste manual) não é apagada pela carga: fica, e o pedido vira o aviso <code>DATA_EMPLOYMENT_STATUS_CONFLICT</code>. Na
          sugestão de mapeamento, colunas &quot;vigente&quot; ou &quot;ativo&quot; viram Vigente? direto, e &quot;cancelado&quot; vira Vigente? com o sim/não
          invertido (cancelado = S → vigente = não), visível no mapeamento para conferir. Um período alterado depois por outra carga (início diferente) não é
          mais aquela identidade: a correção de datas é feita reenviando a ausência com o início certo.
        </p>
      </WikiSection>

      <WikiSection id="escalas" title="Escalas de trabalho: Jornadas + calendário" eyebrow="Regime é metadata; a folga tem data">
        <p>
          <strong>Jornadas de trabalho</strong> traz horário de entrada, carga horária e o <em>regime</em> (5x2 ou 6x1) com vigência — metadata, com histórico de quem mudou de regime.{" "}
          <strong>Escalas de trabalho</strong> traz o <em>calendário programado</em>: uma linha por colaborador × data dizendo se trabalha (com o turno) ou folga. É essa linha que responde &quot;deveria trabalhar nesta data?&quot; — um 6x1 folga
          na quarta quando a escala diz, e domingo não é folga por suposição. Ausência de linha <strong>não</strong> é folga: é &quot;a fonte não informou&quot;; por isso o feed costuma ser um snapshot de horizonte (ex.: D-7 até D+30). Em modo
          delta, só as datas recebidas mudam. Mesma escala duas vezes não duplica; correção posterior (quarta trabalha → folga) sobrescreve a data e os cálculos históricos refletem a correção — medições nunca são apagadas.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">{`API RH (uma fonte, vários feeds)
├── Colaboradores            (EMPLOYEES)            situação funcional a partir de uma data
├── Ausências                (EMPLOYEE_ABSENCES)    períodos explícitos: férias, INSS, maternidade…
├── Jornadas de trabalho     (WORK_SCHEDULES)       horário, carga horária e regime 5x2/6x1
├── Escalas de trabalho      (WORK_SCHEDULE_DAYS)   trabalha/folga por data (snapshot de horizonte)
└── Exceções de calendário   (WORK_SCHEDULE_EXCEPTIONS) day off, banco de horas, folga extraordinária`}</pre>
        <p>
          <strong>Freshness da escala</strong> segue a mesma filosofia da situação funcional: o mapa de dados mostra &quot;Escalas de trabalho · Atualizado há 2h · API RH › Work Schedules&quot; ou &quot;⚠ Fonte atrasada&quot; — com a conexão
          podendo continuar OK. Dias depois da última carga são &quot;escala presumida&quot;; ausência de produção em dia de escala desconhecida ou atrasada nunca vira feedback negativo (<code>WORK_SCHEDULE_STALE</code> /{" "}
          <code>WORK_SCHEDULE_UNKNOWN</code>). Feriados vêm do calendário-base por capital operacional + datas da organização (Administração › Calendário operacional) e só atuam no fallback seg–sex com a política &quot;excluir&quot; — escala explícita vence feriado.
        </p>
        <p>
          <strong>Exceções de calendário</strong> (day off, banco de horas, folga extraordinária, atestado) são um contrato próprio: a folga normal do 6x1 <em>não</em> é exceção — ela vem em Escalas de trabalho. A exceção vence a escala naquele dia sem reescrever o
          calendário programado; chave natural colaborador × data × tipo (mesma exceção 2× = 1 registro), &quot;vigente = não&quot; cancela sem apagar, e a origem (fonte › feed › carga) fica visível no perfil e no Admin. A medição do dia
          continua no banco e fora do cálculo operacional — salvo produção observada (ver <WikiLink href="/wiki/indicadores/medicao-operacional#planejado-observado">Planejado × observado</WikiLink>). O contrato é <strong>opcional</strong>: o Supervisor também registra exceções no Calendário da equipe, e o cliente pode usar só a Central, só o Supervisor ou os dois. Quando as origens divergem
          (a Central reenvia como vigente uma exceção que o Supervisor cancelou, ou cancela uma que ele registrou), a INIA mantém o registro do Supervisor e grava o aviso <code>DATA_SCHEDULE_EXCEPTION_CONFLICT</code> na quarentena — nunca sobrescreve em silêncio. A Qualidade dos dados mostra exceções por origem, conflitos, pendências de produção, divergências plano × realidade, produção com situação não produtiva e a cobertura verificada do catálogo de feriados (com as lacunas registradas — nunca &quot;100% completo&quot;).
        </p>
        <p>
          <strong>Horizonte do calendário</strong> é um terceiro conceito, diferente de saúde da conexão e de freshness da carga: até que data a escala é conhecida. A Central mostra &quot;Calendário disponível: 01/09/2026 → 31/10/2026&quot; e avisa
          &quot;⚠ Calendário termina em 3 dias&quot; quando restam ≤ N dias (limite configurável em Calendário operacional; padrão 7) — e quem administra a Central de Dados na organização inteira recebe um alerta no sino (&quot;Escalas de trabalho disponíveis somente até 20/09. Restam 4 dias de calendário conhecido.&quot;), um por horizonte, encerrado quando o calendário avança. Uma carga pode ter chegado há 10 minutos e o calendário terminar amanhã. A Qualidade dos dados também mostra
          &quot;Capital operacional preenchida: X de Y&quot; e &quot;6x1 com calendário válido: X de Y&quot; — 6x1 sem calendário é escala desconhecida, nunca folga adivinhada.
        </p>
        <p>
          <strong>Capital operacional</strong> chega em Colaboradores (<code>operationalCapitalCode</code>): uma das 27 capitais (código ou nome oficial; abreviações da empresa entram por &quot;Mapear códigos&quot;, ex.: FOR → FORTALEZA). Valor fora do catálogo vai para a
          quarentena; a UF é derivada. É a jurisdição de feriados da pessoa — não endereço, residência nem lotação.
        </p>
      </WikiSection>

      <WikiSection id="cargas" title="Cargas (Runs)" eyebrow="O que aconteceu nessa execução">
        <p>
          Toda sincronização, importação, envio ou reprocessamento cria uma carga com linha do tempo por etapa, métricas completas (bytes, recebidos,
          lidos, válidos, rejeitados, inseridos, atualizados, inalterados, desativados — ex.: ausência cancelada pela fonte —, erros, duração, tentativas), checkpoint antes/depois e o maior
          tempo de negócio recebido. O processamento é assíncrono (fila + worker com lease); a tela consulta o status. Uma carga falhada por erro
          transitório (fonte inalcançável, timeout) volta à fila com espera crescente: a agendada tenta até 7 vezes, por quase 3 horas, para atravessar
          uma trava longa na origem; a pedida em Sincronizar agora tenta 3 vezes, em poucos minutos. Durante a espera, a conexão aparece com erro,
          Sincronizar agora antecipa a mesma carga e pausar a fonte ou o feed cancela a carga, sem nova consulta à origem. Credencial, mapeamento, esquema
          e validação nunca ficam tentando para sempre. Um feed nunca tem duas execuções em andamento.
        </p>
        <WikiTable caption="Estados de uma carga">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estado</TableHead>
                <TableHead>Rótulo</TableHead>
                <TableHead>Significado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DATA_HUB_RUN_STATES.map((state) => (
                <TableRow key={state.state}>
                  <TableCell className="font-mono text-xs">{state.state}</TableCell>
                  <TableCell className="whitespace-nowrap">{state.label}</TableCell>
                  <TableCell>{state.meaning}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          <strong className="font-medium text-foreground">Reprocessar</strong>: enquanto o conteúdo bruto estiver retido, uma carga pode ser reprocessada com o
          mapeamento <em>atual</em> do feed — corrigiu o mapeamento, reprocessa o arquivo/lote anterior. Idempotência garante que reprocessar não duplica.
        </p>
      </WikiSection>

      <WikiSection id="quarentena" title="Quarentena e qualidade" eyebrow="Erro de uma linha nunca é perda silenciosa">
        <p>
          Cada registro rejeitado vira uma entrada rastreável: carga, número da linha, chave do registro na origem, código estável, campo e mensagem —
          sem o payload sensível inteiro. A carga mostra os erros agrupados (&quot;800 × DATA_EMPLOYEE_NOT_FOUND, 302 × DATA_INDICATOR_NOT_FOUND&quot;),
          com filtro por código, busca e exportação CSV (sem segredos). A aba Qualidade dos dados consolida top erros dos últimos 7 dias, feeds com
          rejeição, dados atrasados, mudanças de esquema e erros recentes.
        </p>
      </WikiSection>

      <WikiSection id="severidades" title="Erros × avisos × rejeitados" eyebrow="Três contadores, três significados">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ExampleCard title="Rejeitados (recordsRejected)">Registros que NÃO entraram no domínio — estrutura inválida, referência inexistente, situação desconhecida. Ficam na quarentena com severidade Erro.</ExampleCard>
          <ExampleCard title="Erros (errorCount)">Erros reais da carga: os registros rejeitados e, quando a carga falha, o erro da execução. Nunca inclui avisos.</ExampleCard>
          <ExampleCard title="Avisos (warningCount)">Registros APLICADOS com ressalva — ex.: conflito de situação funcional resolvido pela precedência (<code>DATA_EMPLOYMENT_STATUS_CONFLICT</code>). Ficam na quarentena com severidade Aviso, para rastro, e nunca contam como erro.</ExampleCard>
        </div>
        <p>
          Uma carga pode terminar Parcial com &quot;10.000 processados · 0 rejeitados · 3 avisos&quot; — e não &quot;3 erros&quot;. A aba Qualidade separa Top erros de Avisos e mostra a severidade de cada item da quarentena. Cargas anteriores a
          essa distinção têm 0 avisos (o histórico nunca é reclassificado sem evidência).
        </p>
      </WikiSection>

      <WikiSection id="lineage" title="Linhagem" eyebrow="De onde veio este dado?">
        <p>
          Uma relação genérica registra, para cada entidade criada ou alterada por uma carga: fonte, feed, carga, contrato, chave do registro na origem,
          número da linha e ação — sem adicionar colunas de ingestão a cada tabela do domínio. Consulta:{" "}
          <code className="font-mono text-xs">GET /api/v1/admin/data-hub/lineage?entityType=indicator_measurements&amp;entityId=…</code>.
        </p>
        <ExampleCard title="Exemplo">O TMA de 475 s de uma colaboradora veio de: Fonte API Operacional · Feed Medições · Carga de 16/09 14:30 · registro abc123 (linha 42).</ExampleCard>
        <p>
          <strong>Onde ver:</strong> &quot;Origem do dado&quot; abre um painel simples (fonte → feed → carga → registro, do mais recente ao mais antigo) em Admin › Usuários (situação funcional e escala de hoje) e, para
          quem administra a Central de Dados (papel com essa permissão), no perfil do colaborador. Exemplos: &quot;Situação: FÉRIAS · Origem: API RH → Ausências → Carga #124 → registro absence-991&quot;; &quot;Escala: 6x1 · folga em 18/09 · Origem: API Workforce → Work Schedules → Carga #830&quot;.
          Um registro sem linhagem (cadastro manual, massa demo, anterior à Central) diz isso em texto — nunca inventa origem. Não é um grafo: é uma lista.
        </p>
        <p>Toda ação administrativa (criar/editar/ativar/pausar fonte ou feed, rotacionar credencial ou token, sincronizar, reprocessar, cancelar) fica no audit trail — nunca com o segredo.</p>
      </WikiSection>

      <WikiSection id="saude-freshness" title="Saúde × Atualidade" eyebrow="Conectado não significa atualizado">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ExampleCard title="Conexão (Connection health)">Consigo chegar e autenticar na fonte? Conexão OK · Conexão com erro · Não testada. Muda quando a fonte é de fato contatada.</ExampleCard>
          <ExampleCard title="Atualidade (Freshness)">Quando chegou dado válido pela última vez? Atualizado · Atrasado (sem carga bem-sucedida por 2× o intervalo ou, com dias e horários, até uma hora depois do segundo horário perdido) · Nunca recebido.</ExampleCard>
          <ExampleCard title="Status da fonte">Rascunho · Ativa · Pausada · Erro — decisão administrativa e falha de credencial, separado dos dois anteriores.</ExampleCard>
          <ExampleCard title="Confiança da situação funcional">A situação funcional que a INIA conhece é recente o bastante para uma decisão? Atualizada · Fonte atrasada · não configurada. Uma conexão saudável com um feed de Colaboradores atrasado dá &quot;Conexão OK&quot; e &quot;Fonte atrasada&quot; ao mesmo tempo.</ExampleCard>
        </div>
        <p>
          A tela distingue ainda <strong>última carga</strong> (a tentativa mais recente), <strong>último sucesso</strong> (carga concluída/parcial) e{" "}
          <strong>último dado recebido</strong> (maior data de negócio aplicada — período da medição, fim da interação, competência): &quot;API sincronizou agora&quot;
          não significa &quot;dados estão atualizados&quot;.
        </p>
      </WikiSection>

      <WikiSection id="configurar-com-senha" title="Configurar exige a senha da fonte" eyebrow="Ter a permissão não basta">
        <p>
          A Central é do <strong className="font-medium text-foreground">Administrador geral</strong> e do{" "}
          <strong className="font-medium text-foreground">Administrador de dados</strong>, sempre na organização inteira. Ter o papel dá acesso à Central,
          mas não à senha guardada: ela existe para as cargas. Quem quer configurar uma fonte com credencial guardada precisa digitar a credencial de novo,
          sem exceção para administrador nem para quem cadastrou. Vale para banco de dados, SFTP e API Pull com autenticação. Arquivo, API Push e API Pull
          sem autenticação não têm senha a exigir.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <ExampleCard title="Sem a senha">
            Ver fontes, conjuntos, cargas, qualidade, contratos e linhagem; testar a conexão; excluir fonte ou conjunto; pausar; sincronizar; reprocessar e
            cancelar carga; enviar e importar arquivo; gerenciar tokens de API Push.
          </ExampleCard>
          <ExampleCard title="Com a senha">
            Listar tabelas e colunas do banco do cliente; ler amostra; validar mapeamento; listar arquivos do SFTP; criar ou alterar conjunto; alterar a fonte;
            ativar e retomar fonte ou conjunto; reiniciar a leitura.
          </ExampleCard>
        </div>
        <p>
          A senha certa libera a configuração por <strong className="font-medium text-foreground">30 minutos</strong>, só para aquela pessoa, naquela fonte e
          naquele login: outra pessoa, outra fonte ou um login novo pedem de novo. A conferência compara com a senha guardada e não conecta no banco do cliente. Se a
          liberação vencer no meio do caminho, a tela pede a senha de novo e mantém o que já foi preenchido. As cargas agendadas continuam usando a senha guardada,
          sem mudança.
        </p>
        <p>
          <strong className="font-medium text-foreground">Cinco senhas recusadas em 15 minutos</strong> bloqueiam novas tentativas daquela pessoa naquele servidor e
          usuário, em qualquer caminho: liberar, testar com senha digitada, cadastrar ou trocar. Mudar o banco ou a criptografia não zera a conta, e acertar também não: os
          erros saem da conta quando passam os 15 minutos. Só recusa de senha conta: servidor fora do ar e chave do servidor SFTP divergente não contam, e testar com a
          senha guardada nunca bloqueia. Ao cadastrar, a INIA testa a senha antes de gravar: se o servidor
          recusar, nada é gravado. Se o servidor estiver fora do alcance, a fonte é cadastrada mesmo assim, porque a rede pode estar para ser liberada.
        </p>
        <ExampleCard title="A senha mudou no servidor">
          Use <em>Trocar a senha</em>. A senha antiga não é pedida, porque esse é justamente o caso em que ela deixou de valer. A INIA conecta com a senha nova e
          só grava se a conexão funcionar: quem não conhece a credencial não consegue derrubar as cargas gravando outra. Depois da troca, quem estava liberado
          precisa da senha nova. Para apontar a fonte para outro servidor, banco, usuário ou criptografia, é preciso estar liberado, informar a senha nova e
          passar no mesmo teste. Em API Pull, a INIA chama o endereço com e sem a credencial, primeiro o endereço base e depois os conjuntos de dados. Se a API responder
          igual nos dois casos, não há como provar a credencial nova, e só troca quem já informou a atual.
        </ExampleCard>
      </WikiSection>

            <WikiSection id="consultar-dados" title="Consultar dados" eyebrow="A consulta só lê, e só o que foi aprovado">
        <p>
          A aba <strong className="font-medium text-foreground">Consultar dados</strong> mostra, em páginas, os dados importados e os gerados pela INIA, sem SQL. Escolha um conjunto, as colunas e a ordem,
          combine condições com E e OU, busque nos campos marcados e exporte em CSV. Só o <strong className="font-medium text-foreground">Administrador geral</strong> e o{" "}
          <strong className="font-medium text-foreground">Administrador de dados</strong> têm acesso, sempre na organização inteira. Uso de IA exige também a permissão de ver IA; Casos de supervisão e Feedbacks, a de ver Indicadores.
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>Só aparecem conjuntos e colunas de uma lista aprovada. Senha, e-mail, sessão, segredo e token não fazem parte de nenhum conjunto.</li>
          <li>O nome da pessoa só aparece em Colaboradores. Nos outros conjuntos, a matrícula.</li>
          <li>Afastamento sensível e atestado aparecem como protegidos, inclusive em filtros e no CSV. O texto das transcrições, dos feedbacks, dos casos, das rejeições e das execuções de IA nunca aparece.</li>
          <li>Datas nos filtros seguem o fuso da organização, e o último dia do intervalo entra inteiro.</li>
          <li>A contagem só roda quando você pede e para em 10.000 registros.</li>
        </ul>
        <p>
          O conjunto <strong className="font-medium text-foreground">Workflows</strong> mostra todos os Workflows, inclusive os excluídos, com quando e por quem foram excluídos. As execuções de um Workflow excluído continuam em <strong className="font-medium text-foreground">Execuções de Workflow</strong>.
        </p>
        <WarningCallout kind="tip" title="Se a consulta passar do limite">
          Cada consulta tem até 5 segundos, e cada arquivo CSV tem até 20.000 linhas ou 20 MB. Acima disso, a INIA interrompe e pede para restringir os filtros. Um período menor costuma resolver.
        </WarningCallout>
        <WarningCallout kind="warning" title="Fica no Registro">
          Exportações e tentativas negadas aparecem no <WikiLink href="/wiki/central-de-dados#registro">Registro</WikiLink>. Consultas aparecem ao filtrar por essa ação. Os valores dos filtros e o conteúdo dos dados nunca são guardados.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="cancelar-registros" title="Cancelar registros" eyebrow="O dado fica guardado e sai dos cálculos">
        <p>
          Em <strong className="font-medium text-foreground">Medições de indicador</strong>, <strong className="font-medium text-foreground">Metas</strong> e nos dois <strong className="font-medium text-foreground">fechamentos oficiais</strong>,
          a Consultar dados permite cancelar um registro importado errado. Ele continua guardado, aparece riscado e marcado como Cancelado na consulta e deixa de entrar em qualquer cálculo. Só o Administrador geral e o Administrador de dados podem cancelar.
        </p>
        <ol className="list-inside list-decimal space-y-1">
          <li>Marque os registros na tabela, ou aplique um filtro para alcançar todos os que atendem a ele.</li>
          <li>Clique em Cancelar selecionados ou em Cancelar todos do filtro e confira a prévia: quantos registros, quantas execuções e quantos feedbacks estão ligados a eles.</li>
          <li>Escreva o motivo e confirme. Não escreva nomes, CPF ou outros dados pessoais.</li>
        </ol>
        <WarningCallout kind="tip" title="Indicador cadastrado com a regra errada">
          Se o indicador está travado porque já recebeu dados, cancele as medições dele, corrija o indicador e reprocesse a carga ou envie um arquivo novo. Os registros voltam a valer pela regra certa.
        </WarningCallout>
        <p>Um registro cancelado volta de duas formas:</p>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Pela carga:</strong> se a origem enviar o mesmo registro de novo, ele volta a valer. Em medições, isso roda os Workflows por Indicador outra vez e pode gastar IA.</li>
          <li><strong className="font-medium text-foreground">Por Reativar:</strong> em Cancelamentos deste conjunto, o lote volta como estava, sem rodar Workflow. Fica barrado se o código, a unidade, a direção ou a estratégia do indicador mudaram depois do cancelamento, ou se outra carga já trouxe o mesmo período, porque o dia contaria duas vezes. Nesses casos, os valores precisam vir numa carga nova.</li>
        </ul>
        <WarningCallout kind="warning" title="O que o cancelamento não faz">
          Feedback já entregue e resultado de Workflow não mudam. A PRV não é recalculada, porque vem fechada da origem. Não dá para cancelar com uma execução de Workflow rodando nem com uma carga do mesmo tipo em andamento, e ninguém cancela os próprios resultados. Execução pausada ou bloqueada não impede, mas se voltar a rodar ela fica bloqueada até o registro voltar a valer. Excluir o indicador continua proibido enquanto houver registros cancelados: desative-o. E o dado continua guardado, então isso não atende a um pedido de eliminação pela LGPD.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="itens-excluidos" title="Itens excluídos" eyebrow="O que foi excluído continua guardado e pode voltar">
        <p>
          Excluir um Workflow, Agent, Orquestrador, base de conhecimento, Argumentário, domínio, flag, indicador, produto, assunto proibido, termo do glossário, feriado, cenário, conexão, modelo ou orçamento de IA, fonte, conjunto de dados ou Report não apaga nada: o objeto sai das telas e da lógica. Em Consultar dados, escolha <strong className="font-medium text-foreground">Itens excluídos</strong> no seletor de conjuntos para ver o que saiu, quando e por quem.
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Quem vê e restaura:</strong> quem pode gerenciar aquele tipo de objeto na organização inteira, com a Consultar dados liberada. O Report é só de quem o criou, que também o restaura na aba Excluídos da tela de Reports.</li>
          <li><strong className="font-medium text-foreground">Restaurar nunca liga nada:</strong> o objeto volta desativado, pausado ou encerrado, e quem restaura liga na tela dele, onde as validações de sempre acontecem.</li>
          <li><strong className="font-medium text-foreground">Credencial não volta:</strong> ao excluir uma conexão de IA ou uma fonte de dados, a credencial é revogada. Depois de restaurar, é preciso informá-la de novo.</li>
          <li><strong className="font-medium text-foreground">O que barra:</strong> outro registro ativo com o mesmo nome ou código, ou um objeto de que este depende que também esteja excluído. A confirmação diz qual.</li>
        </ul>
        <WarningCallout kind="warning" title="Excluir não atende a um pedido de eliminação pela LGPD">
          O dado continua no banco. Ter histórico não impede excluir: execuções, conversas e medições ficam guardadas e continuam aparecendo no que já aconteceu. O que barra é o uso de agora, como um Agent ou indicador citado por um Workflow, e a tela diz qual é.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="registro" title="Registro" eyebrow="Quem fez o quê">
        <p>
          A aba <strong className="font-medium text-foreground">Registro</strong>, na Central e em cada fonte, mostra quem cadastrou, alterou e excluiu; quem
          liberou a configuração, errou a senha ou foi bloqueado; quem tentou configurar sem liberação; quem testou, sincronizou, enviou ou importou arquivo; quem baixou o
          CSV de rejeições; e quem listou tabelas, leu colunas ou leu amostra do banco do cliente, com o objeto e a quantidade de linhas. Alteração de fonte mostra o antes e o depois de servidor, porta, banco, usuário e criptografia; os
          demais campos aparecem só pelo nome. Fonte excluída continua no Registro, pelo nome. A fonte também mostra quem a cadastrou e quem alterou por último.
        </p>
        <WarningCallout kind="tip" title="O que nunca entra no Registro">
          Senha, token, cabeçalho ou dado do cliente: a amostra registra quantas linhas foram lidas, nunca o conteúdo delas.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="seguranca" title="Segurança" eyebrow="Backend valida; segredo nunca sai">
        <ul className="list-inside list-disc space-y-1">
          <li>Recurso administrativo: as rotas exigem o papel Administrador geral ou Administrador de dados na organização inteira; toda leitura/escrita é escopada pela organização da sessão — id de outra organização responde &quot;não encontrado&quot;. Configurar uma fonte com credencial guardada exige também a <WikiLink href="/wiki/central-de-dados#configurar-com-senha">senha dela</WikiLink>.</li>
          <li>Em API Pull, valores de cabeçalhos extras, parâmetros fixos e o que vem depois do &quot;?&quot; na URL aparecem ocultos para quem não liberou a configuração, porque podem levar credencial. Salvar o valor oculto mantém o atual. Em fonte sem autenticação não há senha para pedir, então ficam ocultos para todo mundo; para trocar, digite o valor novo.</li>
          <li>Conteúdo bruto retido (30 dias) só abre pela fonte que o trouxe: o id de uma carga de banco não serve na amostra nem na importação de uma fonte de arquivo.</li>
          <li>Segredos (token, API key, senha, client secret, chave privada) ficam cifrados em repouso com AES-256-GCM e chave <em>fora do banco</em> (variável de ambiente, obrigatória em produção). Nunca voltam por API (a tela mostra só &quot;configurada em…&quot;), nunca vão para log nem para trace; a rotação revoga o anterior e remover a fonte revoga todas as credenciais dela.</li>
          <li>Token de push: só o hash é guardado; o valor aparece uma única vez ao criar/rotacionar; revogável; rate limit por token.</li>
          <li>SFTP: verificação de host key nunca é desligada silenciosamente — com fingerprint configurada a conexão só é aceita se bater.</li>
          <li>PII: logs estruturados carregam ids, contrato, status e contagens — nunca payload completo; a quarentena guarda chave/campo/mensagem, não o registro inteiro.</li>
          <li>Excel: só .xlsx, leitura de células; macros nunca executadas. Retenção do conteúdo bruto: 30 dias (configurável); metadados da carga permanecem.</li>
        </ul>
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="O que ainda não existe">
        <ul className="list-inside list-disc space-y-1">
          <li>Snapshot com desativação por ausência não é aplicado (opt-in futuro com regra de domínio segura).</li>
          <li>Situação funcional não tem um estado &quot;desconhecido&quot; próprio: sem retorno confirmado a INIA presume ATIVO e marca a base (presumido) e a confiança (fonte atrasada) — nunca apresenta a presunção como certeza.</li>
          <li>Sem MDM: conflito entre duas fontes master do mesmo cadastro é bloqueado, não mesclado.</li>
          <li>Submotivo de uma interação não é apagado por carga: vazio mantém o recebido (corrigir é enviar outro submotivo).</li>
          <li>O catálogo de assuntos canônicos (aliases, inclusive o alias de um submotivo dentro de um motivo) ainda não tem tela nem API: sem ele, o assunto é o texto do submotivo como a fonte mandou.</li>
          <li>Sem Kafka/Spark/Airflow/dbt, sem CDC de bancos externos, sem conectores específicos (Salesforce, SAP, Genesys, Google Drive), sem IA para mapeamento, sem rollback temporal de carga.</li>
          <li>Cancelamento só para cargas ainda na fila; sem WebSocket (a tela consulta o status).</li>
          <li>Rate limit do push é por processo (token bucket em memória); atrás de um gateway, o dele prevalece.</li>
          <li>Objetos brutos ficam no Postgres atrás de um port — trocar por S3 é trocar o adaptador, ainda não feito.</li>
        </ul>
      </WikiSection>

      <SeeAlso
        links={[
          { href: "/wiki/central-de-dados/conectores", label: "Conectores", hint: "CSV, Excel, API Pull, API Push, SFTP e banco de dados em detalhe" },
          { href: "/wiki/central-de-dados/guias", label: "Guias e troubleshooting", hint: "importar CSV, conectar API e SFTP, entender uma carga com erros" },
          { href: "/wiki/indicadores/configuracao", label: "Configuração de indicadores", hint: "estratégia e capacidades que a Central respeita" },
          { href: "/wiki/introducao/como-as-pecas-se-conectam", label: "Como as peças se conectam", hint: "Cliente → Central → Domínio → Workflow/Analytics/Agents" },
        ]}
      />
    </WikiArticle>
  )
}
