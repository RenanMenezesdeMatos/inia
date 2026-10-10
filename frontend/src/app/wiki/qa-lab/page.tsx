import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CapabilityBadge, ExampleCard, FieldRow, SeeAlso, StepList, UseCases, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { AI_POLICY_LABELS, RUN_MODE_LABELS } from "@/schemas/admin/qa-lab.schema"

export const metadata: Metadata = {
  title: "QA Lab",
  description: "Ambiente de simulação de Workflows, Agents e Orchestrators com dados reais e zero efeito operacional: DRAFT × PUBLISHED, snapshot, reexecução, controles reais, Parar antes da IA, orçamento de requests, interações, trace e rastro de conhecimento.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "O que é o QA Lab" },
  { id: "zero-side-effects", label: "Zero efeitos colaterais" },
  { id: "quando-usar", label: "Quando usar / não usar" },
  { id: "passo-a-passo", label: "Passo a passo: testar um Workflow" },
  { id: "draft-published", label: "DRAFT × PUBLISHED" },
  { id: "snapshot", label: "Snapshot" },
  { id: "rerun", label: "Reexecutar" },
  { id: "controles", label: "Controles reais" },
  { id: "parar-antes-da-ia", label: "Parar antes da IA" },
  { id: "budget", label: "Orçamento de IA" },
  { id: "dados-de-teste", label: "Dados de teste" },
  { id: "interacoes", label: "Interações" },
  { id: "chat-style", label: "Transcrição como diálogo" },
  { id: "revisao-simulada", label: "Revisão humana simulada" },
  { id: "trace", label: "Trace" },
  { id: "knowledge-trace", label: "Rastro de conhecimento" },
  { id: "ferramentas-utilizadas", label: "Ferramentas utilizadas" },
  { id: "qa-calculo", label: "QA de cálculo (medições)" },
  { id: "agent-orchestrator", label: "Testar Agent e Orchestrator" },
  { id: "historico", label: "Histórico de QA" },
  { id: "tokens-eficiencia", label: "Tokens e eficiência" },
  { id: "observabilidade", label: "Observabilidade de IA" },
  { id: "limitacoes", label: "Limitações atuais" },
]

