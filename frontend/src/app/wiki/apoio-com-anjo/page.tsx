import type { Metadata } from "next"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FieldRow, SeeAlso, StepList, WarningCallout, WikiArticle, WikiPageHeader, WikiSection, WikiTable } from "@/components/wiki/wiki-primitives"
import type { WikiTocEntry } from "@/components/wiki/wiki-toc"

export const metadata: Metadata = {
  title: "Apoio com Anjo",
  description: "Quando a INIA não resolve, o operador pede ajuda a uma pessoa da equipe de apoio (o Anjo), numa conversa separada que a INIA não lê.",
}

const TOC: WikiTocEntry[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "descurtida", label: "Descurtida com motivo" },
  { id: "pedido", label: "Pedir ajuda" },
  { id: "fila", label: "Fila, espera e prazo" },
  { id: "sala", label: "Sala de apoio" },
  { id: "anjo", label: "Área do Anjo" },
  { id: "configuracao", label: "Liga/desliga e papéis" },
  { id: "painel", label: "Painel do apoio" },
  { id: "privacidade", label: "Privacidade" },
]

export default function HumanSupportWikiPage() {
  return (
    <WikiArticle toc={TOC}>
      <WikiPageHeader
        eyebrow="04 · Experiência do Colaborador"
        title="Apoio com Anjo"
        lead="Quando a resposta da INIA não resolve, o operador pode falar com uma pessoa da equipe de apoio — o Anjo — numa conversa própria. A INIA não lê essa conversa. Nada é criado sozinho: o pedido só nasce quando o operador clica em “Pedir ajuda”."
      />

      <WikiSection id="visao-geral" title="Visão geral" eyebrow="O fluxo">
        <StepList
          steps={[
            { title: "A INIA responde", detail: "O sistema marca, por código, quando a consulta não encontrou a informação, não terminou ou ficou sem resposta — nunca procurando frases no texto." },
            { title: "O operador avalia ou vê a sugestão", detail: "A descurtida pergunta o motivo e “Você ainda precisa de ajuda com isso?”. Com o apoio ligado, aparece “Falar com um Anjo”." },
            { title: "O operador pede ajuda", detail: "A janela mostra exatamente o que o Anjo vai receber, a disponibilidade e o prazo da fila." },
            { title: "Um Anjo recebe na hora", detail: "Sem aceite: o pedido vai direto ao Anjo disponível com menos atendimentos. Sem vaga, entra na fila por ordem de chegada." },
            { title: "Conversa, encerramento e avaliação", detail: "Operador e Anjo conversam na sala de apoio. No fim, o Anjo classifica o atendimento e o operador pode avaliá-lo." },
          ]}
        />
      </WikiSection>

      <WikiSection id="descurtida" title="Descurtida com motivo" eyebrow="Chat livre">
        <p>No chat livre, o polegar para baixo abre um formulário: motivo, comentário (obrigatório em “Outro”) e “Você ainda precisa de ajuda com isso?”. A descurtida só é marcada depois de gravada; fechar sem enviar não grava nada. Na sessão de feedback e no recado de Workflow o polegar continua como antes.</p>
        <WarningCallout kind="tip" title="Três avaliações que nunca se misturam">
          A avaliação do feedback no Acompanhamento, a avaliação da resposta da INIA (curtir/descurtir) e a avaliação do atendimento do Anjo são separadas. Ausência de descurtida ou de pedido de apoio nunca é tratada como prova de que a resposta resolveu.
        </WarningCallout>
      </WikiSection>

      <WikiSection id="pedido" title="Pedir ajuda" eyebrow="Operador">
        <FieldRow label="Onde" value="Só depois de tentar com a INIA (com o apoio ligado): a sugestão “Falar com um Anjo” abaixo de uma resposta em que a INIA não encontrou, não concluiu ou ficou sem responder, e o formulário da descurtida com “Sim”. Não há botão fixo; com um pedido aberto, o selo “Apoio · …” acima da conversa leva à sala." />
        <FieldRow label="O que o Anjo recebe" value="A pergunta, a resposta da INIA, o motivo e o comentário da descurtida (quando houver) e a nota do operador — a mesma cópia mostrada na janela." />
        <FieldRow label="Sem Anjo em serviço" value="“Pedir ajuda” fica desabilitado e a tentativa é registrada para o painel do apoio. Se um Anjo entrar em serviço com a janela aberta, o botão é habilitado." />
        <FieldRow label="Um por vez" value="Cada operador tem no máximo um pedido aberto. Pedido encerrado nunca reabre: nova necessidade, novo pedido." />
      </WikiSection>

      <WikiSection id="fila" title="Fila, espera e prazo" eyebrow="Disponibilidade">
        <WikiTable caption="O texto da disponibilidade, pela primeira regra que valer.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Situação</TableHead>
                <TableHead>O operador vê</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>Apoio desligado</TableCell><TableCell>O apoio com Anjo ainda não está disponível para sua equipe.</TableCell></TableRow>
              <TableRow><TableCell>Ninguém em serviço</TableCell><TableCell>Nenhum Anjo em serviço agora.</TableCell></TableRow>
              <TableRow><TableCell>Alguém pode receber</TableCell><TableCell>Há Anjos disponíveis: seu pedido vai direto para um deles.</TableCell></TableRow>
              <TableRow><TableCell>Todos ocupados</TableCell><TableCell>Todos os Anjos estão em atendimento. + espera estimada</TableCell></TableRow>
              <TableRow><TableCell>Todos em pausa</TableCell><TableCell>Nenhum Anjo disponível no momento. Aguarde: seu pedido está na fila.</TableCell></TableRow>
            </TableBody>
          </Table>
        </WikiTable>
        <p>A espera estimada usa os pedidos dos últimos 14 dias do Subgrupo (ou do Grupo, ou da organização). O prazo da fila é calculado pelo histórico, entre 10 e 25 minutos (20 sem histórico), e aparece como horário: “Seu pedido fica na fila até 14:35”. O operador nunca vê quantos Anjos estão em pausa, nem por quê.</p>
      </WikiSection>

      <WikiSection id="sala" title="Sala de apoio" eyebrow="Conversa humana">
        <p>A sala fica no lugar da conversa com a INIA. Abrir a sala encerra a sessão de voz; o campo não tem microfone. Aviso fixo: “A INIA não lê esta conversa. A coordenação do Apoio e o Administrador geral podem ler.” Na tela do operador, quem atende se chama “Apoio” (“Falar com o Apoio”, “Ana (Apoio) recebeu seu pedido”); “Anjo” fica só na área do Anjo e nos painéis da coordenação.</p>
        <FieldRow label="Mensagem nova" value="Toda mensagem que chega da outra pessoa toca um som curto, para o operador e para o Anjo — também com a conversa aberta na tela; mensagem que você já leu em outro aparelho não toca de novo. Além do som, com a aba escondida ou outro programa na frente, o título da aba pisca com o nome de quem escreveu (“• Nova mensagem de Ana — INIA”) até você voltar. Com a INIA na tela, mas a sala de apoio fechada, o operador vê um aviso no canto com “Abrir conversa”, o selo do apoio diz quantas mensagens são novas e o painel recolhido da INIA ganha um ponto. Na área do Anjo, os atendimentos com mensagem nova ganham um número. O som só toca depois do primeiro clique na página (regra dos navegadores) e, com a INIA aberta em várias abas, toca uma vez só." />
        <FieldRow label="Digitando" value="Enquanto uma pessoa escreve, a outra vê “Fulano está digitando…” com três pontos animados. Só o fato de estar escrevendo é avisado, nunca o texto. O aviso some 5 segundos depois da última tecla, quando o campo é apagado ou quando a mensagem chega." />
        <FieldRow label="Entregue e lida" value="Cada mensagem própria mostra um tique cinza (enviada: gravada), dois cinza (entregue: a tela da outra pessoa recebeu) ou dois azuis (lida: a outra pessoa estava com a conversa na tela, com a janela em foco). Com a aba escondida ou outra janela em foco, fica como entregue." />
        <FieldRow label="Encerramento" value="Pelo operador, pelo Anjo, pelo Anjo quando o operador está sem a INIA aberta há mais de 5 minutos, ou quando o operador não volta a tempo (abaixo). A conversa com a INIA de onde o pedido saiu é encerrada (“Encerrada após o Apoio”) e o chat abre uma conversa nova." />
        <FieldRow label="Operador sem responder" value="Se a última mensagem foi do Anjo e o operador fica 15 minutos sem responder, o Anjo é liberado e o pedido passa a “Aguardando seu retorno” (no painel: “Aguardando o operador”). O operador vê até que horas pode voltar: escrevendo, o pedido entra no FIM da fila; sem resposta até 20 minutos depois da última mensagem do Anjo, o pedido é encerrado como abandono do operador. Ele também pode cancelar." />
        <FieldRow label="Anjo sem responder" value="Se o Anjo não respondeu ainda ou a última mensagem foi do operador e o Anjo fica 15 minutos sem responder, ele perde o atendimento: conta como abandono do Anjo (aparece como “Perdido: você ficou sem responder” no histórico dele, sem classificação nem avaliação) e o pedido volta para a FRENTE da fila, para qualquer Anjo — também o mesmo. Se não houver ninguém do Apoio em serviço, vale a regra de quem pede sem ninguém: o pedido é encerrado e a tentativa fica registrada (o mesmo quando o operador volta e não há ninguém)." />
        <FieldRow label="Tempos de resposta" value="Os três tempos (15, 20 e 15 minutos por padrão) ficam em Painel dos Anjos › Monitoria Online › “Tempos de resposta”. O padrão da organização é mudado só por quem acompanha a organização inteira; cada Grupo pode ter os seus, e o Coordenador de Anjos muda só os do próprio Grupo (“Usar o padrão da organização” desfaz). A partir de quando conta: “Operador sem responder” e “Encerrar se o operador não voltar”, da última mensagem do Anjo (o encerramento não conta de quando o pedido passou a aguardar); “Anjo sem responder”, da última mensagem do operador ou do início do atendimento. O encerramento precisa ser depois da volta à fila do operador. Valem na hora, com histórico e auditoria." />
        <FieldRow label="Abandonos do Anjo" value="Número e taxa próprios, separados do operador: parou de responder (perdeu o atendimento) e saiu — deslogou, o login venceu ou a conta foi desligada — derrubando o operador, sobre os atendimentos encerrados (fora os transferidos). Queda de rede e papel retirado pela coordenação não contam (aparecem à parte). Aparece no bloco de Abandonos (Monitoria Online e Indicadores), no card por Anjo e na coluna da tabela do Histórico." />
        <FieldRow label="Pausa “Desconexão”" value="O Anjo que fica 20 minutos sem responder ninguém — contados do primeiro retorno que ficou devendo a um operador, ou da última mensagem ou mudança de estado dele, se veio depois — é posto pelo sistema em pausa “Desconexão”: não recebe pedidos e não conta como em serviço. Se em 10 minutos não voltar (escolher um estado), fica Indisponível. O motivo aparece na área do Anjo, na Monitoria Online e na presença do Anjo (Jornada). Os dois tempos são da organização inteira e ficam em “Tempos de resposta”, no padrão da organização; o Anjo nunca escolhe essa pausa." />
        <FieldRow label="Anjo sem conexão" value="O operador vê “O Anjo está sem conexão. Aguardando…”. Se o Anjo não voltar em 3 minutos, o atendimento é interrompido e o pedido volta para a frente da fila." />
        <FieldRow label="Avaliação" value="“Sua dúvida foi resolvida?” e as estrelas, opcionais. Escolher só marca; o botão “Enviar avaliação” grava as duas respostas, agradece e leva de volta à INIA. Dá para mudar até 24 horas depois do fim, pelo botão “Atualizar avaliação”. Atendimento interrompido não é avaliado." />
      </WikiSection>

      <WikiSection id="anjo" title="Área do Anjo" eyebrow="Quem atende">
        <p>Quem tem o papel Anjo atende na aba “Apoio” do próprio perfil, a última, depois de Organograma (o endereço antigo <code>/apoio</code> leva até ela). No topo fica o estado e, abaixo, as ações para mudá-lo.</p>
        <FieldRow label="Estado na aba" value="Desde a entrada no sistema, a aba “Apoio” mostra o estado do Anjo pela cor do nome e do ícone da aba — verde para Disponível, azul para Em atendimento (disponível com atendimento aberto), amarelo para Em pausa e vermelho para Indisponível — e por um selo ao lado do nome, com o sinal de confirmado, o fone de atendimento, o ícone do motivo da pausa ou o ícone de parada. Em pausa com atendimento aberto continua “Em pausa”. Passar o mouse mostra a dica com o estado, o que ele significa e, quando houver, a pausa ou indisponibilidade programada. Para mostrar o estado ao entrar, a INIA só lê o estado, sem colocar o Anjo em serviço. Quem já estava em serviço (Disponível ou Em pausa) ou com atendimento aberto volta a ficar conectado sozinho." />
        <FieldRow label="Conexão em qualquer tela" value="Ao abrir a aba “Apoio”, o Anjo fica conectado nesta aba do navegador enquanto ela estiver na INIA — inclusive nas outras abas do perfil e nas outras telas, como Diagnóstico ou Administração. Trocar de tela não derruba os atendimentos. Só uma aba do navegador por vez mantém a conexão; nas outras, a área avisa que está aberta em outra aba." />
        <FieldRow label="Mensagens não lidas fora da área" value="Fora da aba “Apoio”, o atalho com o ícone do Anjo no cabeçalho, ao lado do sino, mostra quantas mensagens do operador ainda não foram lidas (ou um ponto quando há atendimento sem resposta), e a própria aba “Apoio” mostra o mesmo número. Mensagem nova ou atendimento novo também tocam um som curto e, com a janela em segundo plano, fazem o título da aba piscar. A contagem vem do servidor: continua certa depois de recarregar a página e zera quando a conversa é aberta e lida." />
        <FieldRow label="Estado" value="Disponível, Em pausa (Lanche, Pessoal, Atividade de processo ou Reunião, cada uma com o seu ícone) ou Indisponível. Disponível e Em pausa mostram um cronômetro de há quanto tempo o Anjo está no estado, contado da última troca gravada no servidor (atualizar a página não o zera); Indisponível não tem cronômetro. A pausa só impede novas atribuições." />
        <FieldRow label="Mudar estado" value="“Ficar disponível”, “Pausa” (ou “Trocar pausa”), que abre a lista de motivos com a pausa atual marcada, e “Ficar indisponível”, em vermelho com o ícone de parada. Sem atendimento em andamento, a mudança vale na hora." />
        <FieldRow label="Mudança programada" value="Com atendimento em andamento, os botões viram “Programar pausa” e “Programar indisponível”: o estado atual continua (com o cronômetro), o Anjo para de receber novos atendimentos na hora e termina os que já tem. A faixa “Programado: …” mostra o que vai entrar; escolher outro motivo ou Indisponível altera, e “Cancelar programação” desfaz. A mudança entra quando termina o último atendimento — encerrado pelo Anjo, pelo operador ou pelo sistema por inatividade — e o cronômetro e as horas em pausa contam desse instante. A programação fica gravada no servidor (recarregar a página ou reconectar não a perde). Se o Anjo ficar sem conexão por mais de 3 minutos, o sistema o deixa Indisponível, os atendimentos voltam para a fila e a programação é descartada." />
        <FieldRow label="Aba Atendimento" value="Os atendimentos em andamento, um por aba. Em telas grandes, o que o operador compartilhou fica à esquerda (pode ser recolhido para a conversa ocupar a largura toda) e a conversa à direita, com o campo de mensagem e os botões de encerrar. O cabeçalho mostra o “Tempo de atendimento”, contado do início do atendimento — não é espera na fila nem tempo de pausa. Um atendimento novo toca um som curto e abre a aba dele, com “Sem resposta há N min” até a primeira mensagem. Depois de encerrar, a classificação pendente aparece na mesma aba." />
        <FieldRow label="Aba Seus atendimentos" value="O histórico dos atendimentos que o Anjo fez, com a duração, como terminou e a classificação; “Ver conversa” abre a conversa só para leitura. Trocar de aba não encerra nada nem apaga o texto digitado; mensagem nova do operador e atendimento sem resposta ficam sinalizados na aba Atendimento." />
        <FieldRow label="Classificação" value="Três escolhas separadas: o motivo do encaminhamento (por que o operador precisou do Anjo), o resultado (resolvido, orientado, encaminhado ou não resolvido) e a pertinência do acionamento (Pertinente, Não pertinente ou Não avaliado). Além dos motivos de falta de informação, há os impedimentos operacionais “Sem acesso à ferramenta ou ao sistema” e “Ferramenta ou sistema indisponível”, com a ferramenta afetada e detalhes opcionais. O motivo nunca define o resultado." />
        <FieldRow label="Foto na conversa" value="O Anjo vê a foto cadastrada do operador no cabeçalho do atendimento e nas mensagens dele; o operador vê a do Anjo. Sem foto, aparecem as iniciais." />
        <FieldRow label="Aba Sua jornada" value="O próprio tempo online, os estados e os próprios atendimentos no período, nos mesmos números do painel da coordenação. O Anjo nunca vê o histórico de outro Anjo nem a situação dos outros Anjos e da fila — isso é da coordenação." />
        <FieldRow label="Entrar de novo" value="Indisponível é o mesmo estado que offline. Quando a sessão termina (sair, prazo do login ou inatividade), o Anjo fica Indisponível na hora. Fazer login e abrir a área não o deixa Disponível: ele só volta a receber pedidos depois de escolher “Ficar disponível”. Atendimentos que já estavam abertos continuam se ele voltar em até 3 minutos." />
        <FieldRow label="Cronômetro" value="Disponível conta desde a última entrada em disponibilidade: ao concluir o último atendimento, o cronômetro recomeça do fim dele." />
      </WikiSection>

      <WikiSection id="configuracao" title="Liga/desliga e papéis" eyebrow="Administrador geral">
        <FieldRow label="Liga/desliga" value="Chave geral e estado de cada Grupo e Subgrupo (Herdar, Ligado, Desligado). Tudo nasce desligado. Desligar cancela a fila daquele escopo; atendimentos em andamento continuam." />
        <FieldRow label="Papéis" value="Anjo (atende os operadores do escopo da atribuição) e Coordenador de Anjos (acompanha o painel do escopo). Só o Administrador geral concede. Ter o papel de Anjo nunca dá acesso amplo às conversas: o Anjo lê só os pedidos que atendeu." />
        <FieldRow label="Capacidade" value="Atendimentos ao mesmo tempo por Anjo, de 1 a 5 (padrão 2). Reduzir não corta atendimentos em andamento." />
      </WikiSection>

      <WikiSection id="painel" title="Painel dos Anjos" eyebrow="Coordenador de Anjos e Administrador geral">
        <p>Em Monitoramento, com o nome “Painel dos Anjos” (a configuração, em Plataforma, chama-se “Configuração dos Anjos”), logo abaixo de Conversas com a INIA e no mesmo formato: abre em <strong>Pedidos</strong>, com a busca por operador ou protocolo, os filtros (estado, origem, Grupo/Subgrupo e período) e o total no título; a lista à esquerda, agrupada pelo dia, mostra a foto do operador, a origem, o Anjo, o estado e quantas mensagens houve — nunca o que foi conversado —, e o pedido escolhido abre à direita como uma conversa (operador à direita, Anjo à esquerda), com o que o operador compartilhou no início e os atendimentos, a classificação e a avaliação no fim.</p>
        <p>As outras abas: <strong>Indicadores</strong> (a operação inteira, no período), tentativas sem Anjo em serviço, <strong>Monitoria Online</strong> (o que acontece agora, sem período) e <strong>Jornada e atendimentos</strong> (as pessoas, no período). Regra: tudo o que é online fica na Monitoria Online; tudo o que é histórico, nas abas com período. O Grupo/Subgrupo vale para todas. Em Indicadores, Monitoria Online e Jornada e atendimentos, “Personalizar” deixa cada pessoa arrastar as áreas e os cards (também pelo teclado), mudar o tamanho em blocos pelo canto do card — a largura (1/4, 1/3, metade, 2/3, 3/4, largura toda) e a altura (1 a 8 blocos ou automática) —, esconder e trazer de volta cards e áreas; “Concluir” salva só para ela, em qualquer máquina, e “Restaurar padrão” volta ao original. Os dados e os filtros não mudam. Toda taxa aparece com numerador e denominador; com menos de 5 casos a taxa fica oculta e, sem nenhum, aparece “sem dados” — nunca 0%. Os termos Online, Disponível, Em atendimento, Indisponível, Dia produtivo e os tempos médios têm um ⓘ com a definição.</p>
        <p><strong>Abandonos</strong> — na Monitoria Online os de hoje, ao vivo; em Indicadores os do período. Na espera: o operador fechou a INIA ou cancelou antes de um Anjo assumir (expirado aparece à parte, porque quem encerra é o sistema). No atendimento: o operador saiu da INIA ou parou de responder, ou o Anjo caiu (rede, sessão encerrada) ou parou de responder. Encerramento normal, pelo Anjo ou pelo operador, e transferência nunca contam como abandono. Cada um com a taxa sobre os pedidos da fila ou os atendimentos encerrados.</p>
        <p><strong>Monitoria Online › Operação agora</strong> (só Coordenador de Anjos e Administrador geral): quantos e quais Anjos estão Disponíveis, Em atendimento, Em pausa (com o tipo) e Indisponíveis — offline conta como Indisponível —, com a sessão encerrada e a pausa ou indisponibilidade programada sinalizadas, e a fila: quantos operadores aguardam e a maior espera desde a entrada na fila. Com fila, clicar no indicador abre a tabela de quem está aguardando, com o Grupo/Subgrupo, o pedido e há quanto tempo. Atualiza a cada 5 segundos e ao voltar a conexão.</p>
        <p><strong>Indicadores › Acionamentos do período</strong>: produtivos (o Anjo marcou pertinente), não produtivos e não avaliados — clicar numa parte filtra o resto da seção —, a curva de acionamentos por horário, a espera dos operadores por dia (média, metade e 90%), os operadores, Grupos e Subgrupos que mais acionam e o que aconteceu com quem não foi acolhido (sem Anjo logado, abandono antes do acolhimento, expirados). Abaixo continuam os cartões das respostas da INIA, dos pedidos e da espera, e a avaliação do atendimento feita pelo operador.</p>
        <p><strong>Jornada e atendimentos › Visão geral</strong> (todos os Anjos do alcance): os cartões de atendimento somados — acolhidos, espera dos operadores, tempo médio de acolhimento, tempo médio de atendimento, falta de retorno, operador que saiu depois de acolhido, interrupções pelo sistema e pertinência —, os principais motivos de acionamento (com as ferramentas mais citadas) e o resultado declarado pelo Anjo, e o tempo online. O trabalho do Anjo fica só nesta aba; a demanda, a fila e a avaliação do operador ficam em Indicadores.</p>
        <p><strong>Jornada e atendimentos</strong>: o tempo online (Disponível + Em atendimento + Em pausa; Indisponível fica fora) de todos os Anjos e de cada um, em gráfico por dia e em horas e minutos, como base dos percentuais (a tabela por dia fica recolhida em “Ver por dia em tabela”) — disponível, em atendimento, em pausa (no total e por tipo) e dia produtivo (disponível aguardando + em atendimento); sem tempo online, “Sem tempo online no período”. Por Anjo — com filtros por nome, Grupo, Subgrupo, supervisor, coordenador, gerente e gerente sênior (a estrutura atual de cada Anjo) —: acolhidos, tempo médio de acolhimento (até a primeira resposta ao operador), tempo médio de atendimento (do acolhimento ao encerramento), falta de retorno, interrupções, estrelas do operador (média com 5 notas ou mais) e, ao clicar no Anjo, o dia a dia, a linha do tempo da presença, a espera dos operadores que ele acolheu, a pertinência e os motivos de acionamento dele. A atribuição é direta: não há oferta para aceitar.</p>
        <p><strong>Transferir atendimento.</strong> Quando o Anjo precisa sair, o pedido em atendimento pode passar para outro Anjo que possa recebê-lo agora (Disponível, com a área aberta, sem pausa programada e com vaga, no Grupo/Subgrupo do pedido) ou, sem nenhum assim, voltar para a frente da fila — o Anjo que saiu não o recebe de novo. O motivo é obrigatório e fica só para a coordenação. O operador continua na mesma conversa e vê que outro Anjo assumiu; o novo Anjo lê a conversa anterior. O atendimento de quem saiu não é classificado nem avaliado.</p>
      </WikiSection>

      <WikiSection id="privacidade" title="Privacidade" eyebrow="LGPD">
        <ul className="list-inside list-disc space-y-1">
          <li>A conversa com o Anjo fica em tabelas próprias: nenhuma resposta, resumo ou ferramenta da INIA a lê.</li>
          <li>Abrir um pedido no painel e a presença dos Anjos fica no registro de quem viu dados pessoais.</li>
          <li>Pedidos, mensagens, atendimentos, classificações e avaliações entram na exportação dos dados do operador; presença e classificações, na do Anjo (as notas não).</li>
          <li>O motivo da pausa do Anjo e o motivo de uma transferência nunca chegam ao operador.</li>
        </ul>
        <SeeAlso
          links={[
            { href: "/wiki/apoio-com-anjo/faq", label: "FAQ da operação dos Anjos", hint: "todas as regras em perguntas e respostas" },
            { href: "/wiki/acompanhamento", label: "Acompanhamento e Ciência" },
            { href: "/wiki/introducao/papeis", label: "Papéis e o que cada um vê" },
          ]}
        />
      </WikiSection>
    </WikiArticle>
  )
}
