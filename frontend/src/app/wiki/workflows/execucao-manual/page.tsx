import type { Metadata } from "next"

import { ExampleCard, FieldRow, SeeAlso, StepList, UseCases, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"
import { MANUAL_TRIGGER_CONTEXT_DESCRIPTIONS, MANUAL_TRIGGER_CONTEXT_LABELS } from "@/schemas/admin/workflow.schema"
import { MANUAL_RUN_STAGE_LABELS } from "@/schemas/admin/workflow-manual-run.schema"

export const metadata: Metadata = {
  title: "Execução manual (Executar agora)",
  description:
    "O gatilho Manual: quando usar, como criar, publicar e executar para um colaborador escolhido, permissões, contexto (interação ou medição reais), acompanhamento, diferença para o QA Lab e o exemplo de feedback entregue pelo Avatar.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "quando-usar", label: "Quando usar" },
  { id: "contexto", label: "Dados de cada execução" },
  { id: "criar-publicar", label: "Criar e publicar" },
  { id: "executar", label: "Executar agora" },
  { id: "permissoes", label: "Permissões e elegibilidade" },
  { id: "acompanhar", label: "Acompanhar resultado e falhas" },
  { id: "real-x-qa-lab", label: "Execução real × QA Lab" },
  { id: "exemplo-avatar", label: "Exemplo: feedback no Avatar" },
  { id: "limitacoes", label: "Limitações" },
]

export default function ManualExecutionPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="05 · Workflow Engine"
        title="Execução manual (Executar agora)"
        lead="O gatilho Manual faz um Workflow começar só quando alguém com permissão clica em Executar agora e escolhe UM colaborador. É o mesmo motor, a mesma versão publicada e as mesmas regras dos outros gatilhos — só o momento de começar é decidido por uma pessoa."
      >
        <WikiFlow
          compact
          steps={[
            { label: "Executar agora", detail: "colaborador + interação/medição reais, escolhidos na tela", tone: "people" },
            { label: "Execução normal do motor", detail: "versão publicada e ativa, presa à execução; origem manual registrada", tone: "core" },
            { label: "Nós do fluxo", detail: "Condition, Agent, Orquestrador, Gerar feedback, Revisão humana, Espera", tone: "ai" },
            { label: "Output", detail: "Acompanhamento, Notificação, Chat ou Avatar — como em qualquer execução", tone: "output" },
          ]}
        />
      </WikiPageHeader>

      <WikiSection id="quando-usar" title="Quando usar" eyebrow="Critério">
        <UseCases
          use={[
            "Demonstrar um fluxo de ponta a ponta para um colaborador específico, na hora",
            "Gerar um feedback de uma interação que você já sabe qual é (ex.: um atendimento que a liderança pediu para olhar)",
            "Refazer a análise de uma medição real depois de ajustar o Agent, a base ou a estratégia (nova execução, nova versão)",
          ]}
          avoid={[
            "Testar um rascunho sem efeitos reais — use o QA Lab",
            "Rodar para toda a equipe — o Manual executa para UM colaborador por disparo; para populações use Agenda",
            "Reagir automaticamente a um evento — isso é Flag de canal ou Indicador",
          ]}
        />
      </WikiSection>

      <WikiSection id="contexto" title="Dados de cada execução" eyebrow="O gatilho declara o que o disparo traz">
        <p>
          Acionar à mão não faz os dados deixarem de ser necessários. O gatilho Manual declara, na configuração, <strong className="font-medium text-foreground">quais dados reais</strong> cada disparo precisa
          trazer — é isso que decide o que os nós podem ler e o que a publicação aceita:
        </p>
        <FieldRow label={MANUAL_TRIGGER_CONTEXT_LABELS.COLLABORATOR} value={MANUAL_TRIGGER_CONTEXT_DESCRIPTIONS.COLLABORATOR} />
        <FieldRow label={MANUAL_TRIGGER_CONTEXT_LABELS.INTERACTION} value={MANUAL_TRIGGER_CONTEXT_DESCRIPTIONS.INTERACTION} />
        <FieldRow label={MANUAL_TRIGGER_CONTEXT_LABELS.INDICATOR_MEASUREMENT} value={MANUAL_TRIGGER_CONTEXT_DESCRIPTIONS.INDICATOR_MEASUREMENT} />
        <WikiTable caption="Regras de publicação pela origem dos dados (as mesmas dos outros gatilhos)">
          <thead>
            <tr>
              <th className="text-left">Formato / nó</th>
              <th className="text-left">Colaborador</th>
              <th className="text-left">Interação</th>
              <th className="text-left">Medição</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Avaliação de processo / Conformidade de processo</td>
              <td>Não (não há transcrição)</td>
              <td>Sim</td>
              <td>Não</td>
            </tr>
            <tr>
              <td>Gerar feedback de monitoria</td>
              <td>Não</td>
              <td>Sim</td>
              <td>Não</td>
            </tr>
            <tr>
              <td>Gerar feedback / Diagnóstico de indicador (medição)</td>
              <td>Não</td>
              <td>Não</td>
              <td>Sim (estratégia publicada do indicador)</td>
            </tr>
            <tr>
              <td>Chamar agente com fonte de dados (período, fechamentos oficiais)</td>
              <td>Sim (fonte obrigatória)</td>
              <td>—</td>
              <td>—</td>
            </tr>
            <tr>
              <td>Condition sobre o &quot;valor do gatilho&quot;</td>
              <td>Não</td>
              <td>Não (sem valor de flag)</td>
              <td>Sim (valor da medição)</td>
            </tr>
          </tbody>
        </WikiTable>
        <WarningCallout title="Nada é fabricado">
          O disparo nunca cria interação, flag, medição ou evidência. A interação precisa existir, ser do colaborador escolhido e ter transcrição; a
          medição precisa ser do colaborador e do indicador do gatilho. Sem o dado, não há execução — a tela explica o que falta.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="criar-publicar" title="Criar e publicar" eyebrow="Passo a passo">
        <StepList
          steps={[
            { title: "Novo Workflow", detail: <>Em Administração › Workflows, crie o Workflow e escolha a Abrangência (Grupo/Subgrupo). A Abrangência continua limitando quem pode ser escolhido.</> },
            { title: "Gatilho Manual", detail: <>No tipo de gatilho escolha <strong>Manual</strong> e, em <strong>Dados de cada execução</strong>, diga se o disparo traz só o colaborador, uma interação ou uma medição (neste caso, escolha o indicador).</> },
            { title: "Monte os nós", detail: <>Os mesmos nós de sempre. Para feedback oficial: origem (Chamar agente ou Orquestrador) → <strong>Gerar feedback</strong> → Output.</> },
            { title: "Valide e publique", detail: <>O painel de problemas e o dry-run aplicam as mesmas regras de publicação. Publicar não dispara nada.</> },
            { title: "Ative", detail: <>Workflow desativado não pode ser executado. Salvar, publicar, reiniciar o serviço ou receber dados nunca iniciam um Workflow Manual.</> },
          ]}
        />
      </WikiSection>

      <WikiSection id="executar" title="Executar agora" eyebrow="No editor do Workflow">
        <p>
          No cabeçalho do editor, o botão <strong className="font-medium text-foreground">Executar agora</strong> aparece para Workflows com gatilho Manual. O diálogo:
        </p>
        <StepList
          steps={[
            { title: "Mostra impedimentos", detail: "Não publicado, desativado ou modo Consolidado — com o que fazer. O botão só habilita sem impedimentos." },
            { title: "Pede o colaborador", detail: "Busca por nome ou matrícula; só aparecem operadores ativos, dentro da Abrangência do Workflow e do seu escopo." },
            { title: "Pede o contexto", detail: "Conforme o gatilho: a interação (com data, assunto, duração e flags) ou a medição (período e valor). Colaborador sozinho não pede nada além." },
            { title: "Avisa que é real", detail: "Resume o Workflow, a versão publicada e o colaborador, e lista as superfícies que o fluxo pode entregar — não é simulação." },
            { title: "Acompanha a execução", detail: "Depois do clique mostra o estado real da execução e as entregas registradas, com atalhos para Execuções e Resultados." },
          ]}
        />
        <WarningCallout kind="tip" title="Duplo clique não duplica; nova execução é intencional">
          Cada abertura do diálogo é uma solicitação única: repetir o clique ou reenviar a mesma solicitação devolve a execução já criada. Para repetir
          a demonstração, use <strong>Executar de novo</strong> (ou abra o diálogo de novo) — isso cria uma nova execução.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="permissoes" title="Permissões e elegibilidade" eyebrow="Validado no backend">
        <FieldRow label="Quem executa" value="Quem pode gerenciar o Workflow (permissão de Workflows no escopo dele). Sem a permissão, nada é mostrado nem executado." />
        <FieldRow label="Quem pode ser escolhido" value="Operador ativo, dentro da Abrangência (e do Filtro Populacional, se houver) do Workflow E dentro do escopo de quem executa. Fora disso, o backend recusa." />
        <FieldRow label="Dados escolhidos" value="Interação/medição da mesma organização e do colaborador escolhido; interação com transcrição." />
        <FieldRow label="Rastreabilidade" value="Cada disparo registra quem executou, quando, Workflow e versão, colaborador, interação/medição e a execução criada — visível em Execuções e Resultados e na auditoria." />
        <p>
          Ver <WikiLink href="/wiki/seguranca#eligibility">Elegibilidade de Workflow</WikiLink> — a mesma regra usada pela ingestão e pela Agenda.
        </p>
      </WikiSection>

      <WikiSection id="acompanhar" title="Acompanhar resultado e falhas" eyebrow="Solicitado não é entregue">
        <WikiTable caption="Estados mostrados no diálogo">
          <thead>
            <tr>
              <th className="text-left">Estado</th>
              <th className="text-left">O que significa</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{MANUAL_RUN_STAGE_LABELS.QUEUED}</td>
              <td>A execução nasceu no gatilho; nada foi analisado nem entregue ainda.</td>
            </tr>
            <tr>
              <td>{MANUAL_RUN_STAGE_LABELS.PROCESSING}</td>
              <td>O motor está percorrendo os nós (inclui chamadas de IA).</td>
            </tr>
            <tr>
              <td>{MANUAL_RUN_STAGE_LABELS.WAITING}</td>
              <td>Parada em Revisão humana, no QA de feedback (feedback retido) ou num nó Espera — nada é entregue até a decisão.</td>
            </tr>
            <tr>
              <td>{MANUAL_RUN_STAGE_LABELS.RETRYING}</td>
              <td>Falha transitória (ex.: provedor de IA); o motor tenta de novo no horário indicado.</td>
            </tr>
            <tr>
              <td>{MANUAL_RUN_STAGE_LABELS.COMPLETED}</td>
              <td>O fluxo terminou. As entregas aparecem listadas pelo que foi de fato gravado.</td>
            </tr>
            <tr>
              <td>{MANUAL_RUN_STAGE_LABELS.FAILED}</td>
              <td>Encerrada com erro (contrato da resposta da IA, invariante, tentativas esgotadas) — o motivo aparece no diálogo e em Execuções.</td>
            </tr>
          </tbody>
        </WikiTable>
        <p>
          A aba <strong className="font-medium text-foreground">Execuções</strong> marca a origem &quot;Manual · colaborador · por quem&quot; e mostra os eventos de cada nó; a aba{" "}
          <strong className="font-medium text-foreground">Resultados</strong> lista o disparo como &quot;Manual: por …&quot;, com feedbacks, QA e consumo de IA.
        </p>
      </WikiSection>

      <WikiSection id="real-x-qa-lab" title="Execução real × QA Lab" eyebrow="Duas ferramentas diferentes">
        <WikiTable>
          <thead>
            <tr>
              <th className="text-left" />
              <th className="text-left">Executar agora (Manual)</th>
              <th className="text-left">QA Lab</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Versão</td>
              <td>Só a publicada e ativa</td>
              <td>Rascunho ou publicada</td>
            </tr>
            <tr>
              <td>Efeitos</td>
              <td>Reais: grava execução, feedback, QA, entregas e avisos</td>
              <td>Nenhum: nada é gravado, entregue ou notificado</td>
            </tr>
            <tr>
              <td>IA</td>
              <td>Sempre real (conta no consumo)</td>
              <td>Parar antes da IA ou real, com orçamento</td>
            </tr>
            <tr>
              <td>Gatilhos</td>
              <td>Só Workflows com gatilho Manual</td>
              <td>Qualquer gatilho (inclusive Manual, com o mesmo seletor de colaborador/interação/medição)</td>
            </tr>
          </tbody>
        </WikiTable>
        <p>
          Ver <WikiLink href="/wiki/qa-lab#zero-side-effects">QA Lab — zero efeitos</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="exemplo-avatar" title="Exemplo: feedback de monitoria entregue pelo Avatar" eyebrow="Reproduzível">
        <StepList
          steps={[
            { title: "Crie o Workflow", detail: <>Abrangência no Subgrupo da equipe; gatilho <strong>Manual</strong> com <strong>Interação do colaborador</strong>.</> },
            { title: "Nó de análise", detail: <>Orquestrador com Roteamento por domínio (ex.: Faturamento) e Formato dos especialistas <strong>Avaliação de processo</strong> — ou Chamar agente com esse formato.</> },
            { title: "Gerar feedback", detail: <>Origem = o nó de análise; Tipo = Automático (vira monitoria porque a execução traz a interação).</> },
            { title: "Output", detail: <>Conteúdo = o resultado de Gerar feedback; destinatário <strong>O próprio operador</strong>; superfície <strong>Avatar</strong> (modo Sugestão).</> },
            { title: "Publique, ative e clique em Executar agora", detail: <>Escolha a colaboradora e um atendimento de contestação com transcrição; confirme.</> },
            { title: "Acompanhe", detail: <>Em processamento → Concluída, com &quot;Avatar: recado disponível&quot; (ou concluída sem recado, quando a análise não encontra nada material a comunicar — o motivo fica na execução).</> },
            { title: "No perfil da colaboradora", detail: <>O sino avisa &quot;Recado da INIA&quot;; no painel da INIA aparece o convite — Ouvir agora (a fala começa no clique), Ler o recado ou Depois. Só depois da fala terminar o recado conta como entregue.</> },
          ]}
        />
        <ExampleCard title="Por que o feedback pode não sair">
          O disparo manual segue as mesmas regras de qualquer execução: o feedback nasce de um diagnóstico da chamada com evidência. Quando a
          evidência não sustenta uma conclusão (por exemplo, gravação interrompida) ou não há nada material a dizer, a INIA não publica e registra o
          motivo — a execução não espera aprovação de ninguém.
        </ExampleCard>
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações da primeira versão" eyebrow="O que ainda não fazemos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Um colaborador por disparo; não há execução manual para um Grupo inteiro nem para modo Consolidado.</li>
          <li>O Filtro Populacional não é configurável no Manual (a pessoa já é escolhida); a Abrangência continua valendo.</li>
          <li>Só no editor do Workflow (Administração) — não há botão em perfis, Chat ou Avatar.</li>
          <li>Com interação, não existe &quot;valor do gatilho&quot;: Conditions devem usar histórico/indicador ou o resultado de um nó anterior.</li>
          <li>Execução real sempre chama a IA configurada; para ensaiar sem custo nem efeitos, use o QA Lab.</li>
          <li>O acompanhamento no diálogo é por consulta periódica; para o detalhe de cada nó use Execuções e Resultados.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/workflows/triggers#manual", label: "Triggers", hint: "as quatro famílias" },
            { href: "/wiki/workflows/outputs#avatar-chat", label: "Avatar e Chat", hint: "como o recado chega" },
            { href: "/wiki/workflows/criacao", label: "Como criar um Workflow" },
            { href: "/wiki/workflows/human-review", label: "Revisão humana" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
