import type { AreaText } from '../../types';

const people: AreaText = {
  area: {
    id: "people",
    title: "Mitglieder, Vertretungen & Equipment",
    intro: "Wer in der Band ist, wer einspringt, wenn jemand nicht kann, das Equipment, das ihr zu Gigs mitnehmt, und wer was sehen kann.",
    icon: "people",
  },

  articles: [
    // ── Members ──────────────────────────────────────────────────────────
    {
      id: "band-members",
      title: "Der Bildschirm Bandmitglieder",
      summary: "Alle in der Band mit Rolle und Instrument, dazu für Admins der Einladungs-Button und die Liste der Vertretungen.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Mitglieder", "Besetzung", "Bandliste", "Leute", "Personen"],
      related: ["invite-members", "member-detail", "member-roles", "deputies", "who-sees-what"],
      body: [
        { type: "p", text: "**Bandmitglieder** listet alle in der Band, die du ausgewählt hast. Der Name der Band steht über dem Titel." },
        {
          type: "steps",
          title: "Öffnen",
          items: [
            "Tippe auf Start unter **Schnellzugriff** auf **Mitglieder**.",
            "Oder tippe oben rechts auf deinen Avatar, um Profil und Konto zu öffnen, und dann in der Karte der aktuellen Band auf **Mitglieder**.",
          ],
        },
        {
          type: "list",
          title: "Was du siehst",
          items: [
            "Drei Zähler: **Gesamt**, **Admins** und **Mitglieder**.",
            "Eine Zeile pro Person: Foto oder Initialen, Name (der Künstlername, falls einer gesetzt ist), Instrument und Rolle (**Admin** oder **Mitglied**). Ein Etikett **Pro** markiert Personen mit einem bezahlten Tarif.",
            "Tippe auf eine Zeile, um die Seite der Person zu öffnen. Siehe [[member-detail]].",
            "Tippe in einer Zeile auf **⋯** (**Aktionen für {name}**) für ein kurzes Menü: **E-Mail**; in deiner eigenen Zeile **Band verlassen**; für Admins in den Zeilen anderer **Zum Admin machen** oder **Zum Mitglied machen** und **Aus der Band entfernen**.",
            "Admins sehen außerdem den Button **Mitglied einladen** (oben rechts und unten) und unter der Liste den Bereich **Vertretungen**. Siehe [[deputies]].",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Sieht alle, lädt Leute ein, ändert Rollen, entfernt Mitglieder und verwaltet Vertretungen." },
            { role: "member", text: "Sieht alle und ihre Kontaktdaten und kann ihnen mailen. Kein Einladungs-Button, keine Rollenänderungen, keine Liste der Vertretungen." },
          ],
        },
        { type: "shot", id: "people-band-members", caption: "Bandmitglieder aus Sicht eines Admins: Zähler, Besetzung und der Button Mitglied einladen." },
        {
          type: "devices",
          rows: [
            { devices: ["duoLaptop"], text: "Die drei Zähler stehen in der oberen Hälfte, die Liste der Personen in der unteren." },
            { devices: ["duoBook", "duoLand", "tablet"], text: "Die Seite einer Person öffnet sich neben der Liste, statt sie zu verdecken." },
            { devices: ["android"], text: "Die Zurück-Geste schließt zuerst die Seite einer Person, dann Bandmitglieder." },
          ],
        },
        { type: "note", tone: "tip", text: "Eine leere Band zeigt **Noch keine Mitglieder** und für Admins **Erstes Mitglied einladen**." },
      ],
    },
    {
      id: "invite-members",
      title: "Jemanden in die Band einladen",
      summary: "Finde jemanden auf BandWith über Name oder E-Mail oder lade eine neue Person per E-Mail, Link oder Code ein.",
      roles: ["admin"],
      kind: "task",
      keywords: ["einladen", "Mitglied hinzufügen", "Einladungscode", "Einladungslink", "beitreten"],
      related: ["accept-an-invite", "member-roles", "band-members"],
      body: [
        { type: "p", text: "Niemand kommt ohne Zustimmung in eine Band. Du schickst eine Einladung, die Person nimmt sie an." },
        {
          type: "steps",
          items: [
            "Tippe bei **Bandmitglieder** auf **Mitglied einladen** (das + oben rechts oder den Button unten).",
            "Gib im Suchfeld mindestens 3 Zeichen eines Namens oder einer E-Mail-Adresse ein.",
            "Ist die Person schon auf BandWith, erscheint sie unter **Auf BandWith gefunden**. Tippe daneben auf **Einladung**.",
            "Wird niemand gefunden, gib die ganze E-Mail-Adresse ein und tippe auf **{email} einladen**.",
            "Wähle vor dem Senden unter **Rolle** die Rolle: **Mitglied** („Kann Band-Inhalte sehen“) oder **Admin** („Verwaltet Mitglieder, Events & Einstellungen“). Mitglied ist vorausgewählt.",
            "Für jemanden, der neu bei BandWith ist, zeigt das Fenster dann den **Einladungscode**. Tippe auf **Teilen**, um Link und Code über eine beliebige App zu schicken, oder auf **Code kopieren**.",
          ],
        },
        {
          type: "list",
          title: "Wie es weitergeht",
          items: [
            "Bestehende Nutzer: Sie bekommen eine Mitteilung und beim nächsten Öffnen von BandWith eine Karte **Band-Einladung**. Du siehst „Einladung an {name} gesendet“.",
            "Neue Person: BandWith verschickt die Einladung per E-Mail, wenn das geht. Du siehst „Einladung per E-Mail an {name} gesendet“ oder, ohne E-Mail, „Einladung für {name} erstellt. Teile sie, damit die Person beitreten kann.“",
            "Eine Einladung gilt 7 Tage. Bleiben noch 2 Tage oder weniger, bekommt die eingeladene Adresse eine Erinnerungs-E-Mail. Läuft sie ab, bekommst du eine E-Mail.",
            "Lädst du dieselbe Adresse noch einmal ein, verlängert sich die Einladung um weitere 7 Tage.",
            "Wenn die Person beitritt, bekommen alle in der Band „{name} ist jetzt bei {band}“.",
          ],
        },
        { type: "note", tone: "privacy", text: "Suchergebnisse zeigen E-Mails teilweise verdeckt (zum Beispiel gi•••@…), außer du gibst die genaue Adresse ein. Wer schon in der Band ist, erscheint nicht." },
        { type: "shot", id: "people-invite", caption: "Das Fenster Mitglied einladen mit Suche, Ergebnissen und Rollenwahl." },
        { type: "note", tone: "tip", text: "Die Einladung ist an die E-Mail-Adresse gebunden. Die Person muss sich mit dieser Adresse anmelden, um beizutreten." },
      ],
    },
    {
      id: "accept-an-invite",
      title: "Einer Band über eine Einladung beitreten",
      summary: "Nimm eine Einladung in der App, über den Einladungslink oder per Einladungscode an.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["Band beitreten", "Einladung annehmen", "Einladungscode", "Einladung ablehnen"],
      related: ["invite-members", "member-roles"],
      body: [
        {
          type: "steps",
          title: "Du nutzt BandWith schon",
          items: [
            "Öffne BandWith. Eine Karte **Band-Einladung** zeigt, wer dich eingeladen hat, die Band, ihre Größe und deine Rolle (**als Mitglied** oder **als Admin**).",
            "Tippe auf **Beitreten**. Du siehst „Du bist {band} beigetreten“, und die Band erscheint in deiner Bandauswahl.",
            "Oder tippe auf **Ablehnen**. Um später zu entscheiden, tippe auf das X (**Später entscheiden**); die Karte kommt beim nächsten Mal wieder.",
          ],
        },
        {
          type: "steps",
          title: "Du bist neu bei BandWith",
          items: [
            "Öffne den Einladungslink aus der Nachricht oder E-Mail. Oder tippe auf dem Willkommensbildschirm auf **Ich habe einen Einladungscode**, füg Code oder Link in **Einladungscode oder -link** ein und tippe auf **Beitreten**.",
            "Prüfe die Karte der Band und tippe auf **Annehmen & weiter** (oder **Einladung ablehnen**).",
            "Erstelle dein Konto oder melde dich mit der E-Mail-Adresse an, an die die Einladung ging.",
          ],
        },
        {
          type: "list",
          title: "Wenn es nicht klappt",
          items: [
            "„Diese Einladung ging an eine andere E-Mail-Adresse“ heißt, dass du mit einer anderen Adresse angemeldet bist. Melde dich ab und nutze die eingeladene.",
            "„Diese Einladung ist abgelaufen“ oder „nicht mehr gültig“: Bitte einen Admin, dich noch einmal einzuladen.",
            "„Das sieht nicht nach einem Einladungscode aus“: Füg den ganzen Code oder den ganzen Link ein.",
          ],
        },
      ],
    },
    {
      id: "member-roles",
      title: "Die Rollen Admin und Mitglied",
      summary: "Was ein Admin kann, das ein Mitglied nicht kann, und die Regel, dass jede Band mindestens einen Admin behält.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Admin", "Mitglied", "Berechtigungen", "Rolle", "mitverwalten", "Inhaber"],
      related: ["make-admin", "who-sees-what", "remove-a-member"],
      body: [
        { type: "p", text: "Jede Person in einer Band ist entweder **Admin** oder **Mitglied**. Eine Band kann mehrere Admins haben. Wer eine Band gründet, ist ihr erster Admin." },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Erstellt und bearbeitet Gigs, Proben und Angebote; legt Gagen fest und markiert Auszahlungen; bearbeitet Setlists, Songs, Verträge, To-do-Listen und Equipment-Kits; lädt Leute ein und entfernt sie; ändert Rollen; verwaltet Vertretungen; bearbeitet Banddetails und Preise; sieht die Finanzen und Statistiken der Band." },
            { role: "member", text: "Sieht die Gigs und die Logistik der Band, antwortet auf Einladungen zum Spielen, liest Setlists und Songs, schlägt Songs und Änderungen vor, führt private Songnotizen, chattet, fügt eigenes persönliches Equipment hinzu und bearbeitet es und sieht nur die eigene Gage." },
          ],
        },
        { type: "note", tone: "warning", text: "Eine Band braucht mindestens einen Admin. Die App lässt dich den letzten Admin nicht entfernen oder zum Mitglied machen: „Eine Band braucht mindestens einen Admin. Mach zuerst jemand anderen zum Admin.“ Dieselbe Regel verhindert, dass du dein Konto löschst, solange du der einzige Admin einer Band bist." },
        { type: "p", text: "Eine Band mitverwalten (einer von mehreren Admins sein) ist eine Funktion der bezahlten Tarife. Während der Beta kann jeder zum Admin gemacht werden. Außerhalb der Beta zeigt **Zum Admin machen** bei Personen im kostenlosen Tarif „Erfordert ein Pro-Konto zum Mitverwalten“." },
        { type: "p", text: "Die vollständige Liste, welche Daten jede Rolle lesen kann, findest du unter [[who-sees-what]]." },
      ],
    },
    {
      id: "make-admin",
      title: "Jemanden zum Admin machen oder einen Admin wieder zum Mitglied",
      summary: "Ändere die Rolle einer Person in der Liste Bandmitglieder oder auf ihrer Seite.",
      roles: ["admin"],
      kind: "task",
      keywords: ["zum Admin machen", "Admin entfernen", "herabstufen", "befördern", "Rolle ändern"],
      related: ["member-roles", "band-members"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe bei **Bandmitglieder** in der Zeile der Person auf **⋯**. Oder tippe auf die Zeile, um ihre Seite zu öffnen.",
            "Tippe auf **Zum Admin machen**, um Admin-Rechte zu geben, oder auf **Zum Mitglied machen**, um sie wegzunehmen.",
          ],
        },
        { type: "p", text: "Die Änderung wird sofort gespeichert; es gibt keine Bestätigung. Die Person sieht ihre neue Rolle, sobald ihre Bandliste das nächste Mal lädt." },
        { type: "note", tone: "warning", text: "Den letzten Admin kannst du nicht zum Mitglied machen. Mach zuerst jemand anderen zum Admin." },
        { type: "note", tone: "tip", text: "Deine eigene Rolle kannst du nicht ändern: Deine Seite und das Menü **⋯** in deiner eigenen Zeile zeigen keine Rollen-Buttons. Bitte einen anderen Admin, dich zum Mitglied zu machen." },
      ],
    },
    {
      id: "remove-a-member",
      title: "Ein Mitglied aus der Band entfernen",
      summary: "Nimm jemanden aus der Band; die Person verliert den Zugriff auf Events, Chats und Repertoire.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Mitglied entfernen", "rauswerfen", "Mitglied löschen"],
      related: ["leave-a-band", "invite-members", "member-roles"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe bei **Bandmitglieder** in der Zeile der Person auf **⋯** und dann auf **Aus der Band entfernen**. Oder öffne ihre Seite und tippe unten auf **Aus der Band entfernen**.",
            "Lies das Fenster **Aus der Band entfernen?** und tippe auf **Entfernen**. Tippe auf **Abbrechen**, um die Person zu behalten.",
          ],
        },
        {
          type: "list",
          title: "Was passiert",
          items: [
            "Die Person verliert sofort den Zugriff auf Events, Chats und Repertoire der Band.",
            "Sie bekommt die Mitteilung „Nicht mehr bei {band}“. Der Rest der Band bekommt „{name} hat {band} verlassen“.",
            "Ihre vergangenen Gigs, Antworten und Auszahlungen bleiben in den Unterlagen der Band.",
            "Du kannst sie später wieder einladen.",
          ],
        },
        { type: "note", tone: "warning", text: "Rückgängig machen geht nicht. Um die Person zurückzuholen, schick eine neue Einladung und warte, bis sie sie annimmt." },
      ],
    },
    {
      id: "leave-a-band",
      title: "Eine Band verlassen",
      summary: "Wie das Verlassen für Admins und für Mitglieder funktioniert.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["Band verlassen", "aus der Band austreten", "Band beenden"],
      related: ["remove-a-member", "member-roles"],
      body: [
        {
          type: "roles",
          rows: [
            { role: "member", text: "Du kannst jede Band, in der du bist, jederzeit verlassen." },
            { role: "admin", text: "Du kannst gehen, solange die Band einen weiteren Admin hat. Bist du der einzige, bittet dich die App, zuerst jemand anderen zum Admin zu machen ([[make-admin]])." },
          ],
        },
        {
          type: "steps",
          items: [
            "Öffne **Bandmitglieder** dieser Band.",
            "Tippe in deiner eigenen Zeile auf **⋯** und dann auf **Band verlassen**. (Du kannst auch auf deine Zeile tippen und unten **Band verlassen** nutzen.)",
            "Das Fenster fragt „{band} verlassen?“: Du verlierst den Zugriff auf Events, Chats und Repertoire der Band. Tippe zum Bestätigen auf **Band verlassen** oder auf **Abbrechen**.",
          ],
        },
        { type: "p", text: "Wenn du gehst, bekommen die anderen „{name} hat {band} verlassen“. Die App wechselt zu deiner anderen Band oder, wenn du keine hast, zum Startbildschirm. Wieder beitreten kannst du nur mit einer neuen Einladung." },
        { type: "note", tone: "warning", text: "Wenn du dein Konto löschst (Einstellungen, **Konto löschen**), verlässt du auch jede Band. Bist du der einzige Admin einer Band, mach zuerst jemand anderen zum Admin." },
      ],
    },
    {
      id: "member-detail",
      title: "Die Seite eines Mitglieds",
      summary: "Wer die Person ist, Gigs und Bezahlung in diesem Jahr, ihre nächsten Termine, ihre Kontakte und die Rollen-Buttons.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Mitgliederprofil", "Mitgliederstatistik", "dieses Jahr bezahlt", "Kontakt", "Telefon", "E-Mail"],
      related: ["band-members", "who-sees-what", "make-admin"],
      body: [
        { type: "p", text: "Tippe bei **Bandmitglieder** auf eine Person, um ihre Seite zu öffnen." },
        {
          type: "list",
          items: [
            "Oben: Foto, Name, Instrument und Rolle.",
            "**Gigs dieses Jahr**: gespielte und kommende Gigs mit einer Punkteanzeige. **Bezahlt · {year}**: was die Person bekommen hat und wie viel noch offen ist.",
            "**Als Nächstes für {name}**: ihre kommenden Termine in dieser Band, jeweils mit ihrer Antwort (zugesagt, offen, abgesagt).",
            "**Kontakte**: E-Mail und Telefon, jeweils mit Kopier-Button. Tippe auf einen Eintrag, um zu schreiben oder anzurufen.",
            "**Nachricht** öffnet einen Direktchat. **Zum Admin machen** / **Zum Mitglied machen** und **Aus der Band entfernen** sind für Admins.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Sieht die Zähler für Gigs und Bezahlung bei allen und jede Aktion, außer auf der eigenen Seite." },
            { role: "member", text: "Sieht die Zähler für Gigs und Bezahlung nur auf der eigenen Seite. Auf der Seite anderer: Name, Instrument, nächste Termine und Kontakte. **Nachricht** erscheint nur auf der Seite eines Admins, weil Mitglieder Direktchats nur mit Admins starten können." },
          ],
        },
        { type: "note", tone: "privacy", text: "Ein Mitglied sieht nie, was ein anderes Mitglied bekommt. Die Zähler kommen von einer Serverfunktion, die Admins alle Mitglieder liefert und dir nur deine eigene Zeile." },
        {
          type: "devices",
          rows: [
            { devices: ["phone", "duoClosed"], text: "Öffnet sich im Vollbild." },
            { devices: ["duoBook", "duoLand"], text: "Öffnet sich auf dem zweiten Bildschirm, neben der Liste." },
            { devices: ["tablet"], text: "Öffnet sich in der Detailspalte neben der Liste." },
          ],
        },
      ],
    },
    {
      id: "default-fees-and-instruments",
      title: "Standardgagen und Instrumente",
      summary: "Woher das Instrument und die vorausgefüllte Gage eines Mitglieds kommen und wo du sie änderst.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Standardgage", "übliche Gage", "Satz", "Instrument", "Rolle", "Bezahlung"],
      related: ["who-sees-what", "deputies", "gig-workspace"],
      body: [
        { type: "p", text: "Jede Person in einer Band kann eine Standardgage haben. Fügt ein Admin sie zu einem neuen Gig oder Angebot hinzu, ist ihre Gage damit vorausgefüllt (Proben haben keine Gage); ohne Standardgage gilt der Mitgliedersatz der Band aus **Preise, Gagen & Leistungen**. Der Admin kann die Gage bei jedem Gig ändern." },
        {
          type: "steps",
          title: "Admins: Instrument oder Standardgage eines Mitglieds ändern",
          items: [
            "Tippe bei **Bandmitglieder** auf die Zeile der Person.",
            "Gib unter **In der Band** das **Instrument in dieser Band** ein (leer: Das Instrument aus dem Profil wird angezeigt) und die **Standardgage** (optional, eine Zahl wie 150).",
            "Tippe auf **Speichern**. Die Standardgage gilt für neue Gigs.",
          ],
        },
        { type: "p", text: "Ein Mitglied, das die eigene Zeile öffnet, sieht „Deine Standardgage in dieser Band: {fee}“, wenn es eine gibt." },
        { type: "p", text: "Dein eigenes Hauptinstrument steht in deinem Profil: Tippe auf deinen Avatar, dann in deiner Profilkarte auf **Ändern**, und wähle es unter **Hauptinstrument / Rolle**. Es erscheint auf deiner Karte in Profil und Konto." },
        { type: "p", text: "Das Instrument neben jedem Namen bei **Bandmitglieder** ist das, das für diese Person in dieser Band gespeichert ist. Die Karte **Wer vertritt wen** bei den Vertretungen gruppiert die Band nach diesen Instrumenten." },
        { type: "note", tone: "privacy", text: "Standardgagen folgen der Geld-Regel: Admins sehen die aller, ein Mitglied nur die eigene." },
      ],
    },
    {
      id: "band-details",
      title: "Name, Logo, Stadt und Bio der Band ändern",
      summary: "Bearbeite die Bandkarte in Profil und Konto; das Logo erscheint auch auf Angebots-PDFs.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Bandname", "Logo", "Bandfoto", "Heimatstadt", "Stadt", "Slogan", "Bio", "Band umbenennen"],
      related: ["member-roles", "band-members"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe oben rechts auf deinen Avatar, um Profil und Konto zu öffnen.",
            "Tippe in der Karte der aktuellen Band auf **Ändern**.",
            "Tippe unter **Band-Logo** auf **Hochladen** (oder **Ändern**) und wähle ein Bild. Tippe auf den Papierkorb (**Logo entfernen**), um es zu entfernen.",
            "Ändere **Bandname**, **Heimatstadt** (wähle einen der **Vorgeschlagene Orte**, damit Fahrtkosten seine Lage nutzen können) und **Band-Bio / Slogan (optional)**.",
            "Tippe auf **Speichern**. Tippe auf **Abbrechen** oder **Schließen**, um ohne Speichern zu gehen.",
          ],
        },
        { type: "p", text: "Das Logo erscheint auf der Bandkarte, in der Bandauswahl und auf Angebots-PDFs. Die Heimatstadt wird außerdem zum Startpunkt für die Fahrtkosten in deinen Preisen." },
        { type: "p", text: "**Band-Einstellungen** unter der Bandkarte öffnet Branding und Preise der Band (Bankkonto, Musikersätze, Leistungen für Angebote). Siehe [[pricing-sheet]]." },
        { type: "note", tone: "privacy", text: "Mitglieder sehen Name, Logo, Stadt und Bio der Band, nie ihre Bank-, Steuer- oder Preisangaben." },
      ],
    },

    // ── Deputies ─────────────────────────────────────────────────────────
    {
      id: "deputies",
      title: "Vertretungen: Musiker, die einspringen",
      summary: "Die Liste der Session-Musiker der Band, wie Anfragen sie erreichen und was sie sehen können und was nicht.",
      roles: ["admin", "deputy"],
      kind: "reference",
      keywords: ["Vertretung", "Aushilfe", "Ersatz", "Ersatzmusiker", "einspringen", "Session-Musiker", "Sub"],
      related: ["add-a-deputy", "ask-a-deputy", "deputy-reply-page", "deputy-gigs", "unlink-a-deputy", "deputy-notifications", "who-sees-what"],
      body: [
        { type: "p", text: "Eine Vertretung ist ein Musiker außerhalb der Band, der spielt, wenn ein Mitglied nicht kann. Die Band führt eine Liste der Vertretungen mit Instrument, Kontakten und üblicher Gage. Vertretungen brauchen kein BandWith-Konto." },
        {
          type: "list",
          title: "So funktioniert es",
          items: [
            "Ein Admin fügt Vertretungen bei **Bandmitglieder** unter **Vertretungen** hinzu ([[add-a-deputy]]).",
            "Sagt ein Mitglied einen Gig ab, tippt der Admin in der Besetzung des Gigs auf **Vertretung finden** und schickt eine Anfrage per WhatsApp, SMS oder E-Mail ([[ask-a-deputy]]).",
            "Die Nachricht enthält einen privaten Link zu einer Antwortseite. Die Vertretung antwortet dort mit einem Tippen, ohne Konto ([[deputy-reply-page]]).",
            "Die Admins bekommen eine Mitteilung mit der Antwort.",
            "Öffnet die Vertretung BandWith über diesen Link und meldet sich an, wird ihr Konto mit dem Eintrag der Band verknüpft. Ab dann kann die Band **In der App anfragen**, und die Vertretung antwortet in **Vertretungs-Gigs** ([[deputy-gigs]]).",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Fügt Vertretungen hinzu, bearbeitet und löscht sie; sieht Telefon, E-Mail, übliche Gage und Notizen; sendet, verfolgt und storniert Anfragen; trennt das Konto einer Vertretung." },
            { role: "member", text: "Sieht weder die Liste der Vertretungen noch die Anfragen. Ein Mitglied, das einen Vertretungslink der eigenen Band öffnet, sieht „Du bist schon in {band}“." },
            { role: "deputy", text: "Sieht nur die eigenen Anfragen: Bandname, Gig-Titel, Datum, Zeiten für Load-in, Soundcheck und Show, Location und Stadt, die Rolle und die angebotene Gage. Die Straße erscheint erst nach einer Zusage." },
          ],
        },
        { type: "note", tone: "privacy", text: "Eine Vertretung sieht nie den Kunden, den Preis des Gigs, die Gagen der anderen Musiker, die Setlist, den Chat oder sonst etwas aus der Band." },
        { type: "note", tone: "tip", text: "Eine Vertretung, die zusagt, kommt nicht in die Besetzung des Gigs. Die Admins verfolgen sie im Besetzungsfenster unter **Angefragte Aushilfen**." },
      ],
    },
    {
      id: "add-a-deputy",
      title: "Eine Vertretung hinzufügen, bearbeiten oder löschen",
      summary: "Pflege die Liste der Aushilfen der Band und sieh, für welche Instrumente noch niemand da ist.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Vertretung hinzufügen", "neue Vertretung", "wer vertritt wen", "Session-Musiker"],
      related: ["deputies", "ask-a-deputy", "unlink-a-deputy"],
      body: [
        {
          type: "steps",
          items: [
            "Scroll bei **Bandmitglieder** nach unten zu **Vertretungen**.",
            "Tippe auf **Vertretung hinzufügen** (das + neben dem Titel). In **Wer vertritt wen** öffnet das + neben einem Instrument mit „Noch keine Vertretung“ das Formular mit diesem Instrument schon ausgefüllt.",
            "Fülle **Name** (Pflicht), **Instrument**, **Telefon (WhatsApp)**, **E-Mail**, **Übliche Gage** und **Notizen** aus (zum Beispiel „Liest Charts, hat eigenes Equipment“).",
            "Tippe auf **Vertretung hinzufügen**.",
          ],
        },
        {
          type: "steps",
          title: "Bearbeiten oder löschen",
          items: [
            "Tippe in der Liste auf die Vertretung.",
            "Ändere die Felder und tippe auf **Speichern**.",
            "Zum Löschen tippe auf **Vertretung löschen** und dann bei „Vertretung löschen?“ auf **Löschen**.",
          ],
        },
        {
          type: "list",
          title: "Wer vertritt wen",
          items: [
            "Listet jedes Instrument, das die Band spielt, die Mitglieder, die es spielen, und seine Vertretungen.",
            "Die Zeile darüber sagt „Jedes Instrument der Band hat eine Vertretung.“ oder wie viele keine haben.",
          ],
        },
        { type: "p", text: "Eine Vertretung mit BandWith-Konto trägt das Etikett **Auf BandWith**, und ihr Fenster sagt, dass sie in der App antwortet." },
        { type: "note", tone: "warning", text: "Löschst du eine Vertretung, verschwindet sie aus der Liste der Band. Frühere Anfragen behalten ihren Namen und ihre Antwort. Du kannst sie später wieder hinzufügen." },
        { type: "note", tone: "privacy", text: "Nur Admins sehen diese Liste („Nur Admins sehen diese Liste.“)." },
        { type: "devices", rows: [{ devices: ["tablet", "duoLand"], text: "Bei breitem Bildschirm werden die Vertretungen in zwei Spalten angezeigt." }] },
      ],
    },
    {
      id: "ask-a-deputy",
      title: "Eine Vertretung für einen Gig anfragen",
      summary: "Schick aus der Besetzung des Gigs eine Anfrage per Nachricht oder in der App und verfolge die Antwort.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Vertretung finden", "Vertretung anfragen", "Mitglied ersetzen", "Gig abdecken", "Aushilfe", "WhatsApp"],
      related: ["deputies", "deputy-reply-page", "deputy-notifications", "gig-workspace"],
      body: [
        { type: "p", text: "Du kannst eine Vertretung anfragen, wenn ein Mitglied einen kommenden Gig der Band abgesagt hat. Proben, persönliche Gigs und vergangene Gigs bieten das nicht an." },
        {
          type: "steps",
          items: [
            "Öffne den Gig und tippe im Bereich **BESETZUNG** auf die Liste der Namen (nicht auf **ÄNDERN**), um das Fenster **Besetzung** zu öffnen.",
            "Tippe neben dem Mitglied, das abgesagt hat, auf **Vertretung finden**. Das Fenster zeigt „Ersatz für {name}“ und die Vertretungen der Band, die mit demselben Instrument zuerst.",
            "Bei einer Vertretung auf BandWith tippst du auf **In der App anfragen**. Sie bekommt eine Mitteilung.",
            "Sonst tippe auf **WhatsApp**, **SMS** oder **E-Mail**. Deine Nachrichten-App öffnet sich mit den Gig-Details und dem Antwortlink. Schick die Nachricht von deinem Handy.",
            "Komm zurück zu BandWith. Die Antwort der Vertretung erscheint unter ihrem Namen: **Angefragt · noch keine Antwort**, **Verfügbar**, **Gibt später Bescheid** oder **Kann nicht**, mit ihrer Notiz.",
          ],
        },
        {
          type: "list",
          title: "Nach der Antwort",
          items: [
            "Nach einer Zusage senden die Buttons stattdessen die Zusammenfassung (**Zusammenfassung senden**, **Zusammenfassung in der App**) mit der ganzen Adresse und dem Kalenderlink.",
            "Änderst du Datum, Zeiten oder Location nach der Antwort, wird die Vertretung markiert: „Der Gig hat sich nach der Antwort geändert: Schick das Update.“ Die Buttons senden dann das Update (**Update senden**, **Update in der App**).",
            "**Link kopieren** kopiert den Antwortlink. **Anfrage absagen** zieht die Anfrage zurück; eine verknüpfte Vertretung bekommt eine Mitteilung.",
            "Das Besetzungsfenster listet jede offene Anfrage unter **Angefragte Aushilfen**.",
          ],
        },
        {
          type: "list",
          title: "Was in der Anfrage steht",
          items: [
            "Bandname, Gig-Titel, Datum und Uhrzeit, Location und Stadt, die Rolle und die Gage.",
            "Die Gage ist die Gage des ersetzten Mitglieds bei diesem Gig oder die übliche Gage der Vertretung, wenn keine festgelegt ist.",
            "Die Straße steht nur in der Zusammenfassung und im Update, nach einer Zusage.",
          ],
        },
        { type: "shot", id: "people-find-deputy", caption: "Vertretung finden als Ersatz für ein Mitglied, das abgesagt hat: jede Vertretung mit In der App anfragen, WhatsApp, SMS und E-Mail." },
        { type: "note", tone: "tip", text: "„Gerade eben schon gesendet.“ heißt, dass du zweimal getippt hast: Dieselbe Anfrage in der App geht höchstens alle 2 Minuten raus." },
        { type: "note", tone: "tip", text: "Noch keine Vertretungen? Das Fenster bietet **Vertretungen hinzufügen** an, das dich zur Liste bringt." },
      ],
    },
    {
      id: "deputy-reply-page",
      title: "Die Antwortseite für Vertretungen",
      summary: "Was eine Vertretung sieht, wenn sie den Link in einer Anfrage öffnet, und wie sie ohne Konto antwortet.",
      roles: ["deputy", "admin"],
      kind: "reference",
      keywords: ["Vertretungslink", "Antwortlink", "deputy.html", "Anfrage beantworten", "ohne Konto"],
      related: ["ask-a-deputy", "deputy-gigs", "deputies"],
      body: [
        { type: "p", text: "Der Link in einer Anfrage öffnet eine kleine Webseite im Browser der Vertretung. Weder App noch Konto sind nötig. Die Seite erscheint, wenn verfügbar, in der Sprache der Vertretung." },
        {
          type: "list",
          title: "Was die Vertretung sieht",
          items: [
            "„{band} sucht eine Aushilfe für diesen Gig.“ mit Datum, Zeiten für Aufbau, Soundcheck und Show, Location, Stadt, Rolle und angebotener Gage.",
            "Drei Antworten: **Ja, ich kann**, **Noch nicht sicher, ich sage später Bescheid**, **Nein, ich kann nicht**, dazu **Nachricht an die Band (optional)**.",
            "Nach einer Zusage: die Adresse, **In Karten öffnen** und **Zum Kalender hinzufügen** (**Apple Kalender · Outlook**, **Google Kalender** oder **Abonnieren · aktualisiert sich selbst**).",
            "**Antwort ändern** bleibt bis zum Gig verfügbar.",
            "Ändert die Band den Gig nach der Antwort: **Etwas hat sich geändert** mit alten und neuen Werten und **Passt trotzdem** oder **Ich kann nicht mehr**.",
            "**BandWith holen** öffnet die App und verknüpft das Konto. Siehe [[deputy-gigs]].",
          ],
        },
        {
          type: "list",
          title: "Wenn der Link nicht mehr funktioniert",
          items: [
            "„Diese Anfrage ist geschlossen.“ Die Band hat die Anfrage zurückgezogen.",
            "„Der Gig wurde abgesagt.“",
            "„Dieser Gig ist vorbei.“ ab dem Tag nach dem Gig.",
            "„Dieser Link funktioniert nicht.“ Die Band hat die Vertretung getrennt, oder der Link ist falsch. Bitte die Band, die Anfrage noch einmal zu schicken.",
          ],
        },
        { type: "note", tone: "privacy", text: "Der Link ist der Schlüssel: Wer ihn hat, kann antworten. Ist er bei der falschen Person gelandet, kann ein Admin die Vertretung trennen; dabei wird jeder Link ersetzt ([[unlink-a-deputy]])." },
      ],
    },
    {
      id: "deputy-in-the-app",
      title: "Vertretungsanfragen in der App beantworten",
      summary: "Verknüpfe dein BandWith-Konto über den Antwortlink mit der Vertretungsliste einer Band und antworte dann in Vertretungs-Gigs.",
      roles: ["deputy"],
      kind: "task",
      keywords: ["Vertretungskonto", "verknüpfen", "Konto verknüpfen", "BandWith holen", "Vertretung App"],
      related: ["deputy-gigs", "deputy-reply-page", "unlink-a-deputy"],
      body: [
        {
          type: "steps",
          items: [
            "Öffne den Antwortlink, den dir eine Band geschickt hat, und tippe auf **BandWith holen**.",
            "Erstelle in der App ein Konto oder melde dich an. Der Willkommensbildschirm sagt „{band} fragt dich als Vertretung an.“",
            "Warte auf „Dein Konto wird mit der Band verknüpft…“. Dann siehst du „Du bist auf der Vertretungsliste von {band}“.",
            "Tippe auf **OK**. Deine Anfragen von dieser Band stehen in **Vertretungs-Gigs**.",
          ],
        },
        {
          type: "list",
          title: "Andere Meldungen",
          items: [
            "„Dieser Link gehört zu einem anderen Konto“: Die Band hat ihn mit jemand anderem verknüpft. Bitte sie um eine neue Anfrage.",
            "„Du bist schon in {band}“: Du bist Mitglied dieser Band und kannst daher nicht ihre Vertretung sein.",
            "„Dein Konto konnte nicht mit der Band verknüpft werden. Prüfe deine Verbindung.“: Tippe auf **Erneut versuchen**. Die App versucht es auch selbst wieder, sobald du online bist.",
          ],
        },
        { type: "p", text: "Ab dann können dich die Admins der Band in der App anfragen, und du bekommst Mitteilungen. Sie erfahren „{deputy} ist auf BandWith“." },
        { type: "note", tone: "tip", text: "Der Link wartet auf dich, auch wenn du dich erst registrieren musst oder die App neu startet." },
      ],
    },
    {
      id: "deputy-gigs",
      title: "Vertretungs-Gigs",
      summary: "Jede Anfrage, die Bands dir als Vertretung geschickt haben, mit deinen Antworten, der Adresse nach einer Zusage und Kalenderlinks.",
      roles: ["deputy"],
      kind: "reference",
      keywords: ["Vertretungs-Gigs", "meine Vertretungsanfragen", "Kalender-Feed", "abonnieren", "webcal"],
      related: ["deputy-in-the-app", "deputy-notifications", "deputy-reply-page"],
      body: [
        {
          type: "list",
          title: "Wo du sie findest",
          items: [
            "Ohne eigene Band: **Vertretungs-Gigs** ist dein Startbildschirm. **Spielst du auch in einer Band?** bietet **Band einrichten** und **Abmelden** an.",
            "Mit Band: Tippe auf deinen Avatar und dann oben in Profil und Konto auf **Vertretungs-Gigs** („Anfragen von {count} Bands“).",
            "Ein Tippen auf eine Vertretungsmitteilung öffnet sie bei dieser Anfrage.",
          ],
        },
        {
          type: "list",
          title: "Jede Anfrage",
          items: [
            "Gig-Titel und Band mit einem Status: **Wartet auf deine Antwort**, **Du hast zugesagt**, **Du sagst später Bescheid**, **Du hast abgesagt**, **Anfrage zurückgezogen**, **Gig abgesagt** oder **Gig vorbei**.",
            "Datum, Load-in, Soundcheck, Show, Location, Stadt, Rolle und **Angebotene Gage**. Die Adresse erscheint nach einer Zusage.",
            "Zum Antworten: **Ja**, **Noch unsicher** oder **Nein, ich kann nicht**, mit optionaler Nachricht. Später **Antwort ändern**.",
            "Hat sich der Gig geändert: **Etwas hat sich geändert**, dann **Passt weiterhin** oder **Ich kann nicht mehr**.",
            "Nach einer Zusage: **In Karten öffnen**, **Zum Kalender hinzufügen**, **Google Kalender** und **Meine Gigs abonnieren**.",
          ],
        },
        { type: "p", text: "Offene Anfragen stehen oben; geschlossene unter **Vergangen und geschlossen**. Angezeigt werden Anfragen ab 30 Tagen zurück. Die Zeile oben nennt die „Bands, die dich als Vertretung anfragen“." },
        { type: "p", text: "**Meine Gigs abonnieren** fügt einen Kalender-Feed deiner bestätigten Gigs mit dieser Band hinzu. Er übernimmt jede Änderung und markiert abgesagte Gigs, so stimmt dein Kalender, ohne dass du BandWith öffnest." },
        { type: "shot", id: "people-deputy-gigs", caption: "Vertretungs-Gigs: eine Anfrage einer anderen Band, die auf Antwort wartet." },
        { type: "devices", rows: [{ devices: ["duoBook", "duoLand"], text: "Als Startbildschirm steht die BandWith-Markenseite auf dem ersten Bildschirm und deine Gigs auf dem zweiten, wie bei der Anmeldung." }] },
      ],
    },
    {
      id: "unlink-a-deputy",
      title: "Das BandWith-Konto einer Vertretung trennen",
      summary: "Wenn die falsche Person den Link geöffnet hat oder die Vertretung das Konto gewechselt hat.",
      roles: ["admin"],
      kind: "task",
      keywords: ["trennen", "falsches Konto", "weitergeleiteter Link", "neuer Link", "erneuern"],
      related: ["deputies", "deputy-in-the-app", "ask-a-deputy"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe bei **Bandmitglieder** unter **Vertretungen** auf die Vertretung mit dem Etikett **Auf BandWith**.",
            "Tippe im Kasten **Auf BandWith** auf **Konto trennen**.",
            "Lies „BandWith-Konto trennen?“ und tippe auf **Trennen**.",
          ],
        },
        {
          type: "list",
          title: "Was passiert",
          items: [
            "Dieses Konto bekommt keine Anfragen mehr in der App und sieht die Gigs dieser Band nicht mehr in **Vertretungs-Gigs**.",
            "Jeder Link, der dieser Vertretung schon geschickt wurde, wird ersetzt. Alte Antwortseiten, Kalender-Feeds und App-Links funktionieren nicht mehr.",
            "Ihre Antworten bleiben, wie sie waren.",
            "Schick die nächste Anfrage per Nachricht. Wird ihr neuer Link aus der App geöffnet, wird wieder das richtige Konto verknüpft.",
          ],
        },
        { type: "note", tone: "warning", text: "Das lässt sich nicht rückgängig machen: Die alten Links funktionieren nie wieder." },
      ],
    },
    {
      id: "deputy-notifications",
      title: "Mitteilungen zu Vertretungen",
      summary: "Welche Mitteilungen Admins und Vertretungen während einer Anfrage bekommen.",
      roles: ["admin", "deputy"],
      kind: "reference",
      keywords: ["Vertretung Push", "Vertretung Mitteilung", "Vertretung hat geantwortet"],
      related: ["ask-a-deputy", "deputy-gigs", "notifications-inbox"],
      body: [
        {
          type: "table",
          head: ["Wann", "Wer", "Mitteilung"],
          rows: [
            ["Die Vertretung antwortet oder ändert die Antwort", "Alle aktiven Admins", "„{deputy} ist verfügbar“, „bestätigt später“ oder „kann nicht“, mit dem Gig und ihrer Notiz"],
            ["Die Vertretung bestätigt nach einer Änderung", "Alle aktiven Admins", "„{deputy} ist mit den Änderungen einverstanden“"],
            ["Eine Vertretung verknüpft ihr Konto", "Alle aktiven Admins", "„{deputy} ist auf BandWith“"],
            ["Eine neue Anfrage oder erneut **In der App anfragen**", "Verknüpfte Vertretung", "„{band}: Kannst du spielen?“"],
            ["**Zusammenfassung in der App** nach einer Zusage", "Verknüpfte Vertretung", "„Du bist bestätigt: {gig}“"],
            ["Datum, Zeiten oder Location ändern sich nach der Antwort", "Verknüpfte Vertretung", "„{gig} hat sich geändert“, mit den Änderungen und „Passt es noch?“"],
            ["Der Gig wird abgesagt", "Verknüpfte Vertretung", "„{gig} ist abgesagt“"],
            ["Der Admin zieht die Anfrage zurück", "Verknüpfte Vertretung", "„{band} braucht dich nicht mehr“"],
          ],
        },
        { type: "p", text: "Mitteilungen an Admins öffnen den Gig. Mitteilungen an Vertretungen öffnen **Vertretungs-Gigs** bei dieser Anfrage. Eine Vertretung ohne App bekommt nichts automatisch: Schick das Update über **Vertretung finden**." },
        { type: "note", tone: "tip", text: "Mehrere Meldungen kurz hintereinander werden zusammengefasst: Dieselbe Anfrage, Zusammenfassung oder Änderungsmeldung erreicht eine Vertretung höchstens alle 2 Minuten." },
      ],
    },

    // ── Gear ─────────────────────────────────────────────────────────────
    {
      id: "gear-inventory",
      title: "Equipment",
      summary: "Die Equipment-Liste der Band mit Kategorien, Status, Ort und wem jedes Teil gehört.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Equipment", "Inventar", "Ausrüstung", "Backline", "PA", "Equipmentliste"],
      related: ["add-gear", "gear-status", "gear-kits", "kit-for-a-gig"],
      body: [
        {
          type: "steps",
          title: "Öffnen",
          items: [
            "Admins: Tippe auf Start unter **Schnellzugriff** auf **Equipment**.",
            "Alle: Tippe auf deinen Avatar und dann unter **Band-Ressourcen & Abläufe** auf die Kachel **Equipment**.",
          ],
        },
        {
          type: "list",
          title: "Was du siehst",
          items: [
            "Zwei Tabs: **Teile** und **Kits** ([[gear-kits]]).",
            "Ein Suchfeld (**Equipment, Mikros, Kabel suchen…**) und Kategorie-Chips mit Zahlen: **Alle**, **Instrumente**, **Kabel**, **Mikrofone**, **Lautsprecher**, **Ständer**, **Licht**, **Koffer**, die eigenen Kategorien der Band, dann **Sonstiges**.",
            "Jedes Teil: Name, Statuspunkt und eine Zeile mit „Persönlich · {name}“ bei eigenem Equipment einer Person, der Kategorie, „Anz. {count}“ und dem Ort.",
            "Teile, die du ändern darfst, haben einen Bearbeiten- und einen Löschen-Button. Teile, die du nicht ändern darfst, zeigen ein Schloss, und ein Hinweis unter der Liste sagt, wer sie ändern kann.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Fügt jedes Teil hinzu, bearbeitet und löscht es, das der Band und das persönliche Equipment der Mitglieder, und verwaltet Kits." },
            { role: "member", text: "Sieht das gesamte Equipment und alle Kits der Band. Fügt mit **Meine Ausrüstung hinzufügen** eigenes Equipment hinzu und ändert oder löscht nur dieses." },
          ],
        },
        { type: "p", text: "Die Kachel in Profil und Konto zeigt die Zahl der Teile und eine Statuszeile: „{count} in Reparatur“, „{count} verloren“ oder „Alles in Ordnung“." },
        { type: "shot", id: "people-gear", caption: "Equipment & Kits auf dem Tablet: die Kit-Leiste über der Liste der Teile." },
        {
          type: "devices",
          rows: [
            { devices: ["tablet"], text: "Der Bildschirm heißt **Equipment & Kits**. Kits sind eine Reihe von Kacheln über den Teilen, ohne die Tabs Teile/Kits." },
            { devices: ["duoBook", "duoLand"], text: "Ein Kit öffnet sich auf dem zweiten Bildschirm." },
          ],
        },
      ],
    },
    {
      id: "add-gear",
      title: "Ein Equipment-Teil hinzufügen, bearbeiten oder löschen",
      summary: "Füge Equipment als das der Band oder als dein eigenes hinzu und halte seine Details aktuell.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["Equipment hinzufügen", "meine Ausrüstung hinzufügen", "persönliches Equipment", "Teil bearbeiten", "Teil löschen", "Seriennummer"],
      related: ["gear-inventory", "gear-status", "who-sees-what"],
      body: [
        {
          type: "steps",
          items: [
            "Tippe bei **Equipment** auf **Equipment hinzufügen** (Admins) oder **Meine Ausrüstung hinzufügen** (Mitglieder) oder oben rechts auf das +.",
            "Gib den **Name des Postens** ein, zum Beispiel „Shure SM58“.",
            "Admins: Wähle unter **Gehört** **Der Band** oder **Mir (persönlich)**. Teile von Mitgliedern gehören immer ihnen selbst.",
            "Wähle eine **Kategorie** und einen **Status**, lege die **Menge** fest und fülle **Ort / wer es hat** aus.",
            "Keine Kategorie passt? Tippe auf **Eigene** und gib einen **Name der Kategorie** ein (bis zu 40 Zeichen). Sie erscheint dann als Chip für die ganze Band.",
            "Füge, wenn du magst, **Seriennummer**, **Kaufdatum**, **Kaufpreis** und **Notizen** hinzu.",
            "Tippe auf **Teil speichern**.",
          ],
        },
        {
          type: "steps",
          title: "Bearbeiten oder löschen",
          items: [
            "Tippe auf das Teil (**{name} bearbeiten**), ändere es und tippe auf **Änderungen sichern**.",
            "Zum Löschen tippe im Fenster auf **Teil löschen** oder in der Zeile des Teils auf den Papierkorb.",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Kann jedes Teil bearbeiten, ändern, wem es gehört, und alles löschen." },
            { role: "member", text: "Kann nur Teile bearbeiten und löschen, die als eigene markiert sind. Das Fenster sagt „Persönliche Ausrüstung: Die Band sieht sie, nur du und die Admins könnt sie ändern.“ Andere Teile zeigen statt der Buttons ein Schloss." },
          ],
        },
        { type: "note", tone: "warning", text: "Der Papierkorb in einer Zeile oder **Teil löschen** im Fenster fragt zuerst „{name} löschen?“. Ein gelöschtes Teil verschwindet auch aus jedem Kit." },
        { type: "note", tone: "privacy", text: "Alle in der Band sehen jedes Teil, seinen Status und wo es ist. **Seriennummer**, **Kaufdatum** und **Kaufpreis** sehen nur Admins und bei persönlichem Equipment die Person, der es gehört." },
      ],
    },
    {
      id: "gear-status",
      title: "Status und Ort des Equipments",
      summary: "Was Verfügbar, Im Einsatz, Wartung und Verloren bedeuten und wie sie in die Zähler von Kits und Profil und Konto einfließen.",
      roles: ["admin", "member"],
      kind: "reference",
      keywords: ["Status", "in Reparatur", "Wartung", "verloren", "fehlt", "Ort", "wer es hat"],
      related: ["gear-inventory", "gear-kits"],
      body: [
        {
          type: "table",
          head: ["Status", "Bedeutung", "Bereit für einen Gig?"],
          rows: [
            ["**Verfügbar**", "An seinem Platz, frei zum Mitnehmen", "Ja"],
            ["**Im Einsatz**", "Bei jemandem unterwegs", "Ja"],
            ["**Wartung**", "Wird repariert", "Nein: zählt als „in Reparatur“"],
            ["**Verloren**", "Fehlt", "Nein: zählt als „verloren“"],
          ],
        },
        { type: "p", text: "**Verfügbar**, **Im Einsatz**, **Wartung** oder **Verloren** wählst du, wenn du ein Teil bearbeitest." },
        { type: "p", text: "**Ort / wer es hat** ist freier Text: ein Raum, ein Koffer, ein Transporter oder der Name einer Person. So findest du Equipment vor einem Gig." },
        { type: "p", text: "Kits zählen ihre bereiten Teile („{ready}/{total} bereit“) und warnen vor dem Rest („{count} Teile prüfen · vor {gig} prüfen.“)." },
      ],
    },
    {
      id: "gear-kits",
      title: "Ein Equipment-Kit erstellen und bearbeiten",
      summary: "Bündle das Equipment, das du zu einer Art von Gig mitnimmst, etwa eine Club-PA oder ein Akustik-Duo-Set.",
      roles: ["admin"],
      kind: "task",
      keywords: ["Kit", "Equipment-Kit", "Paket", "Packliste", "PA-Kit"],
      related: ["kit-for-a-gig", "gear-inventory", "gear-status"],
      body: [
        {
          type: "steps",
          items: [
            "Öffne bei **Equipment** den Tab **Kits** und tippe auf **Neues Kit**.",
            "Gib den **Kit-Name** ein (bis zu 80 Zeichen) und, wenn du magst, **Notizen**, etwa wie es gepackt wird.",
            "Hake unter **Teile aus deinem Equipment** die Teile an. Nutze die Suche, wenn die Liste lang ist.",
            "Tippe auf **Kit erstellen**.",
          ],
        },
        {
          type: "steps",
          title: "Bearbeiten oder löschen",
          items: [
            "Tippe auf das Kit, um es zu öffnen, und dann auf **Ändern**.",
            "Ändere Name, Notizen oder Teile und tippe auf **Änderungen sichern**.",
            "Zum Löschen tippe auf **Kit löschen** und dann noch einmal (**Nochmal tippen, um das Kit zu löschen**). Die Teile bleiben im Equipment.",
          ],
        },
        {
          type: "list",
          title: "Die Kit-Seite",
          items: [
            "Zähler: **Teile**, **Koffer** und **Bereit**.",
            "**Nächster Gig mit diesem Kit** und eine Warnung, wenn Teile in Wartung oder verloren sind.",
            "Die Liste der Teile mit ihrem Status.",
            "**Für einen Gig nutzen** ([[kit-for-a-gig]]).",
          ],
        },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Erstellt, bearbeitet, löscht und nutzt Kits." },
            { role: "member", text: "Sieht die Kits, ihre Teile und ihre Bereitschaft, ohne Bearbeiten-Buttons." },
          ],
        },
      ],
    },
    {
      id: "kit-for-a-gig",
      title: "Ein Kit für einen Gig nutzen",
      summary: "Ordne einem Gig ein Kit zu, damit die Band weiß, was in den Transporter kommt.",
      roles: ["admin", "member"],
      kind: "task",
      keywords: ["Equipment zuordnen", "Equipment für Gig", "Kit für Gig", "Kit wählen"],
      related: ["gear-kits", "gig-workspace", "gear-status"],
      body: [
        {
          type: "steps",
          title: "Vom Gig aus",
          items: [
            "Öffne den Gig. Tippe im Bereich **EQUIPMENT-KIT** auf **KIT WÄHLEN** (oder **ÄNDERN**, wenn schon eins gesetzt ist).",
            "Tippe in **Kit für diesen Gig** neben jedem Kit, das du brauchst, auf **Kit hinzufügen**. Tippe auf **Kit hinzugefügt**, um eins wieder zu entfernen.",
            "Tippe auf **Fertig**.",
          ],
        },
        {
          type: "steps",
          title: "Vom Kit aus",
          items: [
            "Öffne das Kit und tippe auf **Für einen Gig nutzen**.",
            "Tippe neben jedem kommenden Gig auf **Kit hinzufügen**. Tippe auf **Fertig**.",
          ],
        },
        { type: "p", text: "Der Gig zeigt dann das Kit mit seinen Teilen und „Alle bereit“ oder wie viele geprüft werden müssen. Das Kit zeigt seinen nächsten Gig." },
        {
          type: "roles",
          rows: [
            { role: "admin", text: "Wählt und ändert die Kits bei kommenden Gigs der Band." },
            { role: "member", text: "Sieht das Kit des Gigs und seine Bereitschaft, ohne den Button KIT WÄHLEN." },
          ],
        },
        { type: "note", tone: "tip", text: "Kits gibt es für Gigs der Band: Proben, Angebote und persönliche Gigs haben keinen Bereich EQUIPMENT-KIT. Ein Kit zu nutzen ändert den Status der Teile nicht." },
        { type: "devices", rows: [{ devices: ["tablet"], text: "Der Bereich EQUIPMENT-KIT steht im Rider-Tab des Gigs." }] },
      ],
    },

    // ── Privacy reference ────────────────────────────────────────────────
    {
      id: "who-sees-what",
      title: "Wer was sieht",
      summary: "Jede Art von Banddaten und was Admins, Mitglieder und Vertretungen lesen oder ändern können.",
      roles: ["admin", "member", "deputy"],
      kind: "reference",
      keywords: ["Datenschutz", "Berechtigungen", "Sichtbarkeit", "Gagen", "wer sieht was", "Rollen"],
      related: ["member-roles", "deputies", "member-detail", "add-gear"],
      body: [
        { type: "p", text: "Geld, Angebotspreise, Verträge und die Gagen anderer sind vom Server geschützt, nicht nur in der App ausgeblendet: Das Handy eines Mitglieds bekommt sie nie." },
        {
          type: "table",
          head: ["Daten", "Admin", "Mitglied"],
          rows: [
            ["Gig-Details (Datum, Zeiten, Location, Adresse, Dresscode, Notizen, Rider und Bühnenplan)", "Alles, dazu Kunde, Preis des Gigs, Anzahlung, Zahlungsstatus, interne Notizen und Vertrag", "Die Logistik der Gigs, die die Person spielt und nicht abgesagt hat. Nie Kunde, Preis, Anzahlung, interne Notizen oder Vertrag"],
            ["Besetzung und Antworten eines Gigs", "Alle, mit Gagen und Auszahlungen", "Wer spielt und die Antworten, ohne Gagen"],
            ["Eigene Gage", "Ja", "Ja: die eigene Gage pro Gig, bezahlt oder nicht, die Standardgage und das eigene **Bezahlt · {year}**"],
            ["Gagen anderer", "Ja, für jedes Mitglied und jede Vertretung", "Nein"],
            ["Angebote und Angebotssummen", "Ja: erstellen, senden und alle sehen", "Nein. Die Verfügbarkeitsprüfung eines Angebots zeigt nur das Datum"],
            ["Bandfinanzen, Zahlungen und Statistiken", "Ja", "Nein. Nur die eigenen Einnahmen"],
            ["Preise, Bank- und Steuerangaben", "Ja", "Nein"],
            ["Setlists", "Erstellen, bearbeiten, Gigs zuordnen", "Nur lesen"],
            ["Repertoire (Songs, Songtexte, Akkorde)", "Hinzufügen, bearbeiten, löschen, importieren", "Lesen; Songs und Änderungen vorschlagen; private Notizen und Dateien, die nur die Person sieht"],
            ["Verträge und Rider", "Ja", "Keine Verträge. Der Gig zeigt die Version des Riders und den Bühnenplan"],
            ["Chat", "Bandchat, Gig-Chats, Direktchats mit allen in der Band", "Bandchat, Chats der Gigs, die die Person spielt, Direktchats nur mit Admins"],
            ["Equipment und Kits", "Alles sehen und ändern", "Jedes Teil, seinen Status und Ort sehen; Seriennummer, Kaufdatum und -preis nur beim eigenen persönlichen Equipment; nur das eigene persönliche Equipment ändern"],
            ["Kontaktdaten der Mitglieder", "E-Mail und Telefon aller in der Band", "E-Mail und Telefon aller in der Band"],
            ["Liste der Vertretungen und Anfragen", "Ja: Kontakte, übliche Gagen, Notizen, Antworten", "Nein"],
            ["Persönliche Gigs und private Songnotizen", "Nur die eigenen", "Nur die eigenen"],
          ],
        },
        {
          type: "table",
          head: ["Daten", "Vertretung"],
          rows: [
            ["Gig-Details", "Nur für Gigs, für die sie angefragt wurde: Bandname, Titel, Datum, Zeiten für Load-in, Soundcheck und Show, Location und Stadt. Die Straße erst nach einer Zusage"],
            ["Eigene Gage", "Die in jeder Anfrage angebotene Gage"],
            ["Andere Gagen, Angebote, Finanzen, Preise", "Nein"],
            ["Besetzung, Setlists, Repertoire, Verträge, Chat, Equipment", "Nein"],
            ["Kontaktdaten der Mitglieder", "Nein"],
            ["Infos zur Vertretung", "Die eigenen Anfragen und der Name, unter dem die Band sie gespeichert hat"],
          ],
        },
        { type: "note", tone: "privacy", text: "Mitglieder und Vertretungen sehen nur die eigene Gage und die Logistik. Sie sehen nie die Gagen anderer, Angebotssummen oder die Finanzen der Band." },
        { type: "note", tone: "tip", text: "Die persönlichen Gigs eines Mitglieds (die außerhalb jeder Band) sind privat: Nur die Person selbst sieht sie. Bands sehen nie Titel, Location oder Uhrzeit." },
      ],
    },
  ],

  faq: [
    { q: "Sehen Mitglieder, was die anderen bekommen?", a: "Nein. Ein Mitglied sieht nur die eigene Gage bei jedem Gig und die eigenen Jahressummen. Admins sehen die aller." },
    { q: "Wie verlasse ich eine Band?", a: "Tippe bei **Bandmitglieder** in deiner eigenen Zeile auf **⋯** und dann auf **Band verlassen**. Ein Admin kann gehen, solange die Band einen weiteren Admin hat. Siehe [[leave-a-band]].", roles: ["admin", "member"] },
    { q: "Warum kann ich den letzten Admin nicht entfernen?", a: "Jede Band braucht mindestens einen Admin. Mach zuerst jemand anderen zum Admin und ändere oder entferne dann den ersten.", roles: ["admin"] },
    { q: "Wie lange gilt eine Einladung?", a: "7 Tage. Die eingeladene Adresse bekommt eine Erinnerung, wenn noch 2 Tage übrig sind. Lädst du dieselbe Adresse noch einmal ein, wird sie verlängert.", roles: ["admin"] },
    { q: "Die eingeladene Person sagt, die Einladung funktioniert nicht.", a: "Sie muss sich mit genau der E-Mail-Adresse anmelden, die du eingeladen hast. Ist die Einladung abgelaufen, lade sie noch einmal ein.", roles: ["admin"] },
    { q: "Braucht eine Vertretung die App?", a: "Nein. Der Link in der Anfrage öffnet eine Webseite, auf der sie mit einem Tippen antwortet. Mit der App bekommt sie Mitteilungen und sieht alle ihre Anfragen in Vertretungs-Gigs." },
    { q: "Kann eine Vertretung den Preis des Gigs oder den Kunden sehen?", a: "Nein. Eine Vertretung sieht nur die Logistik, ihre Rolle und die ihr angebotene Gage. Die Straße erscheint, nachdem sie zugesagt hat." },
    { q: "Die falsche Person hat einen Vertretungslink geöffnet. Was tue ich?", a: "Öffne die Vertretung bei Bandmitglieder, tippe auf „Konto trennen“ und bestätige. Alle alten Links funktionieren nicht mehr; schick die nächste Anfrage per Nachricht.", roles: ["admin"] },
    { q: "Können Mitglieder Equipment hinzufügen?", a: "Ja, ihr eigenes persönliches Equipment mit „Meine Ausrüstung hinzufügen“. Ändern oder löschen können sie nur dieses. Das Equipment der Band verwalten die Admins.", roles: ["member"] },
    { q: "Sehen Mitglieder die Vertretungen?", a: "Nein. Die Liste der Vertretungen und die Anfragen sind nur für Admins." },
    { q: "Wo ändere ich das Band-Logo?", a: "Profil und Konto, Karte der aktuellen Band, Ändern, Band-Logo. Es erscheint auch auf deinen Angebots-PDFs.", roles: ["admin"] },
    { q: "Wo lege ich die Standardgage eines Mitglieds fest?", a: "Tippe bei **Bandmitglieder** auf die Person, dann unter **In der Band**: **Standardgage** und **Speichern**. Sie gilt für neue Gigs.", roles: ["admin"] },
  ],

  glossary: [
    { term: "Admin", definition: "Eine Person, die die Band verwaltet: Gigs, Geld, Setlists, Mitglieder und Einstellungen. Eine Band kann mehrere haben und braucht mindestens einen.", see: "member-roles" },
    { term: "Mitglied", definition: "Eine Person in der Band, die Gigs, Logistik und die eigene Gage sieht, die Band aber nicht verwaltet.", see: "member-roles" },
    { term: "Einladungscode", definition: "Der Code in einer Band-Einladung. Füg ihn ein oder öffne den Einladungslink, um der Band beizutreten.", see: "accept-an-invite" },
    { term: "Vertretung", definition: "Ein Musiker außerhalb der Band, der einspringt, wenn ein Mitglied nicht spielen kann. Auch Aushilfe oder Sub genannt.", see: "deputies" },
    { term: "Antwortlink", definition: "Der private Link in einer Vertretungsanfrage. Er öffnet eine Webseite, auf der die Vertretung ohne Konto antwortet.", see: "deputy-reply-page" },
    { term: "Auf BandWith", definition: "Eine Vertretung, deren BandWith-Konto mit dem Eintrag der Band verknüpft ist. Die Band kann sie in der App anfragen.", see: "deputy-in-the-app" },
    { term: "Vertretungs-Gigs", definition: "Der Bildschirm, auf dem eine Vertretung jede Anfrage der Bands sieht und beantwortet, die sie anfragen.", see: "deputy-gigs" },
    { term: "Trennen", definition: "Das verknüpfte Konto einer Vertretung lösen. Alle ihre alten Links funktionieren dann nicht mehr.", see: "unlink-a-deputy" },
    { term: "Wer vertritt wen", definition: "Die Karte in der Liste der Vertretungen, die für jedes Instrument die Mitglieder und Vertretungen zeigt, die es spielen.", see: "add-a-deputy" },
    { term: "Persönliches Equipment", definition: "Equipment, das ein Mitglied als eigenes hinzufügt. Die ganze Band sieht es; ändern können es nur die Person selbst und die Admins.", see: "add-gear" },
    { term: "Kit", definition: "Eine benannte Zusammenstellung von Teilen aus dem Equipment, die du zu einer Art von Gig mitnimmst, etwa eine Club-PA.", see: "gear-kits" },
    { term: "Bereit", definition: "Ein Kit-Teil, das zu einem Gig mitkann: verfügbar oder im Einsatz, nicht in Wartung oder verloren.", see: "gear-status" },
  ],
};

export default people;
