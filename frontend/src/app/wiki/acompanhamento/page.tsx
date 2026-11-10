import type { Metadata } from "next"

import { ExampleCard, FieldRow, SeeAlso, WarningCallout, WikiArticle, WikiFlow, WikiLink, WikiPageHeader, WikiSection } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Acompanhamento e Ciência",
  description: "Acompanhamento é conteúdo entregue para leitura: feedbacks, reconhecimentos, orientações, resumos e Outputs de Workflow. Ciência é a confirmação formal do próprio colaborador.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "tres-conceitos", label: "Ler ≠ decidir ≠ avisar" },
  { id: "o-que-chega", label: "O que chega no Acompanhamento" },
  { id: "por-papel", label: "Operador × gestão" },
  { id: "ciencia", label: "Ciência do colaborador" },
  { id: "material-apoio", label: "Material de apoio recomendado" },
  { id: "conteudo-rico", label: "Conteúdo formatado" },
  { id: "inia-no-acompanhamento", label: "Avatar e chat da INIA" },
  { id: "limitacoes", label: "Limitações atuais" },
]

export default function FollowUpPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="04 · Experiência do Colaborador"
        title="Acompanhamento e Ciência"
        lead="Acompanhamento é a aba do que existe para LER: a única porta de entrada do que a operação, a INIA e os Workflows produzem para você — ou para os colaboradores da sua estrutura."
      />

      <WikiSection id="tres-conceitos" title="Ler ≠ decidir ≠ avisar" eyebrow="Três conceitos que nunca se misturam">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <ExampleCard title="Acompanhamento — ler">Feedbacks publicados, resultados de Workflow, escalonamentos. Marcar como lido só registra a leitura.</ExampleCard>
          <ExampleCard title="Pendências — decidir">Ação requerida: hoje, só Revisão humana de Workflow (Aprovar / Reprovar / Escalar).</ExampleCard>
          <ExampleCard title="Sino — algo novo aconteceu">Aviso endereçado a você, com destino decidido pelo backend e rota decidida pela tela.</ExampleCard>
        </div>
        <p>
          Ler nunca resolve: marcar um item como lido grava só a leitura; decidir uma revisão é uma ação própria em{" "}
          <WikiLink href="/wiki/pendencias">Pendências</WikiLink>; o sino é descrito em <WikiLink href="/wiki/notificacoes">Notificações</WikiLink>.
        </p>
      </WikiSection>

      <WikiSection id="o-que-chega" title="O que chega no Acompanhamento" eyebrow="Tipos de conteúdo">
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium text-foreground">Feedback de indicador</strong> — baseado em números oficiais, meta, período e histórico.</li>
          <li><strong className="font-medium text-foreground">Feedback de monitoria</strong> — baseado numa interação/transcrição, com evidência literal.</li>
          <li><strong className="font-medium text-foreground">Reconhecimento</strong> — elogio específico e verificável.</li>
          <li><strong className="font-medium text-foreground">Orientação</strong> — recomendação sem revisão prévia (ex.: TMA acima da meta hoje).</li>
          <li><strong className="font-medium text-foreground">Resumo / resultado de Workflow</strong> — para a gestão (ex.: resumo mensal da equipe, panorama de Qualidade).</li>
          <li><strong className="font-medium text-foreground">Escalonamento</strong> — um caso encaminhado a você com o conteúdo analisado.</li>
        </ul>
        <WikiFlow
          compact
          steps={[
            { label: "Workflow chega a um Output", tone: "core" },
            { label: "Para “O próprio operador” · Acompanhamento: cria o caso, registra a evidência e publica um Feedback", tone: "output" },
            { label: "Para a gestão · Acompanhamento ou Notificação: cria um alerta com o conteúdo na descrição", tone: "output" },
            { label: "Aparece no Acompanhamento do destinatário; o sino avisa", tone: "people" },
          ]}
        />
      </WikiSection>

      <WikiSection id="por-papel" title="Operador × gestão" eyebrow="A mesma aba, dois conteúdos">
        <FieldRow label="Operador" value="Feedbacks de indicador, monitorias, reconhecimentos e planos publicados para ele, com o chat da INIA ao lado. Cada feedback publicado tem o botão “Confirmar ciência”." />
        <FieldRow label="Supervisor e acima" value="Feedbacks publicados para os colaboradores da estrutura (com o estado de ciência de cada um) e o que os Workflows endereçaram ao gestor: resultados (ex.: resumo mensal da equipe) e escalonamentos. Cada item aponta para o colaborador e, quando existe, para o caso. O filtro “Só aguardando ciência” mostra apenas feedbacks que o colaborador ainda não confirmou." />
      </WikiSection>

      <WikiSection id="ciencia" title="Ciência do colaborador" eyebrow="Confirmação formal">
        <p>
          <strong className="font-medium text-foreground">Ciência</strong> é a confirmação formal, feita pelo <strong className="font-medium text-foreground">próprio colaborador</strong>,
          de que ele leu um feedback publicado para ele. Não é &quot;lido/não lido&quot; do gestor, ninguém confirma no lugar do colaborador e não é
          aprovação nem reprovação de nada.
        </p>
        <FieldRow label="Como confirma" value="No Acompanhamento dele (ou dentro da conversa com a INIA sobre o feedback), clicando em “Confirmar ciência” e entrando com o próprio login e senha. Depois disso o item mostra “Ciência confirmada em ‹data›”. A confirmação é definitiva e pode ser repetida sem efeito; se havia uma conversa com a INIA em andamento sobre o feedback, ela é concluída." />
        <FieldRow label="O que o gestor vê" value="No Acompanhamento da estrutura, cada feedback aparece como no Acompanhamento do colaborador — o mesmo cartão (tipo, motivo e título) e o conteúdo lido no próprio cartão —, com “para ‹pessoa›” na linha da INIA e, embaixo, “Aguardando ciência do colaborador” ou “Ciência confirmada em ‹data›”. Na Equipe, o resumo conta os feedbacks publicados ainda sem ciência e a linha de cada pessoa mostra “N aguardando ciência” — clicar abre o Acompanhamento dela só com esses itens." />
        <FieldRow label="Funcionalmente" value="Confirmar grava a data/hora da ciência no feedback; o status do feedback continua Publicado. Só o destinatário consegue confirmar." />
        <WarningCallout title="Ciência não é aprovação" kind="tip">
          Confirmar ciência registra que o feedback foi recebido e lido. Não altera o feedback, não fecha o caso e não decide nada de Workflow.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="material-apoio" title="Material de apoio recomendado" eyebrow="Capacidade comum de resposta — chat, avatar, Feedback e Workflow">
        <p>
          <strong className="font-medium text-foreground">Material de apoio recomendado</strong> é um conteúdo real da{" "}
          <WikiLink href="/wiki/bases-conhecimento#material-apoio">Base de Conhecimento</WikiLink> que a IA considera útil para o colaborador
          aprofundar o assunto de uma resposta — um feedback publicado, uma resposta do chat ou da voz. Aparece numa seção própria — &quot;Material de
          apoio recomendado&quot; (ou &quot;Materiais de apoio recomendados&quot;) — com o título do material, uma frase da IA explicando por que ele
          ajuda e o botão &quot;Acessar material&quot;, que abre a página real do material dentro da INIA.
        </p>
        <p>Três coisas que nunca se misturam:</p>
        <FieldRow label="Candidato" value="Material encontrado pelo retrieval — os documentos cujos trechos entraram na análise (vários trechos do mesmo documento contam como um só). Candidato não é recomendação." />
        <FieldRow label="Recomendação" value="Material que a IA decidiu ser realmente útil para AQUELA resposta: no máximo 3, escolhido só entre os candidatos, sempre com um motivo curto e específico. Zero é um resultado válido — recomendar não é obrigatório." />
        <FieldRow label="Apresentação" value="A superfície que mostra a recomendação: o chat e o avatar (resposta do Orquestrador), o Acompanhamento (Feedback publicado) e a Revisão humana (o revisor vê o que será entregue)." />
        <p>Quem faz o quê:</p>
        <FieldRow label="Agent" value="Encontra conhecimento nas bases que consulta. Quando responde diretamente (node “Chamar agente” de um Workflow, teste manual) e está com “Recomendar materiais quando este Agente responder diretamente” ligado, pode recomendar. Como especialista de um Orquestrador, só fornece candidatos — nunca a recomendação final." />
        <FieldRow label="Orquestrador" value="Agrega os candidatos de TODOS os especialistas acionados (qualquer domínio, deduplicados por material) e, com “Recomendar materiais nas respostas” ligado, decide a recomendação da resposta final. Não muda roteamento, escolha de especialistas nem síntese." />
        <FieldRow label="Workflow" value="Só transporta: a recomendação viaja junto do resultado do node (Agent ou Orquestrador) até a Revisão humana e o Output." />
        <FieldRow label="Output" value="Decide se AQUELA entrega apresenta o que já foi recomendado (“Incluir materiais de apoio recomendados”, só no Acompanhamento do próprio operador). Desligado — o padrão, inclusive nos Workflows existentes —, o Feedback é publicado sem materiais mesmo que a IA tenha recomendado." />
        <FieldRow label="Chat e Avatar" value="Superfícies da resposta do Orquestrador: mostram o card ao lado da resposta sem depender de Workflow, governadas só pela configuração do Orquestrador. Reabrir a conversa traz os mesmos materiais, revalidados." />
        <FieldRow label="Feedback" value="Uma das superfícies/persistências possíveis (relação Feedback ↔ material), reaproveitando a mesma validação." />
        <p>O que a aplicação garante, em toda superfície:</p>
        <FieldRow label="A aplicação valida" value="Cada material indicado é verificado no backend: existe, é da organização, está publicado, não foi removido, estava entre os candidatos daquela execução e o destinatário (o operador da conversa ou do Feedback — nunca quem executou) pode abri-lo pelo alcance da base. Referência inválida é descartada com registro, sem derrubar a resposta." />
        <FieldRow label="A aplicação gera o link" value="Título e link nunca vêm da IA: são resolvidos a partir do material real a cada leitura. Se o material for despublicado, removido ou sair do alcance depois, a seção mostra apenas “não está mais disponível”, sem link e sem título — também no histórico do chat." />
        <FieldRow label="Voz" value="A INIA nunca lê uma URL. Quando há material, o card aparece na tela e a resposta falada apenas menciona que existe um apoio disponível ali." />
        <WarningCallout title="Abrir o material não é ciência" kind="tip">
          Clicar em &quot;Acessar material&quot; não confirma ciência do feedback, não conclui leitura e não fecha nada. Ciência continua sendo o
          botão &quot;Confirmar ciência&quot;. Material de apoio também não é a evidência do feedback: evidência fundamenta a conclusão; material é
          conteúdo recomendado para desenvolvimento.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="conteudo-rico" title="Conteúdo formatado" eyebrow="Leitura humana">
        <p>
          Todo texto gerado por Agents, Orchestrators e Workflows para leitura humana é exibido formatado — títulos, negrito, listas, citações e
          tabelas — nunca como texto cru com asteriscos, e sem executar HTML embutido. Campos curtos (nome, título, badge) continuam texto puro;
          transcrições são citação literal e não passam por formatação.
        </p>
      </WikiSection>

      <WikiSection id="inia-no-acompanhamento" title="Avatar e chat da INIA" eyebrow="Interfaces de consumo">
        <p>
          A INIA (avatar 3D e chat de texto/voz) fica disponível como apoio dentro do Acompanhamento do operador: uma interface conversacional que
          responde perguntas sobre indicadores e procedimentos por meio do orquestrador que atende o chat/voz. Avatar e chat são{" "}
          <strong className="font-medium text-foreground">superfícies de consumo</strong> — nunca gatilhos de Workflow.
        </p>
        <FieldRow label="Avatar" value="Compacto por padrão, com o estado e os controles da chamada ao lado. O botão “Ampliar a INIA” dá a ela uma área própria, acima das mensagens, para falar por voz ou vídeo; ela nunca fica por cima da conversa. “Compactar a INIA” volta ao tamanho menor. Trocar o tamanho não interrompe a voz." />
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="Transparência">
        <ul className="list-inside list-disc space-y-1">
          <li>O chat/voz da INIA ainda <strong className="font-medium text-foreground">não persiste</strong> as interações: mensagens, curtidas/descurtidas e dúvidas se perdem ao recarregar a página.</li>
          <li>Outputs de Workflow nas superfícies Avatar e Chat são gravados, mas o avatar/chat ainda não os lê.</li>
          <li>Comunicados publicados pelo gestor ainda não são persistidos.</li>
          <li>Material de apoio: feedbacks manuais não trazem recomendação; o Orquestrador pós-JOIN (síntese consolidada) não aciona especialistas e por isso não tem candidatos; na voz a seleção acontece por especialista acionado (a orquestração da voz roda fora do backend). O clique em &quot;Acessar material&quot; não é registrado.</li>
          <li>O histórico do chat/voz passou a ser reaberto a partir do que foi persistido (mensagens e materiais); curtidas/descurtidas continuam só na tela.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/pendencias", label: "Pendências e Revisão humana" },
            { href: "/wiki/notificacoes", label: "Notificações (sino)" },
            { href: "/wiki/workflows/outputs", label: "Outputs e Surfaces", hint: "como o Workflow decide quem recebe e onde" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
