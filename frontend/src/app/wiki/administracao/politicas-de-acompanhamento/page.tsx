import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SeeAlso, StepList, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Políticas de acompanhamento",
  description: "Quando observar, orientar, treinar, abrir plano de ação, encaminhar à liderança ou solicitar avaliação de continuidade — tipos de intervenção, políticas versionadas, o nó do Workflow, o relatório de inteligência e a experiência do líder.",
}

const TOC: WikiTocEntry[] = [
  { id: "conceitos", label: "Conceitos" },
  { id: "capacidades", label: "Capacidades dos tipos" },
  { id: "configurar", label: "Como configurar" },
  { id: "regras", label: "Regras, prioridade e conflitos" },
  { id: "criterios", label: "Critérios disponíveis" },
  { id: "dados-insuficientes", label: "Dados insuficientes" },
  { id: "publicar", label: "Validar, conferir o impacto, simular e publicar" },
  { id: "workflow", label: "No Workflow" },
  { id: "resultados", label: "Resultados da avaliação" },
  { id: "relatorio", label: "Relatório de inteligência" },
  { id: "lider", label: "A experiência do líder" },
  { id: "continuidade", label: "Avaliação de continuidade" },
  { id: "permissoes", label: "Permissões" },
  { id: "limitacoes", label: "Limitações atuais" },
]

const CONCEPTS: { term: string; meaning: string }[] = [
  { term: "Tipo de intervenção", meaning: "O que pode ser feito com o colaborador (ex.: Observar, Orientar, Treinar, Plano de ação, Encaminhar à liderança). É um cadastro da organização, com chave estável, nome, capacidades, responsável, prazo padrão, evidências exigidas, aprovação, formulário e critérios de conclusão. Versionado: o que já foi aberto continua com a versão do tipo em que nasceu." },
  { term: "Capacidade", meaning: "O comportamento técnico que o tipo usa (tarefas, checkpoints, treinamento, plano de ação…). É a única parte fixa: a INIA conhece capacidades, nunca nomes de tipos." },
  { term: "Política de acompanhamento", meaning: "QUANDO recomendar ou abrir intervenções: regras com condições e ações, prioridade explícita, escopo (organização, grupo ou subgrupo), rascunho, versões publicadas imutáveis e vigência." },
  { term: "Avaliação", meaning: "Uma aplicação da política a um colaborador num instante: versão usada, fatos consultados, condições, regras e decisão de cada ação, com justificativa reproduzível. Nunca é editada: reavaliar cria outra, ligada à original." },
  { term: "Intervenção", meaning: "O trabalho aberto para um colaborador, dentro do caso de supervisão: responsável, prazo, motivo, situação inicial, evidências, plano, tarefas, checkpoints e resultado." },
  { term: "Encaminhar × Revisão humana × Escalar", meaning: "Encaminhar transfere a responsabilidade de uma intervenção a alguém acima na cadeia. A Revisão humana do Workflow pede uma decisão sobre a execução. O Escalar do Workflow continua sendo um aviso hierárquico. São coisas diferentes e nenhuma substitui a outra." },
]

const CAPABILITIES: { name: string; what: string; inconclusive: string }[] = [
  { name: "Observação", what: "Foco e período de observação, sem cobrança do colaborador.", inconclusive: "Sim" },
  { name: "Checkpoints", what: "Pontos de verificação datados, com a leitura registrada em cada um.", inconclusive: "Sim" },
  { name: "Revisão de dados / investigação", what: "Verificar dados ausentes ou inconsistentes, ou investigar a causa, antes de concluir algo sobre o colaborador.", inconclusive: "Sim" },
  { name: "Revisão pela liderança", what: "A liderança analisa o caso e registra um parecer.", inconclusive: "Sim" },
  { name: "Orientação", what: "Registro do que foi orientado, quando e com quais referências da base.", inconclusive: "Não" },
  { name: "Tarefas", what: "Lista de tarefas com responsável e prazo.", inconclusive: "Não" },
  { name: "Treinamento", what: "Objetivo, conteúdos aprovados da base, atividades, prazo e avaliação de aprendizagem — ligado a uma competência. Afirma uma lacuna de habilidade: a regra precisa exigir diagnóstico sustentado.", inconclusive: "Não" },
  { name: "Plano de ação", what: "Situação inicial, objetivo mensurável, tarefas, apoio, checkpoints e critério de encerramento (inclui Tarefas e Checkpoints).", inconclusive: "Não" },
  { name: "Reconhecimento", what: "Elogio ou reconhecimento de um bom resultado.", inconclusive: "Não" },
  { name: "Solicitar avaliação de continuidade", what: "Processo humano restrito. Veja a seção própria.", inconclusive: "Nunca" },
]

