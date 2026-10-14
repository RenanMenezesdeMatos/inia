import type { Metadata } from "next"

import { CapabilityBadge, ExampleCard, SeeAlso, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export const metadata: Metadata = {
  title: "O que é a INIA",
  description: "Objetivo, público, principais casos de uso, diferença entre análise, automação e acompanhamento, papel da IA e papel das regras determinísticas.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "O que é" },
  { id: "objetivo", label: "Objetivo e público" },
  { id: "casos-de-uso", label: "Principais casos de uso" },
  { id: "jornada", label: "A jornada de um caso" },
  { id: "caso", label: "Caso de supervisão" },
  { id: "analise-automacao", label: "Análise × automação × acompanhamento" },
  { id: "ia-vs-regras", label: "IA × regras determinísticas" },
  { id: "feedback", label: "Feedback publicável" },
  { id: "oficial-vs-calculado", label: "O que vem oficial e o que a INIA calcula" },
  { id: "limitacoes", label: "Limitações atuais" },
]

export default function IntroductionPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="01 · Introdução"
        title="O que é a INIA"
        lead="Uma Supervisora Virtual com IA para operações de atendimento. Não é, em essência, um chatbot: ela identifica sinais operacionais, reúne evidências, produz diagnósticos explicáveis, recomenda ações, acompanha a evolução e escala casos quando necessário."
      >
        <div className="flex flex-wrap gap-2 pt-2">
          <CapabilityBadge label="Dados oficiais lidos, nunca recalculados" />
          <CapabilityBadge label="Regras determinísticas antes da IA" />
          <CapabilityBadge label="Evidência literal verificada por código" />
          <CapabilityBadge label="Humano no circuito (Revisão humana)" />
          <CapabilityBadge label="Chat/voz persistidos" tone="missing" />
        </div>
      </WikiPageHeader>

      <WikiSection id="objetivo" title="Objetivo e público" eyebrow="Para quem">
        <p>
          O objetivo é dar a cada pessoa da operação — do operador ao diretor — uma leitura honesta e acionável do que está acontecendo, com a
          evidência ao lado da conclusão. O produto atende, com a mesma tela e capacidades calculadas por papel:
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Operador</strong>: recebe feedbacks, reconhecimentos e orientações; acompanha o próprio PRV e indicadores; confirma ciência.</li>
          <li><strong className="font-medium text-foreground">Supervisor</strong>: enxerga a equipe direta, decide revisões humanas, recebe resultados e escalonamentos.</li>
          <li><strong className="font-medium text-foreground">Coordenador, Gerente, Gerente Sênior, Diretor</strong>: enxergam a estrutura abaixo deles, com consolidado, agrupamentos e drill-down.</li>
          <li><strong className="font-medium text-foreground">Administrador</strong>: configura Bases de Conhecimento, Agents, Orchestrators, Indicadores, Regras, Flags, Workflows e Usuários; testa no QA Lab.</li>
        </ul>
        <p>
          Cada perfil enxerga apenas o escopo permitido pela estrutura organizacional e pelas capacidades calculadas no backend — ver{" "}
          <WikiLink href="/wiki/introducao/papeis">Papéis</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="casos-de-uso" title="Principais casos de uso" eyebrow="Na prática">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="Feedback de chamada com evidência">Uma rechamada ou nota baixa na URA dispara um Workflow; um Agent especialista compara a transcrição com o procedimento oficial e cita o trecho exato; o Supervisor aprova; o operador recebe no Acompanhamento.</ExampleCard>
          <ExampleCard title="Feedback de indicador">Q4 de PRV por três fechamentos seguidos, TMA acima da meta, queda de Qualidade: a INIA explica com os números oficiais e recomenda acompanhamento — sem inventar causa.</ExampleCard>
          <ExampleCard title="Auditoria de processo">Contestação de fatura, cancelamento, reparo: o Agent confere etapa a etapa se o procedimento foi seguido, e diz quando não foi possível confirmar.</ExampleCard>
          <ExampleCard title="Visão gerencial">Selecionar os piores/melhores de uma estrutura, analisar cada um, consolidar e sintetizar um resumo executivo para o Gerente ou Diretor.</ExampleCard>
          <ExampleCard title="Reconhecimento">Bons resultados também geram elogio específico e verificável — o produto não existe só para apontar problema.</ExampleCard>
          <ExampleCard title="Acompanhamento de estrutura">Indicadores consolidados, distribuição por quartil, situação por fato de cada colaborador e onde atuar primeiro.</ExampleCard>
        </div>
      </WikiSection>

      <WikiSection id="jornada" title="A jornada de um caso" eyebrow="Canônica">
        <WikiFlow
          compact
          steps={[
            { label: "Detecção", detail: "sinal operacional: flag numa interação, nova medição, agenda", tone: "input" },
            { label: "Diagnóstico", detail: "regra determinística + análise de IA quando há o que analisar", tone: "core" },
            { label: "Evidência", detail: "trecho literal da transcrição, número oficial, seção da base", tone: "core" },
            { label: "Recomendação", detail: "o que fazer, ligado ao procedimento ou ao indicador", tone: "ai" },
            { label: "Acompanhamento", detail: "publicado para leitura; ciência do colaborador; evolução", tone: "output" },
            { label: "Escalonamento ou encerramento", detail: "quando persiste, sobe a hierarquia; senão, encerra", tone: "people" },
          ]}
        />
        <p>
          O que fazer em cada situação — observar, orientar, treinar, abrir plano de ação, encaminhar à liderança — não é uma escada fixa: é
          decidido por <WikiLink href="/wiki/administracao/politicas-de-acompanhamento">políticas de acompanhamento</WikiLink> que a organização
          configura e versiona. Um resultado abaixo da meta, isoladamente, não determina a intervenção — pesam causa, recorrência, evidências,
          evolução e intervenções anteriores; bons resultados também geram reconhecimento.
        </p>
      </WikiSection>

      <WikiSection id="caso" title="Caso de supervisão" eyebrow="Unidade central">
        <p>
          O <strong className="font-medium text-foreground">caso de supervisão</strong> é a unidade central do domínio. Alertas, evidências,
          feedbacks, planos de desenvolvimento, checkpoints e escalonamentos pertencem — ou são rastreáveis — a um caso. Quando um Workflow
          dispara por Flag e publica um feedback, ele cria um caso novo com a evidência registrada e o Feedback publicado de verdade, pela mesma
          regra de publicação que vale para um feedback criado manualmente.
        </p>
      </WikiSection>

      <WikiSection id="analise-automacao" title="Análise × automação × acompanhamento" eyebrow="Três coisas diferentes">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Camada</TableHead>
                <TableHead>O que é</TableHead>
                <TableHead>Onde fica</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Análise</TableCell>
                <TableCell>Ler e entender: PRV, indicadores, consolidado, situação, distribuição, insights por fato. Abrir a tela nunca chama IA.</TableCell>
                <TableCell><WikiLink href="/wiki/indicadores/analytics">Indicadores</WikiLink> e <WikiLink href="/wiki/estrutura/equipe">Equipe / Estrutura</WikiLink></TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Automação</TableCell>
                <TableCell>Reagir a eventos e dados com regras e IA: Workflows, Agents, Orchestrators, Bases de Conhecimento — testados no QA Lab.</TableCell>
                <TableCell><WikiLink href="/wiki/workflows">Workflow Engine</WikiLink>, <WikiLink href="/wiki/agents">Agents</WikiLink>, <WikiLink href="/wiki/qa-lab">QA Lab</WikiLink></TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Acompanhamento</TableCell>
                <TableCell>Receber e agir: conteúdo para ler (Acompanhamento), decisão requerida (Pendências) e aviso de que algo novo aconteceu (sino).</TableCell>
                <TableCell><WikiLink href="/wiki/acompanhamento">Acompanhamento</WikiLink>, <WikiLink href="/wiki/pendencias">Pendências</WikiLink>, <WikiLink href="/wiki/notificacoes">Notificações</WikiLink></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
      </WikiSection>

      <WikiSection id="ia-vs-regras" title="Papel da IA e papel das regras determinísticas" eyebrow="Princípio">
        <WarningCallout kind="tip" title="IA não substitui regras que podem ser determinadas deterministicamente">
          Comparar 78% com 80%, contar quantos fechamentos estão em Q4, ordenar uma equipe pelo TMA, decidir quem participa de um Workflow — tudo
          isso é resolvido por regra (Conditions, rankings, filtros), reproduzível e auditável. A IA entra só onde há análise a fazer: ler uma
          transcrição, comparar com um procedimento, explicar um conjunto de números, sintetizar várias análises.
        </WarningCallout>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="Determinístico (sem IA)">Conditions, Selecionar colaboradores (critério e ranking), fan-out/fan-in, resolução de destinatário, situação do colaborador, insights de tela, ciência, pendências.</ExampleCard>
          <ExampleCard title="IA (Agents e Orchestrators)">Feedback de monitoria com evidência literal, feedback de indicador com números oficiais, conformidade de processo, síntese gerencial, chat/voz do operador.</ExampleCard>
        </div>
        <p>
          Regras que o código aplica — não só o prompt pede: texto gerado por IA nunca é evidência; a evidência de um feedback de monitoria
          precisa ser citação literal da transcrição (se a IA parafraseia, o resultado é descartado); etapa &quot;CONFORME&quot; sem citação vira
          &quot;NÃO FOI POSSÍVEL CONFIRMAR&quot;; SEM DADOS nunca vira 0 nem FALSE.
        </p>
      </WikiSection>

      <WikiSection id="feedback" title="Feedback publicável" eyebrow="Dois tipos">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExampleCard title="INDICATOR">Baseado em indicador, meta vigente, período, evolução, contexto operacional e histórico.</ExampleCard>
          <ExampleCard title="MONITORING">Baseado em interação/transcrição, critérios de monitoria, conhecimento vigente, guardrails e diagnósticos relacionados.</ExampleCard>
        </div>
        <p>
          Um feedback publicável contém indicador impactado, evidência encontrada, comportamento observado, procedimento relacionado e
          recomendação. Toda conclusão acionável aponta para uma fonte verificável.
        </p>
      </WikiSection>

      <WikiSection id="oficial-vs-calculado" title="O que vem oficial da empresa e o que a INIA calcula" eyebrow="Fonte da verdade">
        <WikiTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vem pronto da fonte corporativa (a INIA só lê)</TableHead>
                <TableHead>A INIA calcula (por regra, reproduzível)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>PRV, atingimento, peso e quartil por competência; meta vigente; valor das medições; flags das interações; transcrições; cadastro de pessoas e de quem reporta a quem.</TableCell>
                <TableCell>Atingimento consolidado de estrutura (média simples), situação do colaborador, dentro/abaixo da referência, insights de tela, medições operacionais agregadas em janelas (média ponderada, taxa, soma, último valor…), quartil operacional, rankings, resolução de destinatário, elegibilidade.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>
          Detalhes em <WikiLink href="/wiki/indicadores">Indicadores e Performance</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="Transparência">
        <ul className="list-inside list-disc space-y-1">
          <li>O chat e a voz da INIA (avatar) ainda não persistem as interações — mensagens, curtidas e dúvidas se perdem ao recarregar a página.</li>
          <li>A medição operacional (camada 1) e o quartil operacional existem no motor de Workflows (Conditions, rankings, QA Lab); a área Indicadores do perfil continua mostrando só fechamentos oficiais mensais.</li>
          <li>Comunicados do gestor, selos e KPIs da Home do operador ainda são de demonstração.</li>
          <li>Notificações são atualizadas por consulta periódica — sem push nem e-mail.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/introducao/papeis", label: "Papéis e o que cada um vê" },
            { href: "/wiki/introducao/como-as-pecas-se-conectam", label: "Como as peças se conectam" },
            { href: "/wiki/glossario", label: "Glossário" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
