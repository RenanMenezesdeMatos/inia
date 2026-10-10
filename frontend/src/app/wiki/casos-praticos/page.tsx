import type { Metadata } from "next"

import { SeeAlso, StepList, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Casos práticos — guias integrados",
  description: "Guias de ponta a ponta usando a UI real: criar um Agent de Faturamento, vincular uma Base de Conhecimento, testar um Workflow sem gastar IA, auditar uma chamada contra um processo, enviar feedback após aprovação, resumo gerencial após analisar uma equipe.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "guia-1", label: "Guia 1: da base ao Acompanhamento" },
  { id: "guia-2", label: "Guia 2: equipe → resumo gerencial" },
  { id: "guia-agent-faturamento", label: "Como criar um Agent de Faturamento" },
  { id: "guia-kb", label: "Como vincular uma Base de Conhecimento" },
  { id: "guia-sem-ia", label: "Como testar um Workflow sem gastar IA" },
  { id: "guia-auditoria", label: "Como auditar uma chamada contra um processo" },
  { id: "guia-aprovacao", label: "Como enviar feedback após aprovação" },
  { id: "guia-resumo", label: "Como gerar um resumo gerencial" },
  { id: "guia-3", label: "Guia 3: Q4 operacional de TMA (7 dias)" },
]

export default function PracticalCasesPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="12 · Casos Práticos"
        title="Guias integrados"
        lead="Pequenos guias de ponta a ponta, usando os rótulos reais das telas. Os 20 modelos de Workflow e os 10 Workflows operacionais estão em Modelos de Workflow."
      >
        <p className="text-sm text-muted-foreground">
          Ver também <WikiLink href="/wiki/casos-praticos/workflows">Modelos de Workflow</WikiLink> e{" "}
          <WikiLink href="/wiki/introducao/como-as-pecas-se-conectam">Como as peças se conectam</WikiLink>.
        </p>
      </WikiPageHeader>

      <WikiSection id="guia-1" title="Guia completo 1 — da Base de Conhecimento ao Acompanhamento" eyebrow="Rechamada → feedback aprovado">
        <WikiFlow
          steps={[
            { label: "Base de Conhecimento", detail: "Admin › Base de conhecimento › Nova base: “Jeito Vivo de Atender”, Tipo Manual, Publicar", tone: "input" },
            { label: "Agent", detail: "Admin › Agentes › Novo agente: Especialista de Experiência do Cliente, com a base em “Bases de conhecimento consultadas”", tone: "ai" },
            { label: "Workflow", detail: "Admin › Workflows › Novo workflow: Gatilho Flag de canal “rechamada” → Condição → Ação Chamar agente → Revisão humana → Output", tone: "core" },
            { label: "QA Lab", detail: "Workflow › Testar rascunho atual, uma interação real com rechamada, Parar antes da IA; depois IA real com limite 1", tone: "core" },
            { label: "Revisão humana", detail: "Aprovar em Pendências (o Supervisor do operador)", tone: "people" },
            { label: "Acompanhamento", detail: "o operador lê o feedback e clica “Confirmar ciência”", tone: "output" },
          ]}
        />
        <p>É o <WikiLink href="/wiki/casos-praticos/workflows">Modelo 01 · Rechamada recorrente</WikiLink>, já configurado em rascunho.</p>
      </WikiSection>

      <WikiSection id="guia-2" title="Guia completo 2 — analisar uma equipe e resumir para a liderança" eyebrow="Ranking → Apply → Join → Orchestrator gerencial">
        <WikiFlow
          steps={[
            { label: "Selecionar colaboradores", detail: "Workflow Consolidado (Agenda mensal, Estrutura do Diretor) → Por ranking: 2 maiores quedas de PRV por Subgrupo", tone: "core" },
            { label: "Aplicar individualmente", detail: "uma execução por colaborador selecionado", tone: "core" },
            { label: "Chamar agente", detail: "Especialista de Performance Individual, com os fechamentos oficiais", tone: "ai" },
            { label: "Revisão humana", detail: "Supervisor de cada um aprova/reprova/escala; Aprovado → feedback ao operador", tone: "people" },
            { label: "Consolidar resultados", detail: "espera todas as execuções; Escalar → Escalonar ao Gerente → Join", tone: "core" },
            { label: "Orquestrador · Gerencial (consolidado)", detail: "síntese: prioridades, padrões, próximos passos", tone: "ai" },
            { label: "Output → Diretor (resolvido pela estrutura) · Acompanhamento", tone: "output" },
          ]}
        />
        <p>É o Modelo 04 (Maiores quedas por Subgrupo); veja também os Modelos 05, 11, 14, 16 e 20 em <WikiLink href="/wiki/casos-praticos/workflows">Modelos de Workflow</WikiLink>.</p>
      </WikiSection>

      <WikiSection id="guia-agent-faturamento" title="Como criar um Agent de Faturamento" eyebrow="Admin › Agentes">
        <StepList
          steps={[
            { title: "Publique as bases do domínio", detail: "Contestação de Contas Móvel, Segunda Via de Conta e Negociação de Débito precisam estar Publicadas em Admin › Base de conhecimento." },
            { title: "Novo agente", detail: <>Nome “Especialista de Faturamento”, Tipo <strong>Personalizado</strong>, Objetivo (“comparar o que aconteceu numa chamada de faturamento com o procedimento oficial, com evidência literal, e orientar o operador”), Descrição.</> },
            { title: "Grupo", detail: "Todos os grupos (admin global) ou o Grupo de faturamento — as bases escopadas para o grupo entram pré-selecionadas." },
            { title: "Contexto (prompt)", detail: "Papel, objetivo, fontes permitidas (só as bases de faturamento), prioridade da base, uso da transcrição, ausência de dados, fatos × hipóteses, evidências literais, formato da saída, limitações e proibições." },
            { title: "Bases de conhecimento consultadas", detail: "Selecione só as três bases de faturamento — nunca Cancelamento, Reparo ou políticas de RH." },
            { title: "Restrições específicas", detail: "Marque as que se aplicam só a este Agent (somadas às globais)." },
            { title: "Criar agente → Teste", detail: "Cole uma transcrição de segunda via e execute o teste; depois, no QA Lab › Agent, verifique que só as seções de segunda via foram recuperadas." },
          ]}
        />
      </WikiSection>

      <WikiSection id="guia-kb" title="Como vincular uma Base de Conhecimento a um Agent" eyebrow="Admin › Base de conhecimento + Agentes">
        <StepList
          steps={[
            { title: "Crie e publique a base", detail: "Nova base → Título, Tipo de documento, conteúdo (Colar texto ou Enviar arquivo), Alcance por grupo → Salvar → Publicar." },
            { title: "Abra o Agent", detail: "Admin › Agentes › o Agent do domínio › aba Configuração." },
            { title: "Bases de conhecimento consultadas", detail: "Mova a base de “Disponíveis” para “Selecionadas”. Se a base tem o mesmo Alcance por grupo do Agent, ela já vem pré-selecionada." },
            { title: "Salvar alterações", detail: "O backend valida que a base existe e não foi excluída." },
            { title: "Confira no QA Lab", detail: "QA Lab › Agent › o Agent, com uma entrada pertinente: em “Bases de conhecimento nesta request”, a base aparece em “Autorizadas para o agente” e os trechos em “Trechos efetivamente recuperados”." },
          ]}
        />
        <WarningCallout kind="tip" title="Base autorizada ≠ conteúdo do prompt">
          Vincular autoriza. O que entra em cada request são só os trechos pertinentes — ver <WikiLink href="/wiki/bases-conhecimento#retrieval">Retrieval</WikiLink>.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="guia-sem-ia" title="Como testar um Workflow sem gastar IA" eyebrow="QA Lab › Workflow">
        <StepList
          steps={[
            { title: "Selecione o Workflow com “Testar rascunho atual”", detail: "Não precisa estar publicado." },
            { title: "Escolha os dados", detail: "Colaborador + interação (Flag), cenário/medição (Indicador) ou estrutura/disparo simulado (Agenda)." },
            { title: "Uso de IA: Parar antes da IA", detail: "Modo de execução: Executar tudo." },
            { title: "Executar somente este Workflow", detail: "Conditions, rankings, fan-out, fan-in e destinatários rodam de verdade; a execução pausa no primeiro node de IA." },
            { title: "Leia o trace", detail: "Cada Condition com valor, regra e ramo; a coleção do ranking; o destinatário resolvido; e, na request pausada, o rastro de conhecimento — exatamente o que entraria no prompt." },
            { title: "Só então, IA real", detail: "Troque para IA real com “Limite de requests ao modelo” = 1 ou 2 e reexecute com “Testar rascunho atual”." },
          ]}
        />
      </WikiSection>

      <WikiSection id="guia-auditoria" title="Como auditar uma chamada contra um processo" eyebrow="Conformidade de processo">
        <StepList
          steps={[
            { title: "Pré-requisitos", detail: "Uma base de processo publicada (ex.: Contestação de Contas Móvel) vinculada ao especialista do domínio; um Workflow com gatilho por Flag de canal (ex.: contestacao) e Abrangência no Grupo do domínio." },
            { title: "Node Ação → Chamar agente", detail: <>Escolha o Especialista de Faturamento e, em <strong>Formato da análise</strong>, “Conformidade de processo”.</> },
            { title: "Teste no QA Lab", detail: "Escolha uma interação real com a flag; execute com IA real (limite 1). O resultado traz o feedback e a lista de etapas: CONFORME, NÃO CONFORME (com evidência), NÃO FOI POSSÍVEL CONFIRMAR, NÃO APLICÁVEL." },
            { title: "Leia com a regra em mente", detail: "Etapa sem citação literal foi rebaixada por código para “Não foi possível confirmar” — ausência de evidência nunca é não conformidade." },
            { title: "Revisão humana e Output", detail: "Supervisor aprova; Output → O próprio operador · Acompanhamento. O resultado da conformidade fica persistido junto do feedback." },
          ]}
        />
        <p>Já configurado como Modelo 18 (instâncias Faturamento, Retenção e Cancelamento, Suporte Técnico).</p>
      </WikiSection>

      <WikiSection id="guia-aprovacao" title="Como enviar um feedback para o operador após aprovação" eyebrow="Revisão humana → Output">
        <StepList
          steps={[
            { title: "No Workflow", detail: "Chamar agente → Revisão humana (Quem revisa: Supervisor do operador; Conteúdo a revisar: o resultado do agente) → ramo Aprovado → Output (Destinatário: O próprio operador; Superfícies: Acompanhamento; Fonte: o resultado do agente inteiro) → Fim. Ramo Reprovado → Fim. Ramo Escalar → Escalonar ao Gerente." },
            { title: "Publique", detail: "Depois de testar no QA Lab (inclusive simulando Aprovar/Reprovar/Escalar)." },
            { title: "Em produção", detail: "A execução para em Pendências do Supervisor; o sino avisa “Revisão pendente”. Aprovar publica o feedback; o operador vê “Novo acompanhamento” e confirma ciência; o Supervisor vê “Ciência em ‹data›”." },
          ]}
        />
      </WikiSection>

      <WikiSection id="guia-resumo" title="Como gerar um resumo gerencial após analisar uma equipe" eyebrow="Pós-JOIN">
        <StepList
          steps={[
            { title: "Workflow Consolidado", detail: "Novo workflow → Gatilho Agenda de calendário → Alvo da avaliação: Consolidado → População / Estrutura: Estrutura do Gerente (ancorada em pessoa)." },
            { title: "Selecionar colaboradores → Aplicar individualmente → Chamar agente → Revisão humana", detail: "Cada pessoa com a sua análise e a sua revisão." },
            { title: "Consolidar resultados", detail: "Todas as decisões convergem no mesmo Join (Aprovado via Output ao operador; Reprovado direto; Escalar via Escalonar ao Gerente com Continuar)." },
            { title: "Orquestrador → Orquestrador · Gerencial (consolidado)", detail: "Instrução: “Resuma os diagnósticos e as decisões das revisões, com prioridades e próximos passos”." },
            { title: "Output → Gerente do operador · Acompanhamento", detail: "Resolvido pela estrutura: exatamente uma pessoa, senão a publicação bloqueia (NOT_FOUND/AMBIGUOUS)." },
            { title: "Sem síntese?", detail: "Se bastar a lista consolidada, ligue o Join direto ao Output — zero IA (Modelo 15)." },
          ]}
        />
      </WikiSection>

      <WikiSection id="guia-3" title="Guia completo 3 — identificar o Q4 operacional de TMA nos últimos 7 dias" eyebrow="Quartil operacional ≠ quartil oficial">
        <StepList
          steps={[
            { title: "Workflow Consolidado", detail: "Agenda de calendário (ex.: toda segunda às 09:00) → Alvo da avaliação: Consolidado → Estrutura: Equipe do Supervisor (ou estrutura do Gerente)." },
            { title: "Selecionar colaboradores › Por ranking › Quartil operacional", detail: "Fonte: Valor do indicador TMA; agregação: Média ponderada pelo volume (Σ segundos ÷ Σ contatos); período: Últimos 7 dias; quartil: Q4. Entram TODOS os do Q4 (sem N)." },
            { title: "Regras que o motor aplica", detail: "Direção LOWER → maior TMA é pior; população = quem tem medição na janela (SEM DADOS fica fora, nunca vira Q4); mínimo de 4 pessoas com valor, senão ninguém é classificado; empate = mesma posição, nunca quartis diferentes." },
            { title: "Aplicar individualmente → Chamar agente → Revisão humana → Output", detail: "Especialista de Eficiência Operacional recebe os números da janela; o Supervisor aprova; Output ao operador · Acompanhamento." },
            { title: "No QA Lab", detail: "Executar até “Selecionar colaboradores” com Parar antes da IA: cada linha mostra janela (09/09 → 15/09), método (Σ total ÷ Σ volume), amostra, dias com dado, cobertura e o quartil operacional atribuído." },
          ]}
        />
        <WarningCallout title="Q4 operacional — últimos 7 dias ≠ Q4 oficial de agosto">
          O quartil operacional é calculado pela INIA sobre UMA população, UM indicador, UMA janela e UMA agregação — muda a cada janela. O quartil
          oficial é o do fechamento mensal, persistido pela fonte corporativa. Para &quot;quem fechou agosto em Q4&quot;, use Por critério › Quartil
          oficial = Q4. Ver <WikiLink href="/wiki/indicadores#quartil-operacional">Indicadores › Quartil operacional</WikiLink>.
        </WarningCallout>
        <SeeAlso
          links={[
            { href: "/wiki/casos-praticos/workflows", label: "Modelos de Workflow", hint: "20 modelos + 10 reais" },
            { href: "/wiki/workflows/criacao", label: "Como criar um Workflow" },
            { href: "/wiki/qa-lab", label: "QA Lab" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
