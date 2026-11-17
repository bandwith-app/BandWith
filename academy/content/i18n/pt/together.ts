import type { AreaText } from '../../types';

const together: AreaText = {
  area: {
    id: "together",
    title: "Ensaios, enquetes e chat",
    intro: "Agende ensaios, encontre uma data em que a banda toda pode e converse nos chats da banda, dos eventos e particulares.",
    icon: "chat",
  },

  articles: [
    // ───────────────────────────── Ensaios ─────────────────────────────
    {
      id: "create-a-rehearsal",
      title: "Criar um ensaio",
      summary: "Agende um ensaio direto: quem vem, quando, onde, quanto custa e no que trabalhar.",
      roles: ["admin"],
      kind: "task",
      keywords: ["novo ensaio", "agendar ensaio", "marcar ensaio", "ensaio da banda", "sessão"],
      related: ["rehearsal-songs-and-prep-tasks", "create-a-rehearsal-poll", "propose-a-rehearsal", "recurring-rehearsals", "rehearsal-drafts"],
      body: [
        {
          type: "p",
          text: "Os admins agendam um ensaio direto quando já sabem a data. Se antes você quiser descobrir quando as pessoas estão livres, faça uma enquete de disponibilidade: veja [[create-a-rehearsal-poll]].",
        },
        {
          type: "steps",
          title: "No celular",
          items: [
            "Toque em **Criar** (o botão + na barra de baixo) e escolha **Novo ensaio**. Você também pode abrir o **Calendário**, tocar num dia vazio e escolher **Ensaio**.",
            "Deixe **Modo de agendamento** em **Agendar já**.",
            "Se quiser, digite um **Título do ensaio (opcional)**. Sem título, o ensaio recebe o nome do tipo de sessão, por exemplo “Ensaio · Banda completa”.",
            "Escolha um **Tipo de sessão**: **Banda completa**, **Vozes**, **Ritmo**, **Acústico** ou **Outro**. Vozes, Ritmo e Acústico já selecionam os membros com o instrumento correspondente; Outro abre o elenco completo.",
            "Confira o **Elenco**. Toque num membro para adicioná-lo ou removê-lo, ou toque em **Selecionar todos**. Toque em **Próximo**.",
            "Em **Buscar local ou estúdio…**, digite o lugar ou toque numa opção rápida como **QG da banda**, **Estúdio A**, **Home studio** ou **A def.**.",
            "Defina a **Data do ensaio**, o **Início** e o **Fim**.",
            "Escolha uma **Recorrência**: **Uma vez**, **Semanal**, **Quinzenal** ou **Mensal**.",
            "Em **Custo do local**, escolha **Grátis** ou **Pago**. Para uma sala paga, informe o **Custo total do estúdio**: o cartão mostra o valor **Por pessoa**. Toque em **Próximo**.",
            "Em **REVISAR E CONFIRMAR**, confira o resumo. Toque em **Sessão e elenco** ou **Data e estúdio** para voltar e mudar alguma coisa.",
            "Se quiser, adicione músicas e tarefas de preparação (veja [[rehearsal-songs-and-prep-tasks]]).",
            "Toque em **Criar ensaio**.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "**Próximo**, na segunda etapa, fica desativado até o ensaio ter um lugar e uma data. Escolha **A def.** se você ainda não reservou uma sala.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Sem conexão, o ensaio fica guardado no seu dispositivo (“Salvo offline • Sincroniza quando conectar”) e é enviado quando você volta a ficar online.",
        },
        {
          type: "p",
          text: "Cada membro do elenco recebe uma notificação “Novo ensaio” e um push, e o ensaio aparece no calendário dele com um cartão **Você vem?** (veja [[answer-a-rehearsal-invite]]). Você fica marcado como presente, a menos que tenha se tirado do elenco: você continua gerenciando o ensaio.",
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["tablet"],
              text: "No iPad, o assistente é uma tela só com quatro cartões: **Sessão**, **Data e hora**, **Local e custo** e **Foco, nota e tarefas**, mais uma **Prévia ao vivo** “Como a banda vê”. A faixa de datas mostra os **Próximos 7 dias** com quantos membros estão livres em cada dia, **Dos calendários da banda**. Você também pode escrever um **Objetivo / notas (opcional)** para a banda. Toque em **Agendar ensaio** quando o contador de cartões estiver completo.",
            },
            {
              devices: ["duoClosed", "duoBook", "duoLaptop", "duoLand"],
              text: "No iPhone Duo, é usado o assistente de celular. Os botões de fechar e voltar passam para a barra lateral quando ela aparece.",
            },
          ],
        },
        { type: "shot", id: "shot-rehearsal-wizard", caption: "O assistente de ensaio, etapa 1: tipo de sessão e elenco." },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Cria, edita e exclui ensaios." },
            { role: "member", text: "Não pode criar ensaios. O mesmo menu **Criar** mostra **Propor ensaio** no lugar: veja [[propose-a-rehearsal]]." },
            { role: "deputy", text: "Os substitutos não são membros da banda e nunca veem o assistente de ensaio." },
          ],
        },
      ],
    },
    {
      id: "rehearsal-songs-and-prep-tasks",
      title: "Adicionar músicas e tarefas de preparação a um ensaio",
      summary: "Escolha as músicas a trabalhar e o que as pessoas devem preparar antes do ensaio.",
      roles: ["admin"],
      kind: "task",
      keywords: ["músicas em foco", "setlist do ensaio", "tarefas", "a fazer", "preparar", "levar"],
      related: ["create-a-rehearsal", "edit-a-rehearsal", "the-rehearsal-page", "todo-and-task-templates"],
      body: [
        {
          type: "p",
          text: "As músicas e as tarefas são adicionadas na última etapa do assistente (**REVISAR E CONFIRMAR**) ou depois, em [[edit-a-rehearsal]]. As músicas viram a setlist do ensaio, que os membros veem como **MÚSICAS EM FOCO** na página do ensaio.",
        },
        {
          type: "steps",
          title: "Músicas",
          items: [
            "No cartão **Setlist**, toque em **Adicionar músicas** e escolha músicas do seu repertório.",
            "Ou toque em **Modelo de setlist** para partir de uma das setlists salvas da banda. No editor de setlist, você pode buscar na biblioteca, adicionar uma música à mão (**Manual**: **Título da música \\*** e **Artista**) e tocar em **Pronto**.",
            "Para remover uma música, toque no X ao lado dela em **Músicas selecionadas**.",
          ],
        },
        {
          type: "steps",
          title: "Tarefas de preparação",
          items: [
            "No cartão **Preparação**, toque numa sugestão de **Adição rápida** como **Levar as cifras** ou **Gravar áudio**.",
            "Ou digite uma tarefa sua em **Nova tarefa** e toque em **Adicionar**.",
            "Remova uma tarefa com o X ao lado dela em **Tarefas da banda**.",
          ],
        },
        {
          type: "p",
          text: "Num ensaio agendado, **EDITAR** ao lado de **TAREFAS** abre **Tarefas**, com **Adicionar** e, enquanto não houver nenhuma, **Carregar uma lista de tarefas**, que adiciona todas as tarefas de um modelo de lista de tarefas salvo. Veja [[todo-and-task-templates]].",
        },
        {
          type: "note",
          tone: "privacy",
          text: "Só os admins escolhem e mudam a setlist do ensaio. Os membros podem abri-la por **MÚSICAS EM FOCO**, mas não podem editá-la.",
        },
      ],
    },
    {
      id: "edit-a-rehearsal",
      title: "Editar um ensaio",
      summary: "Mude a data, os horários, a sala, o elenco, o custo, as músicas em foco, as notas ou as tarefas de um ensaio agendado, direto na página dele.",
      roles: ["admin"],
      kind: "task",
      keywords: ["mudar ensaio", "remarcar ensaio", "reagendar", "atualizar ensaio"],
      related: ["create-a-rehearsal", "delete-a-rehearsal", "rehearsal-and-chat-notifications"],
      body: [
        {
          type: "steps",
          items: [
            "Abra o ensaio pelo **Calendário** ou pela tela Início.",
            "Toque no que você quer mudar: o lápis no alto ou os quadros **INÍCIO** e **FIM**, o quadro **SALA**, ou **EDITAR** ao lado de **PRESENÇA**, **MÚSICAS EM FOCO**, **NOTAS**, **TAREFAS** ou **CUSTO DO ESTÚDIO**.",
            "Abre um painel só com essa parte. **Título, data e horários** também tem **Recorrência**; **Elenco** tem **Selecionar todos**.",
            "Toque em **Salvar**. O botão fica desativado até algo mudar.",
          ],
        },
        {
          type: "p",
          text: "Fechar o painel com **Cancelar**, ✕, Voltar ou deslizando para baixo deixa o ensaio como estava. Se você mudou algo, antes aparece **Salvar as alterações?**: **Salvar alterações**, **Descartar** ou **Continuar editando**. Abrir outra parte do ensaio pergunta o mesmo. As músicas em foco são salvas com **Salvar** no painel da setlist.",
        },
        {
          type: "list",
          title: "Quem é avisado",
          items: [
            "Uma nova data, novos horários ou um novo lugar enviam uma notificação “Ensaio atualizado” e um push às pessoas do ensaio.",
            "Os membros que você adiciona ao elenco recebem o convite “Novo ensaio”.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Ensaios passados são editados do mesmo jeito, também no iPad. Os membros veem a página sem lápis e sem **EDITAR**.",
        },
      ],
    },
    {
      id: "delete-a-rehearsal",
      title: "Excluir (cancelar) um ensaio",
      summary: "Tire um ensaio do calendário; todos os participantes são avisados.",
      roles: ["admin"],
      kind: "task",
      keywords: ["cancelar ensaio", "excluir ensaio", "remover ensaio"],
      related: ["edit-a-rehearsal", "recurring-rehearsals"],
      body: [
        {
          type: "steps",
          items: [
            "Abra o ensaio.",
            "Toque em **EXCLUIR**, abaixo de **CHAT DO ENSAIO**.",
            "Toque em **Sim, excluir**, ou em **CANCELAR** para mantê-lo.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "A exclusão não pode ser desfeita. Um ensaio recorrente é um único evento, então excluí-lo remove todas as datas da série.",
        },
        {
          type: "p",
          text: "Os membros do ensaio recebem uma notificação “Ensaio cancelado” e um push. Se o abrirem por uma notificação antiga, veem **Ensaio cancelado** e um aviso de que um admin o removeu.",
        },
      ],
    },
    {
      id: "rehearsal-drafts",
      title: "Salvar um ensaio como rascunho",
      summary: "Saia do assistente no meio do caminho e termine o ensaio depois.",
      roles: ["admin"],
      kind: "task",
      keywords: ["rascunho", "inacabado", "salvar para depois"],
      related: ["create-a-rehearsal"],
      body: [
        {
          type: "steps",
          items: [
            "No assistente, depois de digitar alguma coisa, toque em **Cancelar** ou no botão de fechar.",
            "Em **Salvar este ensaio como rascunho?**, toque em **Salvar rascunho**. **Descartar** joga fora, **Continuar editando** volta ao assistente.",
            "Para terminar, abra o rascunho em Rascunhos na tela Início ou pelo dia dele no calendário.",
            "Para jogar fora um rascunho que você reabriu, feche o assistente e toque em **Excluir rascunho**.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Só você vê os seus rascunhos. Os membros não recebem nada até você criar o ensaio.",
        },
        {
          type: "p",
          text: "Se não der para salvar, o assistente continua aberto e o ensaio também fica guardado como rascunho, então nada do que você digitou se perde.",
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet"], text: "No iPad, a tela de criação única tem o próprio botão de salvar como rascunho no cabeçalho." }],
        },
      ],
    },
    {
      id: "recurring-rehearsals",
      title: "Ensaios recorrentes",
      summary: "Como aparecem e funcionam os ensaios semanais, quinzenais e mensais.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["ensaio semanal", "repetir", "toda semana", "série", "quinzenal", "mensal"],
      related: ["create-a-rehearsal", "delete-a-rehearsal", "answer-a-rehearsal-invite"],
      body: [
        {
          type: "p",
          text: "Quando você define uma **Recorrência** diferente de **Uma vez**, o BandWith salva um único ensaio com uma regra de repetição. As próximas datas aparecem no calendário cerca de quatro meses à frente, até 24 datas.",
        },
        {
          type: "table",
          head: ["Recorrência", "O que o ensaio mostra"],
          rows: [
            ["Uma vez", "UMA VEZ"],
            ["Semanal", "TODA {day}, por exemplo TODA TERÇA"],
            ["Quinzenal", "{day} A CADA 2 SEMANAS"],
            ["Mensal", "MENSAL"],
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Todas as datas de uma série compartilham o mesmo ensaio: um elenco, uma resposta por membro, uma setlist. Editar ou excluir muda todas as datas.",
        },
      ],
    },
    {
      id: "the-rehearsal-page",
      title: "A página do ensaio",
      summary: "O que um ensaio mostra aos admins e aos membros.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["detalhes do ensaio", "presença", "custo do estúdio", "músicas em foco"],
      related: ["answer-a-rehearsal-invite", "edit-a-rehearsal", "event-and-rehearsal-chats", "rehearsal-songs-and-prep-tasks"],
      body: [
        {
          type: "p",
          text: "Abra um ensaio pelo **Calendário** ou pela tela Início. A página dele é azul, a cor dos ensaios, e tem estas partes:",
        },
        {
          type: "list",
          items: [
            "**Você vem?**: o cartão de resposta para os membros convidados (veja [[answer-a-rehearsal-invite]]).",
            "Blocos de horário: **INÍCIO**, **FIM** e **SALA**.",
            "**PRESENÇA**: quem foi convidado e o que respondeu.",
            "**MÚSICAS EM FOCO**: até oito músicas, com **+ {count} MAIS** e **SETLIST** para ver a lista completa.",
            "**NOTAS**: a nota do ensaio, quando houver.",
            "**TAREFAS**: as tarefas de preparação e quantas estão feitas. Toque numa tarefa para marcá-la.",
            "**CUSTO DO ESTÚDIO**: a sala, as horas, o total e **Dividido entre {count} presentes**, com o valor **CADA**.",
            "Botões no final: **CHAT DO ENSAIO** e **EXCLUIR** para os admins, que mudam todo o resto com **EDITAR** em cada parte; **CHAT DO ENSAIO** para os membros que responderam que vão.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Vê tudo o que está acima, inclusive **CUSTO DO ESTÚDIO**, e pode editar ou excluir o ensaio." },
            { role: "member", text: "Só vê o ensaio quando o admin o incluiu no elenco. Vê horários, sala, presença, músicas em foco, notas e tarefas. A seção do custo do estúdio não aparece para os membros. A opção de sair fica no menu **Mais opções**." },
            { role: "deputy", text: "Os substitutos são chamados para shows, não para ensaios, e não veem os ensaios da banda." },
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "O custo total da sala é dinheiro da banda e fica com os admins. Durante uma enquete, os membros veem só a parte deles (“€ 12 cada um”).",
        },
      ],
    },
    {
      id: "answer-a-rehearsal-invite",
      title: "Responder a um convite de ensaio ou desistir",
      summary: "Diga ao admin se você vem, mude a sua resposta ou desista depois.",
      roles: ["member"],
      kind: "task",
      keywords: ["rsvp", "vou", "não posso", "recusar ensaio", "desistir"],
      related: ["the-rehearsal-page", "rehearsal-and-chat-notifications"],
      body: [
        {
          type: "steps",
          title: "Responder",
          items: [
            "Abra o ensaio pela notificação “Novo ensaio” ou pelo **Calendário**.",
            "No cartão **Você vem?**, toque em **VOU** ou **NÃO POSSO**. O cartão diz até quando responder (“Responda até … para o admin confirmar a sala.”).",
            "Para mudar depois, toque em **Trocar** no cartão **Sua resposta** e escolha de novo.",
            "Se antes você respondeu talvez, o cartão diz “Sua resposta era Talvez. Escolha VOU ou NÃO POSSO.”: escolha uma.",
          ],
        },
        {
          type: "steps",
          title: "Desistir",
          items: [
            "Abra o ensaio e toque em **Mais opções** (o botão … no alto).",
            "Em **Opções do ensaio**, toque em **Desistir deste ensaio**.",
            "Confirme com **DESISTIR**. O admin é avisado.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Depois que você responde **NÃO POSSO** ou desiste, o ensaio sai do seu calendário. Peça a um admin se quiser ser incluído de novo.",
        },
        {
          type: "devices",
          rows: [{ devices: ["duoClosed", "duoBook", "duoLand"], text: "No iPhone Duo, **Mais opções** fica na barra lateral com as outras ações do cabeçalho." }],
        },
      ],
    },
    {
      id: "propose-a-rehearsal",
      title: "Propor um ensaio (membros)",
      summary: "Peça ao admin um ensaio sobre um tema, com os dias que são bons para você.",
      roles: ["member"],
      kind: "task",
      keywords: ["pedir ensaio", "sugerir ensaio", "proposta de membro", "solicitar ensaio"],
      related: ["handle-a-rehearsal-proposal", "rehearsal-polls-explained"],
      body: [
        {
          type: "steps",
          items: [
            "Toque em **Criar** (o + na barra de baixo) e escolha **Propor ensaio**. Com o **Calendário** vazio, você também pode tocar em **Propor ensaio**.",
            "Se você está em várias bandas, escolha a banda em **Escolha a banda**.",
            "Digite um **Tema**, por exemplo “Treinar as transições da nova setlist”. Ele é obrigatório.",
            "Se quiser, toque nos **Dias preferidos (opcional)** que são bons para você.",
            "Se quiser, adicione **Notas ou músicas (opcional)**.",
            "Toque em **Enviar ao admin**.",
          ],
        },
        {
          type: "p",
          text: "Os admins da banda recebem uma notificação “Nova proposta de ensaio” e um push. Na sua tela Início e no **Calendário**, a proposta aparece como **Sua proposta de ensaio** com **Aguarda admin** e **Aberta até** o seu último dia: o último dos seus dias preferidos na semana seguinte, ou 7 dias se você não escolheu nenhum. Ela fica até um admin transformá-la em enquete ou recusá-la, ou até esse dia passar: aí sai de todas as listas.",
        },
        {
          type: "note",
          tone: "warning",
          text: "Você pode enviar uma proposta a cada 7 dias por banda. Depois de usá-la, a tela mostra **Limite semanal atingido** e a data da **Próxima proposta disponível**. O limite também é verificado pelo servidor.",
        },
        {
          type: "list",
          title: "Casos especiais",
          items: [
            "Ainda sem banda: você vê **Banda necessária**, com **Criar uma banda**.",
            "Se um admin recusar a sua proposta, você recebe “Proposta de ensaio recusada” (notificação e push), com o motivo se ele informou um, e ela sai da sua lista.",
            "Mudou de ideia? Toque em **Retirar** na sua proposta e depois em **Retirar** de novo em “Retirar sua proposta?”. Os admins deixam de vê-la.",
          ],
        },
        { type: "roles", rows: [{ role: "admin", text: "Os admins não propõem: eles criam direto o ensaio ou uma enquete. Veja [[create-a-rehearsal]]." }] },
      ],
    },
    {
      id: "handle-a-rehearsal-proposal",
      title: "Responder à proposta de ensaio de um membro",
      summary: "Transforme a proposta de um membro numa enquete de disponibilidade ou recuse-a.",
      roles: ["admin"],
      kind: "task",
      keywords: ["proposta", "criar enquete", "recusar proposta", "descartar proposta", "pedido de membro"],
      related: ["propose-a-rehearsal", "create-a-rehearsal-poll"],
      body: [
        {
          type: "steps",
          items: [
            "Encontre a proposta em **Organização de ensaios**, nas Pendências da tela Início ou no **Calendário**. Ela mostra **Proposta de ensaio de um membro**, **Proposta de**, os **Dias preferidos** e a nota. Você também pode abri-la pela notificação “Nova proposta de ensaio”.",
            "Toque em **Criar enquete** (na janela da notificação: **Criar enquete a partir da proposta**). O criador de enquetes abre com o tema como título, a nota e os dias preferidos já selecionados.",
            "Adicione horários e publique como em [[create-a-rehearsal-poll]].",
            "Ou toque em **Recusar** para fechar a proposta sem enquete. Em **Recusar esta proposta?**, digite se quiser um **Motivo** e toque em **Recusar**. O membro que a fez recebe “Proposta de ensaio recusada” (notificação e push) com o seu motivo.",
            "Se você não fizer nada, a proposta sai da lista depois do dia mostrado em **Aberta até**.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "A proposta de um membro não traz músicas, lugar nem custo. Adicione isso no criador antes de publicar.",
        },
      ],
    },

    // ───────────────────────────── Enquetes ─────────────────────────────
    {
      id: "create-a-rehearsal-poll",
      title: "Criar uma enquete de disponibilidade",
      summary: "Ofereça à banda algumas datas e deixe os membros votarem nas que dão certo.",
      roles: ["admin"],
      kind: "task",
      keywords: ["enquete", "votar", "disponibilidade", "encontrar uma data", "doodle", "enquete de datas"],
      related: ["poll-who-votes-and-deadline", "vote-in-a-rehearsal-poll", "lock-in-a-poll-date", "rehearsal-polls-explained"],
      body: [
        {
          type: "steps",
          title: "No celular",
          items: [
            "Toque em **Criar**, escolha **Novo ensaio** e mude o **Modo de agendamento** para **Enquete**. Abre o criador de **Enquete de disponibilidade**.",
            "Digite um **Título da enquete** e, se quiser, um **Objetivo / notas (opcional)**.",
            "Em **Quem vota**, toque num membro para deixá-lo de fora. Você sempre vota.",
            "Em **Local, custo e músicas**, preencha **Local / estúdio** (digite algumas letras e escolha uma sugestão, ou mantenha o que digitou), o **Custo da sala** (a **Divisão** mostra a parte de cada um) e as **Músicas em foco** (toque em **Adicionar**).",
            "Adicione datas. Com **Semana inteira**, escolha **Esta semana** ou **Próxima semana**, toque nos dias em **Incluir dias**, defina **Início** e **Fim** e toque em **Adicionar os dias escolhidos à enquete**. Cada dia mostra quantos membros estão livres. Com **Data / hora livre**, escolha uma **Data proposta**, **Início** e **Fim** e toque em **Adicionar horário à enquete**.",
            "Confira os **Horários propostos**. Remova um com **Remover horário** ou toque em **Limpar tudo**.",
            "Se quiser, defina **Votar até**: um dia e um horário (veja [[poll-who-votes-and-deadline]]).",
            "Toque em **Publicar enquete**.",
          ],
        },
        {
          type: "p",
          text: "Cada membro chamado a votar recebe uma notificação “Vote nos horários do ensaio” e um push. A enquete aparece como **Enquete · Ativa** na tela Início e no **Calendário**, em **Organização de ensaios**.",
        },
        {
          type: "p",
          text: "Mudou de ideia? **Voltar** (em cima ou embaixo, ou o botão Voltar do celular) retorna ao formulário do ensaio; **Fechar** sai da enquete. Se você mudou algo, o app pergunta antes: **Descartar esta enquete?** Toque em **Continuar editando** ou **Descartar**. Sem mudanças, ela simplesmente fecha. Enquetes não têm rascunhos.",
        },
        {
          type: "list",
          title: "O que impede a publicação",
          items: [
            "Sem título: “Dê um título à sua enquete.”",
            "Sem horário: “Adicione pelo menos um horário para os membros votarem.”",
            "Um prazo de votação depois do primeiro horário: “Escolha um dia antes do primeiro horário”.",
            "Adicionar o mesmo dia e horário de início duas vezes: “Esse horário já foi adicionado.”",
          ],
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["tablet"],
              text: "No iPad, a enquete é uma tela de criação única, **Novo ensaio** com “Enquete · os membros votam nas datas”. Cartões: **Sessão e elenco**, **Horários propostos** (uma faixa da semana colorida conforme quantos membros estão livres; toque num dia para adicioná-lo com os horários escolhidos), **Local, custo e músicas** e **Prazo de votação e nota**. Uma **Prévia ao vivo** mostra os horários “Como os membros votam”, com a **Favorita**.",
            },
          ],
        },
        { type: "shot", id: "shot-poll-builder", caption: "O criador de enquetes de disponibilidade no celular." },
        {
          type: "note",
          tone: "privacy",
          text: "Os números de livres vêm dos calendários de todos, mas só aparece o número (“4 de 5 livres”), nunca quem está ocupado ou por quê.",
        },
      ],
    },
    {
      id: "poll-who-votes-and-deadline",
      title: "Quem vota e o prazo de votação",
      summary: "Limite uma enquete a alguns membros e diga até quando eles devem responder.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["lista de convidados", "convidados", "prazo", "votar até", "quem vota"],
      related: ["create-a-rehearsal-poll", "vote-in-a-rehearsal-poll"],
      body: [
        {
          type: "p",
          text: "Por padrão, todos os membros ativos são chamados a votar. Quando você deixa alguém de fora em **Quem vota**, a enquete passa a ter uma lista de convidados.",
        },
        {
          type: "list",
          items: [
            "Só os membros convidados recebem a notificação da enquete e podem votar. Os outros da banda podem abrir a enquete só para leitura, marcada como **Não convidado**; o servidor recusa os votos deles.",
            "Os admins da banda sempre veem a enquete. O admin que a publica está sempre na lista.",
            "Quando você fixa uma data, só os membros convidados entram no ensaio: você também, se foi convidado ou votou. De qualquer forma, quem gerencia é você.",
            "A parte do custo da sala é dividida pelo número de pessoas chamadas a votar.",
          ],
        },
        {
          type: "p",
          text: "**Votar até** é um dia entre hoje e o primeiro horário proposto, mais um horário (18:00, se você não mudar). Os membros veem “Vote até sex., 11 de dez., 18:00” na enquete.",
        },
        {
          type: "note",
          tone: "warning",
          text: "No horário do prazo, a votação fecha: a enquete mostra **Votação encerrada** e “A votação foi encerrada. Um admin vai fixar uma data.” O servidor recusa votos posteriores. Os admins ainda podem fixar uma data.",
        },
      ],
    },
    {
      id: "vote-in-a-rehearsal-poll",
      title: "Votar numa enquete de disponibilidade",
      summary: "Toque nas datas em que você pode ou diga que nenhuma dá.",
      roles: ["member", "admin"],
      kind: "task",
      keywords: ["votar", "disponibilidade", "escolher datas", "nenhuma dá", "enquete"],
      related: ["poll-who-votes-and-deadline", "lock-in-a-poll-date", "rehearsal-polls-explained"],
      body: [
        {
          type: "steps",
          title: "Pelo cartão da enquete",
          items: [
            "Na tela Início (Pendências) ou no **Calendário**, encontre o cartão **Enquete · Ativa**. Um selo indica **Vote já**, **Votou** ou **Nenhuma dá**.",
            "Toque em cada data em que você pode. Toque de novo para retirar o voto. Você pode escolher várias datas.",
            "Toque em **Detalhes** para ver cada data com “{count}/{total} disponíveis”, a **Favorita** e quem votou. Depois que você vota, os detalhes fecham sozinhos (“Fecha em …s”); toque em **Manter aberto** para impedir isso.",
            "Se você votou e afinal nenhuma data dá, toque em **Nenhuma dá** nos detalhes.",
          ],
        },
        {
          type: "steps",
          title: "Pela notificação",
          items: [
            "Toque no push “Vote nos horários do ensaio” ou na notificação no sino e toque em **Vote já**.",
            "Em **Disponibilidade para o ensaio**, sob **Escolha as datas em que você pode**, toque nas datas que dão para você.",
            "Toque em **Pronto**. Se nenhuma das datas der, toque em **Nenhuma dá**.",
          ],
        },
        {
          type: "p",
          text: "**Nenhuma dá** apaga os seus votos e avisa o admin que nenhuma data serve para você: os admins veem “Nenhuma data funciona para …”. Se depois você votar numa data, essa resposta é substituída.",
        },
        {
          type: "list",
          title: "O que você vê ao votar",
          items: [
            "O lugar e a sua parte da sala (“Blackbox Studios · € 12 cada um”) e as músicas em foco.",
            "“{answered} de {total} responderam” e o prazo de votação, quando houver.",
            "Em **Respostas**, quem votou em qual data, assim que alguém tiver votado.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Os votos se atualizam ao vivo para todos. Sem conexão, o voto não é salvo e você vê “Não foi possível registrar o voto. Tente de novo.”",
        },
        { type: "shot", id: "shot-poll-card", caption: "Uma enquete ativa na tela Início, com as datas e os detalhes." },
        {
          type: "devices",
          rows: [
            {
              devices: ["duoLaptop"],
              text: "Na posição Laptop, a janela de votação mostra membros e dias na tela de cima e as suas datas, com **Fixar {day}** / **Fixe uma data** e **Pronto**, na tela de baixo.",
            },
          ],
        },
      ],
    },
    {
      id: "lock-in-a-poll-date",
      title: "Fixar uma data e criar o ensaio",
      summary: "Escolha a data vencedora de uma enquete; o BandWith cria o ensaio e avisa a banda.",
      roles: ["admin"],
      kind: "task",
      keywords: ["finalizar enquete", "confirmar data", "fechar enquete", "fixar", "vencedora"],
      related: ["vote-in-a-rehearsal-poll", "the-rehearsal-page", "answer-a-rehearsal-invite"],
      body: [
        {
          type: "steps",
          items: [
            "No cartão da enquete, toque em **Detalhes · Fixar**. Na janela da notificação, procure em **Respostas · Fixe uma data**.",
            "Ao lado da data que você quer (muitas vezes a **Favorita**), toque em **Fixar**.",
            "Confira o **Local do ensaio**. Ele começa com o lugar definido na enquete ou “Estúdio de ensaio”.",
            "Toque em **Confirmar e criar evento**.",
          ],
        },
        {
          type: "list",
          title: "O que acontece",
          items: [
            "É criado um ensaio confirmado nessa data e horário, com o título, o lugar e a nota da enquete.",
            "O custo da sala vira o custo do estúdio do ensaio, e as músicas em foco viram a setlist dele.",
            "Os membros convidados entram no ensaio e respondem normalmente ([[answer-a-rehearsal-invite]]). Você fica marcado como presente.",
            "A enquete é fechada e sai das Pendências. Os membros recebem uma notificação “Ensaio confirmado!” no sino (sem push).",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Se outro admin fixou a enquete um instante antes de você, você vê “Esta enquete já foi confirmada ou encerrada.” e nenhum segundo ensaio é criado.",
        },
      ],
    },
    {
      id: "delete-a-rehearsal-poll",
      title: "Excluir uma enquete",
      summary: "Remova uma enquete com todas as datas e votos.",
      roles: ["admin"],
      kind: "task",
      keywords: ["remover enquete", "cancelar enquete"],
      related: ["create-a-rehearsal-poll", "handle-a-rehearsal-proposal"],
      body: [
        {
          type: "steps",
          items: [
            "Abra **Detalhes · Fixar** da enquete ou abra-a pela notificação.",
            "Toque em **Excluir enquete**.",
            "Em **Excluir a enquete de ensaio?**, toque de novo em **Excluir enquete** ou em **Cancelar**.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Todas as datas propostas e os votos dos membros são apagados de vez. Não dá para desfazer, e os membros não são avisados.",
        },
        {
          type: "p",
          text: "Para fechar a proposta de um membro que ainda não tem enquete, use **Recusar** (veja [[handle-a-rehearsal-proposal]]).",
        },
      ],
    },
    {
      id: "rehearsal-polls-explained",
      title: "Como funcionam as propostas e as enquetes",
      summary: "O caminho de um pedido de ensaio, da ideia de um membro até uma data no calendário.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["status da enquete", "status da proposta", "organização de ensaios", "pendências"],
      related: ["propose-a-rehearsal", "create-a-rehearsal-poll", "vote-in-a-rehearsal-poll", "lock-in-a-poll-date"],
      body: [
        {
          type: "table",
          head: ["Fase", "O que significa", "Quem vê"],
          rows: [
            ["Proposta (**Aguarda admin**)", "Um membro pediu um ensaio.", "O membro que propôs e os admins."],
            ["Enquete (**Enquete · Ativa**)", "Um admin publicou datas para votação.", "Os membros convidados e os admins."],
            ["Confirmado (**Ensaio · Confirmado**)", "Uma data foi fixada; o ensaio está no calendário.", "Todos que estão no ensaio."],
            ["Recusada, expirada ou excluída", "Fechada sem ensaio (uma proposta expira depois do dia em **Aberta até**).", "Ninguém: sai das listas."],
          ],
        },
        {
          type: "p",
          text: "As propostas e enquetes abertas aparecem na tela Início, em **Pendências**, e no alto do **Calendário**, em **Organização de ensaios ({count})**. No **Calendário**, elas seguem o filtro de banda.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Publica enquetes, transforma propostas em enquetes, fixa datas, recusa e exclui. Qualquer admin da banda pode fazer isso, não só quem publicou." },
            { role: "member", text: "Propõe (uma por semana), vota, responde **Nenhuma dá** e vê quem votou em quê." },
            { role: "deputy", text: "Não participa das enquetes da banda." },
          ],
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["duoLaptop"],
              text: "Na posição Laptop, a “Mesa da banda” da tela Início lista as enquetes em que você ainda não votou e as propostas à espera de enquete; toque numa para abri-la.",
            },
          ],
        },
      ],
    },

    // ───────────────────────────── Chat ─────────────────────────────
    {
      id: "the-chat-inbox",
      title: "A caixa de conversas",
      summary: "Todas as suas conversas da banda, dos eventos e diretas numa só lista.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["mensagens", "caixa de entrada", "lista de conversas", "não lidas", "buscar mensagens"],
      related: ["start-a-chat", "send-and-reply-to-messages", "delete-a-chat", "who-can-message-whom"],
      body: [
        {
          type: "p",
          text: "Toque em **Chat** na barra de baixo. O selo na aba conta as mensagens não lidas.",
        },
        {
          type: "list",
          items: [
            "Filtre com **TUDO**, **DIRETOS**, **BANDAS** ou **EVENTOS**. Cada filtro mostra o próprio número de não lidas.",
            "As conversas com mensagens não lidas vêm primeiro. Uma linha mostra o nome (“ · Banda” para a conversa da banda), o horário, a última mensagem e o número de não lidas ou os tiques da sua última mensagem.",
            "Se você está em duas bandas ou mais, a linha também mostra a qual banda ela pertence.",
            "Um ponto verde numa conversa direta indica que a pessoa está online.",
            "Digite pelo menos duas letras em **Buscar conversas…** para encontrar conversas, pessoas e palavras nas mensagens: os resultados são agrupados em **CONVERSAS**, **PESSOAS** e **MENSAGENS**. Toque em **Limpar busca** para voltar.",
            "Deslize uma conversa para a esquerda para excluí-la ([[delete-a-chat]]).",
            "Comece uma nova conversa com o + (**Nova conversa**) no alto ([[start-a-chat]]).",
          ],
        },
        { type: "shot", id: "shot-chat-inbox", caption: "A caixa de conversas com os filtros por tipo." },
        {
          type: "devices",
          rows: [
            { devices: ["tablet", "duoBook", "duoLand"], text: "A lista e a conversa aberta ficam lado a lado; a conversa aberta fica destacada na lista." },
            { devices: ["duoClosed", "duoBook", "duoLand"], text: "No iPhone Duo, o campo de busca fica na barra lateral." },
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "No modo solo (sem banda) não há chat: a aba **Chat** abre o calendário.",
        },
      ],
    },
    {
      id: "start-a-chat",
      title: "Começar uma conversa",
      summary: "Abra a conversa da banda, a de um evento ou uma mensagem direta.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["nova conversa", "mandar mensagem", "dm", "mensagem direta", "conversa da banda"],
      related: ["who-can-message-whom", "event-and-rehearsal-chats", "the-chat-inbox"],
      body: [
        {
          type: "steps",
          items: [
            "Em **Chat**, toque no + (**Nova conversa**) no alto.",
            "Escolha o **Tipo de conversa**: **DIRETOS**, **BANDA** ou **EVENTO**.",
            "Busque e selecione uma pessoa (**Buscar admins…** ou **Buscar membros…**), uma banda (**Buscar bandas…**) ou um evento (**Buscar eventos…**).",
            "Toque no botão embaixo: **Enviar mensagem a …** ou **Abrir conversa …**.",
          ],
        },
        {
          type: "p",
          text: "Se a conversa já existe, o BandWith a abre em vez de criar uma segunda. Uma banda tem uma única conversa com todos os membros ativos; um evento tem uma única conversa com a sua formação.",
        },
        {
          type: "p",
          text: "Você também pode mandar mensagem a alguém pela lista de membros da banda: abra o membro e toque no botão de mensagem. Ele só aparece quando um de vocês é admin.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "**DIRETOS** lista todos os membros das suas bandas. **EVENTO** lista todos os eventos das bandas que você administra." },
            { role: "member", text: "**DIRETOS** lista só os **Admins** da banda (“Mensagens diretas são limitadas aos admins da banda.”). **EVENTO** lista só os eventos em que você está e que não recusou." },
          ],
        },
      ],
    },
    {
      id: "send-and-reply-to-messages",
      title: "Enviar, responder e mencionar",
      summary: "Escreva mensagens, responda a uma mensagem específica, mencione alguém e leia mensagens antigas.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["enviar mensagem", "responder", "citar", "mencionar", "@", "mensagens antigas", "offline"],
      related: ["message-receipts-and-online-status", "the-chat-inbox"],
      body: [
        {
          type: "steps",
          title: "Enviar",
          items: [
            "Abra uma conversa e toque em **Escreva uma mensagem…** embaixo.",
            "Digite a mensagem e toque em **Enviar mensagem** (ou aperte Enter num teclado).",
          ],
        },
        {
          type: "steps",
          title: "Responder a uma mensagem",
          items: [
            "No celular ou tablet, deslize a mensagem para a direita. Com mouse, passe o cursor sobre ela e clique em **Responder à mensagem**.",
            "O campo de texto mostra **Respondendo a …**. Digite e envie. Toque em **Cancelar resposta** para desistir.",
          ],
        },
        {
          type: "steps",
          title: "Mencionar alguém",
          items: [
            "Digite @ e o começo de um nome.",
            "Toque na pessoa nas sugestões (Enter escolhe a primeira). As menções aparecem em negrito.",
          ],
        },
        {
          type: "list",
          title: "Bom saber",
          items: [
            "Nas conversas da banda e dos eventos, cada mensagem mostra o nome de quem enviou, com “ · Admin” para os admins.",
            "A conversa carrega as 50 mensagens mais recentes. Role para cima e toque em **Carregar mensagens anteriores** para ver mais.",
            "As mensagens são só texto: não há anexos, reações, edição nem exclusão de mensagens isoladas.",
            "Sem conexão, a mensagem não é enviada e volta para o campo de texto com “Mensagem não enviada. Verifique sua conexão e tente de novo.” Envie de novo quando estiver online.",
            "Uma menção fica destacada para todos, mas não envia uma notificação extra: todos na conversa já são avisados de cada mensagem.",
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["duoLaptop"], text: "Na posição Laptop, as mensagens ocupam a tela de cima e o campo de texto abre na tela de baixo." }],
        },
      ],
    },
    {
      id: "event-and-rehearsal-chats",
      title: "Conversas de show e de ensaio",
      summary: "Uma conversa para as pessoas de um show ou ensaio, com os horários fixados no alto.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["conversa do evento", "chat do show", "chat do ensaio", "conversa da formação", "faixa do evento"],
      related: ["start-a-chat", "gig-workspace", "the-rehearsal-page"],
      body: [
        {
          type: "steps",
          title: "Abrir",
          items: [
            "Abra o show ou o ensaio.",
            "Toque em **CHAT DO EVENTO** (num show) ou **CHAT DO ENSAIO** (num ensaio).",
          ],
        },
        {
          type: "p",
          text: "A conversa inclui a formação do evento (todos que não recusaram) e os admins da banda. Quem é adicionado à formação depois entra quando a próxima mensagem é enviada.",
        },
        {
          type: "p",
          text: "Uma faixa no alto mostra o evento: título, **Hoje** / **Amanhã** ou a data, **Montagem …** (ou **Início …**) e o lugar, mais **Cancelado** ou **Evento passado** quando for o caso. Toque nela para abrir o evento.",
        },
        {
          type: "note",
          tone: "privacy",
          text: "A faixa e o painel lateral mostram só a logística: horários, lugar e status. Nunca o cachê nem o cliente.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Pode abrir a conversa de qualquer evento da banda." },
            { role: "member", text: "Só vê o botão da conversa depois de responder que vai. Os membros que recusam perdem o acesso: “Você só pode enviar mensagens nos eventos de que participa.”" },
          ],
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["tablet", "duoBook", "duoLand"],
              text: "Com dois painéis (um iPad na horizontal ou o iPhone Duo aberto), um painel de contexto ao lado da conversa mostra os horários (**Montagem**, **Passagem de som**, **Show**, **Fim**), o lugar, o status, **Neste chat · Formação …/…** e quem está online, com **Abrir o show**.",
            },
          ],
        },
        { type: "shot", id: "shot-event-chat", caption: "Uma conversa de evento no iPad com a faixa do evento e o painel de contexto." },
        {
          type: "note",
          tone: "tip",
          text: "Os shows pessoais não têm conversa: “As conversas de evento estão disponíveis para eventos da banda.”",
        },
      ],
    },
    {
      id: "who-can-message-whom",
      title: "Quem pode mandar mensagem a quem",
      summary: "As regras do chat para admins, membros e substitutos.",
      roles: ["admin", "member", "deputy"],
      kind: "reference",
      keywords: ["regras do chat", "permissões", "mensagens restritas", "não consigo mandar mensagem"],
      related: ["start-a-chat", "event-and-rehearsal-chats"],
      body: [
        {
          type: "table",
          head: ["Conversa", "Admin", "Membro"],
          rows: [
            ["Conversa da banda", "Sim, nas bandas em que você está ativo", "Sim, nas bandas em que você está ativo"],
            ["Conversa do evento", "Qualquer evento da sua banda", "Só os eventos em que você está e que não recusou"],
            ["Mensagem direta", "Qualquer pessoa das suas bandas", "Só os admins de uma banda em comum"],
          ],
        },
        {
          type: "p",
          text: "Dois membros não podem trocar mensagens diretas; eles conversam no chat da banda ou do evento. As regras são verificadas quando você começa uma conversa e a cada envio.",
        },
        {
          type: "p",
          text: "Quando uma regra impede você, o campo de texto é trocado por um cadeado com o motivo, por exemplo “Mensagens diretas só estão disponíveis com os admins da banda.” ou “Você não tem mais acesso a esta conversa.” (depois que você saiu da banda ou foi tirado do show).",
        },
        {
          type: "roles",
          rows: [
            { role: "deputy", text: "Os substitutos não são membros da banda, então não estão em nenhuma conversa de banda, de evento ou direta. A banda fala com eles pelos pedidos de substituto (“Pedir no app”), e eles respondem em Shows como substituto. Veja [[deputy-in-the-app]]." },
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Uma conversa direta fica entre as duas pessoas. O BandWith nunca a reaproveita para uma conversa com outra pessoa, então ninguém mais pode ler esse histórico.",
        },
      ],
    },
    {
      id: "message-receipts-and-online-status",
      title: "Tiques, confirmação de leitura e status online",
      summary: "O que significam o relógio, um tique e dois tiques.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["tiques", "confirmação de leitura", "entregue", "visto", "online"],
      related: ["send-and-reply-to-messages", "the-chat-inbox"],
      body: [
        {
          type: "table",
          head: ["Sinal", "Significado"],
          rows: [
            ["Relógio (**Enviando**)", "A sua mensagem está a caminho."],
            ["Um tique (**Enviado**)", "Salva no servidor."],
            ["Dois tiques cinza (**Entregue**)", "Chegou aos celulares das outras pessoas."],
            ["Dois tiques coloridos (**Lido**)", "Elas abriram a conversa depois da sua mensagem."],
          ],
        },
        {
          type: "p",
          text: "Nas conversas da banda e dos eventos, os tiques só mudam quando todos receberam ou leram a mensagem. Quem entrou depois do envio não conta.",
        },
        {
          type: "p",
          text: "O cabeçalho de uma conversa direta mostra **Online** ou **Offline**. As conversas em grupo mostram “{count} membros · {count} online”.",
        },
      ],
    },
    {
      id: "delete-a-chat",
      title: "Excluir uma conversa",
      summary: "Tire uma conversa da sua lista e apague mensagens de vez.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["excluir conversa", "limpar chat", "remover conversa", "apagar mensagens"],
      related: ["the-chat-inbox"],
      body: [
        {
          type: "steps",
          items: [
            "Na lista de conversas, deslize a conversa para a esquerda e toque no botão de excluir. Ou abra a conversa e toque em **Excluir conversa** (a lixeira) no canto superior direito.",
            "Confirme com **Excluir** ou toque em **Cancelar**.",
          ],
        },
        {
          type: "table",
          head: ["Conversa", "O que é apagado"],
          rows: [
            ["Conversa direta", "Todas as mensagens, para vocês dois."],
            ["Conversa da banda ou do evento", "Só as suas mensagens, para todos. Os outros ficam com o resto da conversa."],
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Não dá para desfazer. A conversa sai da sua lista até chegar uma nova mensagem; aí ela volta só com as mensagens novas.",
        },
      ],
    },
    {
      id: "rehearsal-and-chat-notifications",
      title: "Notificações de ensaios, enquetes e chat",
      summary: "Quais ações avisam quem, e quais também enviam um push.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["push", "notificação", "alertas", "sino", "selo"],
      related: ["answer-a-rehearsal-invite", "vote-in-a-rehearsal-poll", "send-and-reply-to-messages"],
      body: [
        {
          type: "table",
          head: ["Quando", "Quem é avisado", "Push"],
          rows: [
            ["Um membro propõe um ensaio", "Os admins da banda", "Sim"],
            ["Um admin publica uma enquete", "Os membros chamados a votar", "Sim"],
            ["Uma data é fixada", "As pessoas incluídas no ensaio", "Não, só no sino"],
            ["Um ensaio é criado ou você é adicionado a um", "Os membros convidados", "Sim"],
            ["Muda a data, o horário ou o lugar", "As pessoas do ensaio", "Sim"],
            ["Um ensaio é excluído", "As pessoas do ensaio", "Sim"],
            ["Um membro desiste ou responde", "O admin que o criou", "Sim, quando desiste"],
            ["Uma nova mensagem no chat", "Todos os outros da conversa", "Sim"],
          ],
        },
        {
          type: "list",
          items: [
            "Tocar numa notificação de enquete abre a janela de votação; uma notificação de ensaio abre o ensaio; uma notificação de chat abre a conversa.",
            "Quando você abre o app com uma enquete ou proposta não lida, o BandWith a mostra uma vez num pequeno pop-up.",
            "Não chega push de uma conversa que está aberta na sua tela. Abrir uma conversa marca as notificações dela como lidas.",
            "Se a notificação é de outra das suas bandas, o app pergunta antes se você quer trocar de banda.",
            "Desative todos os pushes em **Ajustes**, com **Notificações push** (“Convites para shows, enquetes, mensagens do chat”). O sino guarda todas as notificações.",
          ],
        },
      ],
    },
  ],

  faq: [
    {
      q: "Um membro pode criar um ensaio?",
      a: "Não. Os membros tocam em **Propor ensaio** e os admins decidem. Os admins agendam direto ou fazem uma enquete.",
      roles: ["member"],
    },
    {
      q: "Por que só posso enviar uma proposta de ensaio por semana?",
      a: "Para manter a organização da banda focada, cada membro pode propor uma vez a cada 7 dias por banda. A tela mostra a próxima data em que você pode propor.",
      roles: ["member"],
    },
    {
      q: "Por que uma enquete diz Não convidado?",
      a: "O admin deixou você de fora em **Quem vota**. Você pode ler a enquete, mas só os membros convidados votam nela.",
      roles: ["member"],
    },
    {
      q: "A enquete fecha no prazo de votação?",
      a: "Sim, para a votação: depois do prazo, a enquete mostra **Votação encerrada** e ninguém mais pode votar. Aí um admin fixa uma data ou exclui a enquete.",
    },
    {
      q: "Os membros podem ver quanto custa a sala de ensaio?",
      a: "Durante uma enquete, eles veem só a parte deles (“€ 12 cada um”). O custo total do estúdio na página do ensaio aparece só para os admins.",
    },
    {
      q: "Posso mandar mensagem direta para outro membro?",
      a: "Só se um de vocês for admin de uma banda em comum. Senão, use a conversa da banda ou do evento.",
      roles: ["member"],
    },
    {
      q: "Por que não consigo abrir o chat do ensaio?",
      a: "Os membros veem **CHAT DO ENSAIO** depois de responder **VOU**. Se você recusou, não tem mais acesso.",
      roles: ["member"],
    },
    {
      q: "Posso editar ou excluir uma mensagem, ou enviar uma foto?",
      a: "Não. As mensagens do chat são só texto. Você pode responder a uma mensagem ou excluir a conversa inteira.",
    },
    {
      q: "Se eu excluir a conversa da banda, a banda perde a conversa?",
      a: "Não. Só as suas mensagens são apagadas. Numa conversa direta, todas as mensagens são apagadas para as duas pessoas.",
    },
    {
      q: "O que acontece com as mensagens que envio sem conexão?",
      a: "Elas não são enviadas. O texto volta para o campo de texto para você enviar de novo quando estiver online.",
    },
    {
      q: "Os substitutos podem usar o chat?",
      a: "Não. Os substitutos não são membros da banda. A banda fala com eles pelos pedidos de substituto no app.",
      roles: ["deputy"],
    },
  ],

  glossary: [
    { term: "Proposta de ensaio", definition: "O pedido de ensaio de um membro, com um tema e dias preferidos. Fica esperando um admin até o seu último dia preferido.", see: "propose-a-rehearsal" },
    { term: "Enquete de disponibilidade", definition: "Uma lista de datas propostas em que a banda vota antes de um admin escolher uma.", see: "create-a-rehearsal-poll" },
    { term: "Horário proposto", definition: "Uma data com horário de início e fim oferecida numa enquete.", see: "create-a-rehearsal-poll" },
    { term: "Modo de agendamento", definition: "A escolha entre **Agendar já** e **Enquete** quando um admin começa um novo ensaio.", see: "create-a-rehearsal" },
    { term: "Quem vota", definition: "Os membros chamados a votar numa enquete. Deixar alguém de fora cria uma lista de convidados.", see: "poll-who-votes-and-deadline" },
    { term: "Votar até", definition: "O dia e o horário em que a enquete para de aceitar votos. Depois disso, a enquete mostra Votação encerrada.", see: "poll-who-votes-and-deadline" },
    { term: "Favorita", definition: "A data da enquete com mais votos até agora.", see: "vote-in-a-rehearsal-poll" },
    { term: "Nenhuma dá", definition: "Uma resposta de enquete que diz que nenhuma das datas serve para você. Apaga os seus votos e avisa o admin.", see: "vote-in-a-rehearsal-poll" },
    { term: "Fixar", definition: "Escolher a data vencedora de uma enquete, o que cria o ensaio.", see: "lock-in-a-poll-date" },
    { term: "Número de livres", definition: "Quantos membros não têm nada no calendário num horário, por exemplo “4 de 5 livres”. Só aparece o número.", see: "create-a-rehearsal-poll" },
    { term: "Músicas em foco", definition: "As músicas a trabalhar num ensaio. Elas viram a setlist do ensaio.", see: "rehearsal-songs-and-prep-tasks" },
    { term: "Tipo de sessão", definition: "Banda completa, Vozes, Ritmo, Acústico ou Outro: dá o nome ao ensaio e pré-seleciona o elenco.", see: "create-a-rehearsal" },
    { term: "Conversa da banda", definition: "A conversa única de que todos os membros ativos de uma banda participam.", see: "start-a-chat" },
    { term: "Conversa do evento", definition: "A conversa de um show ou ensaio, para a formação e os admins.", see: "event-and-rehearsal-chats" },
    { term: "Faixa do evento", definition: "A barra no alto de uma conversa de evento com a data, o horário de montagem ou de início e o lugar.", see: "event-and-rehearsal-chats" },
    { term: "Tiques de confirmação", definition: "Os sinais ao lado das suas mensagens: enviando, enviado, entregue, lido.", see: "message-receipts-and-online-status" },
  ],
};

export default together;