const CONDITIONS: { name: string; what: string }[] = [
  { name: "Indicador", what: "O MESMO critério da Condition e do “Selecionar colaboradores”: valor, média, contagem ou atingimento numa janela (com amostra e cobertura mínimas), comparação com a meta vigente ou com o período anterior, quartil oficial do fechamento (Q1 = melhor, Q4 = pior) e “em N dos últimos fechamentos”. Medição diária e fechamento oficial são fontes diferentes; a INIA nunca recalcula quartil nem atingimento oficial." },
  { name: "Flag de atendimento", what: "Atendimentos do colaborador numa janela em que uma flag do catálogo chegou com o valor procurado (sim/não, ou número comparado a um valor) — em quantidade ou em percentual dos atendimentos. Menos atendimentos que o mínimo = inconclusiva. Os atendimentos encontrados entram como fontes no relatório." },
  { name: "Situação funcional", what: "Elegível hoje, ou dias elegíveis numa janela (afastamentos, férias e ausências contam como estão na Central de Dados)." },
  { name: "Intervenções anteriores", what: "Quantas intervenções de certos tipos, status e resultado operacional (melhorou, sem mudança, piorou) existem na janela — do mesmo assunto ou de qualquer um." },
  { name: "Tempo desde a última intervenção", what: "Dias desde a última aberta ou concluída; a regra diz explicitamente o que vale quando não há nenhuma." },
  { name: "Diagnóstico sustentado", what: "Existe (ou não) um diagnóstico com padrão verificado e evidência no período, opcionalmente ligado a competências." },
  { name: "Feedback publicado", what: "Quantidade de feedbacks publicados (de indicador ou de monitoria) no período." },
  { name: "Evolução desde o último feedback", what: "A INIA compara a medição diária do indicador antes e depois do último feedback publicado sobre ele. A regra define a melhora mínima, em %, para contar como evolução (0 = qualquer melhora). Sem feedback no período, não é atendida; sem medição suficiente (menos de 7 dias desde o feedback, poucos dias medidos, indicador sem medição diária), fica inconclusiva — nunca “sem evolução”." },
]

const CRITERIA_COVERAGE: { source: string; available: string; notAvailable: string }[] = [
  { source: "Medição diária do indicador", available: "Média (ponderada, simples), soma, último valor, mínimo, máximo ou contagem de dias que atendem um valor; janela em dias, calendário ou últimos N meses fechados; mínimo de medições e cobertura mínima; comparação com valor fixo, meta vigente ou período anterior (valor ou variação %).", notAvailable: "—" },
  { source: "Fechamento oficial", available: "Valor, atingimento e peso do indicador; atingimento do PRV; média, mínimo ou máximo do atingimento nos últimos N fechamentos.", notAvailable: "Recalcular atingimento ou PRV (a INIA usa o número recebido)." },
  { source: "Quartil oficial", available: "É / não é Q1…Q4 no último fechamento; “em pelo menos X dos últimos N fechamentos”; também para o PRV. Q1 = melhor, Q4 = pior, recebido pronto.", notAvailable: "Recalcular o quartil." },
  { source: "Quartil operacional", available: "—", notAvailable: "Não existe em políticas: é calculado sobre a população de um Workflow (Ranking/Condition), e a política não tem essa população. Use o quartil oficial." },
  { source: "Flags de atendimento", available: "Quantidade ou % de atendimentos com a flag (sim/não ou valor numérico) numa janela, com mínimo de atendimentos.", notAvailable: "Derivar flag de áudio ou transcrição (as flags chegam calculadas)." },
]

