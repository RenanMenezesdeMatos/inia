import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExampleCard, SeeAlso, StepList, WarningCallout, WikiArticle, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { DATA_HUB_ERROR_CODES } from "@/components/wiki/data-hub-catalog-data"

export const metadata: Metadata = {
  title: "Guias da Central de Dados",
  description: "Como importar um CSV, conectar uma API, conectar um SFTP, entender uma carga com erros — e a tabela de códigos de erro com a ação recomendada.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Antes de começar" },
  { id: "csv", label: "Como importar um CSV" },
  { id: "api", label: "Como conectar uma API" },
  { id: "sftp", label: "Como conectar um SFTP" },
  { id: "erros", label: "Como entender uma carga com erros" },
  { id: "indicador-novo", label: "Novo indicador, mesmo feed" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "codigos", label: "Códigos de erro" },
]

export default function DataHubGuidesPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader eyebrow="11 · Central de Dados" title="Guias e troubleshooting" lead="Passo a passo nas telas reais da Central de Dados e o que fazer quando uma carga não sai como esperado." />

      <WikiSection id="visao-geral" title="Antes de começar" eyebrow="Ordem de dependências">
        <p>
          Os contratos declaram dependências e a Central rejeita (na quarentena) o que referencia algo que ainda não existe. A ordem segura para uma
          organização nova é: <strong>Grupos → Subgrupos → Colaboradores → Estrutura/Jornadas/Ausências → Metas → Medições/Fechamentos/PRV → Interações →
          Transcrições/Flags</strong>. Indicadores e flags de canal são configuração da INIA (telas Indicadores e Flags de canal), não cargas.
        </p>
      </WikiSection>

      <WikiSection id="csv" title="Como importar um CSV" eyebrow="Admin › Central de Dados › Importar arquivo">
        <StepList
          steps={[
            { title: "Upload", detail: "Escolha o .csv (ou .xlsx). A Central lê o cabeçalho, detecta o separador e mostra as colunas e o total de registros." },
            { title: "Tipo de dado", detail: "Reaproveite um feed de importação existente (mapeamento já validado) ou crie um feed novo escolhendo o contrato (ex.: Colaboradores)." },
            { title: "Configuração", detail: "Formato, codificação (UTF-8 / Windows-1252 / Latin-1) e separador; para Excel, a aba." },
            { title: "Mapeamento", detail: "Confirme a sugestão por nome (matricula → externalEmployeeId, nome → name, gestor → reportsToExternalId) e adicione transformações: 'Interpretar data dd/MM/yyyy' para admissão, 'Mapear códigos' para perfil (Atendente → OPERATOR)." },
            { title: "Validação", detail: "Até 20 registros com ✓/✕ e o erro por campo. Ajuste o mapeamento até os obrigatórios ficarem verdes. Nada foi aplicado ainda." },
            { title: "Importar", detail: "A carga é criada e processada em segundo plano; a tela acompanha o status." },
            { title: "Resultado", detail: "Recebidos, válidos, inseridos, atualizados, inalterados, rejeitados — e o link para o detalhe da carga com a quarentena." },
          ]}
        />
        <ExampleCard title="Mesmo arquivo de novo">Enviar o mesmo arquivo uma segunda vez não duplica: o checksum reaproveita a carga e, se reprocessado, todos os registros contam como inalterados.</ExampleCard>
      </WikiSection>

      <WikiSection id="api" title="Como conectar uma API" eyebrow="Admin › Central de Dados › Nova fonte › API Pull">
        <StepList
          steps={[
            { title: "Conexão", detail: "Nome, Base URL, autenticação (ex.: Bearer Token) e o token. Continuar salva a fonte com o segredo cifrado." },
            { title: "Testar conexão", detail: "A INIA chama a Base URL com a credencial. 401/403 aparece como 'Conexão com erro' com o motivo." },
            { title: "Feed", detail: "Nome, chave, contrato (ex.: Medições operacionais), endpoint (/v1/medicoes), caminho dos registros (data), paginação (por número de página, tamanho 500) e checkpoint (campo atualizadoEm → parâmetro since)." },
            { title: "Amostra e mapeamento", detail: "A Central busca até 20 registros e sugere o mapeamento por nome (matricula, indicador, dia, valor, numerador, denominador)." },
            { title: "Validar e ativar", detail: "Preview, cadência (ex.: a cada 15 min), namespace de origem, Ativar." },
            { title: "Sincronizar agora", detail: "Na fonte ou no feed. Acompanhe em Cargas: recebidos, inseridos, checkpoint antes/depois. A segunda sincronização só traz o que passou do watermark." },
          ]}
        />
        <WarningCallout title="Credencial errada">
          A carga falha com DATA_SOURCE_AUTH_FAILED, a fonte fica em <strong>Erro</strong> e a conexão em <strong>Conexão com erro</strong> — mas os dados já
          aplicados continuam &quot;Atualizados&quot; até a cadência vencer. Rotacione a credencial em Configuração e clique em Retomar. Quem tem horários escolhidos espera o próximo; para carregar na hora, use Sincronizar agora.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="sftp" title="Como conectar um SFTP" eyebrow="Admin › Central de Dados › Nova fonte › SFTP">
        <StepList
          steps={[
            { title: "Conexão", detail: "Host, porta, usuário, diretório remoto, senha ou chave privada e (recomendado) a fingerprint SHA-256 da host key." },
            { title: "Testar conexão", detail: "A INIA lista o diretório remoto." },
            { title: "Feed", detail: "Padrão de arquivo (employees_*.csv), formato e opções do arquivo. A amostra vem do arquivo mais recente do padrão." },
            { title: "Mapear, validar, cadência", detail: "Como nos demais conectores; cadência diária num horário do fuso da operação é o comum." },
            { title: "Cargas", detail: "Cada carga processa o arquivo mais antigo ainda não processado; 'Nenhum arquivo novo' é uma carga Concluída com zero registros. O mesmo arquivo nunca entra duas vezes." },
          ]}
        />
      </WikiSection>

      <WikiSection id="erros" title="Como entender uma carga com erros" eyebrow="Detalhe da carga">
        <StepList
          steps={[
            { title: "Status e erro da carga", detail: "Concluída = tudo aplicado; Parcial = válidos aplicados e inválidos na quarentena; Falhou = veja o código (credencial, esquema, mapeamento, contrato atômico…)." },
            { title: "Linha do tempo", detail: "Conectou · Baixou · Leu · Mapeou · Validou · Aplicou — com duração e detalhe de cada etapa. Onde parou diz muito: falhou em Mapeando = esquema/mapeamento; em Validando = dados; em Aplicando = banco." },
            { title: "Métricas", detail: "Recebidos vs. válidos vs. rejeitados; inseridos/atualizados/inalterados dizem se a carga mudou algo. 'Último dado de negócio recebido' diz até quando os dados chegaram." },
            { title: "Quarentena", detail: "Erros agrupados por código (800 × DATA_EMPLOYEE_NOT_FOUND…), filtro por código, busca por chave/campo/mensagem, paginação e Exportar CSV." },
            { title: "Corrigir e reprocessar", detail: "Erro de mapeamento: ajuste no feed e clique em Reprocessar (usa o conteúdo retido com o mapeamento novo). Erro de referência: carregue o dado-pai (colaborador, grupo, interação) e reprocesse. Erro na origem: corrija lá e envie de novo." },
          ]}
        />
      </WikiSection>

      <WikiSection id="indicador-novo" title="Novo indicador, mesmo feed" eyebrow="Sem desenvolvimento">
        <p>
          Cadastre o indicador em <WikiLink href="/wiki/indicadores/configuracao">Indicadores</WikiLink> (código, unidade, direção, estratégia, medição
          operacional). A partir daí o feed de medições já aceita linhas com o novo <code className="font-mono text-xs">indicatorCode</code>. Se a estratégia é Taxa ou
          Média ponderada, as linhas precisam trazer numerador e denominador; se o indicador não tem medição operacional habilitada, medições diárias são
          rejeitadas com DATA_INDICATOR_CAPABILITY. Nenhum conector, endpoint ou tabela novos.
        </p>
      </WikiSection>

      <WikiSection id="troubleshooting" title="Troubleshooting" eyebrow="Sintoma → causa → ação">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sintoma</TableHead>
                <TableHead>Causa provável</TableHead>
                <TableHead>Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Fonte &quot;Conexão OK&quot; mas dados &quot;Atrasado&quot;</TableCell>
                <TableCell>A conexão funciona, mas não houve carga bem-sucedida em 2× o intervalo ou, com dias e horários, até uma hora depois do segundo horário perdido (feed pausado, cargas falhando por dados, fonte pausada).</TableCell>
                <TableCell>Veja Cargas do feed; retome feed/fonte; corrija a causa das falhas.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Central mostra &quot;Situação funcional: Fonte atrasada&quot; com a conexão OK</TableCell>
                <TableCell>O feed de Colaboradores/Ausências (autoritativo, se houver) não teve carga bem-sucedida dentro da cadência. Não é erro de conexão: é confiança do estado funcional.</TableCell>
                <TableCell>Sincronize o feed; até lá, dias após a última carga ficam presumidos (Workflows respondem &quot;situação funcional desatualizada&quot; em vez de &quot;não produziu&quot;).</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Linha de Colaboradores rejeitada com DATA_EMPLOYMENT_STATUS_UNKNOWN</TableCell>
                <TableCell>A fonte usa um código próprio de situação (PROD, FER, LIC…) que a INIA não traduz sozinha — nunca chuta &quot;em produção&quot;.</TableCell>
                <TableCell>No feed, adicione &quot;Mapear códigos&quot; em Situação funcional (PROD → EM_PRODUCAO, FER → FERIAS…). O preview mostra origem e normalizado lado a lado.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Colaborador 6x1 com &quot;escala desconhecida&quot; no trace / sem quartil</TableCell>
                <TableCell>O regime 6x1 é conhecido (Jornadas), mas o calendário programado (Escalas de trabalho) não cobre as datas — a INIA não inventa a folga.</TableCell>
                <TableCell>Alimente o feed Escalas de trabalho (snapshot de horizonte, uma linha por data com trabalha/folga).</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Aviso DATA_EMPLOYMENT_STATUS_CONFLICT na quarentena, registro aplicado</TableCell>
                <TableCell>Colaboradores e Ausências discordaram sobre a mesma pessoa e a precedência decidiu (período explícito &gt; fonte autoritativa &gt; evidência mais nova). Ou a carga cancelou (Vigente? = não) uma ausência que outra origem registrou — o período fica.</TableCell>
                <TableCell>Confira a linhagem do período; se a fonte errada venceu, marque a certa como autoritativa ou envie o período com início e fim. Ausência de outra origem se cancela por ela.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Feed &quot;Degradado&quot;</TableCell>
                <TableCell>A origem removeu/renomeou uma coluna mapeada para campo obrigatório.</TableCell>
                <TableCell>Ajuste o mapeamento no feed e clique em Ativar/Retomar; reprocesse a carga falhada.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Todas as linhas rejeitadas com DATA_EMPLOYEE_NOT_FOUND</TableCell>
                <TableCell>Matrículas não batem com o cadastro (prefixo, zeros à esquerda, espaços) ou Colaboradores ainda não foi carregado.</TableCell>
                <TableCell>Compare a chave do registro com a matrícula na INIA; use &quot;Remover espaços&quot;/&quot;Mapear códigos&quot;; carregue Colaboradores antes.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Valor rejeitado por DATA_CONTRACT_VIOLATION em medições</TableCell>
                <TableCell>Valor não confere com numerador ÷ denominador (Taxa × 100), percentual fora de 0–100 ou tempo negativo.</TableCell>
                <TableCell>Confira a estratégia do indicador e a unidade; corrija a origem.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>API Push responde 401</TableCell>
                <TableCell>Token ausente, revogado, de outra fonte/feed, ou chave do feed/id público errados.</TableCell>
                <TableCell>Gere/rotacione o token na fonte e confira a URL exibida na tela.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>API Push responde 409</TableCell>
                <TableCell>Fonte pausada ou feed em rascunho/pausado.</TableCell>
                <TableCell>Ative/retome na Central.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>&quot;Já existe uma carga em andamento ou na fila&quot;</TableCell>
                <TableCell>Um feed nunca roda duas vezes ao mesmo tempo.</TableCell>
                <TableCell>Aguarde a carga atual (ou cancele-a se ainda estiver na fila).</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Reprocessar indisponível</TableCell>
                <TableCell>O conteúdo bruto passou da retenção (30 dias).</TableCell>
                <TableCell>Reenvie o arquivo/lote ou sincronize de novo.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="codigos" title="Códigos de erro" eyebrow="Estáveis — para agrupar e agir">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Escopo</TableHead>
                <TableHead>Significado</TableHead>
                <TableHead>Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DATA_HUB_ERROR_CODES.map((entry) => (
                <TableRow key={entry.code}>
                  <TableCell className="font-mono text-xs">{entry.code}</TableCell>
                  <TableCell className="whitespace-nowrap">{entry.scope}</TableCell>
                  <TableCell>{entry.meaning}</TableCell>
                  <TableCell>{entry.action}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <SeeAlso
        links={[
          { href: "/wiki/central-de-dados", label: "Central de Dados", hint: "conceito e catálogo de contratos" },
          { href: "/wiki/central-de-dados/conectores", label: "Conectores" },
          { href: "/wiki/indicadores/configuracao", label: "Configuração de indicadores" },
          { href: "/wiki/workflows/triggers", label: "Triggers", hint: "o que uma medição ou flag aplicada dispara" },
        ]}
      />
    </WikiArticle>
  )
}
