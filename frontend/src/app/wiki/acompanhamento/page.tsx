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
          <li><strong className="font-medium text-foreground">Alinhamento operacional</strong> — para o colaborador: orientação temporária da gestão para o público dele, com a vigência (ver <WikiLink href="#alinhamentos">Alinhamentos no Acompanhamento</WikiLink>).</li>
        </ul>
        <p>
          No topo do Acompanhamento, “Tipos” (ao lado do período) escolhe o que aparece — marque ou desmarque comunicados, alinhamentos, feedbacks de monitoria ou de indicador
          e, para quem lidera, também resultados de workflow, revisões pendentes, escalonamentos, intervenções e reports. “Todos os tipos” volta a mostrar tudo.
        </p>
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
        <FieldRow label="Como confirma" value="No Acompanhamento dele (ou dentro da conversa com a INIA sobre o feedback), clicando em “Confirmar ciência”. Primeiro ele escolhe “Concordo com o feedback” ou “Não concordo com o feedback” (nada vem marcado); depois entra com o próprio login e senha. Depois disso o item mostra “Ciência confirmada em ‹data›”. A confirmação é definitiva e pode ser repetida sem efeito; se havia uma conversa com a INIA em andamento sobre o feedback, ela é concluída." />
        <FieldRow label="Concordar ou não" value="É a avaliação do feedback e fica gravada junto com a ciência — nunca uma sem a outra. Quem não concorda escolhe o motivo (ex.: não condiz com o que aconteceu, processo citado errado) e escreve uma justificativa obrigatória (3 a 1000 caracteres, com uma pergunta para cada motivo). Não concordar não impede a ciência: a ciência só registra que ele leu. A discordância vira uma contestação, respondida por quem revisa os feedbacks da equipe (ver Administração › Contestações de feedback); a resposta aparece no próprio feedback e chega um aviso no sino. A escolha não muda depois de registrada. Quem confirmou ciência antes desta escolha existir não tem escolha presumida: o item mostra “Dizer se concorda”, que registra a escolha uma vez, com login e senha." />
        <FieldRow label="O que aparece no feedback" value="Embaixo do item, sempre visível: “Você concordou com o feedback.” ou “Você não concordou com o feedback” com a situação (aguardando resposta / resposta disponível) e, em “Ver detalhes”, o motivo, a justificativa e a resposta da revisão. As avaliações “não foi útil” feitas antes de 10/11/2026 continuam aparecendo como “Avaliação anterior”, com a resposta. O antigo “Este conteúdo foi útil?” (polegares) saiu dos feedbacks; as avaliações das respostas do chat continuam." />
        <FieldRow label="O que o gestor vê" value="No Acompanhamento da estrutura, cada feedback aparece como no Acompanhamento do colaborador — o mesmo cartão (tipo, motivo e título) e o conteúdo lido no próprio cartão —, com “para ‹pessoa›” na linha da INIA e, embaixo, “Aguardando ciência do colaborador” ou “Ciência confirmada em ‹data›”. Na Equipe, o resumo conta os feedbacks publicados ainda sem ciência e a linha de cada pessoa mostra “N aguardando ciência” — clicar abre o Acompanhamento dela só com esses itens." />
        <FieldRow label="Funcionalmente" value="Confirmar grava a data/hora da ciência no feedback e, na mesma operação, a escolha (concorda / não concorda, motivo e justificativa); o status do feedback continua Publicado. Só o destinatário consegue confirmar. O gestor vê só o estado da ciência, não a escolha nem a justificativa (a menos que ele tenha o papel de revisor de contestações)." />
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
        <FieldRow label="Disposição na tela" value="A página rola até o Acompanhamento e a INIA pararem logo abaixo das abas; a partir daí, cada coluna rola por conta própria. A partir de 1024 px eles ficam lado a lado, com a largura ajustável pelo divisor. Em telas menores aparece uma coluna por vez, com a alternância “Acompanhamento” e “INIA”; trocar de coluna não perde a conversa nem a posição de leitura." />
        <FieldRow label="Avatar" value="Compacto por padrão, com o estado e os controles da chamada ao lado. O botão “Ampliar a INIA” dá a ela uma área própria, acima das mensagens, para falar por voz ou vídeo; ela nunca fica por cima da conversa. “Compactar a INIA” volta ao tamanho menor. Trocar o tamanho não interrompe a voz." />
      </WikiSection>

      <WikiSection id="alinhamentos" title="Alinhamentos no Acompanhamento" eyebrow="Conteúdo da liderança">
        <p>
          Cada alinhamento operacional do público do colaborador (universo e Grupo/Subgrupo de hoje) vira um cartão no Acompanhamento dele —
          um cartão por alinhamento, sempre na versão que importa agora. A vigência aparece em todo cartão. Ver{" "}
          <WikiLink href="/wiki/administracao">Administração › Alinhamentos operacionais</WikiLink> para o cadastro.
        </p>
        <FieldRow label="Antes de valer" value="Aparece já na publicação, com a faixa em destaque “Alinhamento válido a partir de …” e o selo “Começa em …”. A faixa some no primeiro dia da vigência (data do fuso da organização)." />
        <FieldRow label="Em vigor" value="Selo “Em vigor · até …”, o que fazer, o que muda no procedimento, os processos e o porquê. Uma nova versão atualiza o mesmo cartão, que sobe no feed com “Atualizado em …” e “O que mudou nesta versão”." />
        <FieldRow label="Não vale mais" value="O cartão fica em vermelho, com o símbolo de PARE e a faixa “Este alinhamento não está mais vigente”, como histórico por 12 meses. Alinhamento excluído some." />
        <FieldRow label="Li o alinhamento" value="Leitura simples, sem senha, registrada por versão (uma nova versão pede “Li a nova versão”). Não é a ciência dos feedbacks e não muda a avaliação das chamadas nem o chat." />
        <FieldRow label="Sino" value="Quando a vigência começa (ou uma nova versão passa a valer), cada operador do público recebe um aviso; clicar leva ao cartão destacado." />
        <FieldRow label="Para quem lidera" value="No Acompanhamento da própria estrutura, em “Da equipe”, aparecem os alinhamentos que valem para alguém da equipe, no mesmo cartão, com “N de M pessoas da equipe leram”. No chat, “quais os alinhamentos do meu time?” traz os em vigor e programados, com quem já leu." />
      </WikiSection>

      <WikiSection id="comunicados" title="Comunicados e Publicações" eyebrow="Conteúdo da liderança">
        <p>
          Quem tem o papel de comunicados escreve em <strong className="font-medium text-foreground">Administração › Publicações</strong> (botão
          “Publicar” no cabeçalho do perfil). O comunicado aparece no Acompanhamento de quem o recebe e a INIA pode usá-lo no chat dessa pessoa,
          citando título, autor, cargo, data e link. Comunicado é <strong className="font-medium text-foreground">só informação</strong> (aviso,
          novidade): nunca é orientação de conduta e não substitui nem remove outro comunicado, PR ou IT. O que fazer no atendimento vem das bases
          de conhecimento, dos alinhamentos operacionais vigentes e dos argumentários.
        </p>
        <FieldRow label="Ciclo" value="Rascunho (só o autor vê) → publicar agora ou agendar → no ar até o fim da exibição ou até ser arquivado. Arquivar tira do Acompanhamento e do chat sem excluir; desarquivar devolve. Retirar é a exclusão lógica (volta por Consultar dados › Itens excluídos)." />
        <FieldRow label="Público" value={<>Minha equipe (todos abaixo de quem publica, gravados na publicação), toda a empresa ou um público específico: o universo e, se quiser, vários Grupos — cada um inteiro ou só alguns Subgrupos (sem Grupo escolhido, vale para todo o universo). O resumo “Vale para” e a estimativa de quantas pessoas receberiam (cada pessoa contada uma vez) aparecem antes de publicar; quem recebe segue o cadastro atual. Toda a empresa e público específico exigem o papel de comunicados da empresa. O público não muda depois que o comunicado sai. Ver <WikiLink href="/wiki/administracao/alcance-por-grupos">Alcance por vários Grupos</WikiLink>.</>} />
        <FieldRow label="Editor" value="Título e texto em destaque; subtítulo, seção, negrito, itálico, listas, link (só https:// ou caminho do app), cor e imagem (JPG, PNG ou WebP, até 6). Resumo, categoria, destaque, produto relacionado e período de exibição ficam na lateral. Pré-visualizar mostra o card como o colaborador verá, com o público e as datas. Sair com alterações não salvas pede confirmação." />
        <FieldRow label="Moderação" value="Só quem publicou edita, arquiva ou retira a própria publicação. O Administrador geral pode retirar a publicação de qualquer pessoa da organização (em Publicações › Toda a organização ou pelo menu do comunicado no Acompanhamento), sempre com um motivo, que fica na auditoria. A moderação nunca altera o texto de ninguém." />
        <FieldRow label="No chat" value="A cada pergunta, a INIA considera só os comunicados no ar que a pessoa recebeu e que se relacionam com a pergunta, e os usa só como informação: se um comunicado parecer orientar uma conduta, ela segue a base, o alinhamento ou o argumentário. Rascunho, agendado, encerrado e arquivado nunca entram. Assuntos proibidos e limites de atuação valem acima de qualquer comunicado." />
      </WikiSection>

      <WikiSection id="limitacoes" title="Limitações atuais" eyebrow="Transparência">
        <ul className="list-inside list-disc space-y-1">
          <li>O chat/voz da INIA ainda <strong className="font-medium text-foreground">não persiste</strong> as interações: mensagens, curtidas/descurtidas e dúvidas se perdem ao recarregar a página.</li>
          <li>Outputs de Workflow nas superfícies Avatar e Chat são gravados, mas o avatar/chat ainda não os lê.</li>
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