const OUTCOMES: { outcome: string; meaning: string }[] = [
  { outcome: "Intervenção criada", meaning: "Ao menos uma intervenção nova foi aberta pronta para execução." },
  { outcome: "Aprovação pendente", meaning: "Foi aberta, mas o tipo exige aprovação antes da execução." },
  { outcome: "Intervenção recomendada", meaning: "Nasceu como proposta: o responsável aceita (e completa o plano) ou descarta." },
  { outcome: "Liderança avisada", meaning: "A regra só avisa: quem lidera recebeu o resumo da INIA no Acompanhamento e nenhuma intervenção foi criada." },
  { outcome: "Intervenção já existente", meaning: "Já havia uma ativa com a mesma identidade (colaborador + tipo + assunto). Nada duplica; com “registrar o novo sinal”, ela recebe o sinal no histórico." },
  { outcome: "Suprimida pela carência", meaning: "Uma igual foi encerrada há menos dias que a carência da ação." },
  { outcome: "Conflito entre intervenções", meaning: "As ações escolhidas são incompatíveis entre si ou com uma intervenção ativa. Nenhuma é aplicada e o conflito fica registrado — a INIA nunca escolhe sozinha “a mais grave”." },
  { outcome: "Avaliação inconclusiva", meaning: "Faltam dados para decidir. Dado ausente nunca é desempenho ruim: só as ações de dados insuficientes da regra podem ser abertas." },
  { outcome: "Nenhuma regra atendida", meaning: "Nenhuma regra bateu — nada é aberto." },
  { outcome: "Política não aplicável", meaning: "A política está inativa, não tem versão em vigor no instante, ou o colaborador está fora do escopo dela." },
]

export default function InterventionPoliciesWikiPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="10 · Administração e Segurança"
        title="Políticas de acompanhamento"
        lead="Quando observar, orientar, treinar, abrir um plano de ação, encaminhar à liderança ou solicitar uma avaliação de continuidade — decidido por políticas que a sua organização configura, nunca por uma escada fixa no código."
      />

      <WikiSection id="conceitos" title="Conceitos" eyebrow="Tipo ≠ política ≠ intervenção">
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
                  <TableCell className="font-medium">{concept.term}</TableCell>
                  <TableCell>{concept.meaning}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <WikiFlow
          compact
          steps={[
            { label: "Sinal", detail: "indicador, fechamento oficial, feedback, diagnóstico", tone: "core" },
            { label: "Política em vigor", detail: "regras, condições e ações", tone: "core" },
            { label: "Avaliação + relatório", detail: "fatos, fontes, incertezas, justificativa", tone: "ai" },
            { label: "Intervenção no caso", detail: "responsável, prazo, plano, checkpoints", tone: "people" },
            { label: "Resultado registrado", detail: "aprendizagem e evolução operacional", tone: "output" },
          ]}
        />
        <p>
          Tudo pertence ao <strong className="font-medium text-foreground">caso de supervisão</strong> do colaborador: a avaliação, o relatório e as
          intervenções são rastreáveis a ele. Não existe uma segunda central de casos, pendências ou avisos.
        </p>
      </WikiSection>

      <WikiSection id="capacidades" title="Capacidades dos tipos" eyebrow="A única parte fixa">
        <p>
          Um tipo declara as capacidades que usa; cada capacidade traz a própria validação. É por elas — nunca pelo nome do tipo — que a INIA decide o
          que pode ser aberto com dados insuficientes ou o que exige diagnóstico sustentado.
        </p>
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Capacidade</TableHead>
                <TableHead>O que traz</TableHead>
                <TableHead>Com dados insuficientes?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CAPABILITIES.map((capability) => (
                <TableRow key={capability.name}>
                  <TableCell className="font-medium">{capability.name}</TableCell>
                  <TableCell>{capability.what}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{capability.inconclusive}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          Configurações são dados validados: não existe campo de script, SQL ou expressão livre em tipos, políticas ou competências.
        </p>
      </WikiSection>

      <WikiSection id="configurar" title="Como configurar" eyebrow="Administração › Automação › Políticas de acompanhamento">
        <StepList
          steps={[
            { title: "Tipos de intervenção", detail: "Crie os tipos que a operação usa (os de demonstração são só exemplos: edite, inative ou crie outros). Para cada um: capacidades, quem executa (o líder direto do colaborador ou o primeiro na cadeia com o nível escolhido), prazo padrão, evidências mínimas e aceitas, aprovação (e por qual nível), formulário próprio, critérios de conclusão, tipos incompatíveis e se a INIA pode rascunhar o plano. Publique: a versão publicada não muda mais. Em “Roteiro de passos”, defina os passos com que a intervenção já nasce (tarefas e checkpoints, cada um com quem faz — quem conduz ou o colaborador — e o prazo em dias após a abertura): quem lidera recebe o acompanhamento proposto e ajusta o que precisar. Os exemplos “Lado a lado” e “Atendimento assistido” mostram o formato." },
            { title: "Competências", detail: "Ligam o diagnóstico ao treinamento: indicadores, práticas e critérios da base (buscados pelo nome, nunca pela chave técnica), documentos APROVADOS da base de conhecimento e atividades (estudo, prática, acompanhar um colega, simulação, avaliação). Os vínculos são escolhidos por uma pessoa; nada é deduzido do nome do indicador." },
            { title: "Nova política", detail: "Chave estável, nome e escopo (organização, grupo ou subgrupo dentro do seu escopo de edição). Ela nasce como rascunho, sem regras." },
            { title: "Regras", detail: "Cada regra aparece com a frase do que ela faz (“Quando …, a INIA …”), que muda conforme você edita. Preencha o nome, o porquê da regra (aparece para quem lidera e na justificativa de cada avaliação), as condições em grupos “todas”/“qualquer uma” (até 3 níveis), o que a INIA faz quando a regra é atendida e o que faz quando faltam dados. A ordem na lista é a prioridade: mover a regra renumera todas. O número da prioridade e a chave ficam em “Avançado”. Em “Adicionar condição” há situações prontas (pior quartil em 3 fechamentos, atingimento abaixo de 100%, já recebeu feedback, sem evolução desde o feedback, já concluiu um acompanhamento sem evolução, tem diagnóstico) e “Outra condição”, para montar do zero." },
            { title: "Ações", detail: "Tipo (o cartão mostra quem será o responsável e se há aprovação, definidos no tipo) e efeito: abrir a ação, sugerir a ação ao responsável (ele aceita ou descarta) ou só avisar quem lidera, sem criar ação. Depois, o prazo (ou o padrão do tipo), o que fazer se já existe uma ativa (manter ou registrar o novo sinal) e a carência. No “só avisar” não há prazo, e a carência é o tempo sem repetir o mesmo aviso." },
            { title: "Validar, conferir o impacto, simular e publicar", detail: "Veja abaixo. Depois, escolha a política no nó “Avaliar política de acompanhamento” de um Workflow." },
          ]}
        />
      </WikiSection>

      <WikiSection id="regras" title="Regras, prioridade e conflitos" eyebrow="Nada implícito">
        <p>As condições disponíveis:</p>
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Condição</TableHead>
                <TableHead>O que verifica</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CONDITIONS.map((condition) => (
                <TableRow key={condition.name}>
                  <TableCell className="font-medium whitespace-nowrap">{condition.name}</TableCell>
                  <TableCell>{condition.what}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="font-medium text-foreground">Prioridade única:</strong> duas regras nunca empatam. Em “primeira que bate”, só a regra de
            maior prioridade atendida decide; uma regra mais prioritária inconclusiva bloqueia as de baixo (nunca é pulada).
          </li>
          <li>
            <strong className="font-medium text-foreground">Todas as que batem:</strong> as ações de todas as regras atendidas se somam; o mesmo tipo
            pedido por duas regras vira uma decisão só, com as duas regras registradas.
          </li>
          <li>
            <strong className="font-medium text-foreground">Incompatíveis:</strong> tipos declarados incompatíveis não convivem — nem na mesma regra
            (a publicação bloqueia), nem com uma intervenção ativa (a avaliação registra conflito e não aplica nada).
          </li>
          <li>
            <strong className="font-medium text-foreground">Duplicidade:</strong> a identidade é colaborador + tipo + assunto (o indicador da política).
            Duas avaliações ao mesmo tempo abrem uma intervenção só; a outra registra “já existente”.
          </li>
          <li>
            <strong className="font-medium text-foreground">Só avisar:</strong> a regra pode avisar quem lidera sem criar a ação. O responsável
            do tipo recebe no Acompanhamento o resumo da INIA (“Para você acompanhar: …”), nada entra em Pendências e nenhuma intervenção nasce —
            abrir uma fica a critério de quem lidera. Se já existe uma intervenção igual ativa, a avaliação registra a existente em vez de avisar; o
            mesmo aviso não se repete antes da carência (0 = avisa toda vez). A avaliação de continuidade nunca é só um aviso.
          </li>
          <li>
            <strong className="font-medium text-foreground">Treinamento exige diagnóstico:</strong> um tipo com a capacidade Treinamento só entra numa
            regra que exige diagnóstico sustentado — indicador abaixo da meta, sozinho, não prova lacuna de habilidade.
          </li>
        </ul>
      </WikiSection>

      <WikiSection id="criterios" title="Critérios disponíveis" eyebrow="Diário × oficial × quartil × flags">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fonte</TableHead>
                <TableHead>O que dá para configurar</TableHead>
                <TableHead>O que não existe (e por quê)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CRITERIA_COVERAGE.map((item) => (
                <TableRow key={item.source}>
                  <TableCell className="font-medium whitespace-nowrap">{item.source}</TableCell>
                  <TableCell>{item.available}</TableCell>
                  <TableCell className="text-muted-foreground">{item.notAvailable}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="dados-insuficientes" title="Dados insuficientes" eyebrow="Atendida · Não atendida · Inconclusiva">
        <p>
          Toda condição responde <em>atendida</em>, <em>não atendida</em> ou <em>inconclusiva</em> (sem fechamento oficial, amostra ou cobertura abaixo
          do mínimo, fonte atrasada). Os grupos combinam isso de forma explícita: em “todas”, uma não atendida decide; em “qualquer uma”, uma atendida
          decide; o resto é inconclusivo.
        </p>
        <WarningCallout title="Dado ausente não é desempenho ruim">
          Uma regra inconclusiva nunca abre as ações normais. Só podem ser abertas as ações de dados insuficientes da regra, e apenas com tipos cujas
          capacidades não classificam o colaborador (observação, checkpoints, revisão de dados, revisão pela liderança).
        </WarningCallout>
      </WikiSection>

      <WikiSection id="publicar" title="Validar, conferir o impacto, simular e publicar" eyebrow="Rascunho → versão imutável">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="font-medium text-foreground">Validar</strong> lista cada pendência no ponto exato da regra (tipo não publicado, prioridade
            repetida, treinamento sem diagnóstico, ação inválida para dados insuficientes, indicador desativado…). Só o que passa pode ser publicado.
          </li>
          <li>
            <strong className="font-medium text-foreground">Simular</strong> aplica o rascunho, a versão em vigor ou uma versão antiga a um colaborador do
            seu escopo numa data — mostrando fatos, condições, regras e ações propostas, sem gravar nada.
          </li>
          <li>
            <strong className="font-medium text-foreground">Impacto</strong> mostra o que o rascunho salvo ou a versão em vigor faria se rodasse agora,
            somado: quantas pessoas ganhariam um acompanhamento, quantas só gerariam aviso ao líder, quantas ficam sem dado suficiente (contadas à
            parte, nunca como desempenho ruim), o que nasceria por formato e quanto chegaria a cada líder. No rascunho, compara com a versão em
            vigor. Nada é gravado e ninguém é avisado. Entram os colaboradores ativos do escopo da política que você já pode consultar; quem a
            política alcança de verdade é a população do Workflow onde ela roda.
          </li>
          <li>
            <strong className="font-medium text-foreground">Publicar</strong> cria uma versão imutável, com vigência a partir de agora ou de uma data
            futura (nunca retroativa). Execuções já iniciadas continuam com a versão em vigor quando nasceram, inclusive nas novas tentativas.
          </li>
          <li>
            Publicado ou referenciado não se apaga: desative. Uma política inativa responde “não aplicável” e o histórico continua consultável.
          </li>
        </ul>
      </WikiSection>

      <WikiSection id="workflow" title="No Workflow" eyebrow="Nó próprio — não é gatilho nem Escalar">
        <p>
          O nó <strong className="font-medium text-foreground">Avaliar política de acompanhamento</strong> (veja o{" "}
          <WikiLink href="/wiki/workflows/nodes">catálogo de nodes</WikiLink>) escolhe uma política publicada e mostra o resumo dela, com link para a
          configuração. O nó não tem critérios próprios: prazos, responsáveis e aprovações são da política.
        </p>
        <p>
          Uma política só é avaliada quando um Workflow chega a esse nó: é o Workflow que diz <em>quando olhar e para quem</em> (gatilho, agenda,
          população); a política diz <em>o que cabe para cada pessoa</em>. Publicada e sem Workflow, a política não faz nada. Por isso a página da
          política mostra, em texto, <strong className="font-medium text-foreground">o que ela faz</strong> (cada regra, na ordem de prioridade, com
          o que a INIA faz, para quem vai e se pede aprovação) e <strong className="font-medium text-foreground">onde ela roda</strong>: os
          Workflows com o nó que a cita e o estado de cada um (publicado e ligado, publicado mas desligado ou só no rascunho do editor), com aviso
          quando nenhum Workflow publicado e ligado passa por ela. Workflows fora do seu escopo de gestão entram só na contagem.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="font-medium text-foreground">Modo:</strong> “Somente recomendar” (tudo nasce como proposta) ou “Abrir intervenções
            conforme a política”.
          </li>
          <li>
            <strong className="font-medium text-foreground">Referências de análise:</strong> nós anteriores (feedback, caso, atendimento) entram como
            evidência da avaliação.
          </li>
          <li>
            <strong className="font-medium text-foreground">Resultado para Conditions:</strong> o resultado geral e um campo por tipo de intervenção
            da política (“Decisão — Plano de ação” é “Recomendada ao responsável”, “Aberta aguardando aprovação”…), escolhidos na lista de campos — sem
            digitar caminho. Uma diferença entre ações nunca fica escondida num resultado único.
          </li>
          <li>
            No <WikiLink href="/wiki/qa-lab">QA Lab</WikiLink> o nó avalia de verdade, mas não abre nada: os efeitos aparecem como simulados.
          </li>
          <li>
            O responsável é resolvido pela cadeia do colaborador (o líder direto, por exemplo): o nó não precisa de um Escalar para entregar a
            intervenção a quem lidera. O “Executar agora” mostra as intervenções que a execução abriu ou recomendou.
          </li>
        </ul>
      </WikiSection>

      <WikiSection id="resultados" title="Resultados da avaliação" eyebrow="Descrevem a avaliação, não a gravidade">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resultado</TableHead>
                <TableHead>Significado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {OUTCOMES.map((item) => (
                <TableRow key={item.outcome}>
                  <TableCell className="font-medium whitespace-nowrap">{item.outcome}</TableCell>
                  <TableCell>{item.meaning}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="relatorio" title="Relatório de inteligência" eyebrow="O fundamento da avaliação">
        <p>
          Cada avaliação gera um relatório ligado ao caso e compartilhado pelas intervenções que ela abriu: síntese e período; indicadores, metas,
          resultados, quartis e evolução; fontes; intervenções anteriores e seus resultados; diagnóstico sustentado; incertezas e dados faltantes
          (separados dos fatos); política, versão e critérios; e cada ação proposta com a própria justificativa, responsável, prazo, próximos passos e
          critério de resultado.
        </p>
        <p>
          A parte estruturada é montada de forma determinística e sempre existe. Se a política pedir, a INIA redige uma narrativa a partir dela,
          citando os fatos — a narrativa vem marcada como redação, separa hipóteses de fatos e não muda critério nem decisão. Se a redação falhar, a
          falha fica registrada, o relatório continua válido e é possível tentar de novo sem abrir nada em duplicidade. O relatório é lido na própria
          INIA (não há exportação).
        </p>
        <p>
          Quando a avaliação abre ou sugere uma ação, o relatório guarda também o <strong className="font-medium text-foreground">resumo da INIA
          para a liderança</strong>, montado só com os fatos da avaliação (não depende de IA): a situação que levou à ação; o que já foi feito — os
          feedbacks publicados ao colaborador nos últimos 180 dias sobre o mesmo indicador (até os cinco mais recentes, com a data, o que foi
          recomendado e se ele já confirmou a ciência) e as intervenções anteriores com o resultado registrado; a evolução medida; o que ainda não
          se sabe; e o próximo passo. O texto dos feedbacks é histórico do que já foi dito ao colaborador, nunca evidência.
        </p>
        <p>
          A <strong className="font-medium text-foreground">evolução medida</strong> compara a medição diária do indicador antes e depois do último
          feedback: duas janelas do mesmo tamanho (os dias desde o feedback, no máximo 60), com o dia do feedback fora das duas. A frase traz os dois
          valores, a variação e quantos dias tinham medição; “melhorou” ou “piorou” só diz para que lado o valor andou, pela direção do indicador —
          não há limiar escondido. Com menos de 7 dias desde o feedback, menos de 3 dias medidos em um dos lados ou indicador sem medição diária, o
          resumo diz o que falta e não classifica: dado ausente não é desempenho ruim.
        </p>
      </WikiSection>

      <WikiSection id="lider" title="A experiência do líder" eyebrow="Receber aviso → entender → agir → acompanhar">
        <StepList
          steps={[
            { title: "Receber o aviso", detail: <>O <WikiLink href="/wiki/notificacoes">sino</WikiLink> avisa que algo novo aconteceu e leva direto à intervenção no caso. No Acompanhamento, o aviso de abertura já traz o resumo da INIA: a fala dela (“Criei um acompanhamento para você fazer com…”, “Sugiro…”), a situação, o que já foi feito, a evolução medida e o próximo passo.</> },
            { title: "Abrir a pendência", detail: <>Em <WikiLink href="/wiki/pendencias">Pendências</WikiLink> aparecem as intervenções que esperam você: aceitar, aprovar, decidir ou executar — com prazo e atraso.</> },
            { title: "Entender o relatório", detail: "No caso de supervisão: o que fazer agora, colaborador, indicador, responsável, prazo, o resumo da INIA (ou o motivo, nas intervenções abertas à mão), o relatório, as evidências e o histórico." },
            { title: "Executar ou decidir", detail: "Aceitar e completar o plano (o painel lista de uma vez o que ainda falta para aceitar), aprovar ou devolver, descartar, encaminhar à liderança — os botões aparecem só para quem pode e no estado certo. No treinamento, o líder pode escolher a competência: entram os conteúdos publicados dela e as atividades viram itens com prazo, sem IA." },
            { title: "Acompanhar a evolução", detail: "Tarefas, atividades e checkpoints com a leitura registrada em cada um. Em cada checkpoint concluído, a INIA anexa a própria medição do indicador desde o início do acompanhamento, ao lado da leitura de quem conduz. Atrasada é uma marca derivada do prazo, nunca um status; com prazo ou passo vencido, quem conduz recebe um lembrete por semana." },
            { title: "Registrar o resultado", detail: "A conclusão exige o que o tipo pede: tarefas concluídas, avaliação de aprendizagem, leitura da evolução operacional e o registro do resultado. Nos formatos que fazem algo com o colaborador (tarefas, treinamento, plano de ação ou orientação), também “O acompanhamento deu resultado?” (sim, em parte ou não) e pelo menos um motivo. A medição da INIA (antes × depois do início) fica registrada ao lado, sem substituir a avaliação de quem conduziu." },
            { title: "Ver a equipe e o que funciona", detail: "No fim da aba Equipe: os acompanhamentos em andamento da sua estrutura (com o próximo passo e o atraso) e, dos concluídos nos últimos 180 dias, por formato e indicador: quantos, se deram resultado, a medição da INIA e os motivos mais citados. A gestão acima vê o mesmo para a estrutura dela." },
          ]}
        />
        <p>
          A ficha do colaborador lista as intervenções dele, e o <WikiLink href="/wiki/acompanhamento">Acompanhamento</WikiLink> recebe o aviso com
          link para o caso — sem duplicar tarefas nem criar outro feed. Resolver a pendência (aceitar, aprovar) não apaga esse registro do
          Acompanhamento: ele continua como caminho de volta ao caso.
        </p>
        <p>
          <strong className="font-medium text-foreground">O colaborador</strong> só vê um acompanhamento quando o formato está marcado como
          “O colaborador vê este acompanhamento” e a intervenção está em execução. No Acompanhamento dele aparecem o formato, quem conduz, o prazo
          e os passos; ele marca os passos que são dele. Nunca vê o motivo, a análise, o relatório nem as anotações de quem conduz, e a avaliação de
          continuidade nunca aparece.
        </p>
        <p>
          O resumo aparece só para quem ainda é parte da intervenção (responsável, quem aprova ou quem decide). Quem encaminhou a responsabilidade a
          outra pessoa continua vendo o aviso curto, sem o resumo. Avisos de intervenções abertas antes de 18/11/2026 também aparecem sem ele.
        </p>
      </WikiSection>

      <WikiSection id="continuidade" title="Avaliação de continuidade" eyebrow="Processo humano restrito">
        <WarningCallout title="A INIA nunca decide desligamento">
          Regras e IA podem abrir uma <em>solicitação</em> de avaliação de continuidade, com evidências e justificativa. Ninguém a decide
          automaticamente: só uma pessoa com a permissão própria registra a decisão, com justificativa. Nenhuma decisão possível altera a situação
          funcional nem executa desligamento. Isso não pode ser desligado por configuração.
        </WarningCallout>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>O tipo com essa capacidade sempre exige decisão humana e evidência, não aceita rascunho por IA e não se combina com outras capacidades.</li>
          <li>Nunca é aberto com dados insuficientes; a regra precisa de uma condição com evidência verificável e de justificativa.</li>
          <li>
            Resultado ruim, sozinho, nunca leva à solicitação: a regra precisa exigir pelo menos uma intervenção anterior <em>concluída</em> com
            resultado “sem mudança” ou “piorou” (“não medido” não conta). Sem essa condição a política não publica, e uma versão publicada antes
            desta regra não consegue abrir a solicitação.
          </li>
          <li>
            O aviso tem texto fixo: a INIA <em>sugere</em> a avaliação, diz que a decisão é de quem está autorizado e que nada muda na situação
            funcional. A IA não redige esse texto.
          </li>
          <li>
            Decisões possíveis: continuidade confirmada, desenvolvimento continua, encaminhado ao processo formal da organização (fora da INIA) ou mais
            evidência necessária.
          </li>
        </ul>
      </WikiSection>

      <WikiSection id="permissoes" title="Permissões" eyebrow="Configurar ≠ executar ≠ decidir">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="font-medium text-foreground">Gestor de políticas de acompanhamento:</strong> editar, simular, publicar e auditar
            políticas no escopo atribuído. Configurar não dá acesso aos dados dos colaboradores: a simulação só alcança quem está no seu escopo.
          </li>
          <li>
            <strong className="font-medium text-foreground">Analista de acompanhamento:</strong> ver, executar e aprovar intervenções no escopo.
          </li>
          <li>
            <strong className="font-medium text-foreground">Avaliador de continuidade:</strong> decidir solicitações de avaliação de continuidade —
            concedido só pelo Administrador geral, que não tem essa permissão por padrão.
          </li>
          <li>
            Líderes executam e aprovam o que está na própria cadeia (responsável e aprovador são resolvidos pela hierarquia do colaborador). Veja também{" "}
            <WikiLink href="/wiki/administracao">Administração</WikiLink>.
          </li>
        </ul>
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="Transparência">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Papéis são do catálogo da INIA (não há papel customizado por organização).</li>
          <li>Atraso é calculado na leitura; não há aviso periódico de prazo vencido.</li>
          <li>O colaborador ainda não vê as próprias intervenções.</li>
          <li>Quartil operacional não está disponível em políticas — use o quartil oficial do fechamento.</li>
          <li>O rascunho de treinamento/plano pela INIA e a narrativa do relatório dependem de IA e ainda não foram validados com modelo real; o resto do fluxo é estruturado.</li>
          <li>A política é acionada pelo nó do Workflow; não existe agendamento próprio fora dele.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/workflows/nodes", label: "Nodes do Workflow", hint: "Avaliar política de acompanhamento" },
            { href: "/wiki/pendencias", label: "Pendências", hint: "o que espera decisão" },
            { href: "/wiki/qa-lab", label: "QA Lab", hint: "simular sem efeitos" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
