import type { AreaText } from '../../types';

const people: AreaText = {
  area: {
    id: "people",
    title: "Membri, sostituti e attrezzatura",
    intro: "Chi fa parte della band, chi sostituisce quando qualcuno non può suonare, l’attrezzatura che porti ai gig e chi può vedere cosa.",
    icon: "people",
  },

  articles: [
    // ── Members ──────────────────────────────────────────────────────────
    {
      id: "band-members",
      title: "La schermata Membri della band",
      summary: "Tutti quelli della band, con ruolo e strumento, più il pulsante per invitare e l’elenco dei sostituti per gli admin.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["membri", "formazione", "organico", "elenco della band", "persone"],
      related: ["invite-members", "member-detail", "member-roles", "deputies", "who-sees-what"],
      body: [
        { type: "p", text: "**Membri della band** elenca tutti quelli della band che hai selezionato. Il nome della band compare sopra il titolo." },
        {
          type: "steps",
          title: "Aprirla",
          items: [
            "Nella Home, sotto **Azioni rapide**, tocca **Membri**.",
            "Oppure tocca il tuo avatar in alto a destra per aprire il menu Profilo e account, poi tocca **Membri** nella scheda della band attuale.",
          ],
        },
        {
          type: "list",
          title: "Cosa vedi",
          items: [
            "Tre contatori: **Totale**, **Admin** e **Membri**.",
            "Una riga per persona: foto o iniziali, nome (il nome d’arte, se c’è), strumento e ruolo (**Admin** o **Membro**). Un’etichetta **Pro** indica chi ha un piano a pagamento.",
            "Tocca una riga per aprire la pagina di quella persona. Vedi [[member-detail]].",
            "Tocca **⋯** (**Azioni per {name}**) su una riga per un breve menu: **Email**; sulla tua riga **Esci dalla band**; per gli admin, sulle righe degli altri, **Rendi admin** o **Rendi membro** e **Rimuovi dalla band**.",
            "Gli admin vedono anche il pulsante **Invita membro** (in alto a destra e in fondo) e, sotto l’elenco, la sezione **Sostituti**. Vedi [[deputies]].",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Vede tutti, invita persone, cambia i ruoli, rimuove membri e gestisce i sostituti." },
            { role: "member", text: "Vede tutti e i loro contatti, e può scrivere loro un’email. Niente pulsante per invitare, niente cambi di ruolo, niente elenco dei sostituti." },
          ],
        },
        { type: "shot", id: "people-band-members", caption: "Membri della band visti da un admin: contatori, formazione e pulsante Invita membro." },
        {
          type: "devices",
          rows: [
            { devices: ["duoLaptop"], text: "I tre contatori stanno nella metà superiore; l’elenco delle persone nella metà inferiore." },
            { devices: ["duoBook", "duoLand", "tablet"], text: "La pagina di una persona si apre accanto all’elenco invece di coprirlo." },
            { devices: ["android"], text: "Il gesto Indietro chiude prima la pagina della persona, poi Membri della band." },
          ],
        },
        { type: "note", tone: "tip", text: "Una band vuota mostra **Ancora nessun membro** e, per gli admin, **Invita il primo membro**." },
      ],
    },
    {
      id: "invite-members",
      title: "Invita qualcuno nella band",
      summary: "Trova un utente BandWith per nome o email, oppure invita una persona nuova via email, link o codice.",
      roles: ["admin"],
      kind: "task",
      keywords: ["invitare", "aggiungere membro", "codice invito", "link d’invito", "entrare"],
      related: ["accept-an-invite", "member-roles", "band-members"],
      body: [
        { type: "p", text: "Nessuno viene aggiunto a una band senza dire sì. Tu mandi un invito; la persona lo accetta." },
        {
          type: "steps",
          items: [
            "In **Membri della band**, tocca **Invita membro** (il + in alto a destra o il pulsante in fondo).",
            "Scrivi almeno 3 caratteri di un nome o di un indirizzo email nel campo di ricerca.",
            "Se la persona è già su BandWith, compare sotto **Trovati su BandWith**. Tocca **Invito** accanto al suo nome.",
            "Se non trovi nessuno, scrivi l’indirizzo email completo e tocca **Invita {email}**.",
            "Prima di inviare, scegli il ruolo sotto **Ruolo**: **Membro** (“Vede i contenuti della band”) o **Admin** (“Gestisce membri, eventi e impostazioni”). Di default è selezionato Membro.",
            "Per chi è nuovo su BandWith, il foglio mostra poi il **Codice invito**. Tocca **Condividi** per mandare link e codice con qualsiasi app, oppure **Copia codice**.",
          ],
        },
        {
          type: "list",
          title: "Cosa succede dopo",
          items: [
            "Utente già registrato: riceve una notifica e una scheda **Invito band** la prossima volta che apre BandWith. Tu vedi “Invito inviato a {name}”.",
            "Persona nuova: BandWith manda l’invito via email quando può. Vedi “Invito inviato via email a {name}” oppure, senza email, “Invito creato per {name}. Condividilo per farlo entrare nella band.”",
            "Un invito vale 7 giorni. Quando mancano 2 giorni o meno, l’indirizzo invitato riceve un’email di promemoria. Se scade, ricevi tu un’email.",
            "Invitare di nuovo lo stesso indirizzo rinnova l’invito per altri 7 giorni.",
            "Quando entra, tutti nella band ricevono “{name} ora è in {band}”.",
          ],
        },
        {
          type: "list",
          title: "Vedi chi non è ancora entrato",
          items: [
            "Gli admin vedono gli inviti aperti in **Membri della band**, sotto **Invitati**: l’email, il ruolo e **Non ancora accettato**, **Scaduto** o **Rifiutato**.",
            "Tocca ⋯ accanto a un invito, poi **Invia di nuovo**: l’invito vale altri 7 giorni e riparte. Per un invito scaduto o rifiutato il pulsante è **Invita di nuovo**.",
            "**Copia link** copia il link d’invito, così puoi mandarlo tu a chi è nuovo su BandWith.",
            "**Annulla invito**, poi **Sì, annullalo**: il link e il codice smettono di funzionare.",
          ],
        },
        { type: "note", tone: "privacy", text: "I risultati della ricerca mostrano le email in parte nascoste (per esempio gi•••@…), a meno che tu non scriva l’indirizzo esatto. Chi è già nella band non compare." },
        { type: "shot", id: "people-invite", caption: "Il foglio Invita membro con ricerca, risultati e scelta del ruolo." },
        { type: "note", tone: "tip", text: "L’invito è legato all’indirizzo email. Per entrare, la persona deve accedere con quell’indirizzo." },
      ],
    },
    {
      id: "accept-an-invite",
      title: "Entra in una band con un invito",
      summary: "Accetta un invito nell’app, dal link d’invito o incollando il codice invito.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["entrare nella band", "accettare invito", "codice invito", "rifiutare invito"],
      related: ["invite-members", "member-roles"],
      body: [
        {
          type: "steps",
          title: "Usi già BandWith",
          items: [
            "Apri BandWith. Una scheda **Invito band** mostra chi ti ha invitato, la band, quante persone ha e il tuo ruolo (**come membro** o **come admin**).",
            "Tocca **Entra nella band**. Vedi “Sei entrato in {band}” e la band compare tra le tue band.",
            "Oppure tocca **Rifiuta**. Per decidere più tardi, tocca la X (**Decidi dopo**); la scheda ricompare la volta successiva.",
          ],
        },
        {
          type: "steps",
          title: "Sei nuovo su BandWith",
          items: [
            "Apri il link d’invito dal messaggio o dall’email. Oppure, nella schermata di benvenuto, tocca **Ho un codice invito**, incolla il codice o il link in **Codice o link d’invito** e tocca **Entra**.",
            "Controlla la scheda della band e tocca **Accetta e continua** (oppure **Rifiuta invito**).",
            "Crea il tuo account o accedi con l’indirizzo email a cui è arrivato l’invito. Sei nella band appena l’account è pronto.",
          ],
        },
        {
          type: "list",
          title: "Se non funziona",
          items: [
            "“Questo invito è stato inviato a un’altra email” vuol dire che hai fatto l’accesso con un altro indirizzo. Esci e usa quello invitato.",
            "“Questo invito è scaduto” o “non è più valido”: chiedi a un admin di invitarti di nuovo.",
            "“Questo non sembra un codice invito”: incolla il codice completo o tutto il link.",
          ],
        },
      ],
    },
    {
      id: "member-roles",
      title: "Ruoli di admin e membro",
      summary: "Cosa può fare un admin che un membro non può, e la regola per cui ogni band ha sempre almeno un admin.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["admin", "membro", "permessi", "ruolo", "co-gestire", "proprietario"],
      related: ["make-admin", "who-sees-what", "remove-a-member"],
      body: [
        { type: "p", text: "Ogni persona in una band è **Admin** o **Membro**. Una band può avere più admin. Chi crea una band ne è il primo admin." },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Crea e modifica gig, prove e preventivi; imposta i compensi e segna i pagamenti; modifica scalette, brani, contratti, checklist e kit di attrezzatura; invita e rimuove persone; cambia i ruoli; gestisce i sostituti; modifica i dati della band e i prezzi; vede le finanze e le statistiche della band." },
            { role: "member", text: "Vede i gig della band e la logistica, risponde agli inviti a suonare, legge scalette e brani, suggerisce brani e modifiche, tiene note private sui brani, usa la chat, aggiunge e modifica la propria attrezzatura personale e vede solo il proprio compenso." },
          ],
        },
        { type: "note", tone: "warning", text: "Una band ha bisogno di almeno un admin. L’app non ti lascia rimuovere l’ultimo admin né renderlo membro: “Una band ha bisogno di almeno un admin. Prima rendi admin qualcun altro.” La stessa regola ti impedisce di eliminare il tuo account finché sei l’unico admin di una band." },
        { type: "p", text: "Co-gestire una band (essere uno di più admin) è una funzione dei piani a pagamento. Durante la beta tutti possono essere resi admin. Fuori dalla beta, **Rendi admin** mostra “Serve un account Pro per co-gestire” per chi ha il piano gratuito." },
        { type: "p", text: "Per l’elenco completo dei dati che ogni ruolo può leggere, vedi [[who-sees-what]]." },
      ],
    },
    {
      id: "make-admin",
      title: "Rendi qualcuno admin, o riporta un admin a membro",
      summary: "Cambia il ruolo di una persona dall’elenco Membri della band o dalla sua pagina.",
      roles: ["admin"],
      kind: "task",
      keywords: ["rendere admin", "togliere admin", "declassare", "promuovere", "cambiare ruolo"],
      related: ["member-roles", "band-members"],
      body: [
        {
          type: "steps",
          items: [
            "In **Membri della band**, tocca **⋯** sulla riga della persona. Oppure tocca la riga per aprire la sua pagina.",
            "Tocca **Rendi admin** per darle i diritti di admin, o **Rendi membro** per toglierli.",
          ],
        },
        { type: "p", text: "La modifica viene salvata subito, senza conferma. La persona vede il nuovo ruolo la prossima volta che si carica il suo elenco della band. Poi il suo telefono elimina i dati della band salvati per l’uso offline e li ricarica per il nuovo ruolo: un nuovo admin vede il cliente e i prezzi, un ex admin non li tiene più sul telefono." },
        { type: "note", tone: "warning", text: "Non puoi rendere membro l’ultimo admin. Prima rendi admin qualcun altro." },
        { type: "note", tone: "tip", text: "Non puoi cambiare il tuo ruolo: la tua pagina e il menu **⋯** sulla tua riga non hanno i pulsanti del ruolo. Chiedi a un altro admin di renderti membro." },
      ],
    },
    {
      id: "remove-a-member",
      title: "Rimuovi un membro dalla band",
      summary: "Togli qualcuno dalla band; perde l’accesso a eventi, chat e repertorio.",
      roles: ["admin"],
      kind: "task",
      keywords: ["rimuovere membro", "cacciare", "eliminare membro"],
      related: ["leave-a-band", "invite-members", "member-roles"],
      body: [
        {
          type: "steps",
          items: [
            "In **Membri della band**, tocca **⋯** sulla riga della persona e poi **Rimuovi dalla band**. Oppure apri la sua pagina e tocca **Rimuovi dalla band** in fondo.",
            "Leggi il foglio **Rimuovere dalla band?** e tocca **Rimuovi**. Tocca **Annulla** per tenerla.",
          ],
        },
        {
          type: "list",
          title: "Cosa succede",
          items: [
            "Perde subito l’accesso a eventi, chat e repertorio della band.",
            "Riceve una notifica “Non sei più in {band}”. Il resto della band riceve “{name} ha lasciato {band}”.",
            "I suoi gig passati, le risposte e i pagamenti restano nei registri della band.",
            "Più avanti puoi invitarla di nuovo.",
          ],
        },
        { type: "note", tone: "warning", text: "Non si può annullare. Per riportare la persona nella band, manda un nuovo invito e aspetta che lo accetti." },
      ],
    },
    {
      id: "leave-a-band",
      title: "Esci da una band",
      summary: "Come funziona l’uscita per gli admin e per i membri.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["uscire dalla band", "lasciare la band", "abbandonare la band"],
      related: ["remove-a-member", "member-roles"],
      body: [
        {
          type: "roles",
          rows: [
            { role: "member", text: "Puoi uscire da qualsiasi band di cui fai parte, quando vuoi." },
            { role: "admin", text: "Puoi uscire se la band ha un altro admin. Se sei l’unico, l’app ti chiede di rendere prima admin qualcun altro ([[make-admin]])." },
          ],
        },
        {
          type: "steps",
          items: [
            "Apri **Membri della band** per quella band.",
            "Tocca **⋯** sulla tua riga e poi **Esci dalla band**. (Puoi anche toccare la tua riga e usare **Esci dalla band** in fondo.)",
            "Il foglio chiede “Uscire da {band}?”: perdi l’accesso a eventi, chat e repertorio della band. Tocca **Esci dalla band** per confermare, oppure **Annulla**.",
          ],
        },
        { type: "p", text: "Quando esci, gli altri ricevono “{name} ha lasciato {band}”. L’app ti porta nell’altra tua band, oppure alla schermata iniziale se non ne hai. Puoi rientrare solo con un nuovo invito." },
        { type: "note", tone: "warning", text: "Eliminare il tuo account (Impostazioni, **Elimina account**) ti fa uscire anche da tutte le band. Se sei l’unico admin di una band, prima rendi admin qualcun altro." },
      ],
    },
    {
      id: "member-detail",
      title: "La pagina di un membro",
      summary: "Chi è, i gig e i compensi di quest’anno, i prossimi eventi, i contatti e i pulsanti del ruolo.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["profilo membro", "statistiche membro", "pagato quest’anno", "contatto", "telefono", "email"],
      related: ["band-members", "who-sees-what", "make-admin"],
      body: [
        { type: "p", text: "Tocca una persona in **Membri della band** per aprire la sua pagina." },
        {
          type: "list",
          items: [
            "In alto: foto, nome, strumento e ruolo.",
            "**Gig quest’anno**: i gig suonati più quelli in arrivo, con un indicatore a pallini. **Pagato · {year}**: quanto ha ricevuto, e quanto le si deve ancora.",
            "**Prossimi per {name}**: i suoi prossimi eventi in questa band, ognuno con la sua risposta (confermato, in attesa, rifiutato).",
            "**Contatti**: email e telefono, ognuno con un pulsante per copiarlo. Toccane uno per scrivere o chiamare.",
            "**Messaggio** apre una chat diretta. **Rendi admin** / **Rendi membro** e **Rimuovi dalla band** sono per gli admin.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Vede i contatori di gig e compensi di tutti, e tutte le azioni tranne che sulla propria pagina." },
            { role: "member", text: "Vede i contatori di gig e compensi solo sulla propria pagina. Sulla pagina di un altro: nome, strumento, prossimi eventi e contatti. **Messaggio** compare solo sulla pagina di un admin, perché i membri possono iniziare una chat diretta solo con gli admin." },
          ],
        },
        { type: "note", tone: "privacy", text: "Un membro non vede mai quanto viene pagato un altro membro. I contatori arrivano da una funzione del server che restituisce tutti i membri agli admin e solo la tua riga a te." },
        {
          type: "devices",
          rows: [
            { devices: ["phone", "duoClosed"], text: "Si apre a tutto schermo." },
            { devices: ["duoBook", "duoLand"], text: "Si apre sul secondo schermo, accanto all’elenco." },
            { devices: ["tablet"], text: "Si apre nella colonna dei dettagli accanto all’elenco." },
          ],
        },
      ],
    },
    {
      id: "default-fees-and-instruments",
      title: "Compensi abituali e strumenti",
      summary: "Da dove vengono lo strumento di un membro e il compenso già compilato, e dove cambiarli.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["compenso abituale", "compenso di default", "tariffa", "strumento", "ruolo", "paga"],
      related: ["who-sees-what", "deputies", "gig-workspace"],
      body: [
        { type: "p", text: "Ogni persona di una band può avere un compenso abituale. Quando un admin la aggiunge a un nuovo gig o preventivo, il suo compenso viene già compilato con quello (le prove non hanno compenso); se non c’è, si usa la tariffa del membro impostata in **Prezzi, compensi e servizi**. L’admin può cambiare il compenso su ogni gig." },
        {
          type: "steps",
          title: "Admin: cambiare lo strumento o il compenso abituale di un membro",
          items: [
            "In **Membri della band**, tocca la riga della persona.",
            "Sotto **Nella band**, scrivi lo **Strumento in questa band** (se vuoto, compare lo strumento del suo profilo) e il **Compenso abituale** (facoltativo, un numero come 150).",
            "Tocca **Salva**. Il compenso abituale viene usato per i nuovi gig.",
          ],
        },
        { type: "p", text: "Un membro che apre la propria riga vede “Il tuo compenso abituale in questa band: {fee}” quando ne ha uno." },
        { type: "p", text: "Il tuo strumento principale è nel tuo profilo: tocca il tuo avatar, poi **Modifica** sulla scheda del profilo, e sceglilo sotto **Strumento / ruolo principale**. Compare sulla tua scheda nel menu Profilo e account." },
        { type: "p", text: "Lo strumento accanto a ogni nome in **Membri della band** è quello salvato per quella persona in questa band. La scheda **Chi copre cosa** dei sostituti raggruppa la band secondo questi strumenti." },
        { type: "note", tone: "privacy", text: "I compensi abituali seguono la regola dei soldi: gli admin vedono quelli di tutti, un membro vede solo il proprio." },
      ],
    },
    {
      id: "band-details",
      title: "Cambia nome, logo, città e bio della band",
      summary: "Modifica la scheda della band nel menu Profilo e account; il logo finisce anche sui PDF dei preventivi.",
      roles: ["admin"],
      kind: "task",
      keywords: ["nome della band", "logo", "foto della band", "città di base", "città", "slogan", "bio", "rinominare band"],
      related: ["member-roles", "band-members"],
      body: [
        {
          type: "steps",
          items: [
            "Tocca il tuo avatar in alto a destra per aprire il menu Profilo e account.",
            "Nella scheda della band attuale, tocca **Modifica**.",
            "Sotto **Logo della band**, tocca **Carica** (o **Cambia**) e scegli un’immagine. Tocca il cestino (**Rimuovi logo**) per toglierlo.",
            "Cambia **Nome della band**, **Città di base** (scegli uno dei **Luoghi suggeriti**, così i costi di trasferta possono usarne la posizione) e **Bio / slogan della band (facoltativo)**.",
            "Tocca **Salva dettagli**. Tocca **Annulla** o **Chiudi** per uscire senza salvare.",
          ],
        },
        { type: "p", text: "Il logo compare sulla scheda della band, nel selettore delle band e sui PDF dei preventivi. La città di base diventa anche il punto di partenza per i costi di trasferta nel tuo listino." },
        { type: "p", text: "**Impostazioni band** sotto la scheda della band apre il branding e i prezzi della band (conto bancario, tariffe dei musicisti, servizi per i preventivi). Vedi [[pricing-sheet]]." },
        { type: "note", tone: "privacy", text: "I membri vedono nome, logo, città e bio della band, mai i suoi dati bancari, fiscali o i prezzi." },
      ],
    },

    // ── Deputies ─────────────────────────────────────────────────────────
    {
      id: "deputies",
      title: "Sostituti: i musicisti che ti coprono",
      summary: "L’elenco dei turnisti della band, come arrivano loro le richieste e cosa possono e non possono vedere.",
      roles: ["admin", "deputy"],
      kind: "reference",
      keywords: ["sostituto", "sostituti", "turnista", "rimpiazzo", "musicista esterno", "session man", "sostituzione"],
      related: ["add-a-deputy", "ask-a-deputy", "deputy-reply-page", "deputy-gigs", "unlink-a-deputy", "deputy-notifications", "who-sees-what"],
      body: [
        { type: "p", text: "Un sostituto è un musicista esterno alla band che suona quando un membro non può. La band tiene un elenco di sostituti con strumento, contatti e compenso abituale. I sostituti non hanno bisogno di un account BandWith." },
        {
          type: "list",
          title: "Come funziona",
          items: [
            "Un admin aggiunge i sostituti in **Membri della band**, sotto **Sostituti** ([[add-a-deputy]]).",
            "Quando un membro rifiuta un gig, l’admin tocca **Trova un sostituto** nella formazione del gig e manda una richiesta via WhatsApp, SMS o email ([[ask-a-deputy]]).",
            "Il messaggio contiene un link privato a una pagina di risposta. Il sostituto risponde lì con un tocco, senza account ([[deputy-reply-page]]).",
            "Gli admin ricevono una notifica con la risposta.",
            "Se il sostituto apre BandWith da quel link e accede, il suo account viene collegato alla sua voce nell’elenco della band. Da quel momento la band può usare **Chiedi nell’app** e il sostituto risponde in **Date da sostituto** ([[deputy-gigs]]).",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Aggiunge, modifica ed elimina i sostituti; vede telefono, email, compenso abituale e note; invia, segue e annulla le richieste; scollega l’account di un sostituto." },
            { role: "member", text: "Non vede l’elenco dei sostituti né le richieste. Un membro che apre il link da sostituto della propria band vede “Fai già parte di {band}”." },
            { role: "deputy", text: "Vede solo le proprie richieste: nome della band, titolo del gig, data, orari di carico, soundcheck e show, locale e città, il ruolo e il compenso offerto. L’indirizzo compare solo dopo che ha detto sì." },
          ],
        },
        { type: "note", tone: "privacy", text: "Un sostituto non vede mai il cliente, il prezzo del gig, i compensi degli altri musicisti, la scaletta, la chat o qualsiasi altra cosa della band." },
        { type: "note", tone: "tip", text: "Un sostituto che dice sì non viene aggiunto alla formazione del gig. Gli admin lo seguono sotto **Sostituti contattati** nel foglio della formazione." },
      ],
    },
    {
      id: "add-a-deputy",
      title: "Aggiungi, modifica o elimina un sostituto",
      summary: "Tieni aggiornato l’elenco dei sostituti della band e vedi quali strumenti non hanno ancora nessuno.",
      roles: ["admin"],
      kind: "task",
      keywords: ["aggiungere sostituto", "nuovo sostituto", "chi copre cosa", "turnista"],
      related: ["deputies", "ask-a-deputy", "unlink-a-deputy"],
      body: [
        {
          type: "steps",
          items: [
            "In **Membri della band**, scorri fino a **Sostituti**.",
            "Tocca **Aggiungi sostituto** (il + accanto al titolo). In **Chi copre cosa**, il + accanto a uno strumento con “Nessun sostituto” apre il modulo con quello strumento già compilato.",
            "Compila **Nome** (obbligatorio), **Strumento**, **Telefono (WhatsApp)**, **Email**, **Compenso abituale** e **Note** (per esempio “Legge le parti, ha la sua strumentazione”).",
            "Tocca **Aggiungi sostituto**.",
          ],
        },
        {
          type: "steps",
          title: "Modificare o eliminare",
          items: [
            "Tocca il sostituto nell’elenco.",
            "Cambia i campi e tocca **Salva**.",
            "Per eliminarlo, tocca **Elimina sostituto**, poi **Elimina** su “Eliminare il sostituto?”.",
          ],
        },
        {
          type: "list",
          title: "Chi copre cosa",
          items: [
            "Elenca ogni strumento suonato dalla band, i membri che lo suonano e i suoi sostituti.",
            "La riga sopra dice “Ogni strumento della band ha un sostituto.” oppure quanti ne sono senza.",
          ],
        },
        { type: "p", text: "Un sostituto con un account BandWith mostra l’etichetta **Su BandWith**, e la sua scheda dice che risponde nell’app." },
        { type: "note", tone: "warning", text: "Eliminare un sostituto lo toglie dall’elenco della band. Le richieste passate conservano il suo nome e la sua risposta. Puoi aggiungerlo di nuovo più avanti." },
        { type: "note", tone: "privacy", text: "Solo gli admin vedono questo elenco (“Solo gli admin vedono questa lista.”)." },
        { type: "devices", rows: [{ devices: ["tablet", "duoLand"], text: "Quando lo schermo è largo, i sostituti sono su due colonne." }] },
      ],
    },
    {
      id: "ask-a-deputy",
      title: "Chiedi a un sostituto di coprire un gig",
      summary: "Dalla formazione del gig, manda una richiesta via messaggio o nell’app e segui la risposta.",
      roles: ["admin"],
      kind: "task",
      keywords: ["trovare un sostituto", "chiedere al sostituto", "sostituire un membro", "coprire un gig", "turnista", "WhatsApp"],
      related: ["deputies", "deputy-reply-page", "deputy-notifications", "gig-workspace"],
      body: [
        { type: "p", text: "Puoi chiedere a un sostituto quando un membro ha rifiutato un gig della band in programma. Prove, gig personali e gig passati non lo prevedono." },
        {
          type: "steps",
          items: [
            "Apri il gig e, nella sezione **FORMAZIONE**, tocca l’elenco dei nomi (non **MODIFICA**) per aprire il foglio **Formazione**.",
            "Accanto al membro che ha rifiutato, tocca **Trova un sostituto**. Il foglio mostra “Al posto di {name}” e i sostituti della band, prima quelli che suonano lo stesso strumento.",
            "Per un sostituto su BandWith, tocca **Chiedi nell'app**. Riceve una notifica.",
            "Altrimenti tocca **WhatsApp**, **SMS** o **Email**. La tua app di messaggi si apre con i dettagli del gig e il link di risposta già scritti. Invia dal tuo telefono.",
            "Torna in BandWith. La risposta del sostituto compare sotto il suo nome: **Chiesto · ancora nessuna risposta**, **Disponibile**, **Confermerà dopo** o **Non posso esserci**, con la sua nota.",
          ],
        },
        {
          type: "list",
          title: "Dopo la risposta",
          items: [
            "Dopo un sì, i pulsanti mandano invece il riepilogo (**Invia riepilogo**, **Riepilogo nell'app**) con l’indirizzo completo e il link al calendario.",
            "Se cambi data, orari o locale dopo la sua risposta, il sostituto viene segnalato con “La data è cambiata dopo la sua risposta: mandagli l’aggiornamento.” I pulsanti mandano l’aggiornamento (**Invia aggiornamento**, **Aggiornamento nell'app**).",
            "**Copia link** copia il link di risposta. **Annulla richiesta** la ritira; un sostituto collegato riceve una notifica.",
            "Il foglio della formazione elenca tutte le richieste aperte sotto **Sostituti contattati**.",
          ],
        },
        {
          type: "list",
          title: "Cosa dice la richiesta",
          items: [
            "Nome della band, titolo del gig, data e ora, locale e città, il ruolo e il compenso.",
            "Il compenso è quello del membro sostituito su questo gig, oppure il compenso abituale del sostituto se non è impostato.",
            "L’indirizzo va solo nel riepilogo e nell’aggiornamento, dopo un sì.",
          ],
        },
        { type: "shot", id: "people-find-deputy", caption: "Trova un sostituto, al posto di un membro che ha rifiutato: ogni sostituto con Chiedi nell’app, WhatsApp, SMS ed Email." },
        { type: "note", tone: "tip", text: "“Già inviato un attimo fa.” vuol dire che hai toccato due volte: la stessa richiesta nell’app parte al massimo una volta ogni 2 minuti." },
        { type: "note", tone: "tip", text: "Ancora nessun sostituto? Il foglio offre **Aggiungi sostituti**, che ti porta all’elenco." },
      ],
    },
    {
      id: "deputy-reply-page",
      title: "La pagina di risposta del sostituto",
      summary: "Cosa vede un sostituto quando apre il link di una richiesta, e come risponde senza account.",
      roles: ["deputy", "admin"],
      kind: "reference",
      keywords: ["link sostituto", "link di risposta", "deputy.html", "rispondere alla richiesta", "senza account"],
      related: ["ask-a-deputy", "deputy-gigs", "deputies"],
      body: [
        { type: "p", text: "Il link di una richiesta apre una piccola pagina web nel browser del sostituto. Non servono app né account. Se possibile, la pagina è nella lingua del sostituto." },
        {
          type: "list",
          title: "Cosa vede il sostituto",
          items: [
            "“{band} cerca un sostituto per questa data.” con data, orari di carico, soundcheck e show, locale, città, ruolo e compenso offerto.",
            "Tre risposte: **Sì, sono disponibile**, **Non so ancora, confermo dopo**, **No, non posso**, più **Messaggio alla band (facoltativo)**.",
            "Dopo un sì: l’indirizzo, **Apri in Mappe** e **Aggiungi al calendario** (**Calendario Apple · Outlook**, **Google Calendar** oppure **Iscriviti · si aggiorna da solo**).",
            "**Cambia risposta** resta disponibile fino al gig.",
            "Se la band cambia il gig dopo la risposta: **Qualcosa è cambiato** con i valori vecchi e nuovi, e **Va bene lo stesso** o **Ora non posso più**.",
            "**Scarica BandWith** apre l’app e collega l’account. Vedi [[deputy-gigs]].",
          ],
        },
        {
          type: "list",
          title: "Quando il link smette di funzionare",
          items: [
            "“Questa richiesta è chiusa.” La band ha ritirato la richiesta.",
            "“La data è stata annullata.”",
            "“Questa data è passata.” dal giorno dopo il gig.",
            "“Questo link non funziona.” La band ha scollegato il sostituto o il link è sbagliato. Chiedi alla band di mandare di nuovo la richiesta.",
          ],
        },
        { type: "note", tone: "privacy", text: "Il link è la chiave: chiunque lo abbia può rispondere. Se è finito alla persona sbagliata, un admin può scollegare il sostituto, e così tutti i link vengono sostituiti ([[unlink-a-deputy]])." },
      ],
    },
    {
      id: "deputy-in-the-app",
      title: "Rispondi alle richieste da sostituto nell’app",
      summary: "Collega il tuo account BandWith all’elenco dei sostituti di una band dal link di risposta, poi rispondi in Date da sostituto.",
      roles: ["deputy"],
      kind: "task",
      keywords: ["account sostituto", "collegare", "collegare account", "scaricare BandWith", "app per sostituti"],
      related: ["deputy-gigs", "deputy-reply-page", "unlink-a-deputy"],
      body: [
        {
          type: "steps",
          items: [
            "Apri il link di risposta che ti ha mandato una band e tocca **Scarica BandWith**.",
            "Nell’app, crea un account o accedi. La schermata di benvenuto dice “{band} ti chiama come sostituto.”",
            "Aspetta “Collego il tuo account alla band…”. Poi vedi “Sei tra i sostituti di {band}”.",
            "Tocca **OK**. Le richieste di quella band sono elencate in **Date da sostituto**.",
          ],
        },
        {
          type: "list",
          title: "Altri messaggi",
          items: [
            "“Questo link appartiene a un altro account”: la band l’ha collegato a qualcun altro. Chiedi una nuova richiesta.",
            "“Fai già parte di {band}”: sei membro di quella band, quindi non puoi esserne il sostituto.",
            "“Non è stato possibile collegare il tuo account alla band. Controlla la connessione.”: tocca **Riprova**. L’app riprova anche da sola quando torni online.",
          ],
        },
        { type: "p", text: "Da quel momento gli admin della band possono chiederti le date nell’app e ricevi le notifiche. A loro arriva “{deputy} è su BandWith”." },
        { type: "note", tone: "tip", text: "Il link ti aspetta anche se prima devi registrarti o se l’app si riavvia." },
      ],
    },
    {
      id: "deputy-gigs",
      title: "Date da sostituto",
      summary: "Tutte le richieste che le band ti hanno mandato come sostituto, con le tue risposte, l’indirizzo dopo un sì e i link al calendario.",
      roles: ["deputy"],
      kind: "reference",
      keywords: ["date da sostituto", "le mie richieste da sostituto", "feed calendario", "iscriversi", "webcal"],
      related: ["deputy-in-the-app", "deputy-notifications", "deputy-reply-page"],
      body: [
        {
          type: "list",
          title: "Dove trovarle",
          items: [
            "Senza una band tua: **Date da sostituto** è la tua schermata Home. **Suoni anche in una band?** offre **Crea la tua band** ed **Esci**.",
            "Con una band: tocca il tuo avatar, poi **Date da sostituto** (“Richieste da {count} band”) in cima al menu Profilo e account.",
            "Toccando una notifica da sostituto si apre direttamente quella richiesta.",
          ],
        },
        {
          type: "list",
          title: "Ogni richiesta",
          items: [
            "Il titolo del gig e la band, con uno stato: **In attesa della tua risposta**, **Hai detto sì**, **Confermerai più avanti**, **Hai detto che non puoi**, **Richiesta ritirata**, **Gig annullato** o **Data passata**.",
            "Data, carico, soundcheck, show, locale, città, ruolo e **Compenso offerto**. L’indirizzo compare dopo un sì.",
            "Per rispondere: **Sì**, **Non so ancora** o **No, non posso**, con un messaggio facoltativo. Più tardi, **Cambia risposta**.",
            "Se il gig è cambiato: **Qualcosa è cambiato**, poi **Va ancora bene** o **Non posso più**.",
            "Dopo un sì: **Apri in Mappe**, **Aggiungi al calendario**, **Google Calendar** e **Iscriviti alle mie date**.",
          ],
        },
        { type: "p", text: "Le richieste aperte vengono prima; quelle chiuse sono sotto **Passate e chiuse**. Compaiono le richieste degli ultimi 30 giorni in poi. La riga in alto elenca le “Band che ti chiamano come sostituto”." },
        { type: "p", text: "**Iscriviti alle mie date** aggiunge un feed di calendario con le tue date confermate con quella band. Segue ogni modifica e segna le date annullate, così il tuo calendario resta aggiornato senza aprire BandWith." },
        { type: "shot", id: "people-deputy-gigs", caption: "Date da sostituto: una richiesta di un’altra band in attesa di risposta." },
        {
          type: "devices",
          rows: [
            { devices: ["duoBook", "duoLand"], text: "Come schermata Home, la pagina del marchio BandWith sta sul primo schermo e le tue date sul secondo, come nell’accesso." },
            { devices: ["duoLaptop"], text: "Come schermata Home in posizione laptop, l’intestazione resta nella metà alta e le tue richieste nella metà bassa. Mentre scrivi un messaggio, la casella resta in vista, sopra la tastiera o appena sopra la piega." },
          ],
        },
      ],
    },
    {
      id: "unlink-a-deputy",
      title: "Scollega l’account BandWith di un sostituto",
      summary: "Quando il link l’ha aperto la persona sbagliata, o il sostituto ha cambiato account.",
      roles: ["admin"],
      kind: "task",
      keywords: ["scollegare", "account sbagliato", "link inoltrato", "nuovo link", "rigenerare"],
      related: ["deputies", "deputy-in-the-app", "ask-a-deputy"],
      body: [
        {
          type: "steps",
          items: [
            "In **Membri della band**, sotto **Sostituti**, tocca il sostituto con l’etichetta **Su BandWith**.",
            "Nel riquadro **Su BandWith**, tocca **Scollega account**.",
            "Leggi “Scollegare l’account BandWith?” e tocca **Scollega**.",
          ],
        },
        {
          type: "list",
          title: "Cosa succede",
          items: [
            "Quell’account smette di ricevere richieste nell’app e non vede più i gig di questa band in **Date da sostituto**.",
            "Tutti i link già mandati a questo sostituto vengono sostituiti. Le vecchie pagine di risposta, i feed di calendario e i link all’app smettono di funzionare.",
            "Le sue risposte restano come sono.",
            "Manda la prossima richiesta via messaggio. Aprendo il nuovo link dall’app si collega di nuovo l’account giusto.",
          ],
        },
        { type: "note", tone: "warning", text: "Non si può annullare: i vecchi link non funzioneranno mai più." },
      ],
    },
    {
      id: "deputy-notifications",
      title: "Notifiche per i sostituti",
      summary: "Quali notifiche ricevono admin e sostituti durante una richiesta.",
      roles: ["admin", "deputy"],
      kind: "reference",
      keywords: ["push sostituto", "notifica sostituto", "risposta del sostituto"],
      related: ["ask-a-deputy", "deputy-gigs", "notifications-inbox"],
      body: [
        {
          type: "table",
          head: ["Quando", "Chi", "Notifica"],
          rows: [
            ["Il sostituto risponde o cambia risposta", "Tutti gli admin attivi", "“{deputy} è disponibile”, “conferma più tardi” o “non può esserci”, con il gig e la sua nota"],
            ["Il sostituto conferma dopo una modifica", "Tutti gli admin attivi", "“Per {deputy} le modifiche vanno bene”"],
            ["Un sostituto collega il suo account", "Tutti gli admin attivi", "“{deputy} è su BandWith”"],
            ["Una nuova richiesta, o di nuovo **Chiedi nell'app**", "Sostituto collegato", "“{band}: puoi suonare?”"],
            ["**Riepilogo nell'app** dopo un sì", "Sostituto collegato", "“Sei confermato: {gig}”"],
            ["Data, orari o locale cambiano dopo la risposta", "Sostituto collegato", "“{gig} è cambiato”, con cosa è cambiato e “Va ancora bene?”"],
            ["Il gig viene annullato", "Sostituto collegato", "“{gig} è annullato”"],
            ["L’admin annulla la richiesta", "Sostituto collegato", "“{band} non ha più bisogno di te”"],
          ],
        },
        { type: "p", text: "Le notifiche degli admin aprono il gig. Quelle dei sostituti aprono **Date da sostituto** su quella richiesta. Un sostituto senza l’app non riceve niente in automatico: mandagli l’aggiornamento da **Trova un sostituto**." },
        { type: "note", tone: "tip", text: "Le raffiche vengono unite: la stessa richiesta, lo stesso riepilogo o lo stesso avviso di modifica arriva a un sostituto al massimo una volta ogni 2 minuti." },
      ],
    },

    // ── Gear ─────────────────────────────────────────────────────────────
    {
      id: "gear-inventory",
      title: "Strumentazione",
      summary: "L’elenco dell’attrezzatura della band con categorie, stato, posizione e proprietario di ogni oggetto.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["attrezzatura", "inventario", "strumentazione", "backline", "impianto", "elenco attrezzatura"],
      related: ["add-gear", "gear-status", "gear-kits", "kit-for-a-gig"],
      body: [
        {
          type: "steps",
          title: "Aprirla",
          items: [
            "Admin: nella Home, sotto **Azioni rapide**, tocca **Strumenti**.",
            "Tutti: tocca il tuo avatar, poi il riquadro **Strumentazione** sotto **Risorse e flussi della band**.",
          ],
        },
        {
          type: "list",
          title: "Cosa vedi",
          items: [
            "Due schede: **Elementi** e **Kit** ([[gear-kits]]).",
            "Un campo di ricerca (**Cerca attrezzatura, microfoni, cavi…**) e i chip delle categorie con i conteggi: **Tutto**, **Strumenti**, **Cavi**, **Microfoni**, **Casse**, **Supporti**, **Luci**, **Custodie**, le categorie create dalla band, poi **Altro**.",
            "Ogni oggetto: nome, pallino di stato e una riga con “Personale · {name}” per l’attrezzatura di qualcuno, la categoria, “qtà {count}” e la posizione.",
            "Gli oggetti che puoi cambiare hanno un pulsante per modificare e uno per eliminare. Quelli che non puoi cambiare mostrano un lucchetto, e una nota sotto l’elenco dice chi può modificarli.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Aggiunge, modifica ed elimina qualsiasi oggetto, della band o personale dei membri, e gestisce i kit." },
            { role: "member", text: "Vede tutta l’attrezzatura e i kit della band. Aggiunge la propria attrezzatura con **Aggiungi la mia attrezzatura** e cambia o elimina solo quella." },
          ],
        },
        { type: "p", text: "Il riquadro nel menu Profilo e account mostra il numero di oggetti e una riga di stato: “{count} in riparazione”, “{count} smarriti” o “Tutto in ordine”." },
        { type: "shot", id: "people-gear", caption: "Attrezzatura e kit su un tablet: la striscia dei kit sopra l’elenco degli oggetti." },
        {
          type: "devices",
          rows: [
            { devices: ["tablet"], text: "La schermata si chiama **Attrezzatura e kit**. I kit sono una striscia di riquadri sopra gli oggetti, senza le schede Elementi/Kit." },
            { devices: ["duoBook", "duoLand"], text: "Un kit si apre sul secondo schermo." },
          ],
        },
      ],
    },
    {
      id: "add-gear",
      title: "Aggiungi, modifica o elimina un oggetto",
      summary: "Aggiungi attrezzatura della band o tua, e tienine aggiornati i dettagli.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["aggiungere attrezzatura", "aggiungere la mia attrezzatura", "attrezzatura personale", "modificare oggetto", "eliminare oggetto", "numero di serie"],
      related: ["gear-inventory", "gear-status", "who-sees-what"],
      body: [
        {
          type: "steps",
          items: [
            "In **Strumentazione**, tocca **Aggiungi attrezzatura** (admin) o **Aggiungi la mia attrezzatura** (membri), oppure il + in alto a destra.",
            "Scrivi il **Nome della voce**, per esempio “Shure SM58”.",
            "Admin: sotto **Di chi è**, scegli **La band** o **Mia (personale)**. Gli oggetti dei membri sono sempre loro.",
            "Scegli una **Categoria** e uno **Stato**, imposta la **Quantità** e compila **Posizione / chi ce l’ha**.",
            "Nessuna categoria va bene? Tocca **Personalizzata** e scrivi un **Nome della categoria** (fino a 40 caratteri). Poi compare come chip per tutta la band.",
            "Se vuoi, aggiungi **Numero di serie**, **Data di acquisto**, **Prezzo di acquisto** e **Note**.",
            "Tocca **Salva oggetto**.",
          ],
        },
        {
          type: "steps",
          title: "Modificare o eliminare",
          items: [
            "Tocca l’oggetto (**Modifica {name}**), cambialo e tocca **Salva modifiche**.",
            "Per eliminarlo, tocca **Elimina oggetto** nel foglio, oppure il cestino sulla riga dell’oggetto.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Può modificare ogni oggetto, cambiare di chi è ed eliminare qualsiasi cosa." },
            { role: "member", text: "Può modificare ed eliminare solo gli oggetti segnati come suoi. Il foglio dice “Attrezzatura personale: la band la vede, solo tu e gli admin potete modificarla.” Gli altri oggetti mostrano un lucchetto al posto dei pulsanti." },
          ],
        },
        { type: "note", tone: "warning", text: "Il cestino su una riga, o **Elimina oggetto** nel foglio, chiede prima “Eliminare {name}?”. Eliminando un oggetto lo togli anche da tutti i kit." },
        { type: "note", tone: "privacy", text: "Tutti nella band vedono ogni oggetto, il suo stato e dove si trova. **Numero di serie**, **Data di acquisto** e **Prezzo di acquisto** li vedono solo gli admin e, per l’attrezzatura personale, il proprietario." },
      ],
    },
    {
      id: "gear-status",
      title: "Stato e posizione dell’attrezzatura",
      summary: "Cosa significano Disponibile, In uso, Manutenzione e Perso, e come alimentano i contatori dei kit e del menu.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["stato", "in riparazione", "manutenzione", "perso", "smarrito", "posizione", "chi ce l’ha"],
      related: ["gear-inventory", "gear-kits"],
      body: [
        {
          type: "table",
          head: ["Stato", "Significato", "Pronto per un gig?"],
          rows: [
            ["**Disponibile**", "Al suo posto, libero da prendere", "Sì"],
            ["**In uso**", "Fuori, con qualcuno", "Sì"],
            ["**Manutenzione**", "In riparazione", "No: contato come “in riparazione”"],
            ["**Perso**", "Smarrito", "No: contato come “smarrito”"],
          ],
        },
        { type: "p", text: "Scegli **Disponibile**, **In uso**, **Manutenzione** o **Perso** quando modifichi un oggetto." },
        { type: "p", text: "**Posizione / chi ce l’ha** è testo libero: una sala, una custodia, un furgone o il nome di una persona. Usalo per trovare l’attrezzatura prima di un gig." },
        { type: "p", text: "I kit contano gli oggetti pronti (“{ready}/{total} pronti”) e avvisano per gli altri (“{count} elementi da controllare · controllalo prima di {gig}.”)." },
      ],
    },
    {
      id: "gear-kits",
      title: "Crea e modifica un kit di attrezzatura",
      summary: "Raggruppa l’attrezzatura che porti a un certo tipo di gig, come l’impianto per i club o il set acustico in duo.",
      roles: ["admin"],
      kind: "task",
      keywords: ["kit", "kit attrezzatura", "set", "lista di carico", "kit impianto"],
      related: ["kit-for-a-gig", "gear-inventory", "gear-status"],
      body: [
        {
          type: "steps",
          items: [
            "In **Strumentazione**, apri la scheda **Kit** e tocca **Nuovo kit**.",
            "Scrivi il **Nome del kit** (fino a 80 caratteri) e, se vuoi, delle **Note**, per esempio come si carica.",
            "Sotto **Elementi dalla strumentazione**, spunta gli oggetti. Usa la ricerca se l’elenco è lungo.",
            "Tocca **Crea kit**.",
          ],
        },
        {
          type: "steps",
          title: "Modificare o eliminare",
          items: [
            "Tocca il kit per aprirlo, poi tocca **Modifica**.",
            "Cambia nome, note o oggetti e tocca **Salva modifiche**.",
            "Per eliminarlo, tocca **Elimina kit**, poi tocca di nuovo (**Tocca di nuovo per eliminare il kit**). Gli oggetti restano nella strumentazione.",
          ],
        },
        {
          type: "list",
          title: "La pagina del kit",
          items: [
            "Contatori: **Elementi**, **Custodie** e **Pronto**.",
            "**Prossimo gig con questo kit**, e un avviso quando degli oggetti sono in manutenzione o persi.",
            "L’elenco degli oggetti con il loro stato.",
            "**Usa per un gig** ([[kit-for-a-gig]]).",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Crea, modifica, elimina e usa i kit." },
            { role: "member", text: "Vede i kit, i loro oggetti e quanto sono pronti, senza pulsanti di modifica." },
          ],
        },
      ],
    },
    {
      id: "kit-for-a-gig",
      title: "Usa un kit per un gig",
      summary: "Collega un kit a un gig, così la band sa cosa va caricato sul furgone.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["assegnare attrezzatura", "attrezzatura per il gig", "kit per il gig", "scegliere un kit"],
      related: ["gear-kits", "gig-workspace", "gear-status"],
      body: [
        {
          type: "steps",
          title: "Dal gig",
          items: [
            "Apri il gig. Nella sezione **KIT ATTREZZATURA**, tocca **SCEGLI UN KIT** (o **CAMBIA** se ce n’è già uno).",
            "In **Kit per questo gig**, tocca **Aggiungi kit** accanto a ogni kit che ti serve. Tocca **Kit aggiunto** per toglierne uno.",
            "Tocca **Fatto**.",
          ],
        },
        {
          type: "steps",
          title: "Dal kit",
          items: [
            "Apri il kit e tocca **Usa per un gig**.",
            "Tocca **Aggiungi kit** accanto a ogni gig in programma. Tocca **Fatto**.",
          ],
        },
        { type: "p", text: "Il gig mostra poi il kit con i suoi oggetti e “Tutti pronti” oppure quanti sono da controllare. Il kit mostra il suo prossimo gig." },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Sceglie e cambia i kit sui gig della band in programma." },
            { role: "member", text: "Vede il kit del gig e quanto è pronto, senza il pulsante SCEGLI UN KIT." },
          ],
        },
        { type: "note", tone: "tip", text: "I kit sono per i gig della band: prove, preventivi e gig personali non hanno la sezione KIT ATTREZZATURA. Usare un kit non cambia lo stato degli oggetti." },
        { type: "devices", rows: [{ devices: ["tablet"], text: "La sezione KIT ATTREZZATURA si trova nella scheda rider del gig." }] },
      ],
    },

    // ── Privacy reference ────────────────────────────────────────────────
    {
      id: "who-sees-what",
      title: "Chi vede cosa",
      summary: "Ogni tipo di dato della band, e cosa possono leggere o cambiare admin, membri e sostituti.",
      roles: ["admin", "member", "deputy"],
      kind: "reference",
      keywords: ["privacy", "permessi", "visibilità", "compensi", "chi può vedere", "ruoli"],
      related: ["member-roles", "deputies", "member-detail", "add-gear"],
      body: [
        { type: "p", text: "Soldi, prezzi dei preventivi, contratti e compensi altrui sono protetti dal server, non solo nascosti nell’app: il telefono di un membro non li riceve mai." },
        {
          type: "table",
          head: ["Dato", "Admin", "Membro"],
          rows: [
            ["Dettagli del gig (data, orari, locale, indirizzo, dress code, note, rider e stage plan)", "Tutto, più cliente, prezzo del gig, acconto, stato del pagamento, note interne e contratto", "La logistica dei gig che suona e non ha rifiutato. Mai cliente, prezzo, acconto, note interne o contratto"],
            ["Formazione del gig e risposte", "Tutti, con compensi e pagamenti", "Chi suona e le risposte, senza compensi"],
            ["Il proprio compenso", "Sì", "Sì: il compenso per gig, pagato o no, il compenso abituale e il proprio **Pagato · {year}**"],
            ["Compensi degli altri", "Sì, per ogni membro e sostituto", "No"],
            ["Preventivi e totali dei preventivi", "Sì: crea, invia e vede tutto", "No. Il controllo di disponibilità di un preventivo mostra solo la data"],
            ["Finanze, pagamenti e statistiche della band", "Sì", "No. Solo i propri guadagni"],
            ["Prezzi, dati bancari e fiscali", "Sì", "No"],
            ["Scalette", "Crea, modifica, collega ai gig", "Sola lettura"],
            ["Repertorio (brani, testi, accordi)", "Aggiunge, modifica, elimina, importa", "Legge; suggerisce brani e modifiche; note e file privati che vede solo lui"],
            ["Contratti e rider", "Sì", "Niente contratti. Il gig mostra la versione del rider e lo stage plan"],
            ["Chat", "Chat della band, chat dei gig, chat dirette con chiunque nella band", "Chat della band, chat dei gig che suona, chat dirette solo con gli admin"],
            ["Attrezzatura e kit", "Vede e cambia tutto", "Vede ogni oggetto, il suo stato e la posizione; numero di serie, data e prezzo di acquisto solo sulla propria attrezzatura personale; cambia solo la propria attrezzatura personale"],
            ["Contatti dei membri", "Email e telefono di tutti nella band", "Email e telefono di tutti nella band"],
            ["Elenco dei sostituti e richieste", "Sì: contatti, compensi abituali, note, risposte", "No"],
            ["Gig personali e note private sui brani", "Solo i propri", "Solo i propri"],
          ],
        },
        {
          type: "table",
          head: ["Dato", "Sostituto"],
          rows: [
            ["Dettagli del gig", "Solo per i gig a cui è stato chiamato: nome della band, titolo, data, orari di carico, soundcheck e show, locale e città. L’indirizzo solo dopo un sì"],
            ["Il proprio compenso", "Il compenso offerto in ogni richiesta"],
            ["Altri compensi, preventivi, finanze, prezzi", "No"],
            ["Formazione, scalette, repertorio, contratti, chat, attrezzatura", "No"],
            ["Contatti dei membri", "No"],
            ["Dati del sostituto", "Le proprie richieste e il nome con cui la band l’ha salvato"],
          ],
        },
        { type: "note", tone: "privacy", text: "Membri e sostituti vedono solo il proprio compenso e la logistica. Non vedono mai i compensi degli altri, i totali dei preventivi o le finanze della band." },
        { type: "note", tone: "tip", text: "I gig personali di un membro (quelli fuori da qualsiasi band) sono privati: li vede solo lui. Le band non ne vedono mai titolo, locale od orario." },
      ],
    },
  ],

  faq: [
    { q: "I membri vedono quanto vengono pagati gli altri?", a: "No. Un membro vede solo il proprio compenso su ogni gig e i propri totali annuali. Gli admin vedono quelli di tutti." },
    { q: "Come esco da una band?", a: "In **Membri della band**, tocca **⋯** sulla tua riga, poi **Esci dalla band**. Un admin può uscire se la band ha un altro admin. Vedi [[leave-a-band]].", roles: ["admin", "member"] },
    { q: "Perché non posso rimuovere l’ultimo admin?", a: "Ogni band ha bisogno di almeno un admin. Prima rendi admin qualcun altro, poi cambia o rimuovi il primo.", roles: ["admin"] },
    { q: "Per quanto tempo vale un invito?", a: "7 giorni. L’indirizzo invitato riceve un promemoria quando mancano 2 giorni. Invitare di nuovo lo stesso indirizzo lo rinnova.", roles: ["admin"] },
    { q: "La persona che ho invitato dice che l’invito non funziona.", a: "Deve accedere con esattamente l’indirizzo email che hai invitato. Se l’invito è scaduto, invitala di nuovo.", roles: ["admin"] },
    { q: "Un sostituto ha bisogno dell’app?", a: "No. Il link della richiesta apre una pagina web dove risponde con un tocco. Con l’app riceve le notifiche e vede tutte le sue richieste in Date da sostituto." },
    { q: "Un sostituto può vedere il prezzo del gig o il cliente?", a: "No. Un sostituto vede solo la logistica, il suo ruolo e il compenso che gli viene offerto. L’indirizzo compare dopo che ha detto sì." },
    { q: "Il link da sostituto l’ha aperto la persona sbagliata. Cosa faccio?", a: "Apri il sostituto in Membri della band, tocca Scollega account e conferma. Tutti i vecchi link smettono di funzionare; manda la prossima richiesta via messaggio.", roles: ["admin"] },
    { q: "I membri possono aggiungere attrezzatura?", a: "Sì, la propria attrezzatura personale con Aggiungi la mia attrezzatura. Possono cambiare o eliminare solo quella. L’attrezzatura della band la gestiscono gli admin.", roles: ["member"] },
    { q: "I membri vedono i sostituti?", a: "No. L’elenco dei sostituti e le richieste sono riservati agli admin." },
    { q: "Dove cambio il logo della band?", a: "Menu Profilo e account, scheda della band attuale, Modifica, Logo della band. Finisce anche sui PDF dei tuoi preventivi.", roles: ["admin"] },
    { q: "Dove imposto il compenso abituale di un membro?", a: "In **Membri della band**, tocca la persona, poi **Nella band**: **Compenso abituale** e **Salva**. Viene usato per i nuovi gig.", roles: ["admin"] },
  ],

  glossary: [
    { term: "Admin", definition: "Chi gestisce la band: gig, soldi, scalette, membri e impostazioni. Una band può averne più di uno e ne deve avere almeno uno.", see: "member-roles" },
    { term: "Membro", definition: "Chi fa parte della band e ne vede i gig, la logistica e il proprio compenso, ma non la gestisce.", see: "member-roles" },
    { term: "Codice invito", definition: "Il codice di un invito nella band. Incollalo, o apri il link d’invito, per entrare nella band.", see: "accept-an-invite" },
    { term: "Sostituto", definition: "Un musicista esterno alla band che suona al posto di un membro che non può. Detto anche turnista.", see: "deputies" },
    { term: "Link di risposta", definition: "Il link privato in una richiesta al sostituto. Apre una pagina web dove il sostituto risponde senza account.", see: "deputy-reply-page" },
    { term: "Su BandWith", definition: "Un sostituto il cui account BandWith è collegato alla sua voce nell’elenco della band. La band può chiedergli le date nell’app.", see: "deputy-in-the-app" },
    { term: "Date da sostituto", definition: "La schermata in cui un sostituto vede e risponde a tutte le richieste delle band che lo chiamano.", see: "deputy-gigs" },
    { term: "Scollega", definition: "Togliere il collegamento all’account di un sostituto. Tutti i suoi vecchi link smettono di funzionare.", see: "unlink-a-deputy" },
    { term: "Chi copre cosa", definition: "La scheda nell’elenco dei sostituti che mostra, per ogni strumento, i membri e i sostituti che lo suonano.", see: "add-a-deputy" },
    { term: "Attrezzatura personale", definition: "L’attrezzatura che un membro aggiunge come sua. Tutta la band la vede; la cambiano solo il proprietario e gli admin.", see: "add-gear" },
    { term: "Kit", definition: "Un insieme con un nome di oggetti della strumentazione da portare a un certo tipo di gig, come l’impianto per i club.", see: "gear-kits" },
    { term: "Pronto", definition: "Un oggetto di un kit che può andare a un gig: disponibile o in uso, non in manutenzione né perso.", see: "gear-status" },
  ],
};

export default people;
