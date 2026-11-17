import type { AreaText } from '../../types';

const together: AreaText = {
  area: {
    id: "together",
    title: "Prove, sondaggi e chat",
    intro: "Fissa le prove, trova una data che vada bene a tutta la band e parlatevi nelle chat della band, degli eventi e private.",
    icon: "chat",
  },

  articles: [
    // ───────────────────────────── Rehearsals ─────────────────────────────
    {
      id: "create-a-rehearsal",
      title: "Crea una prova",
      summary: "Fissa direttamente una prova: chi viene, quando, dove, quanto costa e su cosa lavorare.",
      roles: ["admin"],
      kind: "task",
      keywords: ["nuova prova", "fissare una prova", "provare", "prove della band", "sessione", "sala prove"],
      related: ["rehearsal-songs-and-prep-tasks", "create-a-rehearsal-poll", "propose-a-rehearsal", "recurring-rehearsals", "rehearsal-drafts"],
      body: [
        {
          type: "p",
          text: "Gli admin fissano direttamente una prova quando sanno già la data. Se prima vuoi scoprire quando sono liberi tutti, fai invece un sondaggio sulle disponibilità: vedi [[create-a-rehearsal-poll]].",
        },
        {
          type: "steps",
          title: "Su un telefono",
          items: [
            "Tocca **Crea** (il pulsante + nella barra in basso) e scegli **Nuova prova**. Puoi anche aprire il **Calendario**, toccare un giorno vuoto e scegliere **Prova**.",
            "Lascia **Modalità di programmazione** su **Programma ora**.",
            "Se vuoi, scrivi un **Titolo della prova (facoltativo)**. Senza titolo, la prova prende il nome dal tipo di sessione, per esempio “Prova · Band al completo”.",
            "Scegli un **Tipo di sessione**: **Band al completo**, **Voci**, **Ritmica**, **Acustica** o **Altro**. Voci, Ritmica e Acustica preselezionano i membri con lo strumento corrispondente; Altro apre l’organico completo.",
            "Controlla l’**Organico**. Tocca un membro per aggiungerlo o toglierlo, oppure tocca **Seleziona tutti**. Tocca **Avanti**.",
            "In **Cerca locale o sala…** scrivi il luogo, oppure tocca una scelta rapida come **Sede della band**, **Studio A**, **Home studio** o **Da def.**.",
            "Imposta **Data della prova**, **Inizio** e **Fine**.",
            "Scegli una **Ricorrenza**: **Una volta**, **Ogni sett.**, **Ogni 15 gg** o **Mensile**.",
            "In **Costo del locale** scegli **Gratis** o **Pagato**. Per una sala a pagamento, inserisci il **Costo totale sala**: la scheda mostra l’importo **A persona**. Tocca **Avanti**.",
            "In **RIEPILOGO E CONFERMA**, controlla il riepilogo. Tocca **Sessione e organico** o **Data e sala** per tornare indietro e cambiare qualcosa.",
            "Se vuoi, aggiungi brani e compiti di preparazione (vedi [[rehearsal-songs-and-prep-tasks]]).",
            "Tocca **Crea prova**.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "**Avanti** al secondo passaggio resta disattivato finché la prova non ha un luogo e una data. Scegli **Da def.** se non hai ancora prenotato una sala.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Senza connessione la prova resta sul tuo dispositivo (“Salvato offline • Si sincronizza appena connesso”) e viene inviata quando torni online.",
        },
        {
          type: "p",
          text: "Ogni membro dell’organico riceve una notifica “Nuova prova” e una push, e la prova compare nel suo calendario con una scheda **Ci sarai?** (vedi [[answer-a-rehearsal-invite]]). Tu risulti presente, a meno che non ti sia tolto dall’organico: la prova la gestisci comunque.",
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["tablet"],
              text: "Su un iPad la procedura è un’unica schermata con quattro schede: **Sessione**, **Data e ora**, **Luogo e costo** e **Obiettivi, nota e compiti**, più un’**Anteprima live** “Come la vede la band”. La striscia delle date mostra i **Prossimi 7 giorni** con quanti membri sono liberi ogni giorno **Dai calendari della band**. Puoi anche scrivere un **Obiettivo / note (facoltativo)** per la band. Tocca **Pianifica prova** quando il contatore delle schede è completo.",
            },
            {
              devices: ["duoClosed", "duoBook", "duoLaptop", "duoLand"],
              text: "Su iPhone Duo si usa la procedura del telefono. I comandi per chiudere e tornare indietro passano nella barra laterale quando è visibile.",
            },
          ],
        },
        { type: "shot", id: "shot-rehearsal-wizard", caption: "La procedura della prova, passo 1: tipo di sessione e organico." },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Crea, modifica ed elimina le prove." },
            { role: "member", text: "Non può creare una prova. Lo stesso menu **Crea** mostra invece **Proponi prova**: vedi [[propose-a-rehearsal]]." },
            { role: "deputy", text: "I sostituti non sono membri della band e non vedono mai la procedura delle prove." },
          ],
        },
      ],
    },
    {
      id: "rehearsal-songs-and-prep-tasks",
      title: "Aggiungi brani e compiti di preparazione a una prova",
      summary: "Scegli i brani su cui lavorare e le cose da preparare prima della prova.",
      roles: ["admin"],
      kind: "task",
      keywords: ["brani da provare", "scaletta della prova", "compiti", "cose da fare", "preparare", "portare"],
      related: ["create-a-rehearsal", "edit-a-rehearsal", "the-rehearsal-page", "todo-and-task-templates"],
      body: [
        {
          type: "p",
          text: "Brani e compiti si aggiungono all’ultimo passaggio della procedura (**RIEPILOGO E CONFERMA**) o più tardi da [[edit-a-rehearsal]]. I brani diventano la scaletta della prova, che i membri vedono come **BRANI DA PROVARE** nella pagina della prova.",
        },
        {
          type: "steps",
          title: "Brani",
          items: [
            "Nella scheda **Scaletta**, tocca **Aggiungi brani** e scegli i brani dal tuo repertorio.",
            "Oppure tocca **Modello di scaletta** per partire da una delle scalette salvate della band. Nell’editor della scaletta puoi cercare nella libreria, aggiungere un brano a mano (**Manuale**: **Titolo del brano \\*** e **Artista**), poi tocca **Fatto**.",
            "Per togliere un brano, tocca la X accanto a lui sotto **Brani selezionati**.",
          ],
        },
        {
          type: "steps",
          title: "Compiti di preparazione",
          items: [
            "Nella scheda **Preparazione**, tocca un suggerimento di **Aggiunta rapida** come **Porta gli accordi** o **Registra l’audio**.",
            "Oppure scrivi un tuo compito in **Nuova attività** e tocca **Aggiungi**.",
            "Togli un compito con la X accanto a lui sotto **Attività della band**.",
          ],
        },
        {
          type: "p",
          text: "In una prova già fissata, **MODIFICA** accanto ad **ATTIVITÀ** apre **Attività**, con **Aggiungi** e, finché non ce ne sono, **Carica una lista di attività**, che aggiunge tutte le attività di una checklist salvata. Vedi [[todo-and-task-templates]].",
        },
        {
          type: "note",
          tone: "privacy",
          text: "Solo gli admin scelgono e cambiano la scaletta della prova. I membri possono aprirla da **BRANI DA PROVARE** ma non modificarla.",
        },
      ],
    },
    {
      id: "edit-a-rehearsal",
      title: "Modifica una prova",
      summary: "Cambia data, orari, sala, organico, costo, brani da provare, note o attività di una prova già fissata, direttamente nella sua pagina.",
      roles: ["admin"],
      kind: "task",
      keywords: ["cambiare prova", "spostare prova", "riprogrammare", "aggiornare prova"],
      related: ["create-a-rehearsal", "delete-a-rehearsal", "rehearsal-and-chat-notifications"],
      body: [
        {
          type: "steps",
          items: [
            "Apri la prova dal **Calendario** o dalla Home.",
            "Tocca quello che vuoi cambiare: la matita in alto o i riquadri **INIZIO** e **FINE**, il riquadro **SALA**, o **MODIFICA** accanto a **PRESENZE**, **BRANI DA PROVARE**, **NOTE**, **ATTIVITÀ** o **COSTO SALA**.",
            "Si apre un foglio con solo quella parte. **Titolo, data e orari** ha anche **Ricorrenza**; **Organico** ha **Seleziona tutti**.",
            "Tocca **Salva**. Resta disattivato finché non cambi qualcosa.",
          ],
        },
        {
          type: "p",
          text: "Chiudere il foglio con **Annulla**, ✕, Indietro o uno swipe verso il basso lascia la prova com’era. Se hai cambiato qualcosa, prima chiede **Salvare le modifiche?**: **Salva modifiche**, **Scarta** o **Continua a modificare**. Aprire un’altra parte della prova chiede lo stesso. I brani da provare si salvano con **Salva** nel foglio della scaletta.",
        },
        {
          type: "list",
          title: "Chi viene avvisato",
          items: [
            "Una nuova data, nuovi orari o un nuovo luogo mandano a chi partecipa alla prova una notifica e una push “Prova aggiornata”.",
            "I membri che aggiungi all’organico ricevono l’invito “Nuova prova”.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Le prove passate si modificano allo stesso modo, anche su iPad. I membri vedono la pagina senza matite e senza **MODIFICA**.",
        },
      ],
    },
    {
      id: "delete-a-rehearsal",
      title: "Elimina (annulla) una prova",
      summary: "Togli una prova dal calendario; tutti i partecipanti vengono avvisati.",
      roles: ["admin"],
      kind: "task",
      keywords: ["annullare prova", "eliminare prova", "cancellare prova"],
      related: ["edit-a-rehearsal", "recurring-rehearsals"],
      body: [
        {
          type: "steps",
          items: [
            "Apri la prova.",
            "Tocca **ELIMINA** sotto **CHAT PROVA**.",
            "Tocca **Sì, elimina**, oppure **ANNULLA** per tenerla.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "L’eliminazione non si può annullare. Una prova ricorrente è un unico evento, quindi eliminandola si tolgono tutte le date della serie.",
        },
        {
          type: "p",
          text: "I membri della prova ricevono una notifica e una push “Prova annullata”. Se la aprono da una vecchia notifica, vedono **Prova annullata** e un avviso che un admin l’ha eliminata.",
        },
      ],
    },
    {
      id: "rehearsal-drafts",
      title: "Salva una prova come bozza",
      summary: "Lascia la procedura a metà e completa la prova più tardi.",
      roles: ["admin"],
      kind: "task",
      keywords: ["bozza", "non finita", "salvare per dopo"],
      related: ["create-a-rehearsal"],
      body: [
        {
          type: "steps",
          items: [
            "Nella procedura, dopo aver scritto qualcosa, tocca **Annulla** o il pulsante di chiusura.",
            "In **Salvare questa prova come bozza?**, tocca **Salva bozza**. **Scarta** la butta via, **Continua a modificare** torna indietro.",
            "Per completarla, apri la bozza da Bozze nella schermata Home, oppure dal suo giorno nel calendario.",
            "Per buttare via una bozza che hai riaperto, chiudi la procedura e tocca **Elimina bozza**.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Le tue bozze le vedi solo tu. I membri non ricevono nulla finché non crei la prova.",
        },
        {
          type: "p",
          text: "Se il salvataggio non riesce, la procedura resta aperta e la prova viene conservata anche come bozza, così non perdi nulla di quello che hai scritto.",
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet"], text: "Su iPad il composer a schermata unica ha il suo pulsante per salvare la bozza nell’intestazione." }],
        },
      ],
    },
    {
      id: "recurring-rehearsals",
      title: "Prove ricorrenti",
      summary: "Come compaiono e come funzionano le prove settimanali, quindicinali e mensili.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["prova settimanale", "ripetere", "ogni settimana", "serie", "ogni due settimane", "mensile"],
      related: ["create-a-rehearsal", "delete-a-rehearsal", "answer-a-rehearsal-invite"],
      body: [
        {
          type: "p",
          text: "Quando imposti una **Ricorrenza** diversa da **Una volta**, BandWith salva un’unica prova con una regola di ripetizione. Le prossime date compaiono in calendario per circa quattro mesi, fino a 24 date.",
        },
        {
          type: "table",
          head: ["Ricorrenza", "Cosa mostra la prova"],
          rows: [
            ["Una volta", "UNA VOLTA"],
            ["Ogni settimana", "OGNI {day}, per esempio OGNI MARTEDÌ"],
            ["Ogni due settimane", "{day} A SETTIMANE ALTERNE"],
            ["Mensile", "MENSILE"],
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Tutte le date di una serie condividono la stessa prova: un organico, una risposta per membro, una scaletta. Modificandola o eliminandola cambiano tutte le date.",
        },
      ],
    },
    {
      id: "the-rehearsal-page",
      title: "La pagina della prova",
      summary: "Cosa mostra una prova agli admin e ai membri.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["dettaglio prova", "presenze", "costo sala", "brani da provare", "modalità live"],
      related: ["answer-a-rehearsal-invite", "edit-a-rehearsal", "event-and-rehearsal-chats", "rehearsal-songs-and-prep-tasks", "stage-mode"],
      body: [
        {
          type: "p",
          text: "Apri una prova dal **Calendario** o dalla Home. La sua pagina è blu, il colore delle prove, e ha queste parti:",
        },
        {
          type: "list",
          items: [
            "**Ci sarai?**: la scheda per rispondere, per i membri invitati (vedi [[answer-a-rehearsal-invite]]).",
            "**Apri modalità live**, il pulsante play in alto a destra (nella barra laterale su un dispositivo a doppio schermo), sulle prove in programma: i brani da provare con testo, accordi e click, con l’admin che guida. Vedi [[stage-mode]].",
            "Riquadri degli orari: **INIZIO**, **FINE** e **SALA**.",
            "**PRESENZE**: chi è invitato e cosa ha risposto.",
            "**BRANI DA PROVARE**: fino a otto brani, con **+ ALTRI {count}** e **SCALETTA** per vedere l’elenco completo.",
            "**NOTE**: la nota della prova, quando c’è.",
            "**ATTIVITÀ**: i compiti di preparazione e quanti sono fatti. Tocca un compito per spuntarlo.",
            "**COSTO SALA**: la sala, le ore, il totale e **Diviso tra {count} presenti**, con l’importo **A TESTA**.",
            "Pulsanti in fondo: **CHAT PROVA** ed **ELIMINA** per gli admin, che cambiano tutto il resto con **MODIFICA** su ogni parte; **CHAT PROVA** per i membri che hanno risposto ci sono.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Vede tutto quello che c’è sopra, compreso il **COSTO SALA**, e può modificare o eliminare la prova." },
            { role: "member", text: "Vede la prova solo se l’admin l’ha messo nell’organico. Vede orari, sala, presenze, brani da provare, note e compiti. La sezione del costo della sala non viene mostrata ai membri. Per ritirarsi c’è il menu **Altre opzioni**." },
            { role: "deputy", text: "Ai sostituti si chiedono gig, non prove, e non vedono le prove della band." },
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Il costo totale della sala riguarda i soldi della band e resta agli admin. Durante un sondaggio, i membri vedono solo la propria quota (“12 € a testa”).",
        },
      ],
    },
    {
      id: "answer-a-rehearsal-invite",
      title: "Rispondi all’invito a una prova o ritirati",
      summary: "Di’ all’admin se ci sarai, cambia la tua risposta o ritirati più tardi.",
      roles: ["member"],
      kind: "task",
      keywords: ["rsvp", "risposta", "ci sono", "non posso", "rifiutare prova", "ritirarsi"],
      related: ["the-rehearsal-page", "rehearsal-and-chat-notifications"],
      body: [
        {
          type: "steps",
          title: "Rispondere",
          items: [
            "Apri la prova dalla notifica “Nuova prova” o dal **Calendario**.",
            "Nella scheda **Ci sarai?**, tocca **CI SONO** o **NON POSSO**. La scheda dice entro quando rispondere (“Rispondi entro … così l’admin può confermare la sala.”).",
            "Per cambiarla più tardi, tocca **Cambia** sulla scheda **La tua risposta** e scegli di nuovo.",
            "Se prima avevi risposto forse, la scheda dice “La tua risposta era Forse. Scegli CI SONO o NON POSSO.”: scegline una.",
          ],
        },
        {
          type: "steps",
          title: "Ritirarsi",
          items: [
            "Apri la prova e tocca **Altre opzioni** (il pulsante … in alto).",
            "In **Opzioni prova**, tocca **Ritirati da questa prova**.",
            "Conferma con **MI RITIRO**. L’admin viene avvisato.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Dopo aver risposto **NON POSSO** o esserti ritirato, la prova sparisce dal tuo calendario. Chiedi a un admin se vuoi essere aggiunto di nuovo.",
        },
        {
          type: "devices",
          rows: [{ devices: ["duoClosed", "duoBook", "duoLand"], text: "Su iPhone Duo, **Altre opzioni** si trova nella barra laterale con le altre azioni dell’intestazione." }],
        },
      ],
    },
    {
      id: "propose-a-rehearsal",
      title: "Proponi una prova (membri)",
      summary: "Chiedi all’admin una prova su un argomento, con i giorni che ti vanno bene.",
      roles: ["member"],
      kind: "task",
      keywords: ["richiedere prova", "suggerire prova", "proposta del membro", "chiedere una prova"],
      related: ["handle-a-rehearsal-proposal", "rehearsal-polls-explained"],
      body: [
        {
          type: "steps",
          items: [
            "Tocca **Crea** (il + nella barra in basso) e scegli **Proponi prova**. Con il **Calendario** vuoto puoi anche toccare **Proponi prova**.",
            "Se fai parte di più band, scegli la band in **Scegli la band**.",
            "Scrivi un **Argomento**, per esempio “Provare i passaggi della nuova scaletta”. È obbligatorio.",
            "Se vuoi, tocca i **Giorni preferiti (facoltativo)** che ti vanno bene.",
            "Se vuoi, aggiungi **Note o brani (facoltativo)**.",
            "Tocca **Invia all’admin**.",
          ],
        },
        {
          type: "p",
          text: "Gli admin della band ricevono una notifica e una push “Nuova proposta di prova”. Nella tua Home e nel **Calendario** la proposta compare come **La tua proposta di prova** con **Attesa admin** e **Aperta fino a** il suo ultimo giorno: l’ultimo dei tuoi giorni preferiti nella settimana successiva, oppure 7 giorni se non ne hai scelti. Resta lì finché un admin non la trasforma in un sondaggio o la rifiuta, o finché quel giorno non passa: poi esce da tutti gli elenchi.",
        },
        {
          type: "note",
          tone: "warning",
          text: "Puoi inviare una proposta ogni 7 giorni per band. Quando l’hai usata, la schermata mostra **Limite settimanale raggiunto** e la data della **Prossima proposta disponibile**. Il limite viene controllato anche dal server.",
        },
        {
          type: "list",
          title: "Casi particolari",
          items: [
            "Non sei ancora in una band: vedi **Serve una band**, con **Crea una band**.",
            "Se un admin rifiuta la tua proposta, ricevi “Proposta di prova rifiutata” (notifica e push), con il motivo se l’ha indicato, e la proposta esce dal tuo elenco.",
            "Hai cambiato idea? Tocca **Ritira** sulla tua proposta, poi di nuovo **Ritira** in “Ritirare la tua proposta?”. Gli admin non la vedono più.",
          ],
        },
        { type: "roles", rows: [{ role: "admin", text: "Gli admin non propongono: creano direttamente la prova o un sondaggio. Vedi [[create-a-rehearsal]]." }] },
      ],
    },
    {
      id: "handle-a-rehearsal-proposal",
      title: "Gestisci la proposta di prova di un membro",
      summary: "Trasforma la proposta di un membro in un sondaggio sulle disponibilità, oppure rifiutala.",
      roles: ["admin"],
      kind: "task",
      keywords: ["proposta", "creare sondaggio", "rifiutare proposta", "ignorare proposta", "richiesta del membro"],
      related: ["propose-a-rehearsal", "create-a-rehearsal-poll"],
      body: [
        {
          type: "steps",
          items: [
            "Trova la proposta sotto **Organizzazione prove** in Da gestire nella Home o nel **Calendario**. Mostra **Proposta di prova di un membro**, **Proposta da**, i **Giorni preferiti** e la nota. Puoi aprirla anche dalla notifica “Nuova proposta di prova”.",
            "Tocca **Crea sondaggio** (nel foglio della notifica: **Crea sondaggio dalla proposta**). Si apre il sondaggio con l’argomento come titolo, la nota e i giorni preferiti già selezionati.",
            "Aggiungi gli orari e pubblica come in [[create-a-rehearsal-poll]].",
            "Oppure tocca **Rifiuta** per chiudere la proposta senza sondaggio. In **Rifiutare questa proposta?** scrivi, se vuoi, un **Motivo**, poi tocca **Rifiuta**. Il membro che l’ha proposta riceve “Proposta di prova rifiutata” (notifica e push) con il tuo motivo.",
            "Se non fai nulla, la proposta esce dall’elenco dopo il giorno indicato in **Aperta fino a**.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "La proposta di un membro non contiene brani, luogo né costo. Aggiungili nel sondaggio prima di pubblicarlo.",
        },
      ],
    },

    // ───────────────────────────── Polls ─────────────────────────────
    {
      id: "create-a-rehearsal-poll",
      title: "Crea un sondaggio sulle disponibilità",
      summary: "Proponi alla band alcune date e lascia che i membri votino quelle in cui ci sono.",
      roles: ["admin"],
      kind: "task",
      keywords: ["sondaggio", "votare", "disponibilità", "trovare una data", "doodle", "sondaggio date"],
      related: ["poll-who-votes-and-deadline", "vote-in-a-rehearsal-poll", "lock-in-a-poll-date", "rehearsal-polls-explained"],
      body: [
        {
          type: "steps",
          title: "Su un telefono",
          items: [
            "Tocca **Crea** e scegli **Nuova prova**, poi passa **Modalità di programmazione** su **Sondaggio**. Si apre il **Sondaggio disponibilità**.",
            "Scrivi un **Titolo del sondaggio** e, se vuoi, un **Obiettivo / note (facoltativo)**.",
            "Sotto **Chi vota**, tocca un membro per escluderlo. Tu voti sempre.",
            "Sotto **Luogo, costo e brani**, compila **Luogo / sala** (scrivi qualche lettera e scegli un suggerimento, oppure tieni quello che hai scritto), il **Costo sala** (la **Divisione** mostra la quota di ciascuno) e i **Brani su cui lavorare** (tocca **Aggiungi**).",
            "Aggiungi le date. Con **Tutta la settimana**, scegli **Questa settimana** o **Prossima settimana**, tocca i **Giorni inclusi**, imposta **Inizio** e **Fine** e tocca **Aggiungi i giorni scelti al sondaggio**. Ogni giorno mostra quanti membri sono liberi. Con **Data / ora a scelta**, scegli una **Data proposta**, **Inizio** e **Fine**, e tocca **Aggiungi orario al sondaggio**.",
            "Controlla gli **Orari proposti**. Toglierne uno con **Rimuovi orario**, oppure tocca **Svuota**.",
            "Se vuoi, imposta **Vota entro**: un giorno e un orario (vedi [[poll-who-votes-and-deadline]]).",
            "Tocca **Pubblica sondaggio**.",
          ],
        },
        {
          type: "p",
          text: "Ogni membro chiamato a votare riceve una notifica e una push “Vota gli orari della prova”. Il sondaggio compare come **Sondaggio · Attivo** nella Home e nel **Calendario** sotto **Organizzazione prove**.",
        },
        {
          type: "p",
          text: "Hai cambiato idea? **Indietro** (in alto o in basso, o il tasto Indietro del telefono) torna al modulo della prova; **Chiudi** esce dal sondaggio. Se hai cambiato qualcosa, ti viene chiesto prima: **Scartare questo sondaggio?** Tocca **Continua a modificare** o **Scarta**. Senza modifiche si chiude e basta. I sondaggi non hanno bozze.",
        },
        {
          type: "list",
          title: "Cosa impedisce la pubblicazione",
          items: [
            "Nessun titolo: “Dai un titolo al sondaggio.”",
            "Nessun orario: “Aggiungi almeno un orario da far votare ai membri.”",
            "Un giorno per votare dopo il primo orario: “Scegli un giorno prima del primo orario”.",
            "Lo stesso giorno e orario di inizio aggiunti due volte: “Questo orario è già stato aggiunto.”",
          ],
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["tablet"],
              text: "Su un iPad il sondaggio è un composer a schermata unica, **Nuova prova** con “Sondaggio · i membri votano le date”. Schede: **Sessione e organico**, **Orari proposti** (una striscia della settimana colorata in base a quanti membri sono liberi; tocca un giorno per aggiungerlo con gli orari scelti), **Luogo, costo e brani** e **Scadenza del voto e nota**. Un’**Anteprima live** mostra gli orari “Come votano i membri”, con la **Preferita**.",
            },
          ],
        },
        { type: "shot", id: "shot-poll-builder", caption: "La creazione del sondaggio sulle disponibilità su un telefono." },
        {
          type: "note",
          tone: "privacy",
          text: "I conteggi dei liberi arrivano dai calendari di tutti, ma si vede solo il numero (“4 su 5 liberi”), mai chi è occupato né perché.",
        },
      ],
    },
    {
      id: "poll-who-votes-and-deadline",
      title: "Chi vota e la scadenza del voto",
      summary: "Limita un sondaggio ad alcuni membri e di’ loro entro quando rispondere.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["elenco invitati", "invitati", "scadenza", "vota entro", "chi vota"],
      related: ["create-a-rehearsal-poll", "vote-in-a-rehearsal-poll"],
      body: [
        {
          type: "p",
          text: "Di default viene chiesto di votare a tutti i membri attivi. Quando escludi qualcuno in **Chi vota**, il sondaggio ha un elenco di invitati.",
        },
        {
          type: "list",
          items: [
            "Solo i membri invitati ricevono la notifica del sondaggio e possono votare. Gli altri della band possono aprire il sondaggio in sola lettura, con l’etichetta **Non invitato**; il server rifiuta i loro voti.",
            "Gli admin della band vedono sempre il sondaggio. L’admin che lo pubblica è sempre nell’elenco.",
            "Quando confermi una data, nella prova vengono messi solo i membri invitati: anche tu se eri invitato o hai votato. In ogni caso la gestisci tu.",
            "La quota del costo della sala si divide per il numero di persone chiamate a votare.",
          ],
        },
        {
          type: "p",
          text: "**Vota entro** è un giorno tra oggi e il primo orario proposto, più un orario (le 18:00, se non lo cambi). I membri vedono nel sondaggio “Vota entro ven 11 dic, 18:00”.",
        },
        {
          type: "note",
          tone: "warning",
          text: "All’orario di scadenza la votazione si chiude: il sondaggio mostra **Votazione chiusa** e “La votazione è chiusa. Un admin confermerà una data.” Il server rifiuta i voti successivi. Gli admin possono comunque confermare una data.",
        },
      ],
    },
    {
      id: "vote-in-a-rehearsal-poll",
      title: "Vota in un sondaggio sulle disponibilità",
      summary: "Tocca le date in cui ci sei, oppure di’ che non ne va bene nessuna.",
      roles: ["member", "admin"],
      kind: "task",
      keywords: ["votare", "disponibilità", "scegliere le date", "nessuna va bene", "sondaggio"],
      related: ["poll-who-votes-and-deadline", "lock-in-a-poll-date", "rehearsal-polls-explained"],
      body: [
        {
          type: "steps",
          title: "Dalla scheda del sondaggio",
          items: [
            "Nella Home (Da gestire) o nel **Calendario**, trova la scheda **Sondaggio · Attivo**. Un badge dice **Vota ora**, **Votato** o **Nessuna va**.",
            "Tocca ogni tasto della data che ti va bene. Toccalo di nuovo per togliere il voto. Puoi scegliere più date.",
            "Tocca **Dettagli** per vedere ogni data con “{count}/{total} disponibili”, la **Preferita** e chi ha votato. Dopo il voto i dettagli si chiudono da soli (“Chiusura tra …s”); tocca **Tieni aperto** per evitarlo.",
            "Se hai votato e alla fine nessuna data va bene, tocca **Nessuna va** nei dettagli.",
          ],
        },
        {
          type: "steps",
          title: "Dalla notifica",
          items: [
            "Tocca la push “Vota gli orari della prova”, o la notifica nella campanella, e tocca **Vota ora**.",
            "In **Disponibilità per la prova**, sotto **Scegli le date in cui ci sei**, tocca le date in cui puoi esserci.",
            "Tocca **Fatto**. Se nessuna data va bene, tocca invece **Nessuna va**.",
          ],
        },
        {
          type: "p",
          text: "**Nessuna va** cancella i tuoi voti e dice all’admin che nessuna data ti va bene: gli admin vedono “Nessuna data va bene per …”. Se poi voti una data, questa risposta viene sostituita.",
        },
        {
          type: "list",
          title: "Cosa vedi mentre voti",
          items: [
            "Il luogo e la tua quota della sala (“Blackbox Studios · 12 € a testa”) e i brani da provare.",
            "“{answered} di {total} hanno risposto”, e la scadenza del voto quando c’è.",
            "Sotto **Risposte**, chi ha votato quale data, appena qualcuno ha votato.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "I voti si aggiornano in tempo reale per tutti. Senza connessione il voto non viene salvato e vedi “Impossibile registrare il voto. Riprova.”",
        },
        { type: "shot", id: "shot-poll-card", caption: "Un sondaggio attivo nella Home con i tasti delle date e i dettagli." },
        {
          type: "devices",
          rows: [
            {
              devices: ["duoLaptop"],
              text: "In posizione laptop il foglio del voto mette membri e giorni sullo schermo in alto, e i tuoi tasti dei giorni con **Conferma {day}** / **Conferma una data** e **Fatto** sullo schermo in basso.",
            },
          ],
        },
      ],
    },
    {
      id: "lock-in-a-poll-date",
      title: "Conferma una data e crea la prova",
      summary: "Scegli la data vincente di un sondaggio; BandWith crea la prova e avvisa la band.",
      roles: ["admin"],
      kind: "task",
      keywords: ["chiudere sondaggio", "confermare data", "concludere sondaggio", "conferma", "data vincente"],
      related: ["vote-in-a-rehearsal-poll", "the-rehearsal-page", "answer-a-rehearsal-invite"],
      body: [
        {
          type: "steps",
          items: [
            "Sulla scheda del sondaggio, tocca **Dettagli · Conferma**. Nel foglio della notifica, guarda sotto **Risposte · Conferma una data**.",
            "Accanto alla data che vuoi (spesso la **Preferita**), tocca **Conferma**.",
            "Controlla il **Luogo della prova**. Parte dal luogo indicato nel sondaggio, oppure da “Sala prove”.",
            "Tocca **Conferma e crea evento**.",
          ],
        },
        {
          type: "list",
          title: "Cosa succede",
          items: [
            "Viene creata una prova confermata in quella data e a quell’ora, con titolo, luogo e nota del sondaggio.",
            "Il costo della sala diventa il costo sala della prova, e i brani su cui lavorare diventano la sua scaletta.",
            "I membri invitati vengono messi nella prova e rispondono come al solito ([[answer-a-rehearsal-invite]]). Tu risulti presente.",
            "Il sondaggio viene chiuso ed esce da Da gestire. I membri ricevono una notifica “Prova confermata!” nella campanella (senza push).",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Se un altro admin ha confermato il sondaggio un attimo prima di te, vedi “Questo sondaggio è già stato confermato o chiuso.” e non viene creata una seconda prova.",
        },
      ],
    },
    {
      id: "delete-a-rehearsal-poll",
      title: "Elimina un sondaggio",
      summary: "Togli un sondaggio con tutte le sue date e i suoi voti.",
      roles: ["admin"],
      kind: "task",
      keywords: ["eliminare sondaggio", "annullare sondaggio"],
      related: ["create-a-rehearsal-poll", "handle-a-rehearsal-proposal"],
      body: [
        {
          type: "steps",
          items: [
            "Apri **Dettagli · Conferma** del sondaggio, oppure aprilo dalla sua notifica.",
            "Tocca **Elimina sondaggio**.",
            "In **Eliminare il sondaggio prova?**, tocca di nuovo **Elimina sondaggio**, oppure **Annulla**.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Tutte le date proposte e i voti dei membri vengono eliminati per sempre. Non si può annullare, e i membri non vengono avvisati.",
        },
        {
          type: "p",
          text: "Per chiudere la proposta di un membro che non ha ancora un sondaggio, usa invece **Rifiuta** (vedi [[handle-a-rehearsal-proposal]]).",
        },
      ],
    },
    {
      id: "rehearsal-polls-explained",
      title: "Come funzionano proposte e sondaggi",
      summary: "La vita di una richiesta di prova, dall’idea di un membro a una data in calendario.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["stato del sondaggio", "stato della proposta", "organizzazione prove", "da gestire"],
      related: ["propose-a-rehearsal", "create-a-rehearsal-poll", "vote-in-a-rehearsal-poll", "lock-in-a-poll-date"],
      body: [
        {
          type: "table",
          head: ["Fase", "Cosa significa", "Chi la vede"],
          rows: [
            ["Proposta (**Attesa admin**)", "Un membro ha chiesto una prova.", "Il membro che l’ha proposta e gli admin."],
            ["Sondaggio (**Sondaggio · Attivo**)", "Un admin ha pubblicato delle date da votare.", "I membri invitati e gli admin."],
            ["Confermata (**Prova · Confermata**)", "È stata confermata una data; la prova è in calendario.", "Tutti quelli della prova."],
            ["Rifiutata, scaduta o eliminata", "Chiusa senza una prova (una proposta scade dopo il giorno in **Aperta fino a**).", "Nessuno: esce dagli elenchi."],
          ],
        },
        {
          type: "p",
          text: "Proposte e sondaggi aperti compaiono nella Home in **Da gestire** e in cima al **Calendario** sotto **Organizzazione prove ({count})**. Nel **Calendario** seguono il filtro per band.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Pubblica sondaggi, trasforma le proposte in sondaggi, conferma le date, rifiuta ed elimina. Lo può fare qualsiasi admin della band, non solo chi ha pubblicato." },
            { role: "member", text: "Propone (una a settimana), vota, risponde **Nessuna va** e vede chi ha votato cosa." },
            { role: "deputy", text: "Non partecipa ai sondaggi della band." },
          ],
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["duoLaptop"],
              text: "In posizione laptop, la “Scrivania della band” nella Home elenca i sondaggi che non hai ancora votato e le proposte in attesa di un sondaggio; toccane uno per aprirlo.",
            },
          ],
        },
      ],
    },

    // ───────────────────────────── Chat ─────────────────────────────
    {
      id: "the-chat-inbox",
      title: "L’elenco delle chat",
      summary: "Tutte le tue chat della band, degli eventi e private in un unico elenco.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["messaggi", "chat", "elenco chat", "non letti", "cercare messaggi"],
      related: ["start-a-chat", "send-and-reply-to-messages", "delete-a-chat", "who-can-message-whom"],
      body: [
        {
          type: "p",
          text: "Tocca **Chat** nella barra in basso. Il badge sulla scheda conta i messaggi non letti.",
        },
        {
          type: "list",
          items: [
            "Filtra con **TUTTO**, **DIRETTE**, **BAND** o **EVENTI**. Ogni filtro mostra il proprio numero di non letti.",
            "Le chat con messaggi non letti vengono prima. Una riga mostra il nome (“ · Band” per la chat della band), l’orario, l’ultimo messaggio e il numero di non letti oppure le spunte del tuo ultimo messaggio.",
            "Se fai parte di due o più band, una riga mostra anche a quale band appartiene.",
            "Un pallino verde su una chat diretta significa che quella persona è online.",
            "Scrivi almeno due lettere in **Cerca chat…** per trovare chat, persone e parole nei messaggi: i risultati sono raggruppati in **CHAT**, **PERSONE** e **MESSAGGI**. Tocca **Cancella ricerca** per tornare indietro.",
            "Scorri una chat verso sinistra per eliminarla ([[delete-a-chat]]).",
            "Inizia una nuova chat con il + (**Nuova chat**) in alto ([[start-a-chat]]).",
          ],
        },
        { type: "shot", id: "shot-chat-inbox", caption: "L’elenco delle chat con i filtri per tipo." },
        {
          type: "devices",
          rows: [
            { devices: ["tablet", "duoBook", "duoLand"], text: "L’elenco e la conversazione aperta stanno affiancati; la chat aperta è evidenziata nell’elenco." },
            { devices: ["duoClosed", "duoBook", "duoLand"], text: "Su iPhone Duo il campo di ricerca si trova nella barra laterale." },
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "In modalità solista (senza band) non c’è la chat: la scheda **Chat** apre il calendario.",
        },
      ],
    },
    {
      id: "start-a-chat",
      title: "Inizia una chat",
      summary: "Apri la chat della band, la chat di un evento o un messaggio diretto.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["nuova chat", "scrivere a qualcuno", "messaggio privato", "messaggio diretto", "chat della band"],
      related: ["who-can-message-whom", "event-and-rehearsal-chats", "the-chat-inbox"],
      body: [
        {
          type: "steps",
          items: [
            "In **Chat**, tocca il + (**Nuova chat**) in alto.",
            "Scegli il **Tipo di chat**: **DIRETTE**, **BAND** o **EVENTO**.",
            "Cerca e seleziona una persona (**Cerca admin…** o **Cerca membri…**), una band (**Cerca band…**) o un evento (**Cerca eventi…**).",
            "Tocca il pulsante in basso: **Scrivi a …** o **Apri la chat …**.",
          ],
        },
        {
          type: "p",
          text: "Se la chat esiste già, BandWith apre quella invece di crearne una seconda. Una band ha una sola chat con tutti i membri attivi; un evento ha una sola chat con la sua formazione.",
        },
        {
          type: "p",
          text: "Puoi scrivere a qualcuno anche dall’elenco dei membri della band: apri il membro e tocca il pulsante del messaggio. Compare solo se uno dei due è admin.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "**DIRETTE** elenca tutti i membri delle tue band. **EVENTO** elenca tutti gli eventi delle band che gestisci." },
            { role: "member", text: "**DIRETTE** elenca solo gli **Admin** della band (“I messaggi diretti sono limitati agli admin della band.”). **EVENTO** elenca solo gli eventi a cui partecipi e che non hai rifiutato." },
          ],
        },
      ],
    },
    {
      id: "send-and-reply-to-messages",
      title: "Scrivi, rispondi e menziona",
      summary: "Scrivi messaggi, rispondi a un messaggio preciso, menziona qualcuno e leggi i messaggi più vecchi.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["inviare messaggio", "rispondere", "citare", "menzione", "@", "messaggi precedenti", "offline"],
      related: ["message-receipts-and-online-status", "the-chat-inbox"],
      body: [
        {
          type: "steps",
          title: "Inviare",
          items: [
            "Apri una chat e tocca **Scrivi un messaggio…** in basso.",
            "Scrivi il messaggio e tocca **Invia messaggio** (o premi Invio sulla tastiera).",
          ],
        },
        {
          type: "steps",
          title: "Rispondere a un messaggio",
          items: [
            "Su un telefono o un tablet, scorri il messaggio verso destra. Con il mouse, passaci sopra e fai clic su **Rispondi al messaggio**.",
            "Il campo di scrittura mostra **Rispondi a …**. Scrivi e invia. Tocca **Annulla risposta** per lasciar perdere.",
          ],
        },
        {
          type: "steps",
          title: "Menzionare qualcuno",
          items: [
            "Scrivi @ e l’inizio di un nome.",
            "Tocca la persona tra i suggerimenti (Invio sceglie la prima). Le menzioni compaiono in grassetto.",
          ],
        },
        {
          type: "list",
          title: "Buono a sapersi",
          items: [
            "Nelle chat della band e degli eventi ogni messaggio mostra il nome di chi scrive, con “ · Admin” per gli admin.",
            "La chat carica gli ultimi 50 messaggi. Scorri verso l’alto e tocca **Carica messaggi precedenti** per vederne altri.",
            "I messaggi sono solo testo: niente allegati, reazioni, modifiche o eliminazione di singoli messaggi.",
            "Senza connessione il messaggio non parte e torna nel campo di scrittura con “Messaggio non inviato. Controlla la connessione e riprova.” Invialo di nuovo quando sei online.",
            "Una menzione viene evidenziata per tutti ma non manda una notifica in più: tutti nella chat ricevono comunque una notifica per ogni messaggio.",
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["duoLaptop"], text: "In posizione laptop i messaggi riempiono lo schermo in alto e il campo di scrittura si apre sullo schermo in basso." }],
        },
      ],
    },
    {
      id: "event-and-rehearsal-chats",
      title: "Chat di eventi e prove",
      summary: "Una chat per chi partecipa a un gig o a una prova, con gli orari fissati in alto.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["chat evento", "chat del gig", "chat prova", "chat della formazione", "striscia evento"],
      related: ["start-a-chat", "gig-workspace", "the-rehearsal-page"],
      body: [
        {
          type: "steps",
          title: "Aprirla",
          items: [
            "Apri il gig o la prova.",
            "Tocca **CHAT EVENTO** (su un gig) o **CHAT PROVA** (su una prova).",
          ],
        },
        {
          type: "p",
          text: "La chat comprende la formazione dell’evento (tutti quelli che non hanno rifiutato) e gli admin della band. Chi viene aggiunto alla formazione più tardi entra nella chat al messaggio successivo.",
        },
        {
          type: "p",
          text: "Una striscia in alto mostra l’evento: titolo, **Oggi** / **Domani** o la data, **Carico …** (o **Inizio …**) e il luogo, più **Annullato** o **Evento passato** quando serve. Toccala per aprire l’evento.",
        },
        {
          type: "note",
          tone: "privacy",
          text: "La striscia e il pannello laterale mostrano solo la logistica: orari, luogo e stato. Mai il compenso né il cliente.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Può aprire la chat di qualsiasi evento della band." },
            { role: "member", text: "Vede il pulsante della chat solo dopo aver risposto che ci sarà. Chi rifiuta perde l’accesso: “Puoi scrivere solo negli eventi a cui partecipi.”" },
          ],
        },
        {
          type: "devices",
          rows: [
            {
              devices: ["tablet", "duoBook", "duoLand"],
              text: "Con due pannelli (un iPad in orizzontale o un iPhone Duo aperto), un pannello accanto alla conversazione mostra gli orari (**Carico**, **Soundcheck**, **Show**, **Fine**), il luogo, lo stato, **In questa chat · Formazione …/…** e chi è online, con **Apri il gig**.",
            },
          ],
        },
        { type: "shot", id: "shot-event-chat", caption: "La chat di un evento su iPad, con la striscia dell’evento e il pannello laterale." },
        {
          type: "note",
          tone: "tip",
          text: "I gig personali non hanno una chat: “Le chat evento sono disponibili per gli eventi della band.”",
        },
      ],
    },
    {
      id: "who-can-message-whom",
      title: "Chi può scrivere a chi",
      summary: "Le regole della chat per admin, membri e sostituti.",
      roles: ["admin", "member", "deputy"],
      kind: "reference",
      keywords: ["regole chat", "permessi", "messaggi limitati", "non posso scrivere"],
      related: ["start-a-chat", "event-and-rehearsal-chats"],
      body: [
        {
          type: "table",
          head: ["Chat", "Admin", "Membro"],
          rows: [
            ["Chat della band", "Sì, nelle band in cui sei attivo", "Sì, nelle band in cui sei attivo"],
            ["Chat evento", "Qualsiasi evento della tua band", "Solo gli eventi a cui partecipi e che non hai rifiutato"],
            ["Messaggio diretto", "Chiunque nelle tue band", "Solo gli admin di una band in comune"],
          ],
        },
        {
          type: "p",
          text: "Due membri non possono scriversi direttamente: si parlano nella chat della band o dell’evento. Le regole vengono controllate quando inizi una chat e a ogni invio.",
        },
        {
          type: "p",
          text: "Quando una regola ti blocca, il campo di scrittura viene sostituito da un lucchetto con il motivo, per esempio “I messaggi diretti sono disponibili solo con gli admin della band.” o “Non hai più accesso a questa chat.” (dopo che hai lasciato la band o sei stato tolto dal gig).",
        },
        {
          type: "roles",
          rows: [
            { role: "deputy", text: "I sostituti non sono membri della band, quindi non sono in nessuna chat della band, di evento o diretta. La band li raggiunge con le richieste al sostituto (“Chiedi nell’app”) e loro rispondono in Date da sostituto. Vedi [[deputy-in-the-app]]." },
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Una chat diretta resta tra le sue due persone. BandWith non la riusa mai per parlare con qualcun altro, quindi nessun altro può leggerne la cronologia.",
        },
      ],
    },
    {
      id: "message-receipts-and-online-status",
      title: "Spunte, conferme di lettura e stato online",
      summary: "Cosa significano l’orologio, la spunta singola e le doppie spunte.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["spunte", "conferma di lettura", "consegnato", "visualizzato", "online"],
      related: ["send-and-reply-to-messages", "the-chat-inbox"],
      body: [
        {
          type: "table",
          head: ["Segno", "Significato"],
          rows: [
            ["Orologio (**Invio**)", "Il messaggio sta partendo."],
            ["Una spunta (**Inviato**)", "Salvato sul server."],
            ["Due spunte grigie (**Consegnato**)", "È arrivato sui telefoni degli altri."],
            ["Due spunte colorate (**Letto**)", "Hanno aperto la chat dopo il tuo messaggio."],
          ],
        },
        {
          type: "p",
          text: "Nelle chat della band e degli eventi le spunte cambiano solo quando tutti hanno ricevuto o letto il messaggio. Chi è entrato dopo l’invio non conta.",
        },
        {
          type: "p",
          text: "L’intestazione di una chat diretta mostra **Online** o **Offline**. Le chat di gruppo mostrano “{count} membri · {count} online”.",
        },
      ],
    },
    {
      id: "delete-a-chat",
      title: "Elimina una chat",
      summary: "Togli una chat dal tuo elenco e cancella i messaggi per sempre.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["eliminare conversazione", "svuotare chat", "rimuovere chat", "cancellare messaggi"],
      related: ["the-chat-inbox"],
      body: [
        {
          type: "steps",
          items: [
            "Nell’elenco delle chat, scorri la chat verso sinistra e tocca il pulsante di eliminazione. Oppure apri la chat e tocca **Elimina chat** (il cestino) in alto a destra.",
            "Conferma con **Elimina**, oppure tocca **Annulla**.",
          ],
        },
        {
          type: "table",
          head: ["Chat", "Cosa viene eliminato"],
          rows: [
            ["Chat diretta", "Tutti i messaggi, per entrambi."],
            ["Chat della band o di un evento", "Solo i tuoi messaggi, per tutti. Gli altri tengono il resto della conversazione."],
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Non si può annullare. La chat esce dal tuo elenco finché non arriva un nuovo messaggio; allora torna, solo con i messaggi nuovi.",
        },
      ],
    },
    {
      id: "rehearsal-and-chat-notifications",
      title: "Notifiche per prove, sondaggi e chat",
      summary: "Quali azioni avvisano chi, e quali mandano anche una push.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["push", "notifica", "avvisi", "campanella", "badge"],
      related: ["answer-a-rehearsal-invite", "vote-in-a-rehearsal-poll", "send-and-reply-to-messages"],
      body: [
        {
          type: "table",
          head: ["Quando", "Chi viene avvisato", "Push"],
          rows: [
            ["Un membro propone una prova", "Gli admin della band", "Sì"],
            ["Un admin pubblica un sondaggio", "I membri chiamati a votare", "Sì"],
            ["Viene confermata una data", "Chi viene messo nella prova", "No, solo campanella"],
            ["Viene creata una prova, o vieni aggiunto a una", "I membri invitati", "Sì"],
            ["Cambiano data, ora o luogo", "Chi partecipa alla prova", "Sì"],
            ["Una prova viene eliminata", "Chi partecipa alla prova", "Sì"],
            ["Un membro si ritira o risponde", "L’admin che l’ha creata", "Sì, per il ritiro"],
            ["Un nuovo messaggio in chat", "Tutti gli altri nella chat", "Sì"],
          ],
        },
        {
          type: "list",
          items: [
            "Toccando la notifica di un sondaggio si apre il foglio del voto; quella di una prova apre la prova; quella di una chat apre la chat.",
            "Quando apri l’app con un sondaggio o una proposta non letti, BandWith te li mostra una volta in un piccolo pop-up.",
            "Non arriva nessuna push per una chat che hai aperta sullo schermo. Aprire una chat segna come lette le sue notifiche.",
            "Se la notifica riguarda un’altra delle tue band, l’app ti chiede prima se vuoi cambiare band.",
            "Disattiva tutte le push in **Impostazioni** con **Notifiche push** (“Inviti ai gig, sondaggi, messaggi in chat”). La campanella conserva tutte le notifiche.",
          ],
        },
      ],
    },
  ],

  faq: [
    {
      q: "Un membro può creare una prova?",
      a: "No. I membri toccano **Proponi prova** e decidono gli admin, che la programmano direttamente o fanno un sondaggio.",
      roles: ["member"],
    },
    {
      q: "Perché posso inviare una sola proposta di prova a settimana?",
      a: "Per tenere ordinata l’organizzazione della band, ogni membro può proporre una volta ogni 7 giorni per band. La schermata mostra la prossima data in cui puoi proporre.",
      roles: ["member"],
    },
    {
      q: "Perché un sondaggio dice Non invitato?",
      a: "L’admin ti ha escluso in **Chi vota**. Puoi leggere il sondaggio, ma votano solo i membri invitati.",
      roles: ["member"],
    },
    {
      q: "Il sondaggio si chiude alla scadenza del voto?",
      a: "Sì, per il voto: dopo la scadenza il sondaggio mostra **Votazione chiusa** e nessuno può più votare. Poi un admin conferma una data o elimina il sondaggio.",
    },
    {
      q: "I membri vedono quanto costa la sala prove?",
      a: "Durante un sondaggio vedono solo la loro quota (“12 € a testa”). Il costo totale della sala nella pagina della prova lo vedono solo gli admin.",
    },
    {
      q: "Posso scrivere direttamente a un altro membro?",
      a: "Solo se uno dei due è admin di una band in comune. Altrimenti usa la chat della band o quella dell’evento.",
      roles: ["member"],
    },
    {
      q: "Perché non riesco ad aprire la chat della prova?",
      a: "I membri vedono **CHAT PROVA** dopo aver risposto **CI SONO**. Se hai rifiutato, non hai più accesso.",
      roles: ["member"],
    },
    {
      q: "Posso modificare o eliminare un singolo messaggio, o mandare una foto?",
      a: "No. I messaggi in chat sono solo testo. Puoi rispondere a un messaggio o eliminare l’intera chat.",
    },
    {
      q: "Se elimino la chat della band, la band perde la conversazione?",
      a: "No. Vengono cancellati solo i tuoi messaggi. In una chat diretta, invece, tutti i messaggi vengono cancellati per entrambe le persone.",
    },
    {
      q: "Cosa succede ai messaggi che invio senza connessione?",
      a: "Non partono. Il testo torna nel campo di scrittura, così puoi inviarlo di nuovo quando sei online.",
    },
    {
      q: "I sostituti possono usare la chat?",
      a: "No. I sostituti non sono membri della band. La band li contatta con le richieste al sostituto nell’app.",
      roles: ["deputy"],
    },
  ],

  glossary: [
    { term: "Proposta di prova", definition: "La richiesta di una prova da parte di un membro, con un argomento e i giorni preferiti. Resta in attesa di un admin fino al suo ultimo giorno preferito.", see: "propose-a-rehearsal" },
    { term: "Sondaggio sulle disponibilità", definition: "Un elenco di date proposte che la band vota prima che un admin ne scelga una.", see: "create-a-rehearsal-poll" },
    { term: "Orario proposto", definition: "Una data con orario di inizio e fine offerta in un sondaggio.", see: "create-a-rehearsal-poll" },
    { term: "Modalità di programmazione", definition: "La scelta tra **Programma ora** e **Sondaggio** quando un admin crea una nuova prova.", see: "create-a-rehearsal" },
    { term: "Chi vota", definition: "I membri chiamati a votare un sondaggio. Escludere qualcuno crea un elenco di invitati.", see: "poll-who-votes-and-deadline" },
    { term: "Vota entro", definition: "Il giorno e l’ora in cui un sondaggio smette di accettare voti. Dopo, il sondaggio mostra Votazione chiusa.", see: "poll-who-votes-and-deadline" },
    { term: "Preferita", definition: "La data del sondaggio che finora ha più voti.", see: "vote-in-a-rehearsal-poll" },
    { term: "Nessuna va", definition: "Una risposta al sondaggio che significa che nessuna data proposta ti va bene. Cancella i tuoi voti e avvisa l’admin.", see: "vote-in-a-rehearsal-poll" },
    { term: "Conferma", definition: "La scelta della data vincente di un sondaggio, che crea la prova.", see: "lock-in-a-poll-date" },
    { term: "Conteggio dei liberi", definition: "Quanti membri non hanno altri impegni in calendario a una certa ora, per esempio “4 su 5 liberi”. Si vede solo il numero.", see: "create-a-rehearsal-poll" },
    { term: "Brani su cui lavorare", definition: "I brani da provare in una prova. Diventano la scaletta della prova.", see: "rehearsal-songs-and-prep-tasks" },
    { term: "Tipo di sessione", definition: "Band al completo, Voci, Ritmica, Acustica o Altro: dà il nome alla prova e preseleziona l’organico.", see: "create-a-rehearsal" },
    { term: "Chat della band", definition: "L’unica chat in cui ci sono tutti i membri attivi di una band.", see: "start-a-chat" },
    { term: "Chat evento", definition: "La chat di un gig o di una prova, per la sua formazione e gli admin.", see: "event-and-rehearsal-chats" },
    { term: "Striscia evento", definition: "La barra in cima alla chat di un evento con la data, l’orario di carico o di inizio e il luogo.", see: "event-and-rehearsal-chats" },
    { term: "Spunte di consegna", definition: "I segni accanto ai tuoi messaggi: in invio, inviato, consegnato, letto.", see: "message-receipts-and-online-status" },
  ],
};

export default together;
