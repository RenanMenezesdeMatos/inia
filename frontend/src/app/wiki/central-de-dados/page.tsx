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
          <li><strong className="font-medium text-foreground">Cadência</strong> (API Pull, SFTP e banco de dados): manual, a cada 15 min / 1 h / 6 h ou diária num horário no fuso da operação. Arquivo e push são sob demanda.</li>
          <li><strong className="font-medium text-foreground">Modo de carga</strong>: Delta (só o que veio muda) ou Snapshot (estado completo). Em ambos, ausência de um registro <strong>nunca</strong> desativa nada nesta versão.</li>
          <li><strong className="font-medium text-foreground">Fonte autoritativa</strong>: um único feed autoritativo ativo por contrato de dado mestre por organização — duas fontes nunca brigam pelo mesmo cadastro.</li>
          <li><strong className="font-medium text-foreground">Exigir carga íntegra</strong>: qualquer rejeição impede a carga inteira (opt-in por feed).</li>
          <li><strong className="font-medium text-foreground">Namespace de origem</strong>: identidade da origem em medições e fechamentos (coluna <code className="font-mono text-xs">source</code>); padrão = id público da fonte.</li>
        </ul>
      </WikiSection>

      <WikiSection id="contrato" title="Contrato de Dados" eyebrow="O formato que a INIA entende">
        <p>
          Cada conjunto de dados tem <strong>uma</strong> definição canônica, versionada (<code className="font-mono text-xs">EMPLOYEES@1</code>): campos, tipos,
          obrigatórios, campo identidade, chave natural, dependências, semântica de escrita (upsert de dado mestre ou evento idempotente), política de
          aplicação (parcial ou atômica), campo de tempo de negócio e exemplos. Feeds e cargas guardam contrato + versão. A tela Contratos de dados mostra
          tudo isso e o payload de exemplo do API Push, gerado do próprio contrato.
        </p>
        <ExampleCard title="Identidade: identificador externo estável, nunca nome">
          Colaborador = matrícula (<code className="font-mono text-xs">externalEmployeeId</code>); Grupo/Subgrupo = código externo (
          <code className="font-mono text-xs">externalCode</code>, único na organização); interação = <code className="font-mono text-xs">externalInteractionId</code>;
          indicador = <code className="font-mono text-xs">indicatorCode</code> do catálogo.
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
                    <span className="font-mono text-xs text-muted-foreground">{contract.key}@1</span>
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
          <li><strong className="font-medium text-foreground">Catálogo</strong>: medição diária exige indicador com medição operacional habilitada; fechamento exige fechamento oficial habilitado; Taxa/Média ponderada exigem numerador e denominador e o valor precisa conferir com numerador ÷ denominador.</li>
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
            uma segunda é bloqueada explicitamente — sem MDM completo nesta versão.
          </ExampleCard>
          <ExampleCard title="Dado de evento (Medições, Interações, Transcrições, Flags, Fechamentos, PRV)">
            Idempotência por identificador externo + namespace de origem: várias fontes podem coexistir se mantiverem identidades claras. Mesmo arquivo ou
            mesmo lote duas vezes nunca duplica.
          </ExampleCard>
        </div>
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
          lidos, válidos, rejeitados, inseridos, atualizados, inalterados, desativados, erros, duração, tentativas), checkpoint antes/depois e o maior
          tempo de negócio recebido. O processamento é assíncrono (fila + worker com lease); a tela consulta o status. Uma carga falhada por erro
          transitório (fonte inalcançável, timeout) volta à fila com backoff limitado (até 3 tentativas); credencial, mapeamento, esquema e validação
          nunca ficam tentando para sempre. Um feed nunca tem duas execuções em andamento.
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
          <ExampleCard title="Atualidade (Freshness)">Quando chegou dado válido pela última vez? Atualizado · Atrasado (última carga bem-sucedida passou de 2× a cadência esperada) · Nunca recebido.</ExampleCard>
          <ExampleCard title="Status da fonte">Rascunho · Ativa · Pausada · Erro — decisão administrativa e falha de credencial, separado dos dois anteriores.</ExampleCard>
          <ExampleCard title="Confiança da situação funcional">A situação funcional que a INIA conhece é recente o bastante para uma decisão? Atualizada · Fonte atrasada · não configurada. Uma conexão saudável com um feed de Colaboradores atrasado dá &quot;Conexão OK&quot; e &quot;Fonte atrasada&quot; ao mesmo tempo.</ExampleCard>
        </div>
        <p>
          A tela distingue ainda <strong>última carga</strong> (a tentativa mais recente), <strong>último sucesso</strong> (carga concluída/parcial) e{" "}
          <strong>último dado recebido</strong> (maior data de negócio aplicada — período da medição, fim da interação, competência): &quot;API sincronizou agora&quot;
          não significa &quot;dados estão atualizados&quot;.
        </p>
      </WikiSection>

      <WikiSection id="seguranca" title="Segurança" eyebrow="Backend valida; segredo nunca sai">
        <ul className="list-inside list-disc space-y-1">
          <li>Recurso administrativo: rotas exigem sessão de administrador; toda leitura/escrita é escopada pela organização da sessão — id de outra organização responde &quot;não encontrado&quot;.</li>
          <li>Segredos (token, API key, senha, client secret, chave privada) ficam cifrados em repouso com AES-256-GCM e chave <em>fora do banco</em> (variável de ambiente, obrigatória em produção). Nunca voltam por API (a tela mostra só &quot;configurada em…&quot;), nunca vão para log nem para trace; a rotação revoga o anterior.</li>
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
