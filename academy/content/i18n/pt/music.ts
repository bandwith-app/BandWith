import type { AreaText } from '../../types';

const music: AreaText = {
  area: {
    id: "music",
    title: "Repertório, setlists e palco",
    intro:
      "Guarde as músicas da banda numa só biblioteca, monte setlists para os shows e leia letras e acordes no palco com todos na mesma música.",
    icon: "music",
  },

  articles: [
    // ───────────────────────────── Repertório ─────────────────────────────
    {
      id: "repertoire-overview",
      title: "A tela Repertório",
      summary: "Onde ficam as músicas e as setlists da banda, e o que faz cada parte da tela.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["músicas", "biblioteca", "catálogo", "repertório", "lista de músicas", "preparação"],
      related: ["add-a-song", "song-menu-actions", "build-a-setlist", "music-what-members-can-do"],
      body: [
        {
          type: "p",
          text: "O Repertório é a biblioteca de músicas da banda. Cada música nele pertence à banda, e todos os membros ativos podem ler todas as músicas. As setlists são montadas com essas músicas.",
        },
        {
          type: "steps",
          title: "Abrir o Repertório",
          items: [
            "Na tela Início, toque no bloco **Repertório** em **Atalhos**.",
            "Ou toque no seu avatar no alto (**Abrir perfil e conta**) e toque em **Repertório** em **Recursos e fluxos da banda**.",
          ],
        },
        {
          type: "list",
          title: "O que tem na tela",
          items: [
            "**Músicas** e **Setlists**, no alto, alternam entre as duas listas. Cada uma mostra quantos itens tem.",
            "O campo de busca filtra a lista em que você está: **Buscar músicas, artistas…** procura em títulos e artistas, **Buscar setlists…** procura nos nomes das setlists.",
            "O cartão **Repertório da banda** mostra o número de **Músicas** e **Setlists**, a **Duração total** de todas as músicas e a **Preparação**: um ponto por música, colorido pelo status, com as contagens de **Pronta**, **Aprendendo** e **Sugerida** embaixo.",
            "Cada linha de música mostra o título, o artista e o tom, a duração e o BPM. Uma etiqueta **Sugerida** ou **Aprendendo** aparece quando a música ainda não está pronta.",
            "O botão redondo **Tocar**, à esquerda da linha, toca a gravação da música ou abre o link dela. Ele fica cinza quando a música não tem nenhum dos dois.",
            "Toque em qualquer outro ponto da linha para abrir o menu da música (veja [[song-menu-actions]]).",
            "Acima das músicas, os admins veem **Sugestões dos membros** quando há algo para revisar; os membros sempre veem **Minhas sugestões** (veja [[review-song-suggestions]] e [[suggest-a-change-to-a-song]]).",
          ],
        },
        {
          type: "table",
          head: ["Status", "Significado"],
          rows: [
            ["**Pronta**", "A banda toca. As músicas que um admin adiciona ou importa começam aqui."],
            ["**Aprendendo**", "A banda está trabalhando nela. Uma sugestão aprovada começa aqui."],
            ["**Sugerida**", "Um membro propôs. Espera um admin aprovar ou recusar."],
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Vê **Importar lista de músicas** e **Adicionar música** no canto superior direito da lista de músicas, e **Nova setlist** na lista de setlists. Pode editar, mudar o status e excluir todas as músicas." },
            { role: "member", text: "Lê todas as músicas e setlists. O botão + no canto superior direito é **Sugerir uma música** na lista de músicas; na lista de setlists não há botão." },
            { role: "deputy", text: "Um substituto não é membro da banda e não tem Repertório. Os substitutos só veem os shows para os quais foram chamados (veja [[deputy-gigs]])." },
          ],
        },
        {
          type: "devices",
          rows: [
            { devices: ["tablet", "duoBook", "duoLand"], text: "O Repertório é a coluna da lista. Uma setlist, o formulário de música ou as sugestões abrem ao lado, no segundo painel." },
            { devices: ["duoLaptop"], text: "O cartão **Repertório da banda** vai para a metade de cima (o Display), e as listas ficam na metade de baixo." },
          ],
        },
        { type: "shot", id: "music-repertoire", caption: "O Repertório com o cartão Repertório da banda e a lista de músicas." },
      ],
    },
    {
      id: "add-a-song",
      title: "Adicionar uma música ao repertório",
      summary: "Adicione uma música em três passos curtos; só o título é obrigatório.",
      roles: ["admin"],
      kind: "task",
      keywords: ["nova música", "criar música", "adicionar faixa", "formulário de música"],
      related: ["song-fields", "suggest-a-song", "import-a-song-list", "import-chords-and-lyrics"],
      body: [
        {
          type: "steps",
          items: [
            "No Repertório, em **Músicas**, toque em **Adicionar música** (o botão + no canto superior direito). Com a biblioteca vazia, você também pode tocar em **Adicionar 1ª música**.",
            "Na etapa 1, **Música**, digite o **Título da música \\***. Adicione o **Artista original** se souber. Para trazer acordes ou letra agora, toque em **Importar acordes e letras** (veja [[import-chords-and-lyrics]]).",
            "Toque em **Próximo**. Na etapa 2, **Detalhes · opcional**, preencha **Duração**, **BPM**, **Tom** e **Gênero** se quiser.",
            "Toque em **Próximo**. Na etapa 3, **Arquivos e links · opcional**, adicione uma gravação, uma cifra, links, notas ou a letra.",
            "Toque em **Adicionar música**. O botão vira **Adicionada!** e o formulário fecha.",
          ],
        },
        {
          type: "p",
          text: "Você pode salvar em qualquer etapa: toque em **Adicionar música agora**, abaixo dos campos, para salvar com o que já tem.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Se uma música com o mesmo título e artista já está na biblioteca, o formulário diz “‘…’ já está na sua biblioteca. Salve de novo para adicionar uma segunda cópia.” Toque de novo no botão de salvar só se você quiser mesmo duas cópias.",
        },
        {
          type: "list",
          title: "O que acontece depois de salvar",
          items: [
            "A música é adicionada com o status **Pronta**.",
            "Todos os outros da banda recebem um aviso na caixa de notificações (sem push).",
            "Os arquivos escolhidos são enviados quando você salva, para o armazenamento privado da banda. Se salvar falhar, eles são removidos.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Adiciona músicas direto à biblioteca como **Pronta**." },
            { role: "member", text: "Usa o mesmo formulário, com o título **Sugerir uma música**. A música entra como **Sugerida** e espera um admin. Veja [[suggest-a-song]]." },
          ],
        },
        {
          type: "devices",
          rows: [
            { devices: ["duoClosed"], text: "**Fechar** fica na barra lateral, embaixo do relógio, em vez do canto superior direito do formulário." },
            { devices: ["tablet", "duoBook", "duoLand"], text: "O formulário abre no segundo painel, ao lado do Repertório." },
          ],
        },
      ],
    },
    {
      id: "song-fields",
      title: "Todos os campos de uma música",
      summary: "O que faz cada campo do formulário de música, com os limites que valem.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["detalhes da música", "bpm", "tom", "duração", "gênero", "gravação", "cifra", "youtube", "notas", "letra"],
      related: ["add-a-song", "transpose-and-tempo", "lyrics-and-chords-format", "play-a-song-recording"],
      body: [
        { type: "p", text: "O formulário de música tem três etapas. Só o título é obrigatório; as outras etapas dizem “opcional” e podem ser puladas." },
        {
          type: "table",
          head: ["Campo", "O que faz"],
          rows: [
            ["**Título da música \\***", "O nome da música. Obrigatório."],
            ["**Artista original**", "Aparece embaixo do título em todo lugar e serve para detectar duplicatas."],
            ["**Importar acordes e letras**", "Traz uma grade de acordes e a letra do fórum do iReal Pro, de um arquivo ou da área de transferência. Depois de anexada uma grade, um cartão **Cifra** mostra o tom, o estilo, o andamento, os compassos e as seções, com **Ver acordes**, **Substituir** e um X para removê-la."],
            ["**Duração**", "Minutos e segundos em duas caixas (min : seg). Usada nos totais das setlists."],
            ["**BPM**", "Andamento, até 3 dígitos. O clique do Modo palco usa esse valor."],
            ["**Tom**", "Texto livre, por exemplo C maj. Aparece na lista, no palco e no controle de transposição do leitor."],
            ["**Tap**, **BPM da gravação**, ÷2 / ×2", "Ferramentas embaixo do BPM para achar o andamento. Veja [[transpose-and-tempo]]."],
            ["**Transpor para a banda**", "Muda o tom, a grade de acordes e os acordes da letra para todos. Só aparece quando há algo para transpor."],
            ["**Gênero**", "Etiquetas para escolher entre os gêneros da banda, ou um novo com o chip tracejado **Gênero** e depois **Adicionar gênero**. Os gêneros filtram a biblioteca quando você monta uma setlist."],
            ["**Gravação**", "Um arquivo de áudio: MP3, M4A, WAV, no máximo 50 MB."],
            ["**Cifra / partitura**", "Um PDF ou uma foto, no máximo 20 MB."],
            ["**Escolher arquivos**", "Escolhe um ou mais arquivos. O app os separa em Gravação ou Cifra pelo tipo. Arquivos do iCloud Drive, Google Drive ou Dropbox: toque em **Escolher arquivos**, depois em **Navegar**, e escolha o app em Locais."],
            ["**Vídeo do YouTube**", "Um link da música no YouTube. Precisa começar com https://."],
            ["**Partitura**", "Um link para um PDF ou partitura online, usado no lugar de uma cifra enviada. Precisa começar com https://."],
            ["**Acordes**", "Um link para uma página de acordes. Ele é salvo nas notas da música como “Acordes: <link>”. Precisa começar com https://."],
            ["**Notas**", "Notas da banda sobre a música: ideias de arranjo, mudanças de tom."],
            ["**Letra · texto, Markdown ou JSON**", "A letra da música, com acordes no meio se quiser. Veja [[lyrics-and-chords-format]]. **Colar ou importar a letra**, embaixo da caixa, abre a janela de importação na aba Letra."],
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "As gravações e cifras enviadas ficam guardadas de forma privada para a sua banda: só os membros da banda podem abri-las.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Se o título estiver vazio quando você escolher um arquivo, o nome do arquivo vira o título.",
        },
      ],
    },
    {
      id: "song-menu-actions",
      title: "Menu da música: todas as ações",
      summary: "O que faz cada item do menu de uma música, e quem o vê.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["ações da música", "opções da música", "menu", "ultimate guitar", "marcar como pronta"],
      related: ["read-a-song", "edit-or-delete-a-song", "play-a-song-recording", "chord-editor"],
      body: [
        { type: "p", text: "Toque numa linha de música no Repertório para abrir o menu dela. Os itens só aparecem quando se aplicam àquela música." },
        {
          type: "table",
          head: ["Item", "O que faz", "Quem"],
          rows: [
            ["**Tocar**", "Toca a gravação no mini player ou abre o link do Spotify ou do YouTube.", "Todos, quando a música tem gravação ou link"],
            ["**Letra**", "Abre o leitor da música na letra.", "Todos, quando a música tem letra"],
            ["**Grade de acordes**", "Abre o leitor da música na grade de acordes.", "Todos, quando a música tem uma grade do iReal"],
            ["**Abrir cifra**", "Abre a cifra enviada ou o link da partitura.", "Todos, quando a música tem uma"],
            ["**Abrir no Ultimate Guitar**", "Abre uma busca da música no Ultimate Guitar, fora do app.", "Todos"],
            ["**Editar acordes**", "Abre o editor de acordes.", "Admins, quando a música tem letra"],
            ["**Editar**", "Abre o formulário da música.", "Admins"],
            ["**Sugerir uma alteração**", "Envia uma correção ou uma nota ao admin.", "Membros"],
            ["**Marcar como pronta**", "Muda o status para Pronta.", "Admins, quando a música não está Pronta"],
            ["**Aprovar · aprendendo**", "Aprova uma música sugerida e a coloca em Aprendendo.", "Admins, numa música Sugerida"],
            ["**Voltar a aprendendo**", "Leva uma música Pronta de volta para Aprendendo.", "Admins, numa música Pronta"],
            ["**Excluir**", "Exclui a música depois de uma confirmação.", "Admins"],
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Passar uma música sugerida para Aprendendo ou Pronta por este menu aceita a sugestão do membro, e excluí-la recusa a sugestão. Nos dois casos, o membro que sugeriu é avisado.",
        },
      ],
    },
    {
      id: "edit-or-delete-a-song",
      title: "Editar, aprovar ou excluir uma música",
      summary: "Mude os detalhes ou o status de uma música, ou tire-a da biblioteca.",
      roles: ["admin"],
      kind: "task",
      keywords: ["mudar música", "atualizar música", "remover música", "status da música", "aprovar música"],
      related: ["song-fields", "song-menu-actions", "music-notifications"],
      body: [
        {
          type: "steps",
          title: "Editar uma música",
          items: [
            "No Repertório, toque na linha da música e depois em **Editar**.",
            "Mude o que precisar em qualquer uma das três etapas. Toque em **Salvar agora** para salvar na etapa 1 ou 2, ou em **Próximo** e depois em **Salvar música** na etapa 3.",
          ],
        },
        {
          type: "p",
          text: "Só os campos que você mudou são salvos, então a alteração que um colega fizer em outro campo ao mesmo tempo é mantida. O resto da banda recebe um único push, por exemplo “Música atualizada · Paper Boats” com “Leo M. alterou: tom, andamento.”",
        },
        {
          type: "steps",
          title: "Mudar o status de uma música",
          items: [
            "Toque na linha da música.",
            "Toque em **Marcar como pronta**, **Aprovar · aprendendo** ou **Voltar a aprendendo**. A etiqueta na linha muda na hora.",
          ],
        },
        {
          type: "steps",
          title: "Excluir uma música",
          items: [
            "Toque na linha da música e depois em **Excluir**.",
            "Leia a confirmação: ela cita as setlists que perdem a música e os próximos shows em que ela é tocada.",
            "Toque em **Excluir** para confirmar, ou em **Cancelar**.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Excluir uma música a tira de todas as setlists em que ela está, e a gravação e a cifra enviadas são apagadas de vez. Não dá para desfazer.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Edita, muda o status e exclui todas as músicas da banda." },
            { role: "member", text: "Não pode editar nem excluir músicas da banda. Usa **Sugerir uma alteração** (veja [[suggest-a-change-to-a-song]])." },
          ],
        },
      ],
    },
    {
      id: "lyrics-and-chords-format",
      title: "Como se escrevem letras e acordes",
      summary: "O formato de música da banda: seções, acordes no meio do texto e o que o app arruma ao salvar.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["chordpro", "markdown", "seções", "estrofe", "refrão", "acordes no texto", "formato", "json"],
      related: ["read-a-song", "chord-editor", "import-chords-and-lyrics"],
      body: [
        { type: "p", text: "A letra é texto simples com algumas marcas fáceis. O mesmo texto guarda as palavras e os acordes, então uma música serve para quem canta e para quem toca." },
        {
          type: "list",
          title: "As marcas",
          items: [
            "Uma seção começa com uma linha de título: `# Verse 1` ou `[Chorus]`.",
            "Uma linha em branco separa as estrofes.",
            "Um acorde vai entre colchetes logo antes da palavra em que cai: `[Am]word`. No leitor, ele aparece em cima dessa palavra.",
            "`**bold**` e `*italic*` funcionam dentro de uma linha.",
            "JSON também funciona, por exemplo uma lista de linhas ou uma lista de seções com nome e linhas.",
          ],
        },
        {
          type: "list",
          title: "O que o app arruma quando a música é salva",
          items: [
            "Os nomes das seções ficam num único formato: “Rit.” vira Refrão, “[Strofa 2]” vira Estrofe 2. O app entende nomes em italiano, espanhol, francês, alemão e português.",
            "Estrofes sem número são numeradas quando há várias.",
            "Uma linha de acordes sobre uma linha de palavras (cifras com acordes em cima da letra) é juntada em acordes no meio do texto.",
            "Um acorde solto antes de um espaço é ligado à palavra seguinte.",
          ],
        },
        {
          type: "p",
          text: "Os nomes das seções ficam escritos em inglês no texto, mas cada pessoa os vê no idioma do próprio app.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Se a letra não puder ser desenhada, o leitor diz “Esta letra não pode ser exibida. Confira o formato em Editar música.”",
        },
      ],
    },
    {
      id: "read-a-song",
      title: "Ler letras e acordes",
      summary: "Abra uma música no leitor em tela cheia, troque de visualização, mude o tamanho do texto e transponha só para você.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["letra", "acordes", "estrutura", "leitor", "tamanho do texto", "visualização", "cifra", "letra e acordes", "grade de acordes"],
      related: ["lyrics-and-chords-format", "transpose-and-tempo", "my-notes-and-files", "stage-mode"],
      body: [
        {
          type: "steps",
          items: [
            "No Repertório, toque na linha da música e em **Letra** ou **Grade de acordes**. No mini player, toque em **Letra**.",
            "Alterne entre **Letra**, **Letra e acordes** e **Grade de acordes** com as abas embaixo do título. Só aparecem as visualizações que a música tem.",
            "Toque nos botões − e + (**Texto menor**, **Texto maior**) no alto para mudar o tamanho do texto.",
            "Para ler em outro tom, use − e + ao redor do tom, embaixo das abas. Toque no tom para voltar ao original.",
            "Toque no X (**Fechar letra**) para fechar o leitor.",
          ],
        },
        {
          type: "table",
          head: ["Visualização", "O que mostra"],
          rows: [
            ["**Letra**", "Só as palavras, sem acordes."],
            ["**Letra e acordes**", "As palavras com os acordes em cima, ou a grade do iReal se a letra não tiver acordes."],
            ["**Grade de acordes**", "Só os acordes: a grade do iReal compasso por compasso, ou a progressão de acordes de cada seção em caixas."],
          ],
        },
        {
          type: "list",
          title: "A sua visualização é lembrada",
          items: [
            "Na primeira vez, o leitor abre na visualização do seu instrumento na banda: quem canta em Letra; guitarra, teclado e baixo em Letra e acordes; bateria, percussão e sopros em Grade de acordes.",
            "Depois disso, ele abre na última visualização que você escolheu neste dispositivo. A mesma escolha vale no Modo palco.",
            "O tamanho do texto fica guardado neste dispositivo e é compartilhado com o Modo palco.",
          ],
        },
        {
          type: "p",
          text: "Se a música estiver tocando no mini player, aparece um botão de play/pausa no cabeçalho do leitor. Os admins também veem **Editar acordes** ali.",
        },
        {
          type: "devices",
          rows: [
            { devices: ["duoLaptop"], text: "A música ocupa a metade de cima (o Display) e os controles do leitor vão para a metade de baixo (o Deck)." },
            { devices: ["tablet", "duoBook", "duoLand"], text: "O leitor abre no segundo painel, ao lado do Repertório." },
          ],
        },
        { type: "shot", id: "music-reader", caption: "O leitor da música com as abas Letra, Letra e acordes e Grade de acordes." },
      ],
    },
    {
      id: "chart-symbols",
      title: "Os símbolos de uma cifra",
      summary: "O que significa cada sinal de uma cifra do iReal Pro ou MusicXML: repetições, finais, segno, coda e o resto.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["símbolos", "legenda", "sinais", "repetição", "segno", "coda", "d.c.", "d.s.", "fine", "final", "casa", "fermata", "n.c.", "barra", "compasso"],
      related: ["read-a-song", "import-from-ireal-pro", "chord-editor", "stage-mode"],
      body: [
        {
          type: "p",
          text: "As cifras importadas do iReal Pro ou de um arquivo MusicXML mostram a forma com os mesmos sinais em todo lugar: o leitor da música, o editor de acordes, o Modo palco e o Modo ao vivo. Embaixo de cada cifra, **O que significam os símbolos** abre esta lista.",
        },
        {
          type: "symbols",
          title: "Os símbolos",
          rows: [
            { symbol: "section", name: "A", text: "Seção: a letra de uma parte (A, B…). Intro e Verso aparecem como palavras." },
            { symbol: "time-signature", name: "3/4", text: "Compasso: a partir deste compasso (aqui 3 tempos de semínima)." },
            { symbol: "repeat-start", text: "Início da repetição: aqui começa a parte repetida." },
            { symbol: "repeat-end", text: "Fim da repetição: volte ao início da repetição e toque de novo." },
            { symbol: "ending", n: 1, text: "Primeira casa: toque na primeira vez; na segunda, pule para a segunda casa." },
            { symbol: "repeat-bar", text: "Toque de novo o compasso anterior." },
            { symbol: "repeat-two-bars", text: "Toque de novo os dois compassos anteriores." },
            { symbol: "repeat-times", n: 3, text: "Toque esta parte 3 vezes." },
            { symbol: "segno", text: "Segno: para onde o D.S. manda você de volta." },
            { symbol: "coda", text: "Coda: no primeiro sinal de coda pule para o segundo, a parte final." },
            { symbol: "to-coda", text: "Para a Coda: pule para a coda agora." },
            { symbol: "dc-al-coda", text: "D.C. al Coda: volte ao início e depois pule para a coda." },
            { symbol: "ds-al-coda", text: "D.S. al Coda: volte ao segno e depois pule para a coda." },
            { symbol: "dc-al-fine", text: "D.C. al Fine: volte ao início e pare em Fine." },
            { symbol: "fine", text: "Fine: a música termina aqui, depois de um D.C. ou D.S." },
            { symbol: "fermata", text: "Fermata: sustente o acorde." },
            { symbol: "no-chord", text: "N.C.: sem acorde, a banda para." },
            { symbol: "slash", text: "Mesmo acorde no tempo seguinte." },
            { symbol: "double-bar", text: "Barra dupla: termina uma parte." },
            { symbol: "final-bar", text: "Barra final: termina a música." },
            { symbol: "end", text: "End: onde a música para." },
          ],
        },
        {
          type: "list",
          title: "Bom saber",
          items: [
            "Os leitores de tela dizem o nome de cada sinal no seu idioma (por exemplo “Repete o compasso anterior”).",
            "As palavras escritas em um compasso que não são um sinal (“Solo on AABA”) ficam como foram escritas.",
            "As cifras importadas antes desta atualização também mostram os sinais. Uma fermata, uma barra ou uma repetição de dois compassos que faltava volta quando você importa a cifra de novo.",
          ],
        },
      ],
    },
    {
      id: "transpose-and-tempo",
      title: "Transpor uma música e achar o andamento",
      summary: "Mude o tom para a banda toda ou só na sua tela, e defina o BPM marcando o tempo ou pela gravação.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["transpor", "mudar tom", "semitom", "bpm", "tap tempo", "detectar andamento"],
      related: ["song-fields", "read-a-song", "stage-click"],
      body: [
        {
          type: "table",
          head: ["Onde", "O que muda", "Quem"],
          rows: [
            ["Formulário da música, **Transpor para a banda**", "O tom da música, a grade de acordes e os acordes da letra, para todos, quando você salva.", "Admins"],
            ["Leitor e Modo palco, − tom +", "Só o que a sua tela mostra. A música continua no tom dela para a banda. Fica guardado por música neste dispositivo.", "Todos"],
          ],
        },
        {
          type: "steps",
          title: "Transpor para a banda toda",
          items: [
            "Abra o menu da música e toque em **Editar**, depois em **Próximo** para chegar a **Detalhes · opcional**.",
            "Em **Tom**, toque em **Descer um semitom** (−) ou **Subir um semitom** (+). O número entre eles mostra quanto você mudou.",
            "Toque em **Salvar agora**. A banda é avisada de que o tom e os acordes mudaram.",
          ],
        },
        {
          type: "steps",
          title: "Achar o BPM",
          items: [
            "No formulário da música, em **Detalhes · opcional**, toque em **Tap** no tempo da música. Depois de dois toques, o BPM é preenchido; o número de toques aparece ao lado do botão.",
            "Ou toque em **BPM da gravação**, quando a música tem um arquivo de áudio. O andamento é calculado no seu dispositivo.",
            "Se o resultado for metade ou o dobro do andamento real, toque em ÷2 ou ×2.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Um andamento tirado da gravação é uma estimativa: o formulário diz “Estimado pela gravação: confira marcando o tempo.”",
        },
      ],
    },
    {
      id: "chord-editor",
      title: "Editar os acordes de uma música",
      summary: "Coloque acordes nas palavras com um toque, mova-os arrastando e copie-os entre seções.",
      roles: ["admin"],
      kind: "task",
      keywords: ["editor de acordes", "editar acordes", "adicionar acorde", "mover acorde", "copiar acordes", "ireal"],
      related: ["lyrics-and-chords-format", "suggest-a-change-to-a-song", "import-from-ireal-pro"],
      body: [
        {
          type: "steps",
          items: [
            "No Repertório, toque na linha da música e em **Editar acordes**. Você também pode tocar em **Editar acordes** no cabeçalho do leitor.",
            "Toque numa palavra. A barra embaixo mostra **Acorde em “…”** e os acordes que a música já usa.",
            "Toque num acorde para colocá-lo na palavra, ou digite um novo em **Novo acorde, p. ex. F#m7** e toque em **Adicionar**. Toque em **Sem acorde** para removê-lo. Toque em **Pronto** para fechar a barra.",
            "Para mover um acorde, arraste-o para outra palavra.",
            "Para reaproveitar os acordes de uma estrofe, toque em **Copiar acordes de…** acima de uma seção e escolha a seção de onde copiar.",
            "Se a música tem uma grade do iReal, toque em **Do iReal (…)** acima de uma seção para pôr os acordes da seção correspondente da grade sobre as linhas dela.",
            "Toque em **Desfazer** no canto superior direito para voltar um passo. Quando terminar, toque em **Salvar acordes**.",
          ],
        },
        {
          type: "list",
          title: "Verificações do editor",
          items: [
            "**Arrumar o formato** aparece quando nomes de seções ou acordes não estão no formato da banda; um toque corrige.",
            "“Não estão na grade do iReal: …” lista os acordes da letra que a grade nunca toca.",
            "“Os acordes soam em …, a música está em ….” aparece quando os acordes não combinam com o tom da música, com um botão para transpô-los.",
          ],
        },
        {
          type: "p",
          text: "O editor de acordes precisa de letra. Sem letra, ele pede para adicioná-la antes em Editar música. Depois que você salva, a banda recebe um push dizendo que os acordes mudaram.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Sair com alterações não salvas pergunta “Salvar as alterações?”, com **Salvar alterações**, **Descartar** e **Continuar editando**.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Edita os acordes da banda para todos." },
            { role: "member", text: "Não tem editor de acordes. Sugere uma correção de acordes com **Sugerir uma alteração** (veja [[suggest-a-change-to-a-song]])." },
          ],
        },
      ],
    },
    {
      id: "import-chords-and-lyrics",
      title: "Importar acordes e letra para uma música",
      summary: "Traga uma grade de acordes e a letra do fórum do iReal Pro, de um arquivo ou da área de transferência.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["importar letra", "colar letra", "chordpro", "musicxml", "grade de acordes", "importar arquivo"],
      related: ["import-from-ireal-pro", "open-a-chart-from-another-app", "lyrics-and-chords-format"],
      body: [
        {
          type: "steps",
          items: [
            "No formulário da música, toque em **Importar acordes e letras** na etapa 1, ou em **Colar ou importar a letra** na etapa 3.",
            "Escolha uma aba: **Do fórum**, **De um arquivo** ou **Letra**.",
            "**De um arquivo**: toque em **Escolher um arquivo** e escolha um arquivo MusicXML (.musicxml, .mxl), ChordPro (.cho, .chordpro, .pro) ou de texto (.txt).",
            "**Letra**: copie a letra em outro lugar e toque em **Colar da área de transferência**, ou cole-a na caixa e toque em **Prévia**.",
            "Confira a prévia e toque em **Usar esta letra** ou em **Voltar**.",
            "Salve a música normalmente.",
          ],
        },
        {
          type: "list",
          title: "Bom saber",
          items: [
            "A letra sempre aparece primeiro numa prévia. Se a música já tem letra, a prévia avisa que a nova vai substituí-la.",
            "Uma grade de acordes sozinha é anexada na hora, sem prévia.",
            "O que a importação traz só preenche campos vazios: o título, o artista, o tom e o andamento que você já digitou ficam.",
            "Ao colar, as linhas vazias separam as seções; os acordes em cima das palavras ou entre [colchetes] ficam com elas.",
            "Do iReal Pro no seu dispositivo: Compartilhar › Exportar › MusicXML, salve no app Arquivos e depois use **De um arquivo**.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Só a sua banda vê as letras e cifras que você importa. Importe só o que você tem direito de usar.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Importa para qualquer música ao adicioná-la ou editá-la." },
            { role: "member", text: "Importa ao sugerir uma música nova. Para uma música que já existe, sugira a alteração." },
          ],
        },
      ],
    },
    {
      id: "import-from-ireal-pro",
      title: "Importar uma grade de acordes do iReal Pro",
      summary: "Toque no link de uma música ou playlist no fórum do iReal Pro para trazer os acordes, a forma, o tom e o andamento para uma música.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["ireal", "ireal pro", "irealb", "grade de acordes", "playlist", "fórum"],
      related: ["import-chords-and-lyrics", "read-a-song", "chord-editor"],
      body: [
        {
          type: "steps",
          title: "Nos apps de iPhone, iPad e Android",
          items: [
            "No formulário da música, toque em **Importar acordes e letras** e fique em **Do fórum**.",
            "Toque em **Explorar o fórum do iReal Pro**. O fórum abre dentro do app.",
            "Toque no link de uma música ou playlist. Os acordes voltam direto para o formulário.",
            "Ou cole um link irealb:// em **Link do iReal Pro**.",
          ],
        },
        {
          type: "steps",
          title: "Na web",
          items: [
            "No formulário da música, toque em **Importar acordes e letras** e fique em **Do fórum**.",
            "Toque em **Abrir o fórum do iReal Pro**. O fórum abre numa janela própria.",
            "Clique com o botão direito no link de uma música ou playlist e escolha Copiar link.",
            "De volta ao BandWith, toque em **Colar link**, cole em **Link do iReal Pro** ou arraste o link para a caixa (ela diz **Solte o link aqui**). A janela do fórum fecha assim que o link entra.",
          ],
        },
        {
          type: "p",
          text: "O link de uma playlist mostra as músicas dela (“… · 12 músicas”). As músicas que batem com o seu título aparecem primeiro; digite em **Buscar uma música** para filtrar a lista e toque numa música para usá-la. **Trocar** volta ao link.",
        },
        {
          type: "list",
          title: "O que vem",
          items: [
            "Os acordes e a forma (seções, compassos, repetições), mais tom, estilo, andamento e fórmula de compasso. Sem melodia, sem letra.",
            "O título, o compositor (como artista), o tom e o BPM preenchem os campos vazios do formulário.",
            "A grade aparece nas visualizações **Letra e acordes** e **Grade de acordes** do leitor, e o editor de acordes pode usá-la para posicionar os acordes.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Se o seu navegador bloquear a janela do fórum, permita pop-ups para o BandWith e tente de novo.",
        },
        {
          type: "devices",
          rows: [
            { devices: ["web"], text: "O fórum não pode abrir dentro da página, então abre numa janela separada e você traz o link de volta com **Colar link**, colando ou arrastando." },
          ],
        },
      ],
    },
    {
      id: "open-a-chart-from-another-app",
      title: "Abrir uma grade MusicXML de outro app",
      summary: "Envie um arquivo MusicXML ao BandWith e anexe a grade de acordes dele a uma música.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["abrir em", "compartilhar", "musicxml", "arquivo recebido", "anexar cifra"],
      related: ["import-chords-and-lyrics", "suggest-a-change-to-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "Em outro app (por exemplo o iReal Pro ou o Arquivos), compartilhe ou abra um arquivo MusicXML com o BandWith.",
            "O BandWith abre uma janela **Arquivo recebido**. Os admins veem **Associar a cifra**; os membros veem **Sugerir a grade de acordes**.",
            "Escolha a música a que ele pertence. Use **Buscar uma música** para procurar. Uma música que já tem grade avisa que ela será substituída.",
            "Toque em **Abrir acordes** para conferir, ou em **Pronto**.",
          ],
        },
        {
          type: "list",
          items: [
            "Para uma música nova, adicione a música primeiro: o arquivo espera em **Importar acordes e letras** › **De um arquivo** › **Arquivo recebido**, onde **Usar** o anexa.",
            "Toque em **Descartar o arquivo** se não quiser usá-lo.",
            "Uma partitura com letra mas sem cifras não gera grade; para usar a letra, abra Editar da música › **Colar ou importar a letra** › **De um arquivo**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "A grade é anexada à música da banda na hora." },
            { role: "member", text: "A grade vai para o admin como sugestão. A música da banda não muda até ele aceitar." },
          ],
        },
        { type: "devices", rows: [{ devices: ["web"], text: "Não disponível: receber arquivos de outros apps funciona nos apps de iPhone, iPad e Android." }] },
      ],
    },
    {
      id: "import-a-song-list",
      title: "Importar uma lista de músicas",
      summary: "Adicione muitas músicas de uma vez a partir de um arquivo CSV ou de texto, ou carregue o repertório pronto.",
      roles: ["admin"],
      kind: "task",
      keywords: ["csv", "excel", "planilha", "importação em massa", "txt", "numbers", "google sheets", "700 músicas"],
      related: ["add-a-song", "repertoire-overview"],
      body: [
        {
          type: "steps",
          items: [
            "No Repertório, em **Músicas**, toque em **Importar lista de músicas** (o botão de envio no canto superior direito). Com a biblioteca vazia, você também pode tocar em **Importar lista (CSV/TXT)**.",
            "Escolha um arquivo .csv, .tsv ou .txt de até 2 MB.",
            "Leia a linha acima da lista: ela diz quantas músicas foram importadas e quantas já estavam na sua biblioteca.",
          ],
        },
        {
          type: "list",
          title: "Como o arquivo pode ser",
          items: [
            "Uma planilha salva como CSV (Excel, Numbers, Google Sheets) com uma linha de cabeçalho. Colunas lidas: title (ou song, name, track), artist (ou band, performer), key, bpm (ou tempo), duration (ou length, time; m:ss ou segundos) e genre.",
            "Uma lista simples digitada no Notas: uma música por linha, como “Título - Artista”, “Título, Artista” ou só “Título”. Linhas numeradas e linhas em branco não são problema.",
            "Até 2000 músicas por arquivo.",
          ],
        },
        {
          type: "p",
          text: "As músicas com o mesmo título e artista de uma que já está na biblioteca são puladas. As músicas importadas entram como **Pronta**.",
        },
        {
          type: "steps",
          title: "Carregar o repertório pronto",
          items: [
            "Com a biblioteca vazia, toque em **Carregar 700+ músicas**.",
            "O app adiciona as músicas selecionadas que ainda não estão na sua biblioteca e diz quantas foram.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Importar uma lista de músicas é só para admins: ela vai direto para a biblioteca da banda. Os membros sugerem músicas uma por uma, e um admin revisa cada uma.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Vê **Importar lista de músicas** e **Carregar 700+ músicas**." },
            { role: "member", text: "Não vê esses botões." },
          ],
        },
      ],
    },
    {
      id: "play-a-song-recording",
      title: "Tocar uma gravação, abrir uma cifra ou um link",
      summary: "Ouça a gravação da banda no mini player e abra cifras e links.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["tocar", "áudio", "mini player", "gravação", "spotify", "youtube", "cifra em pdf"],
      related: ["song-menu-actions", "song-fields", "read-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "No Repertório, toque no botão redondo **Tocar** numa linha de música, ou toque na linha e em **Tocar**.",
            "Uma gravação (um arquivo enviado, um link do Google Drive ou qualquer link de áudio) toca no mini player. Use **Pausar**, **Tocar** e **Parar** ali, e **Letra** para abrir o leitor da música.",
            "Um link do Spotify ou do YouTube abre fora do app.",
            "Para ver a cifra, toque na linha e em **Abrir cifra**.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Se nada abrir, o app diz “Não foi possível abrir a música. Confira a gravação ou os links.” Se um link falhar no player, **Abrir o link** o abre em outro lugar.",
        },
      ],
    },
    {
      id: "my-notes-and-files",
      title: "Minhas notas e arquivos numa música",
      summary: "Adicione notas privadas numa música, numa linha, numa palavra ou num acorde, e guarde arquivos seus que ninguém mais vê.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["notas pessoais", "notas privadas", "minhas notas", "anotações", "meus arquivos", "gravação própria"],
      related: ["read-a-song", "stage-mode", "suggest-a-change-to-a-song"],
      body: [
        {
          type: "note",
          tone: "privacy",
          text: "As suas notas e arquivos são só seus: ninguém mais da banda os vê, nem os admins. A música da banda não muda para os outros.",
        },
        {
          type: "steps",
          title: "Adicionar uma nota",
          items: [
            "Abra a música no leitor (**Letra** ou **Grade de acordes**) ou no Modo palco.",
            "Toque em **Adicionar nota** (no Modo palco, **Nota**). **Minhas notas** ligam sozinhas; na primeira vez, uma janela explica o que são: toque em **Entendi**.",
            "Uma barra embaixo da tela diz **Toque na linha onde você quer a nota**: toque na linha que você quer, ou em **Música inteira** para uma nota na música toda. **Cancelar** sai.",
            "Mais rápido: segure uma linha por meio segundo. Abre **Nota nesta linha**: toque em **Nota para mim**.",
            "Numa linha, escolha onde fica a nota: **Linha inteira**, uma das palavras ou um dos acordes dela.",
            "Digite em **Minha nota** e toque em **Salvar nota**.",
            "**Nota salva em “…”** mostra onde ela ficou.",
          ],
        },
        {
          type: "list",
          items: [
            "As suas notas aparecem embaixo da linha delas, destacadas. As notas sobre a música toda aparecem acima da letra.",
            "Toque numa nota para mudá-la ou toque em **Excluir nota**.",
            "Uma nota fica na linha dela mesmo quando um admin edita os acordes ou move seções. Se a linha não estiver mais na música, a nota vai para o alto para não se perder.",
            "Desative **Minhas notas** para escondê-las, por exemplo no palco. A escolha fica guardada neste dispositivo.",
          ],
        },
        {
          type: "steps",
          title: "Adicionar um arquivo seu",
          items: [
            "Com **Minhas notas** ativado, toque em **Adicionar arquivo** e escolha uma gravação ou uma partitura.",
            "Ele aparece como um chip embaixo da barra. Toque nele para abri-lo; toque no X dele e confirme para removê-lo.",
          ],
        },
        {
          type: "p",
          text: "Para compartilhar uma nota com a banda, toque em **Sugerir à banda** na janela da nota. Ela vai para o admin como sugestão, com a linha em que estava.",
        },
        {
          type: "devices",
          rows: [{ devices: ["phone", "phoneLand", "duoClosed"], text: "No Modo palco, a barra mostra **Nota** e um ícone para **Adicionar arquivo**, assim cabe numa linha acima da letra." }],
        },
      ],
    },

    // ───────────────────────────── Sugestões ─────────────────────────────
    {
      id: "suggest-a-song",
      title: "Sugerir uma música nova",
      summary: "Proponha uma música para o repertório; um admin aprova ou recusa.",
      roles: ["member"],
      kind: "task",
      keywords: ["propor música", "sugerir música", "pedido de música", "ideia de música"],
      related: ["add-a-song", "my-song-suggestions", "review-song-suggestions"],
      body: [
        {
          type: "steps",
          items: [
            "No Repertório, em **Músicas**, toque em **Sugerir uma música** (o botão + no canto superior direito).",
            "Preencha o formulário como para qualquer música: **Título da música \\*** é o único campo obrigatório. Você pode importar acordes e letra e anexar uma gravação ou uma cifra.",
            "Toque em **Sugerir agora** para enviar antes, ou passe pelas etapas e toque em **Sugerir uma música** na última.",
          ],
        },
        {
          type: "list",
          title: "O que acontece depois",
          items: [
            "A música aparece no Repertório com a etiqueta **Sugerida**, para todos da banda.",
            "Os admins da banda recebem um push: “Música sugerida · …”. Várias músicas sugeridas no mesmo minuto geram um único push.",
            "Quando um admin aprova, ela passa para **Aprendendo** e você recebe um push. Se for recusada, a música e os arquivos dela são apagados, e você recebe um push com o motivo do admin, se ele tiver dado um.",
          ],
        },
        {
          type: "p",
          text: "Os arquivos que você anexa a uma música sugerida ficam na sua pasta até um admin aceitar a música.",
        },
      ],
    },
    {
      id: "suggest-a-change-to-a-song",
      title: "Sugerir uma alteração numa música",
      summary: "Envie ao admin uma correção da letra ou dos acordes, ou uma nota para a banda toda.",
      roles: ["member"],
      kind: "task",
      keywords: ["correção", "corrigir letra", "corrigir acordes", "nota para a banda", "propor alteração"],
      related: ["my-song-suggestions", "review-song-suggestions", "my-notes-and-files"],
      body: [
        {
          type: "steps",
          items: [
            "No Repertório, toque na linha da música e em **Sugerir uma alteração**.",
            "Escolha **Letra ou cifras** ou **Nota para a banda**.",
            "Para letra ou cifras, mude o texto em **Letra com cifras**. Os acordes vão entre colchetes antes da palavra: [Am]palavra. A linha embaixo da caixa diz o que você mudou, por exemplo “Acordes alterados em 2 linhas”.",
            "Adicione uma **Mensagem para o admin (opcional)** se ajudar.",
            "Para uma nota, digite-a em **Nota para toda a banda**.",
            "Toque em **Enviar sugestão**. A janela diz **Enviada ao admin** e fecha.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "A música da banda continua igual para todos até o admin aceitar a sua sugestão.",
        },
        {
          type: "p",
          text: "Você também pode partir de uma das suas notas: abra-a e toque em **Sugerir à banda**. A nota é enviada com a linha em que estava.",
        },
        {
          type: "p",
          text: "Os admins recebem um push com o nome do tipo: “Correção da letra · …”, “Correção das cifras · …” ou “Nota para a banda · …”.",
        },
      ],
    },
    {
      id: "my-song-suggestions",
      title: "Acompanhar ou retirar as suas sugestões",
      summary: "Veja quais sugestões suas estão esperando, quais foram aceitas, e retire uma.",
      roles: ["member"],
      kind: "task",
      keywords: ["minhas sugestões", "retirar", "status da sugestão", "pendente"],
      related: ["suggest-a-song", "suggest-a-change-to-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "No Repertório, em **Músicas**, toque em **Minhas sugestões**. A linha diz quantas esperam o admin.",
            "**Pendentes** lista as que ainda estão abertas; **Revisadas** lista as outras com o resultado.",
            "Toque numa para vê-la. **Alterações**, **Antes** e **Depois** mostram a diferença; uma revisada mostra o motivo do admin, se ele tiver dado um.",
            "Para retirar uma sugestão pendente, toque em **Retirar a sugestão** e de novo em **Retirar a sugestão** para confirmar, ou em **Manter**.",
          ],
        },
        {
          type: "table",
          head: ["Etiqueta", "Significado"],
          rows: [
            ["**Pendentes**", "Ainda não revisada."],
            ["**Aceito**", "Aplicada como você enviou."],
            ["**Aceita com alterações**", "O admin aplicou com edições próprias."],
            ["**Não aceita**", "Recusada."],
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Retirar a sugestão de uma música nova apaga a música e os arquivos que você anexou. Os admins deixam de vê-la.",
        },
      ],
    },
    {
      id: "review-song-suggestions",
      title: "Revisar as sugestões dos membros",
      summary: "Aceite, aceite com alterações ou recuse o que os membros propõem, com um motivo opcional.",
      roles: ["admin"],
      kind: "task",
      keywords: ["revisar", "aprovar", "recusar", "sugestões dos membros", "moderar"],
      related: ["suggest-a-change-to-a-song", "suggest-a-song", "edit-or-delete-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "No Repertório, em **Músicas**, toque em **Sugestões dos membros** (mostra “… para revisar”). Você também pode tocar no push que recebeu.",
            "Em **Pendentes**, toque numa sugestão. Ela diz quem sugeriu e quando, com a mensagem da pessoa.",
            "Veja **Alterações** (linhas adicionadas e removidas), **Antes** e **Depois**. Para uma música nova, um resumo lista o que ela traz.",
            "Se quiser, escreva um **Motivo (opcional, … vai ver)**.",
            "Toque em **Aceitar**, **Aceitar com alterações** ou **Recusar**.",
          ],
        },
        {
          type: "table",
          head: ["Botão", "O que acontece"],
          rows: [
            ["**Aceitar**", "A alteração é aplicada à música da banda. Uma música nova passa para Aprendendo."],
            ["**Aceitar com alterações**", "Você edita o texto antes e toca em **Aceitar com estas alterações**. Para uma música nova, abre o formulário da música."],
            ["**Recusar**", "Nada muda. Uma música nova sugerida é apagada, com os arquivos dela."],
          ],
        },
        {
          type: "list",
          items: [
            "O membro recebe um push com o resultado e o seu motivo.",
            "Se a música mudou depois da sugestão, a tela avisa que você está comparando com a versão atual.",
            "Uma nota para a banda é adicionada às notas da música.",
            "Uma sugestão que inclui uma grade de acordes também substitui a grade da música.",
            "As sugestões revisadas ficam em **Revisadas**.",
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet", "duoBook", "duoLand"], text: "As sugestões abrem no segundo painel, ao lado do Repertório." }],
        },
        { type: "shot", id: "music-suggestions", caption: "Uma correção de letra com Alterações, Antes e Depois, e os botões de revisão." },
      ],
    },

    // ───────────────────────────── Setlists ─────────────────────────────
    {
      id: "build-a-setlist",
      title: "Montar uma setlist",
      summary: "Crie uma setlist no Repertório, adicione músicas da biblioteca, coloque-as em ordem e salve.",
      roles: ["admin"],
      kind: "task",
      keywords: ["nova setlist", "criar setlist", "set list", "ordem do show", "playlist"],
      related: ["setlists-and-sets", "attach-a-setlist-to-a-gig", "edit-a-gig-setlist", "music-notifications"],
      body: [
        {
          type: "steps",
          items: [
            "No Repertório, toque em **Setlists** e depois em **Nova setlist** (o botão + no canto superior direito). Sem nenhuma setlist ainda, você também pode tocar em **Criar 1ª setlist**.",
            "Digite um **Nome da setlist \\***, por exemplo Noite de jazz 1º set, e toque em **Criar setlist**.",
            "Toque na nova setlist na lista para abri-la.",
            "Toque em **Adicionar músicas…**. Busque com **Buscar na biblioteca…** ou toque num chip de gênero para filtrar. Toque numa música para adicioná-la; toque de novo para tirá-la. As músicas da setlist ficam destacadas.",
            "Toque em **Pronto** para fechar a biblioteca.",
            "Arraste uma música pela alça (**Arraste para reordenar**) para movê-la. Toque no X de uma linha para removê-la.",
            "Mude o **Nome da setlist** no alto se quiser.",
            "Toque em **Salvar setlist**.",
          ],
        },
        {
          type: "list",
          title: "O que o editor mostra",
          items: [
            "**Ordem da setlist (… músicas)** com a duração **Total**.",
            "Quando a setlist tem mais de um set, uma etiqueta por set com as músicas e o tempo dele, e uma etiqueta **Set 1**, **Set 2** na primeira música de cada set.",
            "Quantas músicas estão sem duração: adicione uma com Editar para ter um total exato.",
          ],
        },
        {
          type: "p",
          text: "Depois que você salva, os membros ativos da banda recebem um único push com o que mudou, por exemplo “Setlist atualizada · Rooftop set” e “Leo M.: 2 músicas movidas, 1 adicionada.” Uma mudança de nome também é mencionada.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Sair do editor com alterações não salvas pergunta “Salvar as alterações da setlist?”, com **Salvar alterações**, **Descartar** e **Continuar editando**.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Cria, edita, renomeia e exclui setlists." },
            { role: "member", text: "Abre as setlists só para leitura: a ordem, os sets e a duração, e **Exportar setlist em PDF**. Sem campo de nome, sem biblioteca, sem alças, sem Salvar." },
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet", "duoBook", "duoLand"], text: "A setlist abre no segundo painel, ao lado da lista de setlists." }],
        },
        { type: "shot", id: "music-setlist-editor", caption: "O editor de setlist com a biblioteca aberta e a ordem da setlist embaixo." },
      ],
    },
    {
      id: "setlists-and-sets",
      title: "Setlists, sets e modelos",
      summary: "Como as setlists, os sets dentro delas e as setlists modelo se relacionam com os shows.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["sets", "set 1", "set 2", "modelo", "setlist salva", "setlist do show"],
      related: ["build-a-setlist", "attach-a-setlist-to-a-gig", "edit-a-gig-setlist"],
      body: [
        { type: "p", text: "Uma setlist é uma lista ordenada de músicas da banda. Uma música aparece só uma vez numa setlist. Uma setlist pode ser dividida em sets (Set 1, Set 2…), por exemplo antes e depois de um intervalo." },
        {
          type: "list",
          items: [
            "Os sets são criados quando você prepara a setlist de um show: **Adicionar set** no formulário do show, ou **Novo set** ao adicionar músicas na visão geral do show.",
            "No editor de setlist do Repertório, você vê os sets e pode mover músicas entre eles arrastando-as pela divisa; uma música nova entra no último set. Os sets vazios somem quando você salva.",
            "As setlists marcadas como modelo mostram a etiqueta **Modelo** na lista. O formulário do show oferece as suas setlists salvas em **Carregar de modelos**.",
            "Quando você carrega uma setlist salva num show, o show ganha uma cópia própria, com o nome do show (por exemplo “Setlist de Rooftop Session”). Mudar depois a setlist do show não muda a setlist de origem.",
            "Toda setlist de show também aparece no Repertório, em **Setlists**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Edita setlists em todo lugar: no Repertório, no formulário do show, na visão geral do show e no Modo palco." },
            { role: "member", text: "Lê todas as setlists da banda. Só os admins editam setlists." },
          ],
        },
      ],
    },
    {
      id: "attach-a-setlist-to-a-gig",
      title: "Anexar uma setlist a um show",
      summary: "Adicione músicas ou uma setlist salva ao criar ou editar um show.",
      roles: ["admin"],
      kind: "task",
      keywords: ["atribuir setlist", "músicas do show", "carregar modelo", "adicionar set", "setlist do evento"],
      related: ["edit-a-gig-setlist", "setlists-and-sets", "create-a-gig"],
      body: [
        {
          type: "steps",
          items: [
            "Crie um show (veja [[create-a-gig]]). Para um show que você já tem, abra-o e use a seção **SETLIST** dele, que oferece os mesmos modelos e músicas.",
            "Abra a seção **Setlist e músicas**.",
            "Para começar de uma setlist salva, toque nela em **Carregar de modelos**. Quando já há músicas, **Modelos** mostra a lista de novo como **Substituir por um modelo**.",
            "Para adicionar músicas, toque em **Biblioteca** embaixo de um set, ou em **Manual** para digitar uma. **Adicionar músicas** adiciona a um set que você escolhe.",
            "Toque em **Adicionar set** para mais um set, dê um nome em **Nome do set...** ou toque em **Remover set**.",
            "Salve o show.",
          ],
        },
        {
          type: "p",
          text: "O show ganha uma setlist própria, com o nome do show. Quando você edita um show, a setlist dele é atualizada e a formação recebe um único push com o que mudou.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Se o show não tem setlist, a visão geral dele diz **SEM SETLIST**; os admins podem adicionar músicas ali mesmo (veja [[edit-a-gig-setlist]]).",
        },
      ],
    },
    {
      id: "edit-a-gig-setlist",
      title: "Editar a setlist de um show na visão geral",
      summary: "Reordene, adicione e remova músicas direto no show, sem abrir o formulário de edição.",
      roles: ["admin"],
      kind: "task",
      keywords: ["reordenar músicas", "visão geral do show", "escolher set", "qual set", "novo set", "arrastar músicas"],
      related: ["attach-a-setlist-to-a-gig", "music-notifications", "gig-workspace"],
      body: [
        {
          type: "steps",
          items: [
            "Abra um show futuro. A seção **SETLIST** da visão geral mostra as músicas.",
            "Para mover uma música, toque e segure e arraste-a. Com teclado, foque na alça e use as setas para cima e para baixo.",
            "Para remover uma música, toque no X dela (**Remover música**).",
            "Para adicionar músicas, toque em **Adicionar músicas**. Com mais de um set, **Em qual set?** pergunta onde; toque num set ou em **Novo set**.",
            "Em **Adicionar músicas**, marque as músicas (**Biblioteca**) e toque em **Adicionar … músicas**. As que já estão no set mostram **No set**. **Manual** cria uma música nova e a adiciona.",
            "Toque em **Salvar** na barra **Alterações não salvas**, ou em **Cancelar** para descartar as alterações.",
          ],
        },
        {
          type: "list",
          items: [
            "Nada é gravado até você tocar em **Salvar**. Aí a formação do show (todos que não recusaram) recebe um único push, por exemplo “Setlist atualizada · Rooftop Session” e “Leo M.: 1 música movida, 1 adicionada.”",
            "Um show ainda sem setlist ganha uma quando você salva, com o nome do show.",
            "Sair do show com alterações não salvas pergunta “Salvar as alterações da setlist?”.",
            "Tocar em **SETLIST** ou no número de músicas abre a lista completa numa janela, onde você pode editar do mesmo jeito.",
            "Orçamentos mostram a setlist aqui só para leitura. Num show passado, você a edita no painel (**SETLIST** ou o número de músicas); as músicas de um ensaio, com **EDITAR** ao lado de **MÚSICAS EM FOCO**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Edita a setlist na visão geral dos próximos shows da banda." },
            { role: "member", text: "Vê as músicas, os artistas e as durações só para leitura. Sem setlist, a janela diz “O admin da banda ainda não anexou uma setlist.”" },
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet"], text: "O espaço de trabalho do show tem uma aba **SETLIST** própria ao lado de **VISÃO GERAL**, **RIDER E PALCO** e **DINHEIRO**." }],
        },
      ],
    },
    {
      id: "export-a-setlist-pdf",
      title: "Exportar uma setlist em PDF",
      summary: "Gere um PDF de uma setlist para imprimir ou enviar.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["pdf", "imprimir setlist", "compartilhar setlist", "baixar"],
      related: ["build-a-setlist"],
      body: [
        {
          type: "steps",
          items: [
            "No Repertório, toque em **Setlists** e abra uma setlist.",
            "Toque em **Exportar setlist em PDF** (o botão de documento no canto superior direito).",
            "No celular, escolha para onde enviá-lo na janela de compartilhamento. Na web, o PDF é baixado.",
          ],
        },
        { type: "p", text: "O PDF traz o nome da banda, o nome da setlist e cada música com artista, tom, BPM, duração e set." },
        { type: "p", text: "O botão fica cinza enquanto a setlist estiver vazia." },
      ],
    },
    {
      id: "delete-a-setlist",
      title: "Excluir uma setlist",
      summary: "Remova uma setlist; as músicas ficam na biblioteca.",
      roles: ["admin"],
      kind: "task",
      keywords: ["remover setlist", "apagar setlist"],
      related: ["build-a-setlist"],
      body: [
        {
          type: "steps",
          items: [
            "No Repertório, toque em **Setlists** e abra a setlist.",
            "Toque em **Excluir setlist** (a lixeira vermelha no canto superior direito).",
            "Leia a confirmação: ela cita os próximos shows que ficam sem setlist.",
            "Toque em **Excluir** ou em **Cancelar**.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Os shows que usam a setlist ficam sem ela. As músicas continuam na sua biblioteca. Não dá para desfazer.",
        },
      ],
    },
    {
      id: "music-notifications",
      title: "Notificações sobre músicas e setlists",
      summary: "Quem é avisado do quê quando músicas, setlists e sugestões mudam.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["push", "notificação", "setlist atualizada", "música atualizada", "alerta"],
      related: ["build-a-setlist", "edit-a-gig-setlist", "review-song-suggestions", "notifications-inbox"],
      body: [
        {
          type: "table",
          head: ["Mudança", "Quem é avisado", "Como"],
          rows: [
            ["A setlist de um show salva (visão geral ou formulário do show)", "A formação do show, menos quem salvou", "Um push: “Setlist atualizada · <show>” com “2 músicas movidas, 1 adicionada”"],
            ["Uma setlist salva no Repertório", "Os membros ativos da banda, menos quem salvou", "Um push: “Setlist atualizada · <setlist>”, ou que ela foi renomeada"],
            ["Uma música editada (formulário ou editor de acordes)", "Os membros ativos da banda, menos quem salvou", "Um push: “Música atualizada · <música>” com os campos alterados"],
            ["Uma música adicionada por um admin", "O resto da banda", "Aviso na caixa, sem push"],
            ["Uma música ou alteração sugerida", "Os admins ativos da banda", "Push"],
            ["Uma sugestão revisada", "O membro que sugeriu", "Push, com o motivo"],
            ["Setlist reordenada no Modo palco", "A banda", "Aviso na caixa, sem push"],
          ],
        },
        { type: "p", text: "Os textos são escritos no idioma do app de cada pessoa." },
        {
          type: "p",
          text: "Um show aberto recarrega a setlist assim que um admin a muda, então os membros veem a nova ordem sem atualizar a tela.",
        },
      ],
    },
    {
      id: "music-what-members-can-do",
      title: "O que admins, membros e substitutos podem fazer com músicas e setlists",
      summary: "Uma tabela de quem pode ler e quem pode mudar o repertório, as setlists e o Modo palco.",
      roles: ["admin", "member", "deputy"],
      kind: "reference",
      keywords: ["permissões", "direitos do membro", "só admin", "só leitura", "privacidade"],
      related: ["repertoire-overview", "suggest-a-change-to-a-song", "stage-mode", "who-sees-what"],
      body: [
        {
          type: "table",
          head: ["Ação", "Admin", "Membro"],
          rows: [
            ["Ler todas as músicas, letras, acordes e arquivos", "Sim", "Sim"],
            ["Adicionar uma música à biblioteca", "Sim, como Pronta", "Sugere, como Sugerida"],
            ["Editar, transpor para a banda, editar acordes, excluir uma música", "Sim", "Não: sugere uma alteração"],
            ["Importar uma lista de músicas ou carregar 700+ músicas", "Sim", "Não"],
            ["Revisar sugestões", "Sim, todas as da banda", "Vê só as próprias"],
            ["Minhas notas e meus arquivos", "Só os próprios", "Só os próprios"],
            ["Ler setlists e exportá-las em PDF", "Sim", "Sim"],
            ["Criar, editar, reordenar, excluir setlists", "Sim", "Não"],
            ["Abrir o Modo palco num show futuro, ou o Modo ao vivo num ensaio futuro", "Sim, como líder", "Sim, seguindo o líder"],
            ["Mudar a música atual da banda, reordenar no palco, iniciar o clique da banda", "Sim", "Não: avança e usa o clique só no próprio celular"],
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Os admins não veem as notas nem os arquivos dos membros. Os membros veem só as próprias sugestões; os admins veem todas.",
        },
        {
          type: "roles",
          rows: [
            { role: "deputy", text: "Um substituto não é membro da banda: sem Repertório, sem setlists e sem Modo palco. Os shows como substituto mostram a data, os horários, o local, a função e o cachê oferecido." },
          ],
        },
      ],
    },

    // ───────────────────────────── Palco ─────────────────────────────
    {
      id: "stage-mode",
      title: "Modo palco",
      summary: "Uma tela ao vivo preta, fácil de ler de relance, com a setlist e a letra ou os acordes de cada música: no dia do show com o roteiro, num ensaio como Modo ao vivo.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["palco", "dia do show", "ao vivo", "roteiro", "go live", "modo apresentação", "ensaio", "modo ao vivo", "ensaio ao vivo", "só a música", "só a letra", "vista limpa"],
      related: ["lead-stage-mode", "follow-in-stage-mode", "stage-manager", "stage-click", "stage-bluetooth-sync", "stage-mode-on-devices"],
      body: [
        {
          type: "steps",
          title: "Abrir o Modo palco",
          items: [
            "Abra um show futuro da banda e toque no botão **Tocar** no canto superior direito (**Abrir modo palco**). No dia do show, ele fica destacado.",
            "Ou, na tela Início, toque em **Go live** embaixo do seu próximo show.",
            "Para sair, toque no X (**Sair do modo palco**).",
            "Num ensaio futuro da banda o mesmo botão é **Abrir modo ao vivo**. Ele abre o Modo ao vivo (abaixo); para sair, **Sair do modo ao vivo**.",
          ],
        },
        {
          type: "list",
          title: "O que tem na tela",
          items: [
            "**Modo palco · <date>**, o título do show, o local e a cidade.",
            "O roteiro: Montagem, Passagem de som, Show e Fim, no formato 24 horas. O próximo fica destacado como **A seguir · …**; os que já passaram ficam apagados.",
            "A **Setlist** com números, títulos, tom e duração. A música atual fica destacada. As músicas tiradas hoje aparecem riscadas, e o número acima da lista diz quantas são (**· 2 tirados**).",
            "Uma segunda aba com o nome da sua visualização (**Letra**, **Letra e acordes** ou **Grade de acordes**) mostra a música atual. Ela acompanha a música quando muda.",
            "**Anterior** e **Próximo** embaixo, com o botão do clique entre eles.",
          ],
        },
        {
          type: "list",
          title: "Na aba da música",
          items: [
            "Alterne entre **Letra**, **Letra e acordes** e **Grade de acordes**. A escolha é compartilhada com o leitor da música.",
            "Mude o tamanho do texto com − e +.",
            "Toque no botão de página ao lado de − e + (**Só a música**) para ler só a música, em tela cheia: sem título, abas, horários ou status. Embaixo ficam só **Mostrar tudo**, **Anterior**, o clique e **Próximo**; as setas e Page Up/Down também trocam de música, para pedais de virar página.",
            "**Mostrar tudo** ou Voltar traz de volta a tela ao vivo inteira. Ao sair do Modo palco, Só a música se desliga.",
            "Transponha só para você com − tom +. Só a sua tela muda.",
            "**Minhas notas** mostra as suas notas privadas sobre a versão da banda.",
            "O roteiro se esconde para dar mais espaço à música.",
            "Onde há espaço (um celular deitado, um iPad, um dispositivo de duas telas aberto sobre os dois painéis), a setlist fica numa coluna ao lado da música. Toque numa música ali para ir até ela.",
          ],
        },
        {
          type: "list",
          title: "Num ensaio: o Modo ao vivo",
          items: [
            "**Modo ao vivo · <data>** e o título do ensaio no topo.",
            "A setlist são as músicas em foco do ensaio, na ordem delas. Sem nenhuma escolhida, aparece “Nenhuma música escolhida para este ensaio ainda.”",
            "Letra, acordes, transposição, tamanho do texto, o clique e Minhas notas funcionam como num show.",
            "O admin guia e os membros seguem, pela internet e por Bluetooth, como num show. Qualquer pessoa no ensaio pode abrir.",
            "Sem roteiro (sem horários de montagem, passagem de som, show ou fim) e sem tirar músicas por hoje.",
          ],
        },
        { type: "shot", id: "music-song-only", caption: "Só a música: a música com os acordes, em tela cheia, com Mostrar tudo, Anterior, o clique e Próximo." },
        { type: "shot", id: "music-rehearsal-live", caption: "O Modo ao vivo num ensaio: as músicas em foco, os acordes da música atual e Anterior / Próxima, sem roteiro." },
        {
          type: "list",
          title: "O cronômetro do ensaio",
          items: [
            "O admin toca em **Começar o ensaio** no Modo ao vivo. O tempo corre para a banda toda: os membros veem, mas não controlam.",
            "**Pausar** para o tempo (um intervalo não conta) e **Retomar** continua. **Encerrar** pergunta antes: **Continuar** ou **Encerrar agora**.",
            "No fim, todos veem o **Resumo do ensaio**: o tempo ensaiado sem intervalos e as músicas tocadas (cada música na tela enquanto o tempo corria conta uma vez). O admin ainda pode **Retomar o ensaio**.",
            "A sessão é salva: fechar o Modo ao vivo ou reiniciar o app a mantém, e a página do ensaio a mostra em **SESSÃO DE ENSAIO**. Um ensaio recorrente tem uma sessão por data.",
            "Sem internet, o tempo do admin continua e é salvo quando voltar a ficar online. No Duo dobrado como um notebook, a tela no chão mostra o tempo e, para o admin, **Pausar** / **Retomar**.",
          ],
        },
        {
          type: "list",
          title: "Notas do ensaio",
          items: [
            "No modo ao vivo toque em **Marcar** quando algo precisar de trabalho: guarda a música que está tocando e o minuto, e vocês continuam tocando.",
            "Na pausa (ou no resumo) toque em **Para escrever** e em **Escrever** em cada marca: escolha no que trabalhar (**Andamento**, **Tom**, **Final**, **Solo**, **Revisar**, **Perfeito**, ou **Repetir uma seção** se a música tiver estrutura), escreva algumas palavras e diga **Para quem é**.",
            "Qualquer nota sobre uma música pode dizer **Onde na música**: uma seção e, se você quiser, uma das linhas dela (**Linha (opcional)**).",
            "No modo ao vivo, você também pode segurar uma linha da letra e tocar em **Nota para a banda**: a nota já abre nessa música, seção e linha.",
            "Admins escrevem para a banda toda ou para qualquer membro; membros, para a banda ou para si mesmos. A banda toda lê todas as notas.",
            "Quem recebe a nota toca em **Praticado** depois de trabalhar nela; um admin toca em **OK** quando a banda já tem (o autor também, numa nota para membros).",
            "A página do ensaio lista as notas em **NOTAS DO ENSAIO**, por música. As notas chegam na hora aos outros celulares no modo ao vivo; sem internet ficam no celular e vão quando a conexão voltar. No Duo dobrado como um notebook, a tela no chão tem um bloco de notas: **Marcar**, um preset com um toque, ou **Escrever…**.",
          ],
        },
        {
          type: "list",
          title: "Para praticar, e o próximo ensaio",
          items: [
            "O Início mostra **Para praticar**: as músicas com notas em aberto para ti ou para a banda, do ensaio mais recente. Toca em **Praticado** numa nota para ti; toca na música para abrir a sua página. No Duo dobrado como um portátil, as músicas estão nas **Pendências** da secretária.",
            "A página da música mostra **Dos ensaios** acima das tuas notas. Uma nota de **Tempo** ou **Tom** que indica o valor (por exemplo “Tempo: 96” ou “Tom: Bb”) tem um botão: os admins **Definir na música**, os membros **Sugerir à banda**.",
            "A página do próximo ensaio mostra **DA ÚLTIMA VEZ**: as notas em aberto de ensaios anteriores sobre as suas músicas. Os admins tocam em **OK** quando a banda já consegue. No Modo ao vivo, um selo em cada música abre as suas notas da última vez.",
            "Quando um admin cria um ensaio, **Das notas de ensaio em aberto** oferece as músicas com notas em aberto como músicas para trabalhar, um toque cada. Uma nova sondagem de ensaio já as escolhe; remove as que não precisas.",
            "Quando um ensaio termina, quem tem músicas para praticar recebe uma só notificação push com elas (“Para praticar: …”), no seu idioma; quem o terminou vê o resumo. **Notificações push** nos Ajustes desliga-a.",
          ],
        },
        {
          type: "list",
          title: "Bom saber",
          items: [
            "O Modo palco existe para os shows futuros da banda e, como Modo ao vivo, para os ensaios futuros da banda; não para orçamentos, eventos passados nem shows pessoais.",
            "A tela fica acesa enquanto o Modo palco está aberto.",
            "**Tela cheia** (o botão de quatro cantos no alto, na barra lateral em um dispositivo de tela dupla) esconde as barras do app, a barra lateral e a barra de status do celular, e mantém a tela ligada. **Sair da tela cheia** ou Voltar sai dela; a escolha fica salva no dispositivo.",
            "Sem setlist, ele diz “Nenhuma setlist vinculada a este show.”",
            "Nos apps de celular e tablet, a setlist com letras e cifras fica guardada no dispositivo quando você abre o show, então o Modo palco funciona sem internet. Sair da conta apaga essa cópia.",
            "Sem internet e sem cópia no dispositivo, ele diz “Offline: não foi possível carregar a setlist.” com **Tentar de novo**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Lidera: muda a música atual da banda, reordena a setlist segurando e arrastando uma música, tira músicas da noite e inicia o clique da banda. Veja [[lead-stage-mode]]." },
            { role: "member", text: "Segue o líder ou avança nas músicas sozinho. Veja [[follow-in-stage-mode]]." },
            { role: "deputy", text: "Sem Modo palco: os substitutos não têm as setlists da banda." },
          ],
        },
        { type: "shot", id: "music-stage", caption: "O Modo palco no dia do show: roteiro, setlist e Anterior / Próximo." },
      ],
    },
    {
      id: "lead-stage-mode",
      title: "Liderar a banda no Modo palco",
      summary: "Como admin, mude a música atual para todos, altere a ordem ao vivo e tire músicas que não vão ser tocadas.",
      roles: ["admin"],
      kind: "task",
      keywords: ["líder", "próxima música", "reordenar ao vivo", "arrastar", "riscar", "pular uma música", "tirar uma música hoje", "a banda segue", "sincronização ao vivo"],
      related: ["stage-mode", "follow-in-stage-mode", "stage-click", "stage-bluetooth-sync"],
      body: [
        {
          type: "steps",
          items: [
            "Abra o Modo palco no show.",
            "Confira o status ao lado da setlist: **Ao vivo** quer dizer que a banda segue você (**A banda segue você**).",
            "Toque em **Próximo** ou **Anterior** para levar a banda à música seguinte ou à anterior, ou toque em qualquer música da lista (**Ir para …**).",
            "Para mudar a ordem, segure uma música até ela levantar, arraste-a para o novo lugar e solte. Um deslize rápido continua rolando a lista, e um toque continua tornando a música atual.",
            "Para pular uma música hoje, toque no botão redondo − no fim da linha dela (**Tirar … hoje**). O título fica riscado e **Anterior** / **Próximo** passam por cima dela. Toque em + (**Voltar a pôr …**) para trazê-la de volta.",
          ],
        },
        {
          type: "table",
          head: ["Status", "Significado"],
          rows: [
            ["**Ao vivo**", "Conectado pela internet: os membros seguem você."],
            ["**Ao vivo · BT**", "Conectado pela internet e enviando também por Bluetooth."],
            ["**Bluetooth**", "Sem internet: os membros por perto seguem você por Bluetooth."],
            ["**Offline**", "Nada chega à banda neste momento."],
            ["**Salvando…**, **Salvo**, **Não salvo**", "Depois de arrastar: a nova ordem é salva logo depois do seu último movimento. **Salvo** aparece por um instante e depois o status volta."],
          ],
        },
        {
          type: "list",
          items: [
            "Os membros que abrem o Modo palco depois entram direto na música atual.",
            "Uma nova ordem vale para todos, inclusive os membros que pararam de seguir, e é salva na setlist do show. O show por trás do Modo palco a mostra na hora.",
            "Fechar o Modo palco salva um movimento que ainda esperava para ser salvo.",
            "Se vários admins lideram ao mesmo tempo, vale o movimento mais recente.",
            "Tirar uma música vale só para hoje: a setlist do show continua com ela. Os membros que seguem você a veem riscada e também a pulam, pela internet ou por Bluetooth. O seu celular lembra as músicas tiradas daquele show se você fechar e abrir o Modo palco de novo.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Mantenha o celular desbloqueado: o Modo palco deixa a tela acesa, e um celular de líder bloqueado para a sincronização da banda.",
        },
      ],
    },
    {
      id: "follow-in-stage-mode",
      title: "Seguir o líder no Modo palco",
      summary: "Como membro, deixe o celular do admin passar as suas músicas, ou avance nelas você mesmo.",
      roles: ["member"],
      kind: "task",
      keywords: ["seguir", "seguindo o líder", "sincronizar", "mesma música"],
      related: ["stage-mode", "lead-stage-mode", "stage-bluetooth-sync"],
      body: [
        {
          type: "steps",
          items: [
            "Abra o Modo palco no show. Seguir já vem ativado: o botão ao lado da setlist diz **Aguardando o líder** até o celular do admin ser encontrado, depois **Com o líder**.",
            "A sua música atual, a letra e os acordes mudam quando o admin avança.",
            "Para olhar adiante sozinho, toque em **Anterior**, **Próximo** ou numa música. Você deixa de seguir e o botão diz **Seguir o líder**.",
            "Toque em **Seguir o líder** para voltar à música do líder e seguir de novo.",
          ],
        },
        {
          type: "list",
          items: [
            "**· BT** depois do rótulo quer dizer que você está ligado ao líder por Bluetooth.",
            "**Offline** quer dizer que nada consegue chegar ao seu celular neste momento.",
            "Os membros não podem mudar a música de mais ninguém nem a ordem.",
          ],
        },
      ],
    },
    {
      id: "stage-click",
      title: "Usar o clique no Modo palco",
      summary: "Um metrônomo visual na borda da tela, no tempo em todos os celulares da banda.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["metrônomo", "clique", "contagem", "andamento", "bpm", "tempo"],
      related: ["stage-mode", "transpose-and-tempo"],
      body: [
        {
          type: "steps",
          items: [
            "No Modo palco, encontre o botão do clique entre **Anterior** e **Próximo**. Ele mostra o BPM da música atual.",
            "Toque nele (**Iniciar o clique**). Um brilho pisca na borda da tela a cada tempo, mais forte no primeiro tempo do compasso.",
            "Toque de novo (**Parar o clique**) para parar.",
          ],
        },
        {
          type: "table",
          head: ["Quem inicia", "O que acontece"],
          rows: [
            ["Admin", "O clique roda em todos os celulares no Modo palco, no tempo do celular do líder."],
            ["Membro", "O clique roda só no seu celular."],
            ["Membro, com o clique do líder rodando", "O botão esconde ou mostra o clique no seu celular (**Ocultar o clique neste celular**, **Mostrar o clique**)."],
          ],
        },
        {
          type: "list",
          items: [
            "O clique é só visual: não tem som. Ele não bloqueia os toques na tela.",
            "Os tempos do compasso vêm da fórmula de compasso da grade do iReal da música; se não houver, são 4.",
            "Uma música sem BPM não pode iniciar o clique (**Sem BPM para esta música**). Adicione o BPM no formulário da música.",
            "Passar para outra música esconde o clique da música anterior.",
            "Os celulares ficam no tempo com cerca de 20–40 ms de diferença: bom para uma contagem e como referência de andamento, não para um clique no ouvido.",
            "O clique da banda precisa de internet: ele não é enviado por Bluetooth.",
          ],
        },
      ],
    },
    {
      id: "stage-manager",
      title: "Tocar o áudio das músicas pela cabine",
      summary: "O notebook ou o tablet de um admin, ligado na mesa de som, toca a gravação de cada música, e as telas da banda passam para a música que está tocando.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["cabine", "playback", "backing track", "áudio", "mesa de som", "reprodução", "cabo", "usb-c", "entrada de fone", "adaptador", "pa"],
      related: ["stage-mode", "lead-stage-mode", "follow-in-stage-mode", "play-a-song-recording"],
      body: [
        {
          type: "p",
          text: "O notebook ou o tablet de um admin, ligado na mesa de som, é a cabine: o único aparelho que toca o áudio das músicas. Quando ele toca uma música, todas as telas no Modo palco passam para essa música, mesmo fora da ordem do setlist. Os celulares dos membros nunca tocam som.",
        },
        {
          type: "steps",
          title: "Antes do show",
          items: [
            "Dê a cada música uma **Gravação** (um arquivo de áudio) na ficha da música. Músicas sem gravação movem a banda do mesmo jeito, mas nada toca.",
            "Ligue o aparelho na mesa (veja as dicas de cabo abaixo) e ative o Não perturbe, para as notificações não saírem no PA.",
            "Abra o show com internet, abra o Modo palco e toque em **Cabine: áudio daqui**. O aparelho baixa o áudio da noite.",
            "Espere até **Áudio pronto** contar todas as músicas (por exemplo 10/10): a partir daí ele toca sem internet. Se ainda faltar alguma música, abra o show de novo com internet.",
          ],
        },
        {
          type: "steps",
          title: "No palco",
          items: [
            "Toque em ▶ numa música para tocá-la. A tela de todos passa para essa música e mostra **Tocando agora** com o tempo.",
            "O player no alto tem **Tocar** / **Pausar**; quando uma música acaba, o mesmo botão toca a próxima. **Parar** precisa ser mantido pressionado, assim um toque sem querer não corta a música.",
            "Para uma música que não está no setlist, toque em + (**Tocar uma música fora do setlist**) e escolha no repertório. Ela entra no setlist logo depois da música atual, para todos.",
            "Para passar a cabine, o outro admin toca em **Cabine: áudio daqui** no próprio aparelho e depois em **Assumir**: o seu áudio para. **Desativar** encerra a cabine no seu aparelho.",
          ],
        },
        {
          type: "table",
          head: ["Quem", "O que vê"],
          rows: [
            ["A cabine (um admin)", "O player, ▶ em cada música com áudio, por onde sai o som (**Saída**) e quantas músicas estão prontas."],
            ["Os outros admins e os membros", "A música que está tocando, com **Tocando agora** ou **Em pausa** e o tempo. Se você estiver em outra música, **Ir** leva você até ela."],
            ["Todos, quando a cabine sai", "A faixa some. O Modo palco funciona como antes."],
          ],
        },
        {
          type: "list",
          title: "O cabo para a mesa",
          items: [
            "Notebooks, iPads e celulares com entrada de fone: um cabo P2 (3,5 mm) na entrada da mesa, por exemplo de P2 para dois P10 (6,3 mm) ou para dois RCA.",
            "iPads e iPhones sem entrada de fone (USB-C ou Lightning): o adaptador da Apple de USB-C (ou Lightning) para 3,5 mm, e depois o mesmo cabo. Para carregar ao mesmo tempo, use um adaptador com porta USB-C de carga (PD).",
            "Mesas com entrada USB (muitas mesas digitais): um cabo USB-C leva o som direto para dentro. O mesmo vale para uma interface de áudio USB class compliant.",
            "Nunca Bluetooth: chega atrasado e pode falhar. O app avisa quando o som vai por Bluetooth ou sai pelo alto-falante do aparelho.",
            "Deixe o volume do aparelho quase no máximo e ajuste o nível na mesa.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Se o cabo se soltar, o som pode parar ou passar para o alto-falante do aparelho. O app mostra um aviso na hora: ligue o cabo de novo.",
        },
        {
          type: "devices",
          rows: [{ devices: ["web"], text: "Num notebook pelo navegador, quem guarda o áudio é o navegador: use sempre o mesmo e não apague os dados dele antes do show. Alguns links (por exemplo Google Drive) só tocam por streaming, então precisam de internet." }],
        },
      ],
    },
    {
      id: "stage-bluetooth-sync",
      title: "Modo palco sem internet (Bluetooth)",
      summary: "Como a banda continua na mesma música por Bluetooth quando o local não tem sinal.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["bluetooth", "offline", "sem sinal", "sem wifi", "ble", "chave do palco"],
      related: ["stage-mode", "lead-stage-mode", "follow-in-stage-mode"],
      body: [
        {
          type: "p",
          text: "Nos apps de iPhone, iPad e Android, o celular do admin também envia a música atual e a ordem por Bluetooth. Os celulares dos membros por perto recebem sem pareamento e sem internet.",
        },
        {
          type: "steps",
          title: "Prepare-se antes do show",
          items: [
            "Todos abrem o show uma vez enquanto estão online. O app guarda no celular a setlist (com letras e cifras) e a chave Bluetooth do show.",
            "Ative o Bluetooth e permita que o BandWith o use.",
            "No palco, todos abrem o Modo palco. O líder mostra **Bluetooth** ou **Ao vivo · BT**; os membros mostram **· BT** depois do rótulo de seguir.",
          ],
        },
        {
          type: "list",
          title: "Quando não conecta",
          items: [
            "“O Bluetooth está desligado ou sem permissão. Ative-o em Ajustes para continuar sincronizado sem internet.”",
            "“Este celular tem uma setlist antiga. Conecte-se à internet uma vez para seguir por Bluetooth.” Isso aparece quando foram adicionadas ou removidas músicas depois que o celular carregou a setlist pela última vez. Só uma nova ordem não é problema.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Cada show tem a sua chave secreta, entregue só aos membros ativos da banda. Só os celulares com a chave encontram o líder e aceitam as mensagens dele.",
        },
        {
          type: "devices",
          rows: [{ devices: ["web"], text: "Sem sincronização por Bluetooth e sem cópia da setlist no dispositivo: na web, o Modo palco precisa de internet." }],
        },
      ],
    },
    {
      id: "stage-mode-on-devices",
      title: "Modo palco em celulares, tablets e dispositivos de duas telas",
      summary: "Como o Modo palco se organiza em cada dispositivo e posição.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["horizontal", "ipad", "surface duo", "retorno de chão", "posição laptop", "tela cheia", "barra lateral", "virador de página"],
      related: ["stage-mode", "device-differences"],
      body: [
        {
          type: "devices",
          rows: [
            { devices: ["phone"], text: "Uma coluna: cabeçalho, roteiro, setlist ou música, Anterior / Próximo embaixo." },
            { devices: ["phoneLand", "duoClosed"], text: "Deitado (baixo e largo), os horários e as etapas ficam à esquerda e a setlist ou a música à direita. Com uma música aberta, a coluna da esquerda mostra a setlist, para você pular para qualquer música." },
            { devices: ["tablet", "duoBook", "duoLand"], text: "O Modo palco abre ao lado do painel da lista. **Tela cheia** dá a tela inteira a ele: aí os horários e as etapas ficam no primeiro painel e a setlist ou a música no segundo, divididos na borda dos painéis para nada ficar na dobra. Com uma música aberta, a setlist fica numa coluna ao lado (no primeiro painel quando o dispositivo está aberto sobre os dois). **Sair da tela cheia** traz a lista de volta. A escolha fica guardada no dispositivo." },
            { devices: ["duoClosed"], text: "**Abrir modo palco** fica na barra lateral; no dia do show, é a ação principal dela. **Tela cheia** esconde a barra no Modo palco." },
            { devices: ["duoLaptop"], text: "Retorno de chão: apoie o dispositivo no chão do palco como um monitor. A metade de cima mostra o contador de músicas (**Música … de …**), o título, o tom, o BPM, a próxima música e o tempo decorrido, ou a letra. A metade de baixo tem botões grandes **Anterior** e **Próximo** e o progresso do set; as músicas tiradas hoje são puladas e os segmentos delas ficam apagados. As setas, Page Up/Down e a barra de espaço também avançam, então pedais Bluetooth de virar página funcionam." },
            { devices: ["duoBook", "duoLaptop"], text: "**Só a música**: num dispositivo aberto sobre as duas telas, a música e os seus quatro botões ficam na tela mais larga, para nada cair na dobra. Dobrado como um notebook, a música preenche a metade de cima e a metade de baixo tem só **Mostrar tudo**, **Anterior**, o clique e **Próximo**." },
            { devices: ["web"], text: "A sincronização ao vivo pela internet e o clique funcionam. Sem Bluetooth e sem cópia offline da setlist. A tela cheia também esconde as barras do navegador, onde o navegador permite." },
          ],
        },
        { type: "p", text: "O Voltar do Android e o Esc saem primeiro do Modo palco, não do show que está por baixo." },
      ],
    },
  ],

  faq: [
    {
      q: "Os membros podem editar músicas ou setlists?",
      a: "Não. Os membros leem todas as músicas e setlists. Eles sugerem músicas novas e alterações na letra, nos acordes ou nas notas, e um admin revisa. Só os admins editam setlists.",
      roles: ["member"],
    },
    {
      q: "Quem vê as minhas notas numa música?",
      a: "Só você. Nem a banda, nem os admins. Para compartilhar uma, abra-a e toque em Sugerir à banda.",
    },
    {
      q: "Transpus uma música no leitor. Mudou para todos?",
      a: "Não. Transpor no leitor ou no Modo palco muda só a sua tela. Para mudar o tom para a banda, um admin usa Transpor para a banda no formulário da música.",
    },
    {
      q: "Por que não consigo importar uma lista de músicas?",
      a: "Importar uma lista vai direto para a biblioteca da banda, então é só para admins. Os membros sugerem músicas uma por uma.",
      roles: ["member"],
    },
    {
      q: "Mudar a setlist de um show muda a setlist salva de onde eu a carreguei?",
      a: "Não. O show ganha uma cópia própria, com o nome do show. A setlist de origem fica como estava.",
      roles: ["admin"],
    },
    {
      q: "A banda recebe uma notificação para cada música que eu movo?",
      a: "Não. Nada é enviado até você salvar. Aí cada pessoa recebe um único push resumindo o que mudou.",
      roles: ["admin"],
    },
    {
      q: "O Modo palco funciona sem internet?",
      a: "Nos apps de celular e tablet, sim: abra o show uma vez enquanto estiver online, e o celular do líder mantém a banda sincronizada por Bluetooth. Na web, o Modo palco precisa de internet.",
    },
    {
      q: "Dá para ouvir o clique?",
      a: "Não. O clique é visual: um brilho na borda da tela a cada tempo.",
    },
    {
      q: "Por que o meu celular para de seguir o líder?",
      a: "Tocar você mesmo em Anterior, Próximo ou numa música faz você parar de seguir. Toque em Seguir o líder para voltar à música do líder.",
      roles: ["member"],
    },
    {
      q: "O que acontece com uma música sugerida que o admin recusa?",
      a: "Ela é apagada com os arquivos que você anexou, e você recebe um push com o motivo do admin, se ele tiver dado um.",
      roles: ["member"],
    },
    {
      q: "Por que não vejo o fórum do iReal Pro dentro do app na web?",
      a: "O fórum não pode ser mostrado dentro de uma página web, então abre numa janela própria. Copie um link ali e toque em Colar link, ou arraste o link para a caixa.",
    },
  ],

  glossary: [
    { term: "Repertório", definition: "A biblioteca de músicas da banda. Todos os membros ativos leem todas as músicas.", see: "repertoire-overview" },
    { term: "Pronta / Aprendendo / Sugerida", definition: "O status de uma música: tocada pela banda, em aprendizado, ou proposta por um membro e à espera de um admin.", see: "song-menu-actions" },
    { term: "Setlist", definition: "Uma lista ordenada de músicas da banda para um show ou uma ocasião, feita pelos admins.", see: "build-a-setlist" },
    { term: "Set", definition: "Uma parte de uma setlist, por exemplo antes e depois de um intervalo (Set 1, Set 2).", see: "setlists-and-sets" },
    { term: "Setlist modelo", definition: "Uma setlist salva que você carrega num show; o show ganha uma cópia própria.", see: "setlists-and-sets" },
    { term: "Acordes no texto", definition: "Acordes escritos entre colchetes logo antes da palavra em que caem, como [Am]palavra.", see: "lyrics-and-chords-format" },
    { term: "ChordPro", definition: "Um formato de texto para letras com acordes entre colchetes. O BandWith importa arquivos .cho, .chordpro e .pro.", see: "import-chords-and-lyrics" },
    { term: "MusicXML", definition: "Um formato de arquivo para partituras. O BandWith lê as cifras e a letra dele.", see: "import-chords-and-lyrics" },
    { term: "Grade do iReal Pro", definition: "Uma grade de acordes compasso por compasso, com forma, tom, estilo e andamento, importada de um link do iReal Pro.", see: "import-from-ireal-pro" },
    { term: "Visualização da música", definition: "Como uma música é mostrada: Letra, Letra e acordes ou Grade de acordes. Lembrada por dispositivo.", see: "read-a-song" },
    { term: "Grade de acordes", definition: "Só os acordes: as seções da música com os acordes em caixas, ou a grade do iReal compasso por compasso.", see: "read-a-song" },
    { term: "Só a música", definition: "O Modo palco e o Modo ao vivo com só a música na tela, em tela cheia, e Anterior, o clique e Próximo embaixo.", see: "stage-mode" },
    { term: "Transpor para a banda", definition: "Mudar o tom, a grade e os acordes de uma música para todos, pelo formulário da música.", see: "transpose-and-tempo" },
    { term: "Minhas notas", definition: "Notas e arquivos privados numa música da banda, visíveis só para você.", see: "my-notes-and-files" },
    { term: "Sugestão", definition: "A proposta de um membro: uma música nova, uma correção de letra ou de acordes, ou uma nota para a banda.", see: "review-song-suggestions" },
    { term: "Modo palco", definition: "A tela preta do dia do show com o roteiro, a setlist e a música atual.", see: "stage-mode" },
    { term: "Líder", definition: "No Modo palco, o admin da banda cujas mudanças de música e de ordem chegam a todos os membros.", see: "lead-stage-mode" },
    { term: "Seguir o líder", definition: "A opção do Modo palco de um membro que mantém a música atual dele igual à do líder.", see: "follow-in-stage-mode" },
    { term: "Clique", definition: "O metrônomo visual do Modo palco: um brilho a cada tempo, sincronizado entre os celulares.", see: "stage-click" },
    { term: "Roteiro", definition: "Os horários de Montagem, Passagem de som, Show e Fim no alto do Modo palco.", see: "stage-mode" },
    { term: "Retorno de chão", definition: "O Modo palco num dispositivo de duas telas na posição laptop: dados da música em cima, botões grandes Anterior / Próximo embaixo.", see: "stage-mode-on-devices" },
  ],
};

export default music;
