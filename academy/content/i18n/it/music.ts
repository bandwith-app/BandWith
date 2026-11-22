import type { AreaText } from '../../types';

const music: AreaText = {
  area: {
    id: "music",
    title: "Repertorio, scalette e palco",
    intro:
      "Tieni i brani della band in un’unica libreria, prepara le scalette per i gig e leggi testi e accordi sul palco, tutti sullo stesso brano.",
    icon: "music",
  },

  articles: [
    // ───────────────────────────── Repertoire ─────────────────────────────
    {
      id: "repertoire-overview",
      title: "La schermata Repertorio",
      summary: "Dove stanno i brani e le scalette della band, e a cosa serve ogni parte della schermata.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["brani", "libreria", "catalogo", "repertorio", "lista brani", "preparazione"],
      related: ["add-a-song", "song-menu-actions", "build-a-setlist", "music-what-members-can-do"],
      body: [
        {
          type: "p",
          text: "Il Repertorio è la libreria dei brani della band. Ogni brano appartiene alla band e tutti i membri attivi possono leggerli tutti. Le scalette si costruiscono con questi brani.",
        },
        {
          type: "steps",
          title: "Aprire il Repertorio",
          items: [
            "Nella Home, tocca il riquadro **Repertorio** sotto **Azioni rapide**.",
            "Oppure tocca il tuo avatar in alto (**Apri profilo e account**) e tocca **Repertorio** sotto **Risorse e flussi della band**.",
          ],
        },
        {
          type: "list",
          title: "Cosa c’è sulla schermata",
          items: [
            "**Brani** e **Scalette** in alto passano da un elenco all’altro. Ognuno mostra quanti elementi contiene.",
            "Il campo di ricerca filtra l’elenco in cui sei: **Cerca brani, artisti…** cerca nei titoli e negli artisti, **Cerca scalette…** nei nomi delle scalette.",
            "La scheda **Repertorio della band** mostra il numero di **Brani** e di **Scalette**, la **Durata totale** di tutti i brani e lo **Stato di preparazione**: un pallino per brano, colorato secondo lo stato, con sotto i conteggi di **Pronto**, **In studio** e **Proposto**.",
            "Ogni riga mostra il titolo, l’artista e la tonalità, la durata e il BPM. Un’etichetta **Proposto** o **In studio** compare quando il brano non è ancora pronto.",
            "Il pulsante rotondo **Riproduci** a sinistra della riga fa partire la registrazione del brano o ne apre il link. È grigio quando il brano non ha né l’una né l’altro.",
            "Tocca un altro punto della riga per aprire il menu del brano (vedi [[song-menu-actions]]).",
            "Sopra i brani, gli admin vedono **Suggerimenti dei membri** quando c’è qualcosa da rivedere; i membri vedono sempre **I miei suggerimenti** (vedi [[review-song-suggestions]] e [[suggest-a-change-to-a-song]]).",
          ],
        },
        {
          type: "table",
          head: ["Stato", "Significato"],
          rows: [
            ["**Pronto**", "La band lo suona. I brani aggiunti o importati da un admin partono da qui."],
            ["**In studio**", "La band ci sta lavorando. Un suggerimento approvato parte da qui."],
            ["**Proposto**", "L’ha proposto un membro. Aspetta che un admin lo approvi o lo rifiuti."],
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Vede **Importa lista brani** e **Aggiungi brano** in alto a destra nell’elenco dei brani, e **Nuova scaletta** in quello delle scalette. Può modificare, cambiare stato ed eliminare ogni brano." },
            { role: "member", text: "Legge tutti i brani e le scalette. Il pulsante + in alto a destra nell’elenco dei brani è **Suggerisci un brano**; nell’elenco delle scalette non c’è nessun pulsante." },
            { role: "deputy", text: "Un sostituto non è membro della band e non ha un Repertorio. I sostituti vedono solo i gig per cui sono stati chiamati (vedi [[deputy-gigs]])." },
          ],
        },
        {
          type: "devices",
          rows: [
            { devices: ["tablet", "duoBook", "duoLand"], text: "Il Repertorio è la colonna dell’elenco. Una scaletta, il modulo di un brano o i suggerimenti si aprono accanto, nel secondo pannello." },
            { devices: ["duoLaptop"], text: "La scheda **Repertorio della band** passa nella metà superiore (il Display) e gli elenchi restano nella metà inferiore." },
          ],
        },
        { type: "shot", id: "music-repertoire", caption: "Il Repertorio con la scheda Repertorio della band e l’elenco dei brani." },
      ],
    },
    {
      id: "add-a-song",
      title: "Aggiungi un brano al repertorio",
      summary: "Aggiungi un brano in tre brevi passi; serve solo il titolo.",
      roles: ["admin"],
      kind: "task",
      keywords: ["nuovo brano", "creare brano", "aggiungere pezzo", "modulo brano"],
      related: ["song-fields", "suggest-a-song", "import-a-song-list", "import-chords-and-lyrics"],
      body: [
        {
          type: "steps",
          items: [
            "Nel Repertorio, su **Brani**, tocca **Aggiungi brano** (il pulsante + in alto a destra). Con la libreria vuota puoi anche toccare **Aggiungi il primo brano**.",
            "Al passo 1, **Brano**, scrivi il **Titolo del brano \\***. Aggiungi l’**Artista originale** se lo conosci. Per inserire subito accordi o testo, tocca **Importa accordi e testi** (vedi [[import-chords-and-lyrics]]).",
            "Tocca **Avanti**. Al passo 2, **Dettagli · opzionale**, compila se vuoi **Durata**, **BPM**, **Tonalità** e **Genere**.",
            "Tocca **Avanti**. Al passo 3, **File e link · opzionale**, aggiungi una registrazione, uno spartito, dei link, delle note o il testo.",
            "Tocca **Aggiungi brano**. Il pulsante diventa **Aggiunto!** e il modulo si chiude.",
          ],
        },
        {
          type: "p",
          text: "Puoi salvare a ogni passo: tocca **Aggiungi brano ora** sotto i campi per salvare con quello che hai inserito finora.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Se nella libreria c’è già un brano con lo stesso titolo e artista, il modulo dice ““…” è già nella tua libreria. Salva di nuovo per aggiungerne una seconda copia.” Tocca di nuovo il pulsante di salvataggio solo se vuoi davvero due copie.",
        },
        {
          type: "list",
          title: "Cosa succede dopo il salvataggio",
          items: [
            "Il brano viene aggiunto con lo stato **Pronto**.",
            "Tutti gli altri della band ricevono un avviso tra le notifiche (senza push).",
            "I file che hai scelto vengono caricati al salvataggio, nello spazio privato della band. Se il salvataggio non va a buon fine, vengono tolti di nuovo.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Aggiunge i brani direttamente in libreria come **Pronto**." },
            { role: "member", text: "Usa lo stesso modulo, con il titolo **Suggerisci un brano**. Il brano viene aggiunto come **Proposto** e aspetta un admin. Vedi [[suggest-a-song]]." },
          ],
        },
        {
          type: "devices",
          rows: [
            { devices: ["duoClosed"], text: "**Chiudi** si trova nella barra laterale, sotto l’orologio, invece che in alto a destra nel modulo." },
            { devices: ["tablet", "duoBook", "duoLand"], text: "Il modulo si apre nel secondo pannello, accanto al Repertorio." },
          ],
        },
      ],
    },
    {
      id: "song-fields",
      title: "Tutti i campi di un brano",
      summary: "A cosa serve ogni campo del modulo del brano, con i limiti che valgono.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["dettagli brano", "bpm", "tonalità", "durata", "genere", "registrazione", "spartito", "youtube", "note", "testo"],
      related: ["add-a-song", "transpose-and-tempo", "lyrics-and-chords-format", "play-a-song-recording"],
      body: [
        { type: "p", text: "Il modulo del brano ha tre passi. Serve solo il titolo; gli altri passi dicono “opzionale” e si possono saltare." },
        {
          type: "table",
          head: ["Campo", "A cosa serve"],
          rows: [
            ["**Titolo del brano \\***", "Il nome del brano. Obbligatorio."],
            ["**Artista originale**", "Compare sotto il titolo ovunque e serve a trovare i doppioni."],
            ["**Importa accordi e testi**", "Porta dentro una griglia accordi e il testo dal forum di iReal Pro, da un file o dagli appunti. Una volta collegata la griglia, una scheda **Griglia accordi** ne mostra tonalità, stile, tempo, battute e sezioni, con **Anteprima accordi**, **Sostituisci** e una X per toglierla."],
            ["**Durata**", "Minuti e secondi in due caselle (min : sec). Serve per i totali delle scalette."],
            ["**BPM**", "Il tempo, fino a 3 cifre. Lo usa il click della Modalità palco."],
            ["**Tonalità**", "Testo libero, per esempio Do magg. Compare nell’elenco, sul palco e nel controllo di trasposizione del lettore."],
            ["**Tap**, **BPM dalla registrazione**, ÷2 / ×2", "Strumenti sotto il BPM per trovare il tempo. Vedi [[transpose-and-tempo]]."],
            ["**Trasponi per la band**", "Sposta la tonalità, la griglia accordi e gli accordi del testo per tutti. Compare solo quando c’è qualcosa da trasporre."],
            ["**Genere**", "Etichette da scegliere tra i generi della band, oppure una nuova con il chip tratteggiato **Genere** e poi **Aggiungi genere**. I generi filtrano la libreria quando prepari una scaletta."],
            ["**Registrazione**", "Un file audio: MP3, M4A, WAV, massimo 50 MB."],
            ["**Spartito / partitura**", "Un PDF o una foto, massimo 20 MB."],
            ["**Scegli file**", "Sceglie uno o più file. L’app li smista tra registrazione e spartito in base al tipo. Per i file su iCloud Drive, Google Drive o Dropbox: tocca **Scegli file**, poi **Sfoglia**, e scegli l’app sotto Posizioni."],
            ["**Video YouTube**", "Un link al brano su YouTube. Deve iniziare con https://."],
            ["**Spartito**", "Un link a un PDF o a uno spartito online, al posto di uno spartito caricato. Deve iniziare con https://."],
            ["**Accordi**", "Un link a una pagina di accordi. Viene salvato nelle note del brano come “Chords: <link>”. Deve iniziare con https://."],
            ["**Note**", "Note della band sul brano: idee di arrangiamento, cambi di tonalità."],
            ["**Testo · testo semplice, Markdown o JSON**", "Il testo del brano, con gli accordi in linea se vuoi. Vedi [[lyrics-and-chords-format]]. **Incolla o importa il testo** sotto la casella apre il foglio di importazione sulla scheda Testo."],
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Le registrazioni e gli spartiti caricati sono conservati in privato per la tua band: possono aprirli solo i membri della band.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Se il titolo è vuoto quando scegli un file, il nome del file diventa il titolo.",
        },
      ],
    },
    {
      id: "song-menu-actions",
      title: "Il menu del brano: tutte le azioni",
      summary: "Cosa fa ogni voce del menu di un brano, e chi la vede.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["azioni brano", "opzioni brano", "menu", "ultimate guitar", "segna come pronto"],
      related: ["read-a-song", "edit-or-delete-a-song", "play-a-song-recording", "chord-editor"],
      body: [
        { type: "p", text: "Tocca la riga di un brano nel Repertorio per aprirne il menu. Le voci compaiono solo quando valgono per quel brano." },
        {
          type: "table",
          head: ["Voce", "Cosa fa", "Chi"],
          rows: [
            ["**Riproduci**", "Fa partire la registrazione nel mini player, oppure apre il link Spotify o YouTube.", "Tutti, se il brano ha una registrazione o un link"],
            ["**Testo**", "Apre il lettore del brano sul testo.", "Tutti, se il brano ha un testo"],
            ["**Griglia accordi**", "Apre il lettore del brano sulla griglia accordi.", "Tutti, se il brano ha una chart iReal"],
            ["**Apri spartito**", "Apre lo spartito caricato o il link allo spartito.", "Tutti, se il brano ne ha uno"],
            ["**Apri in Ultimate Guitar**", "Apre una ricerca del brano su Ultimate Guitar, fuori dall’app.", "Tutti"],
            ["**Modifica accordi**", "Apre l’editor degli accordi.", "Admin, se il brano ha un testo"],
            ["**Modifica**", "Apre il modulo del brano.", "Admin"],
            ["**Suggerisci una modifica**", "Manda una correzione o una nota all’admin.", "Membri"],
            ["**Segna come pronto**", "Imposta lo stato su Pronto.", "Admin, se il brano non è Pronto"],
            ["**Approva · in studio**", "Approva un brano proposto e lo mette In studio.", "Admin, su un brano Proposto"],
            ["**Rimetti in studio**", "Riporta un brano Pronto a In studio.", "Admin, su un brano Pronto"],
            ["**Elimina**", "Elimina il brano dopo una conferma.", "Admin"],
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Mettere un brano proposto In studio o Pronto da questo menu accetta il suggerimento del membro, eliminarlo lo rifiuta. In entrambi i casi il membro che l’ha proposto viene avvisato.",
        },
      ],
    },
    {
      id: "edit-or-delete-a-song",
      title: "Modifica, approva o elimina un brano",
      summary: "Cambia i dettagli o lo stato di un brano, oppure toglilo dalla libreria.",
      roles: ["admin"],
      kind: "task",
      keywords: ["cambiare brano", "aggiornare brano", "rimuovere brano", "stato del brano", "approvare brano"],
      related: ["song-fields", "song-menu-actions", "music-notifications"],
      body: [
        {
          type: "steps",
          title: "Modificare un brano",
          items: [
            "Nel Repertorio, tocca la riga del brano, poi **Modifica**.",
            "Cambia quello che ti serve in uno qualsiasi dei tre passi. Tocca **Salva ora** per salvare dal passo 1 o 2, oppure **Avanti** e poi **Salva brano** al passo 3.",
          ],
        },
        {
          type: "p",
          text: "Vengono salvati solo i campi che hai cambiato, quindi se nello stesso momento un compagno cambia un altro campo, la sua modifica resta. Il resto della band riceve una sola push, per esempio “Brano aggiornato · Paper Boats” con “Leo M. ha modificato: tonalità, tempo.”",
        },
        {
          type: "steps",
          title: "Cambiare lo stato di un brano",
          items: [
            "Tocca la riga del brano.",
            "Tocca **Segna come pronto**, **Approva · in studio** o **Rimetti in studio**. L’etichetta sulla riga cambia subito.",
          ],
        },
        {
          type: "steps",
          title: "Eliminare un brano",
          items: [
            "Tocca la riga del brano, poi **Elimina**.",
            "Leggi la conferma: indica le scalette che perdono il brano e i prossimi gig in cui viene suonato.",
            "Tocca **Elimina** per confermare, oppure **Annulla**.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Eliminando un brano lo togli da tutte le scalette che lo contengono, e la registrazione e lo spartito caricati vengono cancellati per sempre. Non si può annullare.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Modifica, cambia stato ed elimina ogni brano della band." },
            { role: "member", text: "Non può modificare né eliminare i brani della band. Usa invece **Suggerisci una modifica** (vedi [[suggest-a-change-to-a-song]])." },
          ],
        },
      ],
    },
    {
      id: "lyrics-and-chords-format",
      title: "Come si scrivono testo e accordi",
      summary: "Il formato dei brani della band: sezioni, accordi in linea e cosa sistema l’app quando salvi.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["chordpro", "markdown", "sezioni", "strofa", "ritornello", "accordi in linea", "formato", "json"],
      related: ["read-a-song", "chord-editor", "import-chords-and-lyrics"],
      body: [
        { type: "p", text: "Il testo è semplice testo con pochi segni. Lo stesso testo contiene parole e accordi, così un brano va bene sia per chi canta sia per chi suona." },
        {
          type: "list",
          title: "I segni",
          items: [
            "Una sezione inizia con una riga di titolo: `# Verse 1` o `[Chorus]`.",
            "Una riga vuota separa le strofe.",
            "Un accordo va tra parentesi quadre subito prima della parola su cui cade: `[Am]word`. Nel lettore compare sopra quella parola.",
            "`**bold**` e `*italic*` funzionano all’interno di una riga.",
            "Funziona anche il JSON, per esempio un elenco di righe o un elenco di sezioni con nome e righe.",
          ],
        },
        {
          type: "list",
          title: "Cosa sistema l’app quando salvi il brano",
          items: [
            "I nomi delle sezioni vengono uniformati: “Rit.” diventa Chorus, “[Strofa 2]” diventa Verse 2. Capisce i nomi in italiano, spagnolo, francese, tedesco e portoghese.",
            "Le strofe senza numero vengono numerate quando sono più di una.",
            "Una riga di accordi sopra una riga di parole (i classici fogli con gli accordi sopra il testo) diventa una riga con gli accordi in linea.",
            "Un accordo seguito da uno spazio viene attaccato alla parola successiva.",
          ],
        },
        {
          type: "p",
          text: "Nel testo i nomi delle sezioni sono scritti in inglese, ma ognuno li vede nella lingua della propria app (Strofa, Ritornello…).",
        },
        {
          type: "note",
          tone: "tip",
          text: "Se il testo non si può visualizzare, il lettore dice “Questo testo non può essere mostrato. Controllane il formato in Modifica.”",
        },
      ],
    },
    {
      id: "read-a-song",
      title: "Leggi testo e accordi",
      summary: "Apri un brano nel lettore a tutto schermo, cambia vista, regola la dimensione del testo e trasponi solo per te.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["testo", "accordi", "struttura", "lettore", "dimensione testo", "vista brano", "spartito", "testo e accordi", "griglia accordi"],
      related: ["lyrics-and-chords-format", "transpose-and-tempo", "my-notes-and-files", "stage-mode"],
      body: [
        {
          type: "steps",
          items: [
            "Nel Repertorio, tocca la riga del brano e poi **Testo** o **Griglia accordi**. Dal mini player, tocca **Testo**.",
            "Passa tra **Testo**, **Testo e accordi** e **Griglia accordi** con le schede sotto il titolo. Compaiono solo le viste che il brano ha.",
            "Tocca i pulsanti − e + (**Testo più piccolo**, **Testo più grande**) in alto per cambiare la dimensione del testo.",
            "Per leggere in un’altra tonalità, usa − e + attorno alla tonalità sotto le schede. Tocca la tonalità per tornare all’originale.",
            "Tocca la X (**Chiudi il testo**) per chiudere il lettore.",
          ],
        },
        {
          type: "table",
          head: ["Vista", "Cosa mostra"],
          rows: [
            ["**Testo**", "Solo le parole, senza accordi."],
            ["**Testo e accordi**", "Le parole con gli accordi sopra, oppure la chart iReal se il testo non ha accordi."],
            ["**Griglia accordi**", "Solo gli accordi: la chart iReal battuta per battuta, oppure il giro di accordi di ogni sezione in caselle."],
          ],
        },
        {
          type: "list",
          title: "La tua vista viene ricordata",
          items: [
            "La prima volta il lettore si apre sulla vista adatta al tuo strumento nella band: chi canta su Testo; chitarra, tastiere e basso su Testo e accordi; batteria, percussioni e fiati su Griglia accordi.",
            "Poi si apre sull’ultima vista che hai scelto su questo dispositivo. La stessa scelta vale in Modalità palco.",
            "La dimensione del testo resta salvata su questo dispositivo ed è la stessa della Modalità palco.",
          ],
        },
        {
          type: "p",
          text: "Se il brano sta suonando nel mini player, nell’intestazione del lettore compare un pulsante play/pausa. Gli admin vedono lì anche **Modifica accordi**.",
        },
        {
          type: "devices",
          rows: [
            { devices: ["duoLaptop"], text: "Il brano occupa la metà superiore (il Display) e i controlli del lettore passano nella metà inferiore (il Deck)." },
            { devices: ["tablet", "duoBook", "duoLand"], text: "Il lettore si apre nel secondo pannello, accanto al Repertorio." },
          ],
        },
        { type: "shot", id: "music-reader", caption: "Il lettore del brano con le schede Testo, Testo e accordi e Griglia accordi." },
      ],
    },
    {
      id: "chart-symbols",
      title: "I simboli di una sigla accordi",
      summary: "Cosa vuol dire ogni segno di una sigla iReal Pro o MusicXML: ritornelli, finali, segno, coda e il resto.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["simboli", "legenda", "segni", "ritornello", "segno", "coda", "d.c.", "d.s.", "fine", "finale", "volta", "corona", "n.c.", "barra", "tempo"],
      related: ["read-a-song", "import-from-ireal-pro", "chord-editor", "stage-mode"],
      body: [
        {
          type: "p",
          text: "Le sigle importate da iReal Pro o da un file MusicXML mostrano la forma con gli stessi segni ovunque: lettore del brano, editor accordi, Modalità palco e Modalità live. Sotto ogni sigla, **Cosa vogliono dire i simboli** apre questo elenco.",
        },
        {
          type: "symbols",
          title: "I simboli",
          rows: [
            { symbol: "section", name: "A", text: "Sezione: la lettera di una parte (A, B…). Intro e Strofa appaiono come parole." },
            { symbol: "time-signature", name: "3/4", text: "Tempo: da questa battuta in poi (qui 3 movimenti da un quarto)." },
            { symbol: "repeat-start", text: "Inizio ritornello: qui comincia la parte da ripetere." },
            { symbol: "repeat-end", text: "Fine ritornello: torna all’inizio del ritornello e suona di nuovo." },
            { symbol: "ending", n: 1, text: "Primo finale: suonalo la prima volta; la seconda salta al secondo finale." },
            { symbol: "repeat-bar", text: "Ripeti la battuta precedente." },
            { symbol: "repeat-two-bars", text: "Ripeti le due battute precedenti." },
            { symbol: "repeat-times", n: 3, text: "Suona questa parte 3 volte." },
            { symbol: "segno", text: "Segno: dove ti rimanda il D.S." },
            { symbol: "coda", text: "Coda: al primo segno di coda salta al secondo, la parte finale." },
            { symbol: "to-coda", text: "Al Coda: salta subito alla coda." },
            { symbol: "dc-al-coda", text: "D.C. al Coda: torna all’inizio, poi salta alla coda." },
            { symbol: "ds-al-coda", text: "D.S. al Coda: torna al segno, poi salta alla coda." },
            { symbol: "dc-al-fine", text: "D.C. al Fine: torna all’inizio e fermati a Fine." },
            { symbol: "fine", text: "Fine: il brano finisce qui, dopo un D.C. o un D.S." },
            { symbol: "fermata", text: "Corona: tieni l’accordo." },
            { symbol: "no-chord", text: "N.C.: nessun accordo, la band si ferma." },
            { symbol: "slash", text: "Stesso accordo sul tempo successivo." },
            { symbol: "double-bar", text: "Doppia stanghetta: finisce una parte." },
            { symbol: "final-bar", text: "Stanghetta finale: finisce il brano." },
            { symbol: "end", text: "End: dove il brano si ferma." },
          ],
        },
        {
          type: "list",
          title: "Buono a sapersi",
          items: [
            "I lettori di schermo dicono il nome di ogni segno nella tua lingua (per esempio “Ripeti la battuta precedente”).",
            "Le parole scritte su una battuta che non sono un segno (“Solo on AABA”) restano come sono scritte.",
            "Anche le sigle importate prima di questo aggiornamento mostrano i segni. Una corona, una barra o una ripetizione di due battute che mancava torna quando importi di nuovo la sigla.",
          ],
        },
      ],
    },
    {
      id: "transpose-and-tempo",
      title: "Trasponi un brano e trovane il tempo",
      summary: "Cambia la tonalità per tutta la band o solo sul tuo schermo, e imposta il BPM battendo il tempo o dalla registrazione.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["trasporre", "trasposizione", "cambio di tonalità", "semitono", "bpm", "tap tempo", "rilevamento del tempo"],
      related: ["song-fields", "read-a-song", "stage-click"],
      body: [
        {
          type: "table",
          head: ["Dove", "Cosa cambia", "Chi"],
          rows: [
            ["Modulo del brano, **Trasponi per la band**", "La tonalità del brano, la sua griglia accordi e gli accordi del testo, per tutti, quando salvi.", "Admin"],
            ["Lettore e Modalità palco, − tonalità +", "Solo quello che mostra il tuo schermo. Per la band il brano resta nella sua tonalità. Viene ricordato per ogni brano su questo dispositivo.", "Tutti"],
          ],
        },
        {
          type: "steps",
          title: "Trasporre per tutta la band",
          items: [
            "Apri il menu del brano e tocca **Modifica**, poi **Avanti** per arrivare a **Dettagli · opzionale**.",
            "Sotto **Tonalità**, tocca **Abbassa di un semitono** (−) o **Alza di un semitono** (+). Il numero in mezzo mostra di quanto ti sei spostato.",
            "Tocca **Salva ora**. La band viene avvisata che tonalità e accordi sono cambiati.",
          ],
        },
        {
          type: "steps",
          title: "Trovare il BPM",
          items: [
            "Nel modulo del brano, su **Dettagli · opzionale**, tocca **Tap** a tempo con il brano. Dopo due tocchi il BPM si compila; accanto al pulsante vedi quante volte hai toccato.",
            "Oppure tocca **BPM dalla registrazione**, se il brano ha un file audio. Il tempo viene calcolato sul tuo dispositivo.",
            "Se il risultato è la metà o il doppio del tempo reale, tocca ÷2 o ×2.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Il tempo ricavato dalla registrazione è una stima: il modulo dice “Stimato dalla registrazione: verificalo battendo il tempo.”",
        },
      ],
    },
    {
      id: "chord-editor",
      title: "Modifica gli accordi di un brano",
      summary: "Metti gli accordi sulle parole con un tocco, spostali trascinandoli e copiali da una sezione all’altra.",
      roles: ["admin"],
      kind: "task",
      keywords: ["editor accordi", "modificare accordi", "aggiungere accordo", "spostare accordo", "copiare accordi", "ireal"],
      related: ["lyrics-and-chords-format", "suggest-a-change-to-a-song", "import-from-ireal-pro"],
      body: [
        {
          type: "steps",
          items: [
            "Nel Repertorio, tocca la riga del brano e poi **Modifica accordi**. Puoi toccare **Modifica accordi** anche nell’intestazione del lettore.",
            "Tocca una parola. La barra in basso mostra **Accordo su “…”** e gli accordi che il brano usa già.",
            "Tocca un accordo per metterlo sulla parola, oppure scrivine uno nuovo in **Nuovo accordo, es. F#m7** e tocca **Aggiungi**. Tocca **Nessun accordo** per toglierlo. Tocca **Fatto** per chiudere la barra.",
            "Per spostare un accordo, trascinalo su un’altra parola.",
            "Per riusare gli accordi di una strofa, tocca **Copia accordi da…** sopra una sezione e scegli la sezione da cui copiarli.",
            "Se il brano ha una chart iReal, tocca **Da iReal (…)** sopra una sezione per mettere sulle sue righe gli accordi della sezione corrispondente.",
            "Tocca **Annulla** in alto a destra per tornare indietro di un passo. Quando hai finito, tocca **Salva accordi**.",
          ],
        },
        {
          type: "list",
          title: "I controlli dell’editor",
          items: [
            "**Sistema il formato** compare quando i nomi delle sezioni o gli accordi non sono nel formato della band; basta un tocco per correggerli.",
            "“Non presenti nella chart iReal: …” elenca gli accordi del testo che la chart non suona mai.",
            "“Gli accordi suonano in …, il brano è in ….” compare quando gli accordi non corrispondono alla tonalità del brano, con un pulsante per trasporli.",
          ],
        },
        {
          type: "p",
          text: "L’editor degli accordi ha bisogno di un testo. Se non c’è, ti dice di aggiungerlo prima in Modifica. Dopo il salvataggio la band riceve una push che gli accordi sono cambiati.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Se esci con modifiche non salvate, l’app chiede “Salvare le modifiche?” con **Salva modifiche**, **Scarta** e **Continua a modificare**.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Modifica gli accordi della band per tutti." },
            { role: "member", text: "Non ha l’editor degli accordi. Propone una correzione con **Suggerisci una modifica** (vedi [[suggest-a-change-to-a-song]])." },
          ],
        },
      ],
    },
    {
      id: "import-chords-and-lyrics",
      title: "Importa accordi e testo in un brano",
      summary: "Porta dentro una griglia accordi e il testo dal forum di iReal Pro, da un file o dagli appunti.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["importare testo", "incollare testo", "chordpro", "musicxml", "griglia accordi", "importare file"],
      related: ["import-from-ireal-pro", "open-a-chart-from-another-app", "lyrics-and-chords-format"],
      body: [
        {
          type: "steps",
          items: [
            "Nel modulo del brano, tocca **Importa accordi e testi** al passo 1, oppure **Incolla o importa il testo** al passo 3.",
            "Scegli una scheda: **Dal forum**, **Da file** o **Testo**.",
            "**Da file**: tocca **Scegli un file** e scegli un file MusicXML (.musicxml, .mxl), ChordPro (.cho, .chordpro, .pro) o di testo (.txt).",
            "**Testo**: copia il testo da un’altra parte, poi tocca **Incolla dagli appunti**, oppure incollalo nella casella e tocca **Anteprima**.",
            "Controlla l’anteprima e tocca **Usa questo testo**, oppure **Indietro**.",
            "Salva il brano come al solito.",
          ],
        },
        {
          type: "list",
          title: "Buono a sapersi",
          items: [
            "Il testo compare sempre prima in anteprima. Se il brano ha già un testo, l’anteprima avvisa che verrà sostituito.",
            "Una griglia accordi da sola viene collegata subito, senza anteprima.",
            "Quello che arriva dall’importazione compila solo i campi vuoti: titolo, artista, tonalità e tempo che hai già scritto restano.",
            "Quando incolli, le righe vuote separano le sezioni; gli accordi sopra le parole o tra [parentesi quadre] restano con loro.",
            "Da iReal Pro sul tuo dispositivo: Condividi › Esporta › MusicXML, salvalo in File, poi usa **Da file**.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "I testi e le griglie che importi li vede solo la tua band. Importa solo materiale che hai il diritto di usare.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Importa in qualsiasi brano mentre lo aggiunge o lo modifica." },
            { role: "member", text: "Importa mentre suggerisce un nuovo brano. Per un brano già esistente, suggerisci invece la modifica." },
          ],
        },
      ],
    },
    {
      id: "import-from-ireal-pro",
      title: "Importa una griglia accordi da iReal Pro",
      summary: "Tocca il link di un brano o di una playlist sul forum di iReal Pro per portare accordi, forma, tonalità e tempo in un brano.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["ireal", "ireal pro", "irealb", "griglia accordi", "playlist", "forum"],
      related: ["import-chords-and-lyrics", "read-a-song", "chord-editor"],
      body: [
        {
          type: "steps",
          title: "Nelle app per iPhone, iPad e Android",
          items: [
            "Nel modulo del brano, tocca **Importa accordi e testi** e resta su **Dal forum**.",
            "Tocca **Sfoglia il forum di iReal Pro**. Il forum si apre dentro l’app.",
            "Tocca il link di un brano o di una playlist. Gli accordi tornano subito nel modulo.",
            "Oppure incolla un link irealb:// in **Link di iReal Pro**.",
          ],
        },
        {
          type: "steps",
          title: "Sul web",
          items: [
            "Nel modulo del brano, tocca **Importa accordi e testi** e resta su **Dal forum**.",
            "Tocca **Apri il forum di iReal Pro**. Il forum si apre in una finestra a parte.",
            "Fai clic destro sul link di un brano o di una playlist e scegli Copia link.",
            "Tornato in BandWith, tocca **Incolla link**, incolla in **Link di iReal Pro**, oppure trascina il link sulla casella (che dice **Rilascia qui il link**). La finestra del forum si chiude appena il link è dentro.",
          ],
        },
        {
          type: "p",
          text: "Il link di una playlist ne mostra i brani (“… · 12 brani”). I brani che corrispondono al tuo titolo vengono per primi; scrivi in **Cerca un brano** per restringere l’elenco e tocca un brano per usarlo. **Cambia** torna al link.",
        },
        {
          type: "list",
          title: "Cosa viene importato",
          items: [
            "Gli accordi e la forma (sezioni, battute, ritornelli), più tonalità, stile, tempo e tempo in chiave. Niente melodia e niente testo.",
            "Titolo, compositore (come artista), tonalità e BPM compilano i campi vuoti del modulo.",
            "La chart compare nelle viste **Testo e accordi** e **Griglia accordi** del lettore, e l’editor degli accordi può usarla per posizionare gli accordi.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Se il browser blocca la finestra del forum, consenti i pop-up per BandWith e riprova.",
        },
        {
          type: "devices",
          rows: [
            { devices: ["web"], text: "Il forum non si può aprire dentro la pagina, quindi si apre in una finestra separata e riporti il link con **Incolla link**, incollandolo o trascinandolo." },
          ],
        },
      ],
    },
    {
      id: "open-a-chart-from-another-app",
      title: "Apri una chart MusicXML da un’altra app",
      summary: "Manda un file MusicXML a BandWith e collega la sua griglia accordi a un brano.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["apri in", "condividi", "musicxml", "file ricevuto", "collegare chart"],
      related: ["import-chords-and-lyrics", "suggest-a-change-to-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "In un’altra app (per esempio iReal Pro o File), condividi o apri un file MusicXML con BandWith.",
            "BandWith apre il foglio **File ricevuto**. Gli admin vedono **Collega la griglia accordi**; i membri vedono **Suggerisci la griglia accordi**.",
            "Scegli il brano a cui appartiene. Usa **Cerca un brano** per cercarlo. Se il brano ha già una chart, l’app avvisa che verrà sostituita.",
            "Tocca **Apri gli accordi** per controllarla, oppure **Fatto**.",
          ],
        },
        {
          type: "list",
          items: [
            "Per un brano nuovo, aggiungi prima il brano: il file ti aspetta in **Importa accordi e testi** › **Da file** › **File ricevuto**, dove **Usalo** lo collega.",
            "Tocca **Scarta il file** se non ti serve.",
            "Una partitura con il testo ma senza sigle degli accordi non dà nessuna chart; per usarne il testo, apri Modifica sul brano › **Incolla o importa il testo** › **Da file**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "La chart viene collegata subito al brano della band." },
            { role: "member", text: "La chart arriva all’admin come suggerimento. Il brano della band non cambia finché non lo accetta." },
          ],
        },
        { type: "devices", rows: [{ devices: ["web"], text: "Non disponibile: ricevere file da altre app funziona nelle app per iPhone, iPad e Android." }] },
      ],
    },
    {
      id: "import-a-song-list",
      title: "Importa una lista di brani",
      summary: "Aggiungi tanti brani in una volta da un file CSV o di testo, oppure carica il repertorio già pronto.",
      roles: ["admin"],
      kind: "task",
      keywords: ["csv", "excel", "foglio di calcolo", "importazione in blocco", "txt", "numbers", "google sheets", "700 brani"],
      related: ["add-a-song", "repertoire-overview"],
      body: [
        {
          type: "steps",
          items: [
            "Nel Repertorio, su **Brani**, tocca **Importa lista brani** (il pulsante di caricamento in alto a destra). Con la libreria vuota puoi anche toccare **Importa lista (CSV/TXT)**.",
            "Scegli un file .csv, .tsv o .txt, fino a 2 MB.",
            "Leggi la riga sopra l’elenco: dice quanti brani sono stati importati e quanti erano già nella tua libreria.",
          ],
        },
        {
          type: "list",
          title: "Com’è fatto il file",
          items: [
            "Un foglio di calcolo salvato come CSV (Excel, Numbers, Google Sheets) con una riga di intestazione. Colonne lette: title (o song, name, track), artist (o band, performer), key, bpm (o tempo), duration (o length, time; m:ss o secondi) e genre.",
            "Un semplice elenco scritto in Note: un brano per riga, come “Titolo - Artista”, “Titolo, Artista” o solo “Titolo”. Righe numerate e righe vuote vanno bene.",
            "Fino a 2000 brani per file.",
          ],
        },
        {
          type: "p",
          text: "I brani con lo stesso titolo e artista di uno già in libreria vengono saltati. I brani importati vengono aggiunti come **Pronto**.",
        },
        {
          type: "steps",
          title: "Caricare il repertorio già pronto",
          items: [
            "Con la libreria vuota, tocca **Carica 700+ brani**.",
            "L’app aggiunge i brani selezionati che non sono ancora nella tua libreria e ti dice quanti sono.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Importare una lista di brani è riservato agli admin: finisce direttamente nella libreria della band. I membri suggeriscono i brani uno alla volta e un admin li rivede uno per uno.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Vede **Importa lista brani** e **Carica 700+ brani**." },
            { role: "member", text: "Non vede questi pulsanti." },
          ],
        },
      ],
    },
    {
      id: "play-a-song-recording",
      title: "Ascolta una registrazione, apri uno spartito o un link",
      summary: "Ascolta la registrazione della band nel mini player e apri spartiti e link.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["riprodurre", "audio", "mini player", "registrazione", "spotify", "youtube", "spartito pdf"],
      related: ["song-menu-actions", "song-fields", "read-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "Nel Repertorio, tocca il pulsante rotondo **Riproduci** sulla riga di un brano, oppure tocca la riga e poi **Riproduci**.",
            "Una registrazione (un file caricato, un link a Google Drive o qualsiasi link audio) parte nel mini player. Lì usa **Pausa**, **Riproduci** e **Stop**, e **Testo** per aprire il lettore del brano.",
            "Un link Spotify o YouTube si apre fuori dall’app.",
            "Per vedere lo spartito, tocca la riga e poi **Apri spartito**.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Se non si apre niente, l’app dice “Impossibile aprire il brano. Controlla la registrazione o i link.” Se un link non funziona nel player, **Apri il link** lo apre altrove.",
        },
      ],
    },
    {
      id: "my-notes-and-files",
      title: "Le mie note e i miei file su un brano",
      summary: "Aggiungi note private su un brano, una riga, una parola o un accordo, e tieni i tuoi file, che non vede nessun altro.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["note personali", "note private", "le mie note", "annotazioni", "i miei file", "registrazione personale"],
      related: ["read-a-song", "stage-mode", "suggest-a-change-to-a-song"],
      body: [
        {
          type: "note",
          tone: "privacy",
          text: "Le tue note e i tuoi file sono solo tuoi: nessun altro della band li vede, admin compresi. Per gli altri il brano della band non cambia.",
        },
        {
          type: "steps",
          title: "Aggiungere una nota",
          items: [
            "Apri il brano nel lettore (**Testo** o **Griglia accordi**) o in Modalità palco.",
            "Tocca **Aggiungi nota** (in Modalità palco, **Nota**). **Le mie note** si attivano da sole; la prima volta un foglio spiega cosa sono: tocca **Ho capito**.",
            "Una barra in fondo allo schermo dice **Tocca la riga dove vuoi la nota**: tocca la riga che vuoi, oppure **Tutto il brano** per una nota su tutto il brano. **Annulla** per uscire.",
            "Più veloce: tieni premuta una riga per mezzo secondo. Si apre **Nota su questa riga**: tocca **Nota per me**.",
            "Per una riga, scegli a cosa si riferisce la nota: **Tutta la riga**, una delle sue parole o uno dei suoi accordi.",
            "Scrivi in **La mia nota** e tocca **Salva nota**.",
            "**Nota salvata su «…»** ti dice dove è andata.",
          ],
        },
        {
          type: "list",
          items: [
            "Le tue note compaiono evidenziate sotto la loro riga. Le note su tutto il brano compaiono sopra il testo.",
            "Tocca una nota per cambiarla o tocca **Elimina nota**.",
            "Una nota resta sulla sua riga anche quando un admin modifica gli accordi o sposta le sezioni. Se la sua riga non c’è più nel brano, passa in cima, così non si perde.",
            "Disattiva **Le mie note** per nasconderle, per esempio sul palco. L’interruttore resta salvato su questo dispositivo.",
          ],
        },
        {
          type: "steps",
          title: "Aggiungere un tuo file",
          items: [
            "Con **Le mie note** attivo, tocca **Aggiungi file** e scegli una registrazione o una partitura.",
            "Compare come chip sotto la barra. Toccalo per aprirlo; tocca la sua X e conferma per toglierlo.",
          ],
        },
        {
          type: "p",
          text: "Per condividere una nota con la band, tocca **Suggerisci alla band** nel foglio della nota. Arriva all’admin come suggerimento, insieme alla riga su cui era.",
        },
        {
          type: "devices",
          rows: [{ devices: ["phone", "phoneLand", "duoClosed"], text: "In Modalità palco la barra mostra **Nota** e un’icona per **Aggiungi file**, così sta su una riga sopra il testo." }],
        },
      ],
    },

    // ───────────────────────────── Suggestions ─────────────────────────────
    {
      id: "suggest-a-song",
      title: "Suggerisci un nuovo brano",
      summary: "Proponi un brano per il repertorio; un admin lo approva o lo rifiuta.",
      roles: ["member"],
      kind: "task",
      keywords: ["proporre brano", "suggerire brano", "richiesta brano", "idea per un nuovo brano"],
      related: ["add-a-song", "my-song-suggestions", "review-song-suggestions"],
      body: [
        {
          type: "steps",
          items: [
            "Nel Repertorio, su **Brani**, tocca **Suggerisci un brano** (il pulsante + in alto a destra).",
            "Compila il modulo come per qualsiasi brano: **Titolo del brano \\*** è l’unico campo obbligatorio. Puoi importare accordi e testo e allegare una registrazione o uno spartito.",
            "Tocca **Suggerisci ora** per inviarlo subito, oppure segui i passi e tocca **Suggerisci un brano** all’ultimo.",
          ],
        },
        {
          type: "list",
          title: "Cosa succede dopo",
          items: [
            "Il brano compare nel Repertorio con l’etichetta **Proposto**, per tutti nella band.",
            "Gli admin della band ricevono una push: “Brano suggerito · …”. Più brani suggeriti nello stesso minuto mandano una sola push.",
            "Quando un admin lo approva, passa a **In studio** e ricevi una push. Se viene rifiutato, il brano e i suoi file vengono eliminati e ricevi una push con il motivo dell’admin, se l’ha scritto.",
          ],
        },
        {
          type: "p",
          text: "I file che alleghi a un brano suggerito restano nella tua cartella personale finché un admin non accetta il brano.",
        },
      ],
    },
    {
      id: "suggest-a-change-to-a-song",
      title: "Suggerisci una modifica a un brano",
      summary: "Manda all’admin una correzione al testo o agli accordi, oppure una nota per tutta la band.",
      roles: ["member"],
      kind: "task",
      keywords: ["correzione", "correggere testo", "correggere accordi", "nota per la band", "proporre modifica"],
      related: ["my-song-suggestions", "review-song-suggestions", "my-notes-and-files"],
      body: [
        {
          type: "steps",
          items: [
            "Nel Repertorio, tocca la riga del brano e poi **Suggerisci una modifica**.",
            "Scegli **Testo o accordi** oppure **Nota per la band**.",
            "Per testo o accordi, cambia il testo in **Testo con accordi**. Gli accordi vanno tra parentesi quadre prima della parola: [Am]parola. La riga sotto la casella dice cosa hai cambiato, per esempio “Accordi cambiati su 2 righe”.",
            "Aggiungi un **Messaggio per l’admin (facoltativo)** se può aiutare.",
            "Per una nota, scrivila in **Nota per tutta la band**.",
            "Tocca **Invia suggerimento**. Il foglio dice **Inviato all’admin** e si chiude.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Il brano della band resta uguale per tutti finché l’admin non accetta il tuo suggerimento.",
        },
        {
          type: "p",
          text: "Puoi partire anche da una delle tue note: aprila e tocca **Suggerisci alla band**. La nota viene inviata insieme alla riga su cui era.",
        },
        {
          type: "p",
          text: "Gli admin ricevono una push che prende il nome dal tipo: “Correzione al testo · …”, “Correzione agli accordi · …” o “Nota per la band · …”.",
        },
      ],
    },
    {
      id: "my-song-suggestions",
      title: "Segui o ritira i tuoi suggerimenti",
      summary: "Vedi quali suggerimenti sono in attesa, quali sono stati accettati, e ritirane uno.",
      roles: ["member"],
      kind: "task",
      keywords: ["i miei suggerimenti", "ritirare", "stato del suggerimento", "in attesa"],
      related: ["suggest-a-song", "suggest-a-change-to-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "Nel Repertorio, su **Brani**, tocca **I miei suggerimenti**. La sua riga dice quanti aspettano l’admin.",
            "**In attesa** elenca quelli ancora aperti; **Rivisti** elenca gli altri con il loro esito.",
            "Toccane uno per vederlo. **Modifiche**, **Prima** e **Dopo** mostrano la differenza; uno già rivisto mostra il motivo dell’admin, se l’ha scritto.",
            "Per ritirare un suggerimento in attesa, tocca **Ritira il suggerimento**, poi di nuovo **Ritira il suggerimento** per confermare, oppure **Tienilo**.",
          ],
        },
        {
          type: "table",
          head: ["Etichetta", "Significato"],
          rows: [
            ["**In attesa**", "Non ancora rivisto."],
            ["**Accettato**", "Applicato così come l’hai inviato."],
            ["**Accettato con modifiche**", "L’admin l’ha applicato con qualche ritocco suo."],
            ["**Non accettato**", "Rifiutato."],
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Ritirando il suggerimento di un nuovo brano elimini il brano e i file che hai allegato. Gli admin non lo vedono più.",
        },
      ],
    },
    {
      id: "review-song-suggestions",
      title: "Rivedi i suggerimenti dei membri",
      summary: "Accetta, accetta con modifiche o rifiuta quello che propongono i membri, con un motivo se vuoi.",
      roles: ["admin"],
      kind: "task",
      keywords: ["rivedere", "approvare", "rifiutare", "suggerimenti dei membri", "moderare"],
      related: ["suggest-a-change-to-a-song", "suggest-a-song", "edit-or-delete-a-song"],
      body: [
        {
          type: "steps",
          items: [
            "Nel Repertorio, su **Brani**, tocca **Suggerimenti dei membri** (mostra “… da rivedere”). Puoi anche toccare la push che hai ricevuto.",
            "In **In attesa**, tocca un suggerimento. Mostra chi l’ha proposto e quando, con il suo messaggio.",
            "Guarda **Modifiche** (righe aggiunte e tolte), **Prima** e **Dopo**. Per un nuovo brano, un riepilogo elenca cosa contiene.",
            "Se vuoi, scrivi un **Motivo (facoltativo, lo vedrà …)**.",
            "Tocca **Accetta**, **Accetta con modifiche** o **Rifiuta**.",
          ],
        },
        {
          type: "table",
          head: ["Pulsante", "Cosa succede"],
          rows: [
            ["**Accetta**", "La modifica viene applicata al brano della band. Un nuovo brano passa a In studio."],
            ["**Accetta con modifiche**", "Prima modifichi il testo, poi tocchi **Accetta con queste modifiche**. Per un nuovo brano si apre il modulo del brano."],
            ["**Rifiuta**", "Non cambia nulla. Un nuovo brano suggerito viene eliminato, con i suoi file."],
          ],
        },
        {
          type: "list",
          items: [
            "Il membro riceve una push con l’esito e il tuo motivo.",
            "Se il brano è cambiato dopo il suggerimento, la schermata avvisa che stai confrontando con la sua versione attuale.",
            "Una nota per la band viene aggiunta alle note del brano.",
            "Un suggerimento che contiene una griglia accordi sostituisce anche la chart del brano.",
            "I suggerimenti rivisti restano in **Rivisti**.",
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet", "duoBook", "duoLand"], text: "I suggerimenti si aprono nel secondo pannello, accanto al Repertorio." }],
        },
        { type: "shot", id: "music-suggestions", caption: "Una correzione al testo con Modifiche, Prima e Dopo, e i pulsanti per decidere." },
      ],
    },

    // ───────────────────────────── Setlists ─────────────────────────────
    {
      id: "build-a-setlist",
      title: "Prepara una scaletta",
      summary: "Crea una scaletta nel Repertorio, aggiungi i brani dalla libreria, mettili in ordine e salva.",
      roles: ["admin"],
      kind: "task",
      keywords: ["nuova scaletta", "creare scaletta", "setlist", "ordine dei brani", "playlist"],
      related: ["setlists-and-sets", "attach-a-setlist-to-a-gig", "edit-a-gig-setlist", "music-notifications"],
      body: [
        {
          type: "steps",
          items: [
            "Nel Repertorio, tocca **Scalette**, poi **Nuova scaletta** (il pulsante + in alto a destra). Se non hai ancora scalette, puoi anche toccare **Crea la prima scaletta**.",
            "Scrivi un **Nome scaletta \\***, per esempio Serata jazz primo set, e tocca **Crea scaletta**.",
            "Tocca la nuova scaletta nell’elenco per aprirla.",
            "Tocca **Aggiungi brani…**. Cerca con **Cerca nella libreria…** o tocca il chip di un genere per filtrare. Tocca un brano per aggiungerlo; toccalo di nuovo per toglierlo. I brani in scaletta sono evidenziati.",
            "Tocca **Fatto** per chiudere la libreria.",
            "Trascina un brano dalla sua maniglia (**Trascina per riordinare**) per spostarlo. Tocca la X su una riga per toglierlo.",
            "Se vuoi, cambia il **Nome scaletta** in alto.",
            "Tocca **Salva scaletta**.",
          ],
        },
        {
          type: "list",
          title: "Cosa mostra l’editor",
          items: [
            "**Ordine scaletta (… brani)** con la durata **Totale**.",
            "Quando la scaletta ha più di un set, un’etichetta per set con i suoi brani e la durata, e un’etichetta **Set 1**, **Set 2** sul primo brano di ogni set.",
            "Quanti brani non hanno una durata: aggiungila con Modifica per avere un totale esatto.",
          ],
        },
        {
          type: "p",
          text: "Dopo il salvataggio, i membri attivi della band ricevono una sola push con cosa è cambiato, per esempio “Scaletta aggiornata · Rooftop set” e “Leo M.: 2 brani spostati, 1 aggiunto.” Viene segnalato anche un cambio di nome.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Se esci dall’editor con modifiche non salvate, l’app chiede “Salvare le modifiche alla scaletta?” con **Salva modifiche**, **Scarta** e **Continua a modificare**.",
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Crea, modifica, rinomina ed elimina le scalette." },
            { role: "member", text: "Apre le scalette in sola lettura: ordine, set e durata, più **Esporta scaletta in PDF**. Niente campo del nome, niente libreria, niente maniglie, niente Salva." },
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet", "duoBook", "duoLand"], text: "La scaletta si apre nel secondo pannello, accanto all’elenco delle scalette." }],
        },
        { type: "shot", id: "music-setlist-editor", caption: "L’editor della scaletta con la libreria aperta e l’ordine della scaletta sotto." },
      ],
    },
    {
      id: "setlists-and-sets",
      title: "Scalette, set e modelli",
      summary: "Come scalette, set al loro interno e scalette modello si collegano ai gig.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["set", "set 1", "set 2", "modello", "scaletta salvata", "scaletta del gig"],
      related: ["build-a-setlist", "attach-a-setlist-to-a-gig", "edit-a-gig-setlist"],
      body: [
        { type: "p", text: "Una scaletta è un elenco ordinato di brani della band. Un brano compare una sola volta in una scaletta. Una scaletta si può dividere in set (Set 1, Set 2…), per esempio prima e dopo una pausa." },
        {
          type: "list",
          items: [
            "I set nascono quando prepari la scaletta di un gig: **Aggiungi set** nel modulo del gig, oppure **Nuovo set** quando aggiungi brani nella panoramica del gig.",
            "Nell’editor della scaletta del Repertorio vedi i set e puoi spostare i brani dall’uno all’altro trascinandoli oltre il confine; un brano nuovo finisce nell’ultimo set. I set vuoti spariscono quando salvi.",
            "Le scalette segnate come modelli mostrano l’etichetta **Modello** nell’elenco. Il modulo del gig propone le tue scalette salvate sotto **Carica da un modello**.",
            "Quando carichi una scaletta salvata in un gig, il gig riceve una sua copia, con il nome del gig (per esempio “Scaletta Rooftop Session”). Se poi cambi la scaletta del gig, quella da cui l’hai caricata non cambia.",
            "Ogni scaletta di un gig compare anche nel Repertorio sotto **Scalette**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Modifica le scalette ovunque: nel Repertorio, nel modulo del gig, nella panoramica del gig e in Modalità palco." },
            { role: "member", text: "Legge tutte le scalette della band. Solo gli admin possono modificarle." },
          ],
        },
      ],
    },
    {
      id: "attach-a-setlist-to-a-gig",
      title: "Collega una scaletta a un gig",
      summary: "Aggiungi brani o una scaletta salvata mentre crei o modifichi un gig.",
      roles: ["admin"],
      kind: "task",
      keywords: ["assegnare scaletta", "brani del gig", "caricare modello", "aggiungere set", "scaletta evento"],
      related: ["edit-a-gig-setlist", "setlists-and-sets", "create-a-gig"],
      body: [
        {
          type: "steps",
          items: [
            "Crea un gig (vedi [[create-a-gig]]). Per un gig che hai già, aprilo e usa invece la sua sezione **SCALETTA**, che offre gli stessi modelli e brani.",
            "Apri la sezione **Scaletta e brani**.",
            "Per partire da una scaletta salvata, toccala sotto **Carica da un modello**. Quando ci sono già dei brani, **Modelli** mostra di nuovo l’elenco come **Sostituisci con un modello**.",
            "Per aggiungere brani, tocca **Libreria** sotto un set, oppure **Manuale** per scriverne uno. **Aggiungi brani** aggiunge al set che scegli.",
            "Tocca **Aggiungi set** per un altro set, dagli un nome in **Nome del set...**, oppure tocca **Rimuovi set**.",
            "Salva il gig.",
          ],
        },
        {
          type: "p",
          text: "Il gig riceve una sua scaletta, con il nome del gig. Quando modifichi un gig, la sua scaletta viene aggiornata e la formazione riceve una sola push con cosa è cambiato.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Se il gig non ha una scaletta, la sua panoramica dice **NESSUNA SCALETTA**; gli admin possono aggiungere brani direttamente lì (vedi [[edit-a-gig-setlist]]).",
        },
      ],
    },
    {
      id: "edit-a-gig-setlist",
      title: "Modifica la scaletta di un gig dalla panoramica",
      summary: "Riordina, aggiungi e togli brani direttamente nel gig, senza aprire il modulo di modifica.",
      roles: ["admin"],
      kind: "task",
      keywords: ["riordinare brani", "panoramica gig", "scelta del set", "quale set", "nuovo set", "trascinare brani"],
      related: ["attach-a-setlist-to-a-gig", "music-notifications", "gig-workspace"],
      body: [
        {
          type: "steps",
          items: [
            "Apri un gig in programma. La sezione **SCALETTA** della panoramica ne mostra i brani.",
            "Per spostare un brano, tienilo premuto e trascinalo. Con la tastiera, metti il focus sulla sua maniglia e usa le frecce su e giù.",
            "Per togliere un brano, tocca la sua X (**Rimuovi brano**).",
            "Per aggiungere brani, tocca **Aggiungi brani**. Con più di un set, **In quale set?** chiede dove; tocca un set o **Nuovo set**.",
            "In **Aggiungi brani**, spunta i brani (**Libreria**), poi tocca **Aggiungi … brani**. I brani già nel set mostrano **Nel set**. **Manuale** crea un nuovo brano e lo aggiunge.",
            "Tocca **Salva** nella barra **Modifiche non salvate**, oppure **Annulla** per scartare le modifiche.",
          ],
        },
        {
          type: "list",
          items: [
            "Non viene scritto nulla finché non tocchi **Salva**. Poi la formazione del gig (tutti quelli che non hanno rifiutato) riceve una sola push, per esempio “Scaletta aggiornata · Rooftop Session” e “Leo M.: 1 brano spostato, 1 aggiunto.”",
            "Un gig che non ha ancora una scaletta ne riceve una quando salvi, con il nome del gig.",
            "Se esci dal gig con modifiche non salvate, l’app chiede “Salvare le modifiche alla scaletta?”.",
            "Toccando **SCALETTA** o il numero di brani si apre l’elenco completo in un foglio, dove puoi modificare allo stesso modo.",
            "I preventivi mostrano qui la scaletta in sola lettura. In un gig passato la modifichi nel foglio (**SCALETTA** o il numero di brani); i brani di una prova con **MODIFICA** accanto a **BRANI DA PROVARE**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Modifica la scaletta nella panoramica dei gig della band in programma." },
            { role: "member", text: "Vede brani, artisti e durate in sola lettura. Senza scaletta, il foglio dice “L’admin della band non ha ancora collegato una scaletta.”" },
          ],
        },
        {
          type: "devices",
          rows: [{ devices: ["tablet"], text: "Lo spazio di lavoro del gig ha una sua scheda **SCALETTA** accanto a **PANORAMICA**, **RIDER & PALCO** e **SOLDI**." }],
        },
      ],
    },
    {
      id: "export-a-setlist-pdf",
      title: "Esporta una scaletta in PDF",
      summary: "Crea un PDF di una scaletta da stampare o inviare.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["pdf", "stampare scaletta", "condividere scaletta", "scaricare"],
      related: ["build-a-setlist"],
      body: [
        {
          type: "steps",
          items: [
            "Nel Repertorio, tocca **Scalette** e apri una scaletta.",
            "Tocca **Esporta scaletta in PDF** (il pulsante documento in alto a destra).",
            "Su un telefono, scegli dove mandarlo nel foglio di condivisione. Sul web, il PDF viene scaricato.",
          ],
        },
        { type: "p", text: "Il PDF riporta il nome della band, il nome della scaletta e ogni brano con artista, tonalità, BPM, durata e set." },
        { type: "p", text: "Il pulsante è grigio finché la scaletta è vuota." },
      ],
    },
    {
      id: "delete-a-setlist",
      title: "Elimina una scaletta",
      summary: "Togli una scaletta; i brani restano in libreria.",
      roles: ["admin"],
      kind: "task",
      keywords: ["rimuovere scaletta", "eliminare scaletta"],
      related: ["build-a-setlist"],
      body: [
        {
          type: "steps",
          items: [
            "Nel Repertorio, tocca **Scalette** e apri la scaletta.",
            "Tocca **Elimina scaletta** (il cestino rosso in alto a destra).",
            "Leggi la conferma: indica i prossimi gig che perdono la loro scaletta.",
            "Tocca **Elimina**, oppure **Annulla**.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "I gig che usano la scaletta la perdono. I brani restano nella tua libreria. Non si può annullare.",
        },
      ],
    },
    {
      id: "music-notifications",
      title: "Notifiche su brani e scalette",
      summary: "Chi viene avvisato di cosa quando cambiano brani, scalette e suggerimenti.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["push", "notifica", "scaletta aggiornata", "brano aggiornato", "avviso"],
      related: ["build-a-setlist", "edit-a-gig-setlist", "review-song-suggestions", "notifications-inbox"],
      body: [
        {
          type: "table",
          head: ["Modifica", "Chi viene avvisato", "Come"],
          rows: [
            ["Scaletta di un gig salvata (panoramica o modulo del gig)", "La formazione del gig, tranne chi ha salvato", "Una push: “Scaletta aggiornata · <gig>” con “2 brani spostati, 1 aggiunto”"],
            ["Scaletta salvata nel Repertorio", "I membri attivi della band, tranne chi ha salvato", "Una push: “Scaletta aggiornata · <scaletta>”, oppure che è stata rinominata"],
            ["Brano modificato (modulo o editor degli accordi)", "I membri attivi della band, tranne chi ha salvato", "Una push: “Brano aggiornato · <brano>” con i campi cambiati"],
            ["Brano aggiunto da un admin", "Il resto della band", "Avviso tra le notifiche, senza push"],
            ["Brano suggerito o modifica suggerita", "Gli admin attivi della band", "Push"],
            ["Suggerimento rivisto", "Il membro che l’ha proposto", "Push, con il motivo"],
            ["Scaletta riordinata in Modalità palco", "La band", "Avviso tra le notifiche, senza push"],
          ],
        },
        { type: "p", text: "I testi sono scritti nella lingua dell’app di ciascuno." },
        {
          type: "p",
          text: "Un gig aperto ricarica la scaletta appena un admin la cambia, così i membri vedono il nuovo ordine senza aggiornare.",
        },
      ],
    },
    {
      id: "music-what-members-can-do",
      title: "Cosa possono fare admin, membri e sostituti con brani e scalette",
      summary: "Una tabella di chi può leggere e chi può cambiare repertorio, scalette e Modalità palco.",
      roles: ["admin", "member", "deputy"],
      kind: "reference",
      keywords: ["permessi", "diritti dei membri", "solo admin", "sola lettura", "privacy"],
      related: ["repertoire-overview", "suggest-a-change-to-a-song", "stage-mode", "who-sees-what"],
      body: [
        {
          type: "table",
          head: ["Azione", "Admin", "Membro"],
          rows: [
            ["Leggere tutti i brani, testi, accordi e file", "Sì", "Sì"],
            ["Aggiungere un brano alla libreria", "Sì, come Pronto", "Lo suggerisce, come Proposto"],
            ["Modificare, trasporre per la band, modificare gli accordi, eliminare un brano", "Sì", "No: suggerisce una modifica"],
            ["Importare una lista di brani o caricare 700+ brani", "Sì", "No"],
            ["Rivedere i suggerimenti", "Sì, tutti quelli della band", "Vede solo i propri"],
            ["Le mie note e i miei file", "Solo i propri", "Solo i propri"],
            ["Leggere le scalette ed esportarle in PDF", "Sì", "Sì"],
            ["Creare, modificare, riordinare, eliminare scalette", "Sì", "No"],
            ["Aprire la Modalità palco su un gig in programma, o la Modalità live su una prova in programma", "Sì, come leader", "Sì, come chi segue"],
            ["Spostare il brano corrente della band, riordinare sul palco, avviare il click della band", "Sì", "No: scorre i brani e usa il click solo sul proprio telefono"],
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Gli admin non vedono le note né i file dei membri. I membri vedono solo i propri suggerimenti; gli admin li vedono tutti.",
        },
        {
          type: "roles",
          rows: [
            { role: "deputy", text: "Un sostituto non è membro della band: niente Repertorio, niente scalette e niente Modalità palco. Le sue date da sostituto mostrano data, orari, locale, ruolo e compenso offerto." },
          ],
        },
      ],
    },

    // ───────────────────────────── Stage ─────────────────────────────
    {
      id: "stage-mode",
      title: "Modalità palco",
      summary: "Una schermata live nera, leggibile a colpo d’occhio, con la scaletta e il testo o gli accordi di ogni brano: il giorno del gig con il programma, a una prova come Modalità live.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["palco", "giorno del gig", "live", "programma della serata", "go live", "modalità concerto", "prova", "modalità live", "prova live", "solo il brano", "solo testo", "vista pulita"],
      related: ["lead-stage-mode", "follow-in-stage-mode", "stage-manager", "stage-click", "stage-bluetooth-sync", "stage-mode-on-devices"],
      body: [
        {
          type: "steps",
          title: "Aprire la Modalità palco",
          items: [
            "Apri un gig della band in programma e tocca il pulsante **Riproduci** in alto a destra (**Apri modalità palco**). Il giorno del gig è evidenziato.",
            "Oppure, nella Home, tocca **Go live** sotto il tuo prossimo gig.",
            "Per uscire, tocca la X (**Esci dalla modalità palco**).",
            "Su una prova della band in programma lo stesso pulsante è **Apri modalità live**. Apre la Modalità live (vedi sotto); per uscire, **Esci dalla modalità live**.",
          ],
        },
        {
          type: "list",
          title: "Cosa c’è sulla schermata",
          items: [
            "**Modalità palco · <data>**, il titolo del gig, il locale e la città.",
            "Il programma della serata: Carico, Soundcheck, Show e Fine, in formato 24 ore. Il prossimo è evidenziato come **A seguire · …**; quelli passati sbiadiscono.",
            "La **Scaletta** con numeri, titoli, tonalità e durata. Il brano corrente è evidenziato. I brani tolti per stasera sono barrati, e il conteggio sopra l’elenco dice quanti sono (**· 2 tolti**).",
            "Una seconda scheda con il nome della tua vista del brano (**Testo**, **Testo e accordi** o **Griglia accordi**) mostra il brano corrente. Segue il brano quando cambia.",
            "**Indietro** e **Avanti** in basso, con il pulsante del click in mezzo.",
          ],
        },
        {
          type: "list",
          title: "Nella scheda del brano",
          items: [
            "Passa tra **Testo**, **Testo e accordi** e **Griglia accordi**. La scelta è la stessa del lettore del brano.",
            "Cambia la dimensione del testo con − e +.",
            "**Schermo intero** (il pulsante con i quattro angoli in alto) mostra solo il brano (**Solo il brano**), da qui o dalla scaletta: una riga piccola con numero e titolo, poi il brano; niente schede, orari o stato. In basso restano solo **Mostra tutto**, **Indietro**, il click e **Avanti**; anche le frecce e Pagina su/giù cambiano brano, per le pedaliere voltapagina.",
            "**Mostra tutto** o Indietro riporta l’intera schermata live, sulla scheda dove eri. Uscendo dalla Modalità palco, Solo il brano si spegne.",
            "Trasponi solo per te con − tonalità +. Cambia solo il tuo schermo.",
            "**Le mie note** mostra le tue note private sopra la versione della band.",
            "Il programma della serata si nasconde per lasciare più spazio al brano.",
            "Dove c’è spazio (un telefono in orizzontale, un iPad, un dispositivo a doppio schermo aperto su entrambi i pannelli), la scaletta resta in una colonna accanto al brano. Tocca lì un brano per andarci.",
          ],
        },
        {
          type: "list",
          title: "A una prova: la Modalità live",
          items: [
            "**Modalità live · <data>** e il titolo della prova in alto.",
            "La scaletta sono i brani da provare della prova, nel loro ordine. Se non ne è stato scelto nessuno dice “Ancora nessun brano scelto per questa prova.”",
            "Testo, accordi, trasposizione, dimensione del testo, il click e Le mie note funzionano come in un gig.",
            "L’admin guida e i membri seguono, via internet e via Bluetooth, come in un gig. Chiunque sia nella prova può aprirla.",
            "Niente programma della serata (nessun orario di carico, soundcheck, show o fine) e niente brani da togliere per stasera.",
          ],
        },
        { type: "shot", id: "music-song-only", caption: "Solo il brano: il brano con i suoi accordi, a schermo intero, con Mostra tutto, Indietro, il click e Avanti." },
        { type: "shot", id: "music-rehearsal-live", caption: "La Modalità live a una prova: i brani da provare, gli accordi del brano corrente e Indietro / Avanti, senza programma della serata." },
        {
          type: "list",
          title: "Il timer della prova",
          items: [
            "L’admin tocca **Inizia la prova** nella Modalità live. Il tempo scorre per tutta la band: i membri lo vedono ma non lo comandano.",
            "**Pausa** ferma il tempo (una pausa non conta) e **Riprendi** lo fa ripartire. **Termina** chiede prima: **Continua** o **Termina ora**.",
            "Alla fine tutti vedono il **Riepilogo della prova**: il tempo provato senza pause e i brani suonati (ogni brano a schermo mentre il tempo scorreva conta una volta). L’admin può ancora **Riprendi la prova**.",
            "La sessione viene salvata: chiudere la Modalità live o riavviare l’app la mantiene, e la pagina della prova la mostra sotto **SESSIONE DI PROVA**. Una prova ricorrente ha una sessione per data.",
            "Senza internet il tempo dell’admin continua e si salva quando torna online. Sul Duo piegato come un laptop, lo schermo a terra mostra il tempo e, per l’admin, **Pausa** / **Riprendi**.",
          ],
        },
        {
          type: "list",
          title: "Note della prova",
          items: [
            "In Modalità live tocca **Segna** quando qualcosa va sistemato: tiene il brano in corso e il minuto, e continuate a suonare.",
            "In pausa (o nel riepilogo) tocca **Da scrivere** e **Scrivi** su ogni segno: scegli su cosa lavorare (**Tempo**, **Tonalità**, **Finale**, **Solo**, **Da rivedere**, **Perfetto**, o **Ripetere una sezione** se il brano ha una struttura), aggiungi due parole e indica **Per chi è**.",
            "Ogni nota su un brano può dire **Dove nel brano**: una sezione e, se vuoi, una delle sue righe (**Riga (facoltativa)**).",
            "In Modalità live puoi anche tenere premuta una riga del testo e toccare **Nota per la band**: la nota si apre già su quel brano, sezione e riga.",
            "Gli admin scrivono per tutta la band o per qualsiasi membro; i membri per la band o per sé. Tutta la band legge tutte le note.",
            "Chi riceve una nota tocca **Provato** dopo averci lavorato; un admin tocca **OK** quando la band ce l’ha (anche l’autore, per una nota ai membri).",
            "La pagina della prova elenca le note sotto **NOTE DELLA PROVA**, per brano. Le note arrivano subito agli altri telefoni in Modalità live; senza internet restano sul telefono e partono quando torna online. Sul Duo piegato come un laptop, lo schermo a terra ha un blocco note: **Segna**, un preset con un tocco, o **Scrivi…**.",
          ],
        },
        {
          type: "list",
          title: "Da studiare, e la prova dopo",
          items: [
            "La Home mostra **Da studiare**: i brani con note aperte per te o per la band, dalla prova più recente. Tocca **Provato** su una nota per te; tocca il brano per aprirne la pagina. Sul Duo piegato come un laptop, i brani sono in **Da fare** sulla scrivania.",
            "La pagina del brano mostra **Dalle prove** sopra le tue note. Una nota **Tempo** o **Tonalità** che indica il valore (per esempio “Tempo: 96” o “Tonalità: Bb”) ha un pulsante: gli admin **Imposta sul brano**, i membri **Suggerisci alla band**.",
            "La pagina della prova successiva mostra **DALL’ULTIMA VOLTA**: le note aperte delle prove precedenti sui suoi brani. Gli admin toccano **OK** quando la band ci è arrivata. In Modalità live un badge su ogni brano apre le sue note dall’ultima volta.",
            "Quando un admin crea una prova, **Dalle note di prova aperte** propone i brani con note aperte come brani su cui concentrarsi, un tocco ciascuno. Un nuovo sondaggio di prova li sceglie già; togli quelli che non servono.",
            "Quando finisce una prova, chi ha brani da studiare riceve una sola push con quei brani (“Da studiare: …”), nella sua lingua; chi l’ha chiusa vede invece il riepilogo. **Notifiche push** nelle Impostazioni la spegne.",
          ],
        },
        {
          type: "list",
          title: "Buono a sapersi",
          items: [
            "La Modalità palco è disponibile per i gig della band in programma e, come Modalità live, per le prove della band in programma; non per preventivi, eventi passati o gig personali.",
            "Lo schermo resta acceso finché la Modalità palco è aperta.",
            "**Schermo intero** (il pulsante con i quattro angoli in alto, nella barra laterale sui dispositivi a doppio schermo) nasconde le barre dell’app, la barra laterale e la barra di stato del telefono, e tiene lo schermo acceso. Con testi o griglie in scaletta mostra solo il brano (**Solo il brano**); senza, la scaletta prende tutto lo schermo e **Esci da schermo intero** o Indietro lo chiude.",
            "Senza scaletta, dice “Nessuna scaletta collegata a questo gig.”",
            "Nelle app per telefono e tablet, la scaletta con testi e spartiti resta salvata sul dispositivo quando apri il gig, così la Modalità palco funziona senza internet. Uscendo dall’account viene cancellata.",
            "Senza internet e senza una copia sul dispositivo, dice “Offline: non è stato possibile caricare la scaletta.” con **Riprova**.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Guida: sposta il brano corrente della band, riordina la scaletta tenendo premuto e trascinando un brano, toglie brani per stasera e avvia il click della band. Vedi [[lead-stage-mode]]." },
            { role: "member", text: "Segue il leader, oppure scorre i brani da solo. Vedi [[follow-in-stage-mode]]." },
            { role: "deputy", text: "Niente Modalità palco: i sostituti non hanno le scalette della band." },
          ],
        },
        { type: "shot", id: "music-stage", caption: "La Modalità palco il giorno del gig: programma, scaletta e Indietro / Avanti." },
      ],
    },
    {
      id: "lead-stage-mode",
      title: "Guida la band in Modalità palco",
      summary: "Da admin, sposta il brano corrente per tutti, cambia l’ordine dal vivo e togli i brani che non suonerai.",
      roles: ["admin"],
      kind: "task",
      keywords: ["leader", "brano successivo", "riordinare dal vivo", "trascinare", "togliere", "saltare un brano", "togliere un brano stasera", "la band ti segue", "sincronizzazione live"],
      related: ["stage-mode", "follow-in-stage-mode", "stage-click", "stage-bluetooth-sync"],
      body: [
        {
          type: "steps",
          items: [
            "Apri la Modalità palco sul gig.",
            "Controlla lo stato accanto alla scaletta: **Live** vuol dire che la band ti segue (**La band ti segue**).",
            "Tocca **Avanti** o **Indietro** per portare la band al brano successivo o precedente, oppure tocca un brano qualsiasi nell’elenco (**Vai a …**).",
            "Per cambiare l’ordine, tieni premuto un brano finché si solleva, trascinalo nel nuovo posto e lascialo. Uno scorrimento veloce fa comunque scorrere l’elenco, e un tocco rende comunque corrente il brano.",
            "Per saltare un brano stasera, tocca il pulsante rotondo − alla fine della sua riga (**Togli … per stasera**). Il titolo viene barrato e **Indietro** / **Avanti** lo saltano. Tocca + (**Rimetti …**) per rimetterlo.",
          ],
        },
        {
          type: "table",
          head: ["Stato", "Significato"],
          rows: [
            ["**Live**", "Connesso via internet: i membri ti seguono."],
            ["**Live · BT**", "Connesso via internet e in trasmissione anche via Bluetooth."],
            ["**Bluetooth**", "Niente internet: i membri vicini ti seguono via Bluetooth."],
            ["**Offline**", "In questo momento non arriva niente alla band."],
            ["**Salvataggio…**, **Salvato**, **Non salvato**", "Dopo un trascinamento: il nuovo ordine viene salvato poco dopo l’ultima mossa. **Salvato** compare per un attimo, poi torna lo stato."],
          ],
        },
        {
          type: "list",
          items: [
            "I membri che aprono la Modalità palco più tardi si allineano sul brano corrente.",
            "Un nuovo ordine vale per tutti, anche per i membri che hanno smesso di seguirti, e viene salvato nella scaletta del gig. Il gig dietro la Modalità palco lo mostra subito.",
            "Chiudendo la Modalità palco viene salvato uno spostamento ancora in attesa di salvataggio.",
            "Se più admin guidano insieme, vince l’ultima mossa.",
            "Togliere un brano vale solo per stasera: la scaletta del gig lo conserva. I membri che ti seguono lo vedono barrato e lo saltano anche loro, via internet o via Bluetooth. Il tuo telefono ricorda i brani tolti per quel gig se chiudi e riapri la Modalità palco.",
          ],
        },
        {
          type: "note",
          tone: "tip",
          text: "Tieni il telefono sbloccato: la Modalità palco tiene lo schermo acceso, e se il telefono del leader si blocca la sincronizzazione della band si ferma.",
        },
      ],
    },
    {
      id: "follow-in-stage-mode",
      title: "Segui il leader in Modalità palco",
      summary: "Da membro, lascia che il telefono dell’admin cambi i brani per te, oppure scorrili da solo.",
      roles: ["member"],
      kind: "task",
      keywords: ["seguire", "seguire il leader", "sincronizzazione", "stesso brano"],
      related: ["stage-mode", "lead-stage-mode", "stage-bluetooth-sync"],
      body: [
        {
          type: "steps",
          items: [
            "Apri la Modalità palco sul gig. Segui il leader è attivo: il pulsante accanto alla scaletta dice **In attesa del leader** finché non trova il telefono dell’admin, poi **Col leader**.",
            "Il brano corrente, il testo e gli accordi cambiano quando l’admin va avanti.",
            "Per guardare avanti per conto tuo, tocca **Indietro**, **Avanti** o un brano. Smetti di seguire e il pulsante dice **Segui il leader**.",
            "Tocca **Segui il leader** per tornare al brano del leader e seguirlo di nuovo.",
          ],
        },
        {
          type: "list",
          items: [
            "**· BT** dopo l’etichetta vuol dire che sei collegato al leader via Bluetooth.",
            "**Offline** vuol dire che in questo momento non arriva niente al tuo telefono.",
            "I membri non possono spostare il brano degli altri né cambiare l’ordine.",
            "Se compare **L’app del leader non è aggiornata: chiedi di aggiornarla**, stai comunque seguendo: al leader basta installare l’ultima versione di BandWith.",
          ],
        },
      ],
    },
    {
      id: "stage-click",
      title: "Usa il click in Modalità palco",
      summary: "Un metronomo visivo lungo il bordo dello schermo, a tempo su tutti i telefoni della band.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["metronomo", "click", "conteggio", "tempo", "bpm", "battito"],
      related: ["stage-mode", "transpose-and-tempo"],
      body: [
        {
          type: "steps",
          items: [
            "In Modalità palco, trova il pulsante del click tra **Indietro** e **Avanti**. Mostra il BPM del brano corrente.",
            "Toccalo (**Avvia il click**). Un bagliore lampeggia lungo il bordo dello schermo a ogni battito, più forte sul primo della battuta.",
            "Toccalo di nuovo (**Ferma il click**) per fermarlo.",
          ],
        },
        {
          type: "table",
          head: ["Chi lo avvia", "Cosa succede"],
          rows: [
            ["Admin", "Il click parte su tutti i telefoni in Modalità palco, a tempo con quello del leader."],
            ["Membro", "Il click parte solo sul tuo telefono."],
            ["Membro, mentre va il click del leader", "Il pulsante lo nasconde o lo mostra sul tuo telefono (**Nascondi il click su questo telefono**, **Mostra il click**)."],
          ],
        },
        {
          type: "list",
          items: [
            "Il click è solo visivo: non c’è suono. Non blocca i tocchi sullo schermo.",
            "I battiti per battuta vengono dal tempo in chiave della chart iReal del brano, altrimenti sono 4.",
            "Un brano senza BPM non può avviare il click (**Nessun BPM per questo brano**). Aggiungi il BPM nel modulo del brano.",
            "Passando a un altro brano, il click del brano precedente si nasconde.",
            "I telefoni restano a tempo entro circa 20–40 ms: va bene per un conteggio iniziale e come riferimento di tempo, non come click in cuffia.",
            "Il click della band ha bisogno di internet: non viene inviato via Bluetooth.",
          ],
        },
      ],
    },
    {
      id: "stage-manager",
      title: "Suona l’audio dei brani dalla regia",
      summary: "Il portatile o il tablet di un admin, collegato al mixer, suona la registrazione di ogni brano, e gli schermi della band passano al brano in play.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["regia", "basi", "base", "audio", "mixer", "riproduzione", "cavo", "usb-c", "jack cuffie", "adattatore", "impianto", "offline", "senza internet", "scaricare"],
      related: ["stage-mode", "lead-stage-mode", "follow-in-stage-mode", "play-a-song-recording"],
      body: [
        {
          type: "p",
          text: "Il portatile o il tablet di un admin, collegato al mixer, fa da regia: è l’unico dispositivo che suona l’audio dei brani. Quando suona un brano, tutti gli schermi in Modalità palco passano a quel brano, anche fuori dall’ordine della scaletta. I telefoni dei membri non suonano mai.",
        },
        {
          type: "steps",
          title: "Prima del gig",
          items: [
            "Dai a ogni brano una **Registrazione** (un file audio) nella scheda del brano. I brani senza muovono comunque la band, ma non suona niente.",
            "Collega il dispositivo al mixer (vedi i consigli sul cavo più sotto) e attiva Non disturbare, così le notifiche non escono dall’impianto.",
            "Nei giorni prima, con internet, apri il gig: sotto la scaletta, **Audio su questo dispositivo** conta i brani già qui (per esempio 3/10). Tocca **Scarica l’audio** per scaricare gli altri. Nell’app sul telefono parte da solo quando apri l’app con internet nei 3 giorni prima di un gig confermato. I file restano sul dispositivo e non finiscono nel backup del telefono.",
            "Apri il gig mentre sei online, apri la Modalità palco e tocca **Regia: audio da qui**. Il dispositivo scarica l’audio della serata: una barra mostra a che punto è, e l’anello attorno al ▶ di ogni brano si riempie mentre scarica.",
            "Aspetta che **Audio pronto** conti tutti i brani (per esempio 10/10): da lì suona anche senza internet. Se un brano non si scarica, la regia te lo dice (vedi sotto).",
          ],
        },
        {
          type: "steps",
          title: "Sul palco",
          items: [
            "Tocca ▶ su un brano per suonarlo. Lo schermo di tutti passa a quel brano e mostra **In riproduzione** con il tempo.",
            "Il player in alto ha **Riproduci** / **Pausa**; a fine brano, lo stesso tasto suona il successivo. **Stop** va tenuto premuto, così un tocco per sbaglio non ferma la musica.",
            "Un brano senza audio, o che qui non si può suonare, lo dice sul player, e **Riproduci** diventa **Riproduci il prossimo** con il primo brano che si può suonare. Intanto la band lo suona dal vivo.",
            "Per un brano che non è in scaletta, tocca + (**Suona un brano fuori scaletta**) e sceglilo dal repertorio. Entra in scaletta subito dopo il brano attuale, per tutti.",
            "Per passare la regia, l’altro admin tocca **Regia: audio da qui** sul suo dispositivo e poi **Prendila**: il tuo audio si ferma. **Disattiva** chiude la regia sul tuo dispositivo.",
          ],
        },
        {
          type: "table",
          head: ["Chi", "Cosa vede"],
          rows: [
            ["La regia (un admin)", "Il player, ▶ su ogni brano con l’audio, dove esce il suono (**Uscita**) e quanti brani sono pronti."],
            ["Gli altri admin e i membri", "Il brano in play, con **In riproduzione** o **In pausa** e il tempo. Se sei su un altro brano, **Vai** ti porta lì."],
            ["Tutti, quando la regia esce", "La striscia sparisce. La Modalità palco funziona come prima."],
          ],
        },
        {
          type: "p",
          text: "Quando un brano non si scarica, tocca **1 non scaricato** sotto **Audio pronto**: una pagina elenca i brani e il motivo. Sistema, poi tocca **Riprova**.",
        },
        {
          type: "table",
          head: ["Cosa dice", "Cosa fare"],
          rows: [
            ["Il link non porta a un file audio", "La registrazione del brano è un link che apre una pagina, non il file. Su Google Drive condividi il file come “Chiunque abbia il link”, oppure carica il file nel brano."],
            ["Niente internet", "Collegati: il brano si scarica da solo appena torni online."],
            ["Questo dispositivo non riesce a riprodurre il file", "Usa un file MP3, M4A o WAV."],
            ["Il download si è interrotto", "Tocca **Riprova**."],
          ],
        },
        {
          type: "list",
          title: "Il cavo al mixer",
          items: [
            "Portatili, iPad e telefoni con l’uscita cuffie: un cavo minijack (3,5 mm) nell’ingresso del mixer, per esempio da 3,5 mm a due jack da 6,3 mm o a due RCA.",
            "iPad e iPhone senza jack (USB-C o Lightning): l’adattatore Apple da USB-C (o Lightning) a 3,5 mm, poi lo stesso cavo. Per caricare intanto, usa un adattatore con una porta USB-C di ricarica (PD).",
            "Mixer con ingresso USB (molti mixer digitali): un cavo USB-C porta il suono direttamente dentro. Lo stesso vale per una scheda audio USB class compliant.",
            "Mai il Bluetooth: arriva in ritardo e può saltare. L’app ti avvisa quando il suono va via Bluetooth o esce dall’altoparlante del dispositivo.",
            "Alza il volume del dispositivo quasi al massimo e regola il livello sul mixer.",
          ],
        },
        {
          type: "note",
          tone: "warning",
          text: "Se il cavo si stacca, il suono può fermarsi o passare all’altoparlante del dispositivo. L’app mostra subito un avviso: ricollega il cavo.",
        },
        {
          type: "devices",
          rows: [{ devices: ["web"], text: "Su un portatile nel browser, l’audio lo tiene il browser: usa sempre lo stesso browser e non cancellarne i dati prima del gig. Anche i link di Google Drive si scaricano, se il file è condiviso come “Chiunque abbia il link”." }],
        },
      ],
    },
    {
      id: "stage-bluetooth-sync",
      title: "Modalità palco senza internet (Bluetooth)",
      summary: "Come la band resta sullo stesso brano via Bluetooth quando nel locale non c’è campo.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["bluetooth", "offline", "senza campo", "senza wifi", "ble", "chiave palco"],
      related: ["stage-mode", "lead-stage-mode", "follow-in-stage-mode"],
      body: [
        {
          type: "p",
          text: "Nelle app per iPhone, iPad e Android, il telefono dell’admin invia il brano corrente e l’ordine anche via Bluetooth. I telefoni dei membri vicini li ricevono senza abbinamento e senza internet.",
        },
        {
          type: "steps",
          title: "Preparati prima del gig",
          items: [
            "Ognuno apre il gig una volta mentre è online. L’app salva sul telefono la scaletta (con testi e spartiti) e la chiave Bluetooth del gig.",
            "Attiva il Bluetooth e consenti a BandWith di usarlo.",
            "Sul palco, tutti aprono la Modalità palco. Il leader mostra **Bluetooth** o **Live · BT**; i membri mostrano **· BT** dopo l’etichetta di chi seguono.",
          ],
        },
        {
          type: "list",
          title: "Quando non si collega",
          items: [
            "“Il Bluetooth è spento o non consentito. Attivalo in Impostazioni per restare sincronizzato senza internet.”",
            "“Questo telefono ha una scaletta vecchia. Collegati a internet una volta per seguire via Bluetooth.” Compare quando sono stati aggiunti o tolti brani dopo l’ultima volta che il telefono ha caricato la scaletta. Un nuovo ordine da solo va bene.",
          ],
        },
        {
          type: "note",
          tone: "privacy",
          text: "Ogni gig ha una sua chiave segreta, data solo ai membri attivi della band. Solo i telefoni con la chiave trovano il leader e accettano i suoi messaggi.",
        },
        {
          type: "devices",
          rows: [{ devices: ["web"], text: "Niente sincronizzazione Bluetooth e niente copia della scaletta sul dispositivo: sul web la Modalità palco ha bisogno di internet." }],
        },
      ],
    },
    {
      id: "stage-mode-on-devices",
      title: "La Modalità palco su telefoni, tablet e dispositivi a doppio schermo",
      summary: "Come si dispone la Modalità palco su ogni dispositivo e posizione.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["orizzontale", "ipad", "surface duo", "spia da palco", "posizione laptop", "schermo intero", "barra laterale", "voltapagine"],
      related: ["stage-mode", "device-differences"],
      body: [
        {
          type: "devices",
          rows: [
            { devices: ["phone"], text: "Una colonna: intestazione, programma della serata, scaletta o brano, Indietro / Avanti in basso." },
            { devices: ["phoneLand", "duoClosed"], text: "In orizzontale (basso e largo), orari e passaggi stanno a sinistra e la scaletta o il brano a destra. Con un brano aperto, la colonna di sinistra mostra invece la scaletta, così puoi saltare a qualsiasi brano." },
            { devices: ["tablet", "duoBook", "duoLand"], text: "La Modalità palco si apre accanto al pannello dell’elenco. **Schermo intero** mostra solo il brano su tutto lo schermo (**Solo il brano**). Una scaletta senza testi né griglie prende invece tutto lo schermo: orari e passaggi nel primo pannello e la scaletta nel secondo, divisi al bordo dei pannelli così che niente finisca sulla piega; **Esci da schermo intero** riporta l’elenco. Con un brano aperto, la scaletta sta in una colonna accanto (nel primo pannello quando il dispositivo è aperto su entrambi)." },
            { devices: ["duoClosed"], text: "**Apri modalità palco** si trova nella barra laterale; il giorno del gig è la sua azione principale. **Schermo intero** nasconde la barra in Modalità palco." },
            { devices: ["duoLaptop"], text: "Spia da palco: appoggia il dispositivo sul pavimento del palco come un monitor. La metà superiore mostra il contatore dei brani (**Brano … di …**), titolo, tonalità, BPM, brano successivo e tempo trascorso, oppure il testo. La metà inferiore ha grandi tasti **Indietro** e **Avanti** e l’avanzamento del set; i brani tolti per stasera vengono saltati e i loro segmenti di avanzamento sono attenuati. Anche frecce, Pagina su/giù e Spazio fanno avanzare, quindi funzionano i pedali voltapagine Bluetooth." },
            { devices: ["duoBook", "duoLaptop"], text: "**Solo il brano**: su un dispositivo aperto su due schermi, il brano e i suoi quattro pulsanti occupano lo schermo più largo, così niente cade sulla piega. Piegato come un portatile, il brano riempie la metà alta e la metà bassa ha solo **Mostra tutto**, **Indietro**, il click e **Avanti**." },
            { devices: ["web"], text: "Funzionano la sincronizzazione live via internet e il click. Niente Bluetooth e niente copia offline della scaletta. Lo schermo intero nasconde anche le barre del browser, dove il browser lo permette." },
          ],
        },
        { type: "p", text: "Il tasto Indietro di Android ed Esc chiudono prima la Modalità palco, non il gig sottostante." },
      ],
    },
  ],

  faq: [
    {
      q: "I membri possono modificare brani o scalette?",
      a: "No. I membri leggono tutti i brani e le scalette. Suggeriscono nuovi brani e modifiche a testi, accordi o note, e un admin li rivede. Solo gli admin possono modificare le scalette.",
      roles: ["member"],
    },
    {
      q: "Chi vede le mie note su un brano?",
      a: "Solo tu. Non la band, non gli admin. Per condividerne una, aprila e tocca Suggerisci alla band.",
    },
    {
      q: "Ho trasposto un brano nel lettore. È cambiato per tutti?",
      a: "No. Trasporre nel lettore o in Modalità palco cambia solo il tuo schermo. Per cambiare la tonalità per la band, un admin usa Trasponi per la band nel modulo del brano.",
    },
    {
      q: "Perché non posso importare una lista di brani?",
      a: "Una lista importata finisce direttamente nella libreria della band, quindi è riservata agli admin. I membri suggeriscono i brani uno alla volta.",
      roles: ["member"],
    },
    {
      q: "Se cambio la scaletta di un gig, cambia anche la scaletta salvata da cui l’ho caricata?",
      a: "No. Il gig riceve una sua copia, con il nome del gig. La scaletta da cui l’hai caricata resta com’era.",
      roles: ["admin"],
    },
    {
      q: "La band riceve una notifica per ogni brano che sposto?",
      a: "No. Non parte niente finché non salvi. Poi ognuno riceve una sola push che riassume cosa è cambiato.",
      roles: ["admin"],
    },
    {
      q: "La Modalità palco funziona senza internet?",
      a: "Nelle app per telefono e tablet sì: apri il gig una volta mentre sei online, e il telefono del leader tiene la band sincronizzata via Bluetooth. Sul web la Modalità palco ha bisogno di internet.",
    },
    {
      q: "Posso sentire il click?",
      a: "No. Il click è visivo: un bagliore lungo il bordo dello schermo a ogni battito.",
    },
    {
      q: "Perché il mio telefono smette di seguire il leader?",
      a: "Se tocchi tu Indietro, Avanti o un brano, smetti di seguire. Tocca Segui il leader per tornare al brano del leader.",
      roles: ["member"],
    },
    {
      q: "Cosa succede a un brano suggerito che l’admin rifiuta?",
      a: "Viene eliminato insieme ai file che hai allegato, e ricevi una push con il motivo dell’admin, se l’ha scritto.",
      roles: ["member"],
    },
    {
      q: "Perché sul web non vedo il forum di iReal Pro dentro l’app?",
      a: "Il forum non si può mostrare dentro una pagina web, quindi si apre in una finestra a parte. Copia lì un link e tocca Incolla link, oppure trascina il link sulla casella.",
    },
  ],

  glossary: [
    { term: "Repertorio", definition: "La libreria dei brani della band. Ogni membro attivo legge tutti i brani.", see: "repertoire-overview" },
    { term: "Pronto / In studio / Proposto", definition: "Lo stato di un brano: suonato dalla band, in fase di studio, oppure proposto da un membro e in attesa di un admin.", see: "song-menu-actions" },
    { term: "Scaletta", definition: "Un elenco ordinato di brani della band per un gig o un’occasione, scritto dagli admin.", see: "build-a-setlist" },
    { term: "Set", definition: "Una parte di una scaletta, per esempio prima e dopo una pausa (Set 1, Set 2).", see: "setlists-and-sets" },
    { term: "Scaletta modello", definition: "Una scaletta salvata che carichi in un gig; il gig riceve una sua copia.", see: "setlists-and-sets" },
    { term: "Accordi in linea", definition: "Accordi scritti tra parentesi quadre subito prima della parola su cui cadono, come [Am]parola.", see: "lyrics-and-chords-format" },
    { term: "ChordPro", definition: "Un formato di testo per i testi con gli accordi tra parentesi. BandWith importa i file .cho, .chordpro e .pro.", see: "import-chords-and-lyrics" },
    { term: "MusicXML", definition: "Un formato di file per le partiture. BandWith ne legge le sigle degli accordi e il testo.", see: "import-chords-and-lyrics" },
    { term: "Chart di iReal Pro", definition: "Una griglia accordi battuta per battuta con forma, tonalità, stile e tempo, importata da un link di iReal Pro.", see: "import-from-ireal-pro" },
    { term: "Vista del brano", definition: "Come viene mostrato un brano: Testo, Testo e accordi o Griglia accordi. Viene ricordata per dispositivo.", see: "read-a-song" },
    { term: "Griglia accordi", definition: "Solo gli accordi: le sezioni del brano con i loro accordi in caselle, oppure la chart iReal battuta per battuta.", see: "read-a-song" },
    { term: "Solo il brano", definition: "Lo schermo intero della Modalità palco e della Modalità live: solo il brano, una riga piccola che lo nomina, e Mostra tutto, Indietro, il click e Avanti in basso.", see: "stage-mode" },
    { term: "Trasponi per la band", definition: "Spostare tonalità, chart e accordi di un brano per tutti, dal modulo del brano.", see: "transpose-and-tempo" },
    { term: "Le mie note", definition: "Note e file privati su un brano della band, visibili solo a te.", see: "my-notes-and-files" },
    { term: "Suggerimento", definition: "La proposta di un membro: un nuovo brano, una correzione al testo o agli accordi, oppure una nota per la band.", see: "review-song-suggestions" },
    { term: "Modalità palco", definition: "La schermata nera del giorno del gig con programma della serata, scaletta e brano corrente.", see: "stage-mode" },
    { term: "Leader", definition: "In Modalità palco, l’admin della band i cui cambi di brano e di ordine arrivano a tutti i membri.", see: "lead-stage-mode" },
    { term: "Segui il leader", definition: "L’impostazione della Modalità palco di un membro che tiene il suo brano corrente su quello del leader.", see: "follow-in-stage-mode" },
    { term: "Click", definition: "Il metronomo visivo della Modalità palco: un bagliore a ogni battito, a tempo su tutti i telefoni.", see: "stage-click" },
    { term: "Programma della serata", definition: "Gli orari di Carico, Soundcheck, Show e Fine in cima alla Modalità palco.", see: "stage-mode" },
    { term: "Spia da palco", definition: "La Modalità palco su un dispositivo a doppio schermo in posizione laptop: info sul brano in alto, grandi tasti Indietro / Avanti in basso.", see: "stage-mode-on-devices" },
  ],
};

export default music;