export default function QaLabPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="09 · QA Lab"
        title="QA Lab"
        lead="Teste Agents, Orchestrators e Workflows de forma isolada, segura e controlada: selecione dados reais, execute passo a passo, veja cada decisão, cada request de IA e cada trecho de conhecimento usado — sem gerar nenhum efeito operacional."
      >
        <div className="flex flex-wrap gap-2 pt-2">
          <CapabilityBadge label="Efeitos simulados" />
          <CapabilityBadge label="Dados reais (somente leitura)" />
          <CapabilityBadge label="Parar antes da IA" />
          <CapabilityBadge label="Orçamento de requests" />
          <CapabilityBadge label="Snapshot e reexecução" />
          <CapabilityBadge label="Telemetria de tokens" />
        </div>
        <p className="text-sm text-muted-foreground">Disponível em Admin › QA Lab, só com o papel Administrador geral (a aba Feedbacks exige o papel QA de feedback).</p>
      </WikiPageHeader>

      <WikiSection id="zero-side-effects" title="Zero efeitos colaterais" eyebrow="Execução simulada">
        <WarningCallout title="O QA Lab nunca gera efeito operacional">
          Uma simulação não cria feedback real, alerta operacional, matrícula produtiva, Revisão humana em Pendências, Output no Acompanhamento nem
          escreve nos dados oficiais. Tudo que o Workflow &quot;faria&quot; é capturado como <strong>efeito simulado</strong> e mostrado no
          resultado. O banco é lido em modo somente leitura. A única coisa &quot;real&quot; que pode acontecer é uma request ao modelo de IA — e só
          quando você escolhe &quot;IA real&quot;.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="quando-usar" title="Quando usar / não usar" eyebrow="Critério">
        <UseCases
          use={[
            "Antes de publicar um Workflow — e sempre que uma Condition, ranking ou prompt mudar",
            "Validar a lógica (Condition, ranking, fan-out, fan-in, destinatário) sem gastar IA",
            "Ver exatamente o que entraria no prompt de um Agent para uma interação real",
            "Reproduzir um caso (mesmo snapshot) para investigar um resultado",
          ]}
          avoid={[
            "Como substituto da aba Execuções para acompanhar matrículas reais",
            "Para gerar feedback de verdade para um operador — isso é o Workflow publicado",
            "Rodadas repetidas com “IA real” sem limite de requests (custo)",
          ]}
        />
      </WikiSection>

      <WikiSection id="passo-a-passo" title="Passo a passo: testar um Workflow" eyebrow="Admin › QA Lab › Workflow">
        <StepList
          steps={[
            { title: "Escolha “O que deseja testar?” → Workflow", detail: "As outras abas são Agent, Orchestrator e Histórico de QA." },
            { title: "Workflow e Configuração a testar", detail: <>Selecione o Workflow e, em <strong>Configuração a testar</strong>, “Testar rascunho atual” (padrão) ou “Testar versão publicada” (só se já publicado). O badge mostra o estado: Rascunho, Publicado ou “Publicado · alterações não publicadas”.</> },
            { title: "Dados de teste", detail: "Escolha o colaborador (busca por nome), a interação (trigger por Flag), a medição/cenário (trigger por Indicador) ou a estrutura/colaborador (Agenda). A tela mostra o gatilho, a abrangência e a unidade avaliada." },
            { title: "Data/hora simulada", detail: "Usada por Agenda, Aguardar, janelas históricas e comparações temporais. Para Agenda de calendário, informe também o “Disparo da agenda (simulado)” — executa imediatamente, sem esperar o agendador." },
            { title: "Modo de execução", detail: `${RUN_MODE_LABELS.RUN_ALL}, ${RUN_MODE_LABELS.STEP} ou ${RUN_MODE_LABELS.UNTIL_NODE} (“Executar até antes de…” um node escolhido).` },
            { title: "Orçamento de IA", detail: <><strong>Uso de IA</strong>: {AI_POLICY_LABELS.STOP_BEFORE_AI} (recomendado na primeira rodada) ou {AI_POLICY_LABELS.REAL}; e <strong>Limite de requests ao modelo (opcional)</strong>.</> },
            { title: "Executar somente este Workflow", detail: "Só este Workflow roda para o evento escolhido — mesmo que outros Workflows publicados compartilhem o mesmo gatilho." },
            { title: "Leia o resultado", detail: "Canvas com o caminho percorrido e as abas Passo a passo, Efeitos simulados, Requests de IA e Contexto utilizado. Reexecute com “Executar novamente esta versão” ou “Testar rascunho atual”." },
          ]}
        />
      </WikiSection>

      <WikiSection id="draft-published" title="DRAFT × PUBLISHED" eyebrow="Rascunho é o padrão">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="Testar rascunho atual (padrão)">Usa o rascunho salvo e não afeta a versão publicada. Um rascunho inválido também roda — o QA Lab mostra onde ele para.</ExampleCard>
          <ExampleCard title="Testar versão publicada (opção explícita)">Usa a configuração atualmente publicada, mas todos os efeitos continuam simulados. Desabilitado enquanto o Workflow não foi publicado.</ExampleCard>
        </div>
      </WikiSection>

      <WikiSection id="snapshot" title="Snapshot" eyebrow="A configuração daquele momento">
        <p>
          Quando uma simulação começa, ela captura a configuração do Workflow daquele momento (o resultado informa &quot;testou o rascunho capturado
          em ‹data›&quot;). Mudanças posteriores no Workflow não alteram aquela execução — o passo a passo, as decisões simuladas e a reexecução
          continuam sobre o mesmo snapshot.
        </p>
      </WikiSection>

      <WikiSection id="rerun" title="Reexecutar" eyebrow="Dois botões, dois significados">
        <FieldRow label="Executar novamente esta versão" value="Reexecuta o MESMO snapshot (mesma configuração capturada), criando um novo QA Run marcado como “reexecução do mesmo snapshot”." />
        <FieldRow label="Testar rascunho atual" value="Cria um novo QA Run com a configuração ATUAL do rascunho — o jeito de testar uma correção depois de editar o Workflow." />
      </WikiSection>

      <WikiSection id="controles" title="Controles reais" eyebrow="Só os que existem">
        <WikiTable caption="Rótulos exatamente como aparecem no QA Lab.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Controle</TableHead>
                <TableHead>O que faz</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">{RUN_MODE_LABELS.RUN_ALL}</TableCell>
                <TableCell>Executa até o fim (ou até uma Revisão humana, um Aguardar, o limite de IA ou “Parar antes da IA”).</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">{RUN_MODE_LABELS.STEP}</TableCell>
                <TableCell>Executa um node por vez — “o próximo node ainda não foi executado” até você avançar.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">{RUN_MODE_LABELS.UNTIL_NODE}</TableCell>
                <TableCell>“Executar até antes de…” um node escolhido — útil para ver a coleção de “Selecionar colaboradores” ou o fan-out sem seguir adiante.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">{AI_POLICY_LABELS.STOP_BEFORE_AI}</TableCell>
                <TableCell>Pausa a execução no primeiro node que precisaria de IA — mostrando o que entraria no prompt, sem gastar token.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">Limite de requests ao modelo</TableCell>
                <TableCell>Quantas requisições ao modelo podem ocorrer neste QA Run. Ao atingir o limite, a execução pausa antes da próxima.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">Data/hora simulada · Disparo da agenda (simulado)</TableCell>
                <TableCell>Relógio da simulação; para Agenda de calendário, o instante do disparo.</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium whitespace-nowrap">Aprovar / Reprovar / Escalar</TableCell>
                <TableCell>Decisão simulada numa Revisão humana pendente do QA Run — nunca aparece em Pendências reais.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="parar-antes-da-ia" title="Parar antes da IA" eyebrow="Testar a lógica sem gastar tokens">
        <p>
          Com <strong className="font-medium text-foreground">{AI_POLICY_LABELS.STOP_BEFORE_AI}</strong>, tudo que é determinístico roda normalmente —
          Condition, ranking, fan-out, fan-in, resolução de destinatário — e a execução pausa no primeiro node de IA. O rastro de conhecimento já
          aparece: é exatamente o que entraria no prompt. É a forma certa de validar um Workflow inteiro antes de gastar uma única request.
        </p>
      </WikiSection>

      <WikiSection id="budget" title="Orçamento de IA" eyebrow="Requests, não nodes">
        <WarningCallout kind="tip" title="Orçamento = quantidade máxima de requests ao modelo naquela simulação">
          &quot;Request de IA&quot; = uma requisição ao modelo; &quot;interação/chamada&quot; = uma ligação da operação. Um QA Run usa UMA interação,
          mas pode fazer 0, 1 ou várias requests: um Orchestrator faz várias (roteamento, especialistas, síntese). O orçamento é global para o QA Run
          inteiro — nunca reiniciado por colaborador num fan-out nem depois do Join. Com limite 2, João e Maria consomem 1 cada, e Pedro pausa antes
          da IA.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="dados-de-teste" title="Dados de teste" eyebrow="Reais, somente leitura">
        <FieldRow label="Colaborador" value="Busca por nome dentro da população elegível do Workflow (Abrangência ∩ Filtro Populacional) — a mesma regra da produção." />
        <FieldRow label="Estrutura" value="Para Workflows Consolidados, a Estrutura Consolidada já configurada." />
        <FieldRow label="Cenário (Indicador)" value="Uma medição real do indicador do gatilho, ou um valor informado à mão para o cenário." />
        <FieldRow label="Prévia por Condition" value="Escolha uma Condition e veja o resultado que ela daria para o colaborador escolhido, antes de executar." />
      </WikiSection>

      <WikiSection id="interacoes" title="Interações" eyebrow="Trigger por Flag">
        <p>
          Para um Workflow por Flag de canal, a interação selecionada É o evento do gatilho — sempre UMA interação por QA Run. O seletor filtra por
          período (De/Até) e mostra, para cada interação compatível: operador, canal, flags (destacando a flag do gatilho e o valor dela),
          transcrição e a evidência que o Agent vai poder citar. Só interações do colaborador escolhido e com a flag do gatilho são elegíveis.
        </p>
      </WikiSection>

      <WikiSection id="chat-style" title="Transcrição como diálogo" eyebrow="Convenção textual">
        <p>
          A transcrição é texto puro, sem falantes estruturados. Quando o texto segue a convenção &quot;Operador: …&quot; / &quot;Cliente: …&quot;, o
          QA Lab renderiza como diálogo (balões por falante, com a evidência literal destacada); caso contrário, mostra texto corrido. A convenção
          não altera a transcrição nem o que o Agent recebe.
        </p>
      </WikiSection>

      <WikiSection id="revisao-simulada" title="Revisão humana simulada" eyebrow="Decidir dentro do QA Run">
        <p>
          Quando a execução chega a uma Revisão humana, o resultado mostra o &quot;Conteúdo a revisar&quot; e os botões Aprovar / Reprovar / Escalar
          (só os conectados no grafo). A decisão é simulada dentro do QA Run e a execução continua pelo ramo escolhido — nada vai para Pendências
          reais. Num fan-out, cada colaborador tem a sua revisão pendente, e o Join espera todas.
        </p>
      </WikiSection>

      <WikiSection id="trace" title="Trace" eyebrow="Node · entrada · saída · decisões · contexto">
        <WikiFlow
          compact
          steps={[
            { label: "Canvas: o caminho percorrido, com o ramo escolhido em cada Condition", tone: "core" },
            { label: "Passo a passo: cada node com Contexto do gatilho / Resultado do node, avaliação da Condition (valor, regra, ramo, motivo do Sem dados), coleção/ranking, consolidação e destinatário resolvido", tone: "core" },
            { label: "Efeitos simulados: o que o Workflow teria feito (feedback, alerta, saída por surface)", tone: "output" },
            { label: "Requests de IA: Agent/Orchestrator executado, prompt final, entrada, resposta, tokens", tone: "ai" },
            { label: "Contexto utilizado: colaborador, interação, medições e variáveis disponíveis", tone: "neutral" },
          ]}
        />
        <p>
          Para Conditions, o trace mostra &quot;Meta resolvida&quot; e &quot;Origem da meta&quot;, &quot;Período anterior&quot; e &quot;Variação&quot;,
          &quot;Fechamentos: N de M esperados&quot; e o motivo do Sem dados. Para &quot;Selecionar colaboradores&quot;: Avaliados / Selecionados / Não
          atenderam / Sem dados (ou o ranking por partição). Para &quot;Consolidar resultados&quot;: Esperados / Concluídos / Falharam. Para Output:
          &quot;Destinatário resolvido: Cargo Nome&quot; — ou o motivo de não resolver.
        </p>
      </WikiSection>

      <WikiSection id="knowledge-trace" title="Rastro de conhecimento" eyebrow="Bases autorizadas × trechos recuperados">
        <p>
          Em cada request de IA, a seção &quot;Bases de conhecimento nesta request&quot; mostra: <strong className="font-medium text-foreground">Bases
          autorizadas</strong> (para o agente), <strong className="font-medium text-foreground">Trechos recuperados</strong> (documento, seção, score,
          excerto), <strong className="font-medium text-foreground">Injetado no prompt</strong> (caracteres/tokens estimados) e{" "}
          <strong className="font-medium text-foreground">Sem retrieval seria</strong> (o que entraria sem retrieval), o modo (NONE / FULL / RETRIEVAL /
          NO_MATCH) e o <strong className="font-medium text-foreground">Prompt final</strong> com segredos redigidos. Com &quot;Parar antes da IA&quot; o
          rastro já aparece — sem gastar token.
        </p>
      </WikiSection>

      <WikiSection id="ferramentas-utilizadas" title="Ferramentas utilizadas" eyebrow="Prova de que o Agent investigou">
        <p>
          Quando o Agent (direto ou como especialista de um Orquestrador) tem <WikiLink href="/wiki/agents/ferramentas-investigacao">Ferramentas de
          investigação</WikiLink>, a etapa mostra a seção <strong className="font-medium text-foreground">Ferramentas utilizadas</strong>: a lista numerada
          das ferramentas na ordem em que foram chamadas (ex.: 1. Consultar indicador · 2. Comparar períodos · 3. Segmentar (assunto) · 4. Comparar com a
          estrutura · 5. Buscar interações · 6. Analisar transcrições · 7. Consultar Base de Conhecimento), com os argumentos resumidos, o resultado
          resumido, a qualidade do dado (amostra insuficiente, cobertura insuficiente, sem dados…) e a proveniência (período, população, fonte). O resumo
          da investigação diz quantas chamadas foram feitas de quantas permitidas, quantas vieram do cache e quantas foram recusadas. É o trace seguro —
          nunca o raciocínio do modelo.
        </p>
      </WikiSection>

      <WikiSection id="qa-calculo" title="QA de cálculo (medições operacionais)" eyebrow="Janela · método · amostra · numerador · denominador">
        <p>
          Sempre que uma Condition ou um ranking usa Valor do indicador, o trace mostra a evidência do cálculo devolvida pelo resolvedor único de
          medições operacionais: a <strong className="font-medium text-foreground">janela</strong> (datas locais), o{" "}
          <strong className="font-medium text-foreground">método</strong> (ex.: &quot;Σ 142.639 s ÷ Σ 287 contatos&quot;, &quot;média simples de 5
          período(s)&quot;, &quot;último valor da janela (snapshot)&quot;), a <strong className="font-medium text-foreground">amostra</strong>, os{" "}
          <strong className="font-medium text-foreground">dias com dado</strong> e a <strong className="font-medium text-foreground">cobertura</strong>{" "}
          (dias com dado ÷ dias úteis esperados), o <strong className="font-medium text-foreground">numerador/denominador</strong> quando a fonte
          informa componentes, o <strong className="font-medium text-foreground">valor</strong> e, no modo Quartil operacional, a posição e o quartil
          atribuído — ou o motivo (população insuficiente, direção sem classificação). Ver{" "}
          <WikiLink href="/wiki/indicadores#medicoes-operacionais">Medições operacionais</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="agent-orchestrator" title="Testar Agent e Orchestrator" eyebrow="As outras abas">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="Aba Agent">
            Escolha o <strong>Agent</strong>, opcionalmente um <strong>Contexto de colaborador</strong> (indicadores e dados oficiais dele) e a{" "}
            <strong>Entrada</strong> (transcrição, pergunta ou contexto). Botão <strong>Executar Agent</strong>. Mesmo orçamento de IA e mesmo rastro de
            conhecimento.
          </ExampleCard>
          <ExampleCard title="Aba Orchestrator">
            Escolha o <strong>Orchestrator</strong>, o <strong>Contexto de invocação</strong> (“Como o chat/voz do operador chamaria” ou “Como um node
            de Workflow chamaria”), a <strong>Pergunta / instrução</strong> e um <strong>Contexto extra</strong> opcional (a transcrição que um node
            passaria). Botão <strong>Executar Orchestrator</strong> — o trace mostra roteamento → especialistas → síntese, request a request.
          </ExampleCard>
        </div>
      </WikiSection>

      <WikiSection id="historico" title="Histórico de QA" eyebrow="Todo QA Run é persistido">
        <p>
          A aba <strong className="font-medium text-foreground">Histórico de QA</strong> lista as simulações anteriores (quem executou, quando, o recurso,
          o estado) e permite reabrir qualquer uma com o trace completo — inclusive reexecutar o mesmo snapshot. Cada execução mostra também a
          telemetria de eficiência: <strong className="font-medium text-foreground">Requests IA · Tool calls · Rodadas · Input · Cached · Uncached · Output ·
          Reasoning · Total · Duração · Tool Budget · Token Budget</strong> (ver a seção seguinte).
        </p>
      </WikiSection>

      <WikiSection id="tokens-eficiencia" title="Tokens e eficiência" eyebrow="Telemetria persistida por execução">
        <p>
          Toda execução do QA Lab grava, junto do trace, uma telemetria calculada pela aplicação a partir do que o provedor de IA informou em cada
          request. Ao abrir a execução, a aba <strong className="font-medium text-foreground">Tokens e eficiência</strong> mostra:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="font-medium text-foreground">Total da execução</strong> — requests de IA, Tool calls executadas (com cache e recusas), planning
            rounds, input, cached input, uncached input, output, reasoning, total e duração; o status do <strong className="font-medium text-foreground">Tool
            Budget</strong> (chamadas usadas de quantas permitidas · Respondida / Orçamento esgotado / Tempo esgotado) e do{" "}
            <strong className="font-medium text-foreground">Token Budget</strong> (OK ou Alerta de tokens quando ultrapassa um limiar de aviso configurável —
            observabilidade, nunca teto que interrompe a execução).
          </li>
          <li>
            <strong className="font-medium text-foreground">Antes × depois</strong> — quando existe uma execução de referência compatível (mesmo recurso, mesmo
            colaborador e mesma interação, a mais recente anterior): tokens, requests, Tool calls e duração antes e depois, com diferença absoluta e
            percentual. O histórico resume isso como &quot;N tokens economizados (−x%) vs execução anterior&quot;.
          </li>
          <li>
            <strong className="font-medium text-foreground">Por fase</strong> — Planejamento (o Agent escolhe ferramentas), Análise semântica (leitura de
            transcrições), Conhecimento e Síntese (resposta final). O preflight determinístico não chama o modelo e por isso não aparece como fase de request.
          </li>
          <li>
            <strong className="font-medium text-foreground">Por request</strong> — sequência, fase, modelo/provedor, input, cached, output, reasoning, total,
            duração, a composição estimada do prompt (caracteres de sistema, schemas de ferramentas e entrada) e as ferramentas solicitadas naquela rodada.
          </li>
        </ul>
        <p>
          Cada request mostra ainda o <strong className="font-medium text-foreground">provedor, modelo e tier</strong> escolhidos pelo roteador (com a razão da rota e se houve
          escalação ou fallback), quantos <strong className="font-medium text-foreground">identificadores técnicos</strong> chegaram ao modelo (o ideal é zero) e o contexto
          lógico por categoria (prompt estático, schemas de ferramentas, Evidence Ledger, conteúdo de interações, conhecimento, schema estruturado, objetivo). As Tool calls
          aparecem separadas: <strong className="font-medium text-foreground">preflight</strong> (determinístico, da aplicação), <strong className="font-medium text-foreground">escolhidas pelo
          Agent</strong> (as únicas que consomem o orçamento) e o total.
        </p>
        <p>
          A partir da V1.3 o painel ganha três blocos: <strong className="font-medium text-foreground">Cache</strong> (modo — sem cache, implícito do provedor ou explícito
          com o prefixo estático em cache —, tokens servidos e hit rate), <strong className="font-medium text-foreground">Qualidade</strong> (status da validação de evidência
          fail-closed: aprovada, corrigida em uma re-request, fallback factual ou descartada; envelope presente; claims rejeitadas; escopos das afirmações; limitações
          declaradas) e <strong className="font-medium text-foreground">Cobertura da evidência</strong> (interações disponíveis × analisadas, cobertura das registradas,
          universo operacional e cobertura operacional — &quot;Não determinado&quot; quando não é possível ligar os dois universos —, representatividade e o escopo de afirmação
          permitido). O total mostra o <strong className="font-medium text-foreground">custo estimado</strong> quando há preços configurados por perfil de modelo (&quot;Preço não
          configurado&quot; caso contrário) e o antes × depois compara também uncached input, prompt estático, schemas e custo. Os componentes do prompt aparecem somados por id,
          para medir cada bloco.
        </p>
        <p>
          <strong className="font-medium text-foreground">Investigation outcome</strong>: objetivo da investigação, escopo de afirmação exigido, motivo da parada (evidência
          suficiente, dados insuficientes, sem caminho, limite de rodadas/orçamento/tokens/segurança), suficiência, necessidades de evidência (satisfeitas/abertas/bloqueadas),
          hipóteses materiais, evidência conflitante e se mais evidência mudaria a conclusão — além de cada parada proposta pelo modelo e recusada pela aplicação, com o motivo
          (&quot;EMPLOYEE_PATTERN exige evidência representativa&quot;). Cada execução grava um <strong className="font-medium text-foreground">fingerprint da massa</strong>
          (só contagens estruturais, nunca conteúdo): o antes × depois só calcula percentuais quando a referência rodou sobre a mesma massa; massa diferente mostra &quot;Dataset
          diferente — comparação não diretamente válida&quot; com os valores lado a lado, e execuções antigas sem fingerprint ficam com compatibilidade não verificável. A mesma seção mostra
          ainda as <strong className="font-medium text-foreground">fontes de evidência</strong> disponíveis × consultadas (conteúdo das interações, eventos, histórico, segmentação, população,
          conhecimento — rastreabilidade, nunca nota), a estratégia de amostragem e a intenção do período, as contagens da análise de interações (analisadas × registradas, achados, trechos
          verificados, blocos temporais cobertos) e se a parada foi recusada na última rodada (com as lacunas e ferramentas restantes); em Qualidade, o <em>marker parse status</em> do envelope de
          evidência distingue marcador ausente, duplicado, payload inválido ou fronteira inválida.
        </p>
        <WarningCallout title="Não informado nunca é estimado">
          Cached input e reasoning só aparecem quando o provedor os informa na resposta; caso contrário a tela mostra &quot;Não informado&quot; — o QA Lab
          não estima nem inventa esses números. Execuções anteriores a esta telemetria continuam legíveis com os totais que tinham (requests, input, output,
          total, duração) e &quot;Não informado&quot; nos demais campos.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="observabilidade" title="Observabilidade de IA" eyebrow="Em nível de produto">
        <p>
          Cada request de IA registra: Agent ou Orchestrator executado, modo do retrieval e bases usadas, prompt final (com segredos redigidos),
          entrada e resposta, tokens estimados injetados e os tokens oficiais informados pelo modelo. Toda execução real de Agent (teste manual ou
          gatilho) também fica na aba Execuções do Agent, com entrada, saída, status e erro.
        </p>
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="Transparência">
        <ul className="list-inside list-disc space-y-1">
          <li>Só o papel Administrador geral acessa o QA Lab.</li>
          <li>Efeitos simulados de cada colaborador num fan-out aparecem agregados na aba &quot;Efeitos simulados&quot; (cosmético).</li>
          <li>&quot;IA real&quot; consome tokens de verdade — use o limite de requests.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/workflows/criacao", label: "Como criar um Workflow", hint: "o QA Lab entra antes de Publicar" },
            { href: "/wiki/bases-conhecimento#retrieval", label: "Retrieval", hint: "o que o rastro de conhecimento mostra" },
            { href: "/wiki/casos-praticos#guia-sem-ia", label: "Guia: testar um Workflow sem gastar IA" },
            { href: "/wiki/seguranca#observabilidade", label: "Observabilidade e segurança da IA" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
