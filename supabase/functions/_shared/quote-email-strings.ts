// Words of the client quote emails (templates "quote-link" and "quote-reply",
// migration 099), in the client's language. The quote page (/quote.html) has
// its own dictionary in src/quote/strings.ts; keep the two in the same tone.
//
// Values are plain text: renderEmail escapes them, and "\n" becomes <br>.

export type QuoteEmailLang = "en" | "it" | "es" | "fr" | "de" | "pt";
export type QuoteEmailKind = "sent" | "updated" | "reminder" | "reply";

interface Strings {
  locale: string;
  greet: string; // "{name}"
  greetNoName: string;
  subject: Record<QuoteEmailKind, string>; // {band} {ref}
  preheader: Record<QuoteEmailKind, string>; // {band} {event}
  kicker: string; // {ref}
  kickerReply: string; // {band}
  headline: Record<QuoteEmailKind, string>;
  intro: Record<QuoteEmailKind, string>; // {band} {event}
  cta: string;
  ctaReply: string;
  event: string;
  date: string;
  total: string;
  pdfTitle: string;
  pdfAttached: string;
  pdfOnPage: string;
  noteTitle: string;
  noteText: string; // {band}
  depositNote: string; // {band} {deposit}
  fallbackTitle: string;
  fallbackText: string;
  footer: string; // {band} {to}
}

export const QUOTE_EMAIL_STRINGS: Record<QuoteEmailLang, Strings> = {
  en: {
    locale: "en-GB",
    greet: "Hi {name},",
    greetNoName: "Hello,",
    subject: {
      sent: "{band} — Quote {ref}",
      updated: "{band} — Updated quote {ref}",
      reminder: "Reminder: quote {ref} from {band}",
      reply: "{band} replied about quote {ref}",
    },
    preheader: {
      sent: "{band} sent you a quote for {event}. Accept it, decline it or ask a question.",
      updated: "{band} updated your quote for {event}.",
      reminder: "Your quote from {band} for {event} is waiting for your answer.",
      reply: "{band} replied to your message about {event}.",
    },
    kicker: "Quote · {ref}",
    kickerReply: "Message from {band}",
    headline: {
      sent: "Your quote\nis ready.",
      updated: "Your quote\nis updated.",
      reminder: "Your quote\nis waiting.",
      reply: "A new\nreply.",
    },
    intro: {
      sent: "{band} sent you a quote for {event}. Open it to see the details, then accept it, decline it or ask a question. No account needed.",
      updated: "{band} updated your quote for {event}. The page always shows the latest version.",
      reminder: "Just a reminder: your quote from {band} for {event} is waiting for your answer.",
      reply: "{band} replied to your message about {event}:",
    },
    cta: "Open the quote",
    ctaReply: "Reply on the quote page",
    event: "Event",
    date: "Date",
    total: "Total",
    pdfTitle: "The PDF",
    pdfAttached: "The quote is attached to this email as a PDF.",
    pdfOnPage: "You can download the PDF from the quote page.",
    noteTitle: "About accepting",
    noteText: "Accepting on the page records your answer with your name and the time. It is not a signature: if a contract is needed, {band} sends it separately.",
    depositNote: "To confirm the date, {band} asks for a deposit of {deposit}. After you accept, the page shows how to pay it: bank details and payment reference.",
    fallbackTitle: "Button not working?",
    fallbackText: "Paste this link into your browser:",
    footer: "You’re getting this because {band} sent a quote to {to} through BandWith. To answer, use the quote page: replies to this email are not read.",
  },
  it: {
    locale: "it-IT",
    greet: "Gentile {name},",
    greetNoName: "Gentile cliente,",
    subject: {
      sent: "{band} — Preventivo {ref}",
      updated: "{band} — Preventivo {ref} aggiornato",
      reminder: "Promemoria: preventivo {ref} di {band}",
      reply: "{band} ha risposto sul preventivo {ref}",
    },
    preheader: {
      sent: "{band} vi ha inviato un preventivo per {event}. Potete accettarlo, rifiutarlo o fare una domanda.",
      updated: "{band} ha aggiornato il preventivo per {event}.",
      reminder: "Il preventivo di {band} per {event} attende la vostra risposta.",
      reply: "{band} ha risposto al vostro messaggio su {event}.",
    },
    kicker: "Preventivo · {ref}",
    kickerReply: "Messaggio da {band}",
    headline: {
      sent: "Il vostro\npreventivo.",
      updated: "Preventivo\naggiornato.",
      reminder: "Il preventivo\nvi aspetta.",
      reply: "Una nuova\nrisposta.",
    },
    intro: {
      sent: "{band} vi ha inviato un preventivo per {event}. Apritelo per vedere i dettagli, poi accettatelo, rifiutatelo o fate una domanda. Non serve un account.",
      updated: "{band} ha aggiornato il preventivo per {event}. La pagina mostra sempre la versione più recente.",
      reminder: "Vi ricordiamo che il preventivo di {band} per {event} attende la vostra risposta.",
      reply: "{band} ha risposto al vostro messaggio su {event}:",
    },
    cta: "Apri il preventivo",
    ctaReply: "Rispondi sulla pagina",
    event: "Evento",
    date: "Data",
    total: "Totale",
    pdfTitle: "Il PDF",
    pdfAttached: "Il preventivo è allegato a questa email in PDF.",
    pdfOnPage: "Potete scaricare il PDF dalla pagina del preventivo.",
    noteTitle: "Sull’accettazione",
    noteText: "Accettando sulla pagina registrate la vostra risposta con nome e orario. Non è una firma: se serve un contratto, {band} lo invia a parte.",
    depositNote: "Per confermare la data, {band} chiede un acconto di {deposit}. Dopo l’accettazione, la pagina mostra come pagarlo: coordinate bancarie e causale.",
    fallbackTitle: "Il pulsante non funziona?",
    fallbackText: "Incollate questo link nel browser:",
    footer: "Ricevete questa email perché {band} ha inviato un preventivo a {to} tramite BandWith. Per rispondere usate la pagina del preventivo: le risposte a questa email non vengono lette.",
  },
  es: {
    locale: "es-ES",
    greet: "Hola, {name}:",
    greetNoName: "Hola:",
    subject: {
      sent: "{band} — Presupuesto {ref}",
      updated: "{band} — Presupuesto {ref} actualizado",
      reminder: "Recordatorio: presupuesto {ref} de {band}",
      reply: "{band} respondió sobre el presupuesto {ref}",
    },
    preheader: {
      sent: "{band} te ha enviado un presupuesto para {event}. Acéptalo, recházalo o haz una pregunta.",
      updated: "{band} ha actualizado tu presupuesto para {event}.",
      reminder: "Tu presupuesto de {band} para {event} espera tu respuesta.",
      reply: "{band} ha respondido a tu mensaje sobre {event}.",
    },
    kicker: "Presupuesto · {ref}",
    kickerReply: "Mensaje de {band}",
    headline: {
      sent: "Tu presupuesto\nestá listo.",
      updated: "Presupuesto\nactualizado.",
      reminder: "Tu presupuesto\nte espera.",
      reply: "Una nueva\nrespuesta.",
    },
    intro: {
      sent: "{band} te ha enviado un presupuesto para {event}. Ábrelo para ver los detalles y luego acéptalo, recházalo o haz una pregunta. No necesitas cuenta.",
      updated: "{band} ha actualizado tu presupuesto para {event}. La página siempre muestra la versión más reciente.",
      reminder: "Te recordamos que el presupuesto de {band} para {event} está esperando tu respuesta.",
      reply: "{band} ha respondido a tu mensaje sobre {event}:",
    },
    cta: "Abrir el presupuesto",
    ctaReply: "Responder en la página",
    event: "Evento",
    date: "Fecha",
    total: "Total",
    pdfTitle: "El PDF",
    pdfAttached: "El presupuesto va adjunto a este email en PDF.",
    pdfOnPage: "Puedes descargar el PDF desde la página del presupuesto.",
    noteTitle: "Sobre la aceptación",
    noteText: "Al aceptar en la página queda registrada tu respuesta con tu nombre y la hora. No es una firma: si hace falta un contrato, {band} lo envía aparte.",
    depositNote: "Para confirmar la fecha, {band} pide un anticipo de {deposit}. Cuando aceptes, la página muestra cómo pagarlo: datos bancarios y concepto.",
    fallbackTitle: "¿El botón no funciona?",
    fallbackText: "Pega este enlace en tu navegador:",
    footer: "Recibes este email porque {band} envió un presupuesto a {to} a través de BandWith. Para responder, usa la página del presupuesto: las respuestas a este email no se leen.",
  },
  fr: {
    locale: "fr-FR",
    greet: "Bonjour {name},",
    greetNoName: "Bonjour,",
    subject: {
      sent: "{band} — Devis {ref}",
      updated: "{band} — Devis {ref} mis à jour",
      reminder: "Rappel : devis {ref} de {band}",
      reply: "{band} a répondu au sujet du devis {ref}",
    },
    preheader: {
      sent: "{band} vous a envoyé un devis pour {event}. Acceptez-le, refusez-le ou posez une question.",
      updated: "{band} a mis à jour votre devis pour {event}.",
      reminder: "Votre devis de {band} pour {event} attend votre réponse.",
      reply: "{band} a répondu à votre message au sujet de {event}.",
    },
    kicker: "Devis · {ref}",
    kickerReply: "Message de {band}",
    headline: {
      sent: "Votre devis\nest prêt.",
      updated: "Devis\nmis à jour.",
      reminder: "Votre devis\nvous attend.",
      reply: "Une nouvelle\nréponse.",
    },
    intro: {
      sent: "{band} vous a envoyé un devis pour {event}. Ouvrez-le pour voir le détail, puis acceptez-le, refusez-le ou posez une question. Aucun compte n’est nécessaire.",
      updated: "{band} a mis à jour votre devis pour {event}. La page affiche toujours la dernière version.",
      reminder: "Petit rappel : le devis de {band} pour {event} attend votre réponse.",
      reply: "{band} a répondu à votre message au sujet de {event} :",
    },
    cta: "Ouvrir le devis",
    ctaReply: "Répondre sur la page",
    event: "Événement",
    date: "Date",
    total: "Total",
    pdfTitle: "Le PDF",
    pdfAttached: "Le devis est joint à cet e-mail en PDF.",
    pdfOnPage: "Vous pouvez télécharger le PDF depuis la page du devis.",
    noteTitle: "À propos de l’acceptation",
    noteText: "Accepter sur la page enregistre votre réponse avec votre nom et l’heure. Ce n’est pas une signature : si un contrat est nécessaire, {band} vous l’envoie séparément.",
    depositNote: "Pour confirmer la date, {band} demande un acompte de {deposit}. Après votre acceptation, la page indique comment le régler : coordonnées bancaires et référence.",
    fallbackTitle: "Le bouton ne fonctionne pas ?",
    fallbackText: "Collez ce lien dans votre navigateur :",
    footer: "Vous recevez cet e-mail parce que {band} a envoyé un devis à {to} via BandWith. Pour répondre, utilisez la page du devis : les réponses à cet e-mail ne sont pas lues.",
  },
  de: {
    locale: "de-DE",
    greet: "Guten Tag {name},",
    greetNoName: "Guten Tag,",
    subject: {
      sent: "{band} — Angebot {ref}",
      updated: "{band} — Angebot {ref} aktualisiert",
      reminder: "Erinnerung: Angebot {ref} von {band}",
      reply: "{band} hat zum Angebot {ref} geantwortet",
    },
    preheader: {
      sent: "{band} hat Ihnen ein Angebot für {event} gesendet. Nehmen Sie es an, lehnen Sie es ab oder stellen Sie eine Frage.",
      updated: "{band} hat Ihr Angebot für {event} aktualisiert.",
      reminder: "Ihr Angebot von {band} für {event} wartet auf Ihre Antwort.",
      reply: "{band} hat auf Ihre Nachricht zu {event} geantwortet.",
    },
    kicker: "Angebot · {ref}",
    kickerReply: "Nachricht von {band}",
    headline: {
      sent: "Ihr Angebot\nist da.",
      updated: "Angebot\naktualisiert.",
      reminder: "Ihr Angebot\nwartet.",
      reply: "Eine neue\nAntwort.",
    },
    intro: {
      sent: "{band} hat Ihnen ein Angebot für {event} gesendet. Öffnen Sie es, um die Details zu sehen, und nehmen Sie es an, lehnen Sie es ab oder stellen Sie eine Frage. Ein Konto ist nicht nötig.",
      updated: "{band} hat Ihr Angebot für {event} aktualisiert. Die Seite zeigt immer die neueste Version.",
      reminder: "Eine kurze Erinnerung: Das Angebot von {band} für {event} wartet auf Ihre Antwort.",
      reply: "{band} hat auf Ihre Nachricht zu {event} geantwortet:",
    },
    cta: "Angebot öffnen",
    ctaReply: "Auf der Seite antworten",
    event: "Veranstaltung",
    date: "Datum",
    total: "Gesamt",
    pdfTitle: "Das PDF",
    pdfAttached: "Das Angebot ist dieser E-Mail als PDF angehängt.",
    pdfOnPage: "Sie können das PDF auf der Angebotsseite herunterladen.",
    noteTitle: "Zur Annahme",
    noteText: "Wenn Sie auf der Seite annehmen, wird Ihre Antwort mit Name und Uhrzeit erfasst. Das ist keine Unterschrift: Falls ein Vertrag nötig ist, sendet {band} ihn separat.",
    depositNote: "Um den Termin zu bestätigen, bittet {band} um eine Anzahlung von {deposit}. Nach der Annahme zeigt die Seite, wie Sie sie bezahlen: Bankverbindung und Verwendungszweck.",
    fallbackTitle: "Funktioniert der Button nicht?",
    fallbackText: "Fügen Sie diesen Link in Ihren Browser ein:",
    footer: "Sie erhalten diese E-Mail, weil {band} über BandWith ein Angebot an {to} gesendet hat. Bitte antworten Sie über die Angebotsseite: Antworten auf diese E-Mail werden nicht gelesen.",
  },
  pt: {
    locale: "pt-BR",
    greet: "Olá, {name},",
    greetNoName: "Olá,",
    subject: {
      sent: "{band} — Orçamento {ref}",
      updated: "{band} — Orçamento {ref} atualizado",
      reminder: "Lembrete: orçamento {ref} de {band}",
      reply: "{band} respondeu sobre o orçamento {ref}",
    },
    preheader: {
      sent: "{band} enviou um orçamento para {event}. Aceite, recuse ou faça uma pergunta.",
      updated: "{band} atualizou seu orçamento para {event}.",
      reminder: "Seu orçamento de {band} para {event} está aguardando sua resposta.",
      reply: "{band} respondeu à sua mensagem sobre {event}.",
    },
    kicker: "Orçamento · {ref}",
    kickerReply: "Mensagem de {band}",
    headline: {
      sent: "Seu orçamento\nestá pronto.",
      updated: "Orçamento\natualizado.",
      reminder: "Seu orçamento\nespera você.",
      reply: "Uma nova\nresposta.",
    },
    intro: {
      sent: "{band} enviou um orçamento para {event}. Abra para ver os detalhes e depois aceite, recuse ou faça uma pergunta. Não precisa de conta.",
      updated: "{band} atualizou seu orçamento para {event}. A página sempre mostra a versão mais recente.",
      reminder: "Só um lembrete: o orçamento de {band} para {event} está aguardando sua resposta.",
      reply: "{band} respondeu à sua mensagem sobre {event}:",
    },
    cta: "Abrir o orçamento",
    ctaReply: "Responder na página",
    event: "Evento",
    date: "Data",
    total: "Total",
    pdfTitle: "O PDF",
    pdfAttached: "O orçamento está anexado a este e-mail em PDF.",
    pdfOnPage: "Você pode baixar o PDF na página do orçamento.",
    noteTitle: "Sobre o aceite",
    noteText: "Ao aceitar na página, sua resposta fica registrada com seu nome e o horário. Não é uma assinatura: se for preciso um contrato, {band} envia separadamente.",
    depositNote: "Para confirmar a data, {band} pede um sinal de {deposit}. Depois que você aceitar, a página mostra como pagar: dados bancários e referência.",
    fallbackTitle: "O botão não funciona?",
    fallbackText: "Cole este link no seu navegador:",
    footer: "Você está recebendo este e-mail porque {band} enviou um orçamento para {to} pelo BandWith. Para responder, use a página do orçamento: respostas a este e-mail não são lidas.",
  },
};

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

export const pickQuoteEmailLang = (lang: unknown): QuoteEmailLang =>
  typeof lang === "string" && lang in QUOTE_EMAIL_STRINGS ? (lang as QuoteEmailLang) : "en";

/** "2027-03-20" in the client's language ("20 March 2027"); "" when unknown. */
export function quoteEmailDate(date: unknown, lang: QuoteEmailLang): string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(date)) return "";
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(QUOTE_EMAIL_STRINGS[lang].locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export interface QuoteEmailInput {
  kind: QuoteEmailKind;
  lang: QuoteEmailLang;
  band: string;
  ref: string;
  event: string;
  date: string; // already formatted
  total: string;
  clientName: string; // "" when unknown
  to: string;
  url: string;
  pdfAttached: boolean;
  reply?: string;
  /** The deposit asked to confirm the date, already formatted ("€1,171"); "" when none. */
  deposit?: string;
}

/** Template variables for "quote-link" / "quote-reply" (raw values). */
export function quoteEmailVars(i: QuoteEmailInput): Record<string, string> {
  const s = QUOTE_EMAIL_STRINGS[i.lang];
  const v = { band: i.band, ref: i.ref, event: i.event, to: i.to };
  const greet = i.clientName ? fill(s.greet, { name: i.clientName }) : s.greetNoName;
  const reply = i.kind === "reply";
  return {
    Subject: fill(s.subject[i.kind], v),
    Preheader: fill(s.preheader[i.kind], v),
    Kicker: reply ? fill(s.kickerReply, v) : fill(s.kicker, v),
    Headline: s.headline[i.kind],
    Intro: `${greet}\n${fill(s.intro[i.kind], v)}`,
    CtaLabel: reply ? s.ctaReply : s.cta,
    QuoteURL: i.url,
    EventLabel: s.event,
    EventName: i.event,
    DateLabel: s.date,
    EventDate: i.date || "—",
    TotalLabel: s.total,
    Total: i.total || "—",
    PdfTitle: s.pdfTitle,
    PdfText: i.pdfAttached ? s.pdfAttached : s.pdfOnPage,
    NoteTitle: s.noteTitle,
    // Before the answer, the client knows a deposit confirms the date and where to pay it (deposit tweaks).
    NoteText: i.deposit && !reply ? `${fill(s.depositNote, { ...v, deposit: i.deposit })}\n${fill(s.noteText, v)}` : fill(s.noteText, v),
    FallbackTitle: s.fallbackTitle,
    FallbackText: s.fallbackText,
    FooterReason: fill(s.footer, v),
    Reply: i.reply ?? "",
    To: i.to,
  };
}

// ------------------------------------------------------------------ balance (168)
// Template "quote-balance": the final balance of an accepted quote, in the
// client's language. The page's words are in src/quote/strings.ts (balance*).

export type QuoteBalanceKind = "sent" | "updated" | "reminder";

interface BalanceStrings {
  subject: Record<QuoteBalanceKind, string>; // {band} {ref}
  preheader: Record<QuoteBalanceKind, string>; // {band} {event} {amount}
  kicker: string; // {ref}
  headline: Record<QuoteBalanceKind, string>;
  intro: Record<QuoteBalanceKind, string>; // {band} {event} {amount}
  dueBy: string; // {date}
  cta: string;
  event: string;
  date: string;
  total: string;
  received: string;
  balance: string;
  dueLabel: string;
  howTitle: string;
  bank: string;
  reference: string;
  card: string;
  cash: string;
  noteTitle: string;
  noteText: string; // {band}
  footer: string; // {band} {to}
}

export const QUOTE_BALANCE_STRINGS: Record<QuoteEmailLang, BalanceStrings> = {
  en: {
    subject: { sent: "{band} — Balance for {ref}", updated: "{band} — Updated balance for {ref}", reminder: "Reminder: balance for {ref} from {band}" },
    preheader: {
      sent: "Thank you! The balance for {event} is {amount}. Bank details and the other ways to pay are inside.",
      updated: "{band} updated the balance for {event}: {amount}.",
      reminder: "A friendly reminder: the balance of {amount} for {event} is still open.",
    },
    kicker: "Balance · {ref}",
    headline: { sent: "Your balance\nis ready.", updated: "Balance\nupdated.", reminder: "A friendly\nreminder." },
    intro: {
      sent: "Thank you for choosing {band}! Here is the balance for {event}: {amount}.",
      updated: "{band} updated the balance for {event}: {amount}. The page always shows the latest amount.",
      reminder: "A friendly reminder: the balance of {amount} for {event} is still open.",
    },
    dueBy: "Please pay by {date}.",
    cta: "See how to pay",
    event: "Event",
    date: "Date",
    total: "Agreed total",
    received: "Already paid",
    balance: "Balance due",
    dueLabel: "Due by",
    howTitle: "How to pay",
    bank: "Bank transfer",
    reference: "Reference",
    card: "By card: use the “Pay by card” button on the page.",
    cash: "Cash",
    noteTitle: "Already paid?",
    noteText: "Then you can ignore this email: {band} marks the balance as received and the page will say so.",
    footer: "You’re getting this because {band} sent the balance of a quote to {to} through BandWith. BandWith does not take payments: you pay {band} directly. To write to {band}, use the quote page.",
  },
  it: {
    subject: { sent: "{band} — Saldo del preventivo {ref}", updated: "{band} — Saldo aggiornato del preventivo {ref}", reminder: "Promemoria: saldo del preventivo {ref} di {band}" },
    preheader: {
      sent: "Grazie! Il saldo per {event} è di {amount}. Dentro trovate le coordinate bancarie e gli altri modi per pagare.",
      updated: "{band} ha aggiornato il saldo per {event}: {amount}.",
      reminder: "Un piccolo promemoria: il saldo di {amount} per {event} è ancora aperto.",
    },
    kicker: "Saldo · {ref}",
    headline: { sent: "Il vostro\nsaldo.", updated: "Saldo\naggiornato.", reminder: "Un piccolo\npromemoria." },
    intro: {
      sent: "Grazie per aver scelto {band}! Ecco il saldo per {event}: {amount}.",
      updated: "{band} ha aggiornato il saldo per {event}: {amount}. La pagina mostra sempre l’importo più recente.",
      reminder: "Un piccolo promemoria: il saldo di {amount} per {event} è ancora aperto.",
    },
    dueBy: "Da pagare entro il {date}.",
    cta: "Come pagare",
    event: "Evento",
    date: "Data",
    total: "Totale concordato",
    received: "Già pagato",
    balance: "Saldo da pagare",
    dueLabel: "Entro il",
    howTitle: "Come pagare",
    bank: "Bonifico bancario",
    reference: "Causale",
    card: "Con carta: usate il pulsante “Paga con carta” sulla pagina.",
    cash: "Contanti",
    noteTitle: "Avete già pagato?",
    noteText: "Allora potete ignorare questa email: {band} segna il saldo come ricevuto e la pagina lo mostrerà.",
    footer: "Ricevete questa email perché {band} ha inviato il saldo di un preventivo a {to} tramite BandWith. BandWith non riceve pagamenti: pagate direttamente {band}. Per scrivere a {band} usate la pagina del preventivo.",
  },
  es: {
    subject: { sent: "{band} — Saldo del presupuesto {ref}", updated: "{band} — Saldo actualizado del presupuesto {ref}", reminder: "Recordatorio: saldo del presupuesto {ref} de {band}" },
    preheader: {
      sent: "¡Gracias! El saldo de {event} es de {amount}. Dentro tienes los datos bancarios y las otras formas de pago.",
      updated: "{band} ha actualizado el saldo de {event}: {amount}.",
      reminder: "Un recordatorio amable: el saldo de {amount} de {event} sigue pendiente.",
    },
    kicker: "Saldo · {ref}",
    headline: { sent: "Tu saldo\nestá listo.", updated: "Saldo\nactualizado.", reminder: "Un recordatorio\namable." },
    intro: {
      sent: "¡Gracias por elegir a {band}! Aquí tienes el saldo de {event}: {amount}.",
      updated: "{band} ha actualizado el saldo de {event}: {amount}. La página siempre muestra el importe más reciente.",
      reminder: "Un recordatorio amable: el saldo de {amount} de {event} sigue pendiente.",
    },
    dueBy: "Por favor, paga antes del {date}.",
    cta: "Cómo pagar",
    event: "Evento",
    date: "Fecha",
    total: "Total acordado",
    received: "Ya pagado",
    balance: "Saldo pendiente",
    dueLabel: "Antes del",
    howTitle: "Cómo pagar",
    bank: "Transferencia bancaria",
    reference: "Concepto",
    card: "Con tarjeta: usa el botón “Pagar con tarjeta” de la página.",
    cash: "Efectivo",
    noteTitle: "¿Ya has pagado?",
    noteText: "Entonces puedes ignorar este email: {band} marca el saldo como recibido y la página lo indicará.",
    footer: "Recibes este email porque {band} envió el saldo de un presupuesto a {to} a través de BandWith. BandWith no cobra pagos: pagas directamente a {band}. Para escribir a {band}, usa la página del presupuesto.",
  },
  fr: {
    subject: { sent: "{band} — Solde du devis {ref}", updated: "{band} — Solde mis à jour du devis {ref}", reminder: "Rappel : solde du devis {ref} de {band}" },
    preheader: {
      sent: "Merci ! Le solde pour {event} est de {amount}. Les coordonnées bancaires et les autres moyens de paiement sont à l’intérieur.",
      updated: "{band} a mis à jour le solde pour {event} : {amount}.",
      reminder: "Petit rappel : le solde de {amount} pour {event} est toujours ouvert.",
    },
    kicker: "Solde · {ref}",
    headline: { sent: "Votre solde\nest prêt.", updated: "Solde\nmis à jour.", reminder: "Petit\nrappel." },
    intro: {
      sent: "Merci d’avoir choisi {band} ! Voici le solde pour {event} : {amount}.",
      updated: "{band} a mis à jour le solde pour {event} : {amount}. La page affiche toujours le montant le plus récent.",
      reminder: "Petit rappel : le solde de {amount} pour {event} est toujours ouvert.",
    },
    dueBy: "À régler avant le {date}.",
    cta: "Comment payer",
    event: "Événement",
    date: "Date",
    total: "Total convenu",
    received: "Déjà payé",
    balance: "Solde à payer",
    dueLabel: "Avant le",
    howTitle: "Comment payer",
    bank: "Virement bancaire",
    reference: "Référence",
    card: "Par carte : utilisez le bouton « Payer par carte » sur la page.",
    cash: "Espèces",
    noteTitle: "Déjà payé ?",
    noteText: "Vous pouvez alors ignorer cet email : {band} marque le solde comme reçu et la page l’indiquera.",
    footer: "Vous recevez cet email car {band} a envoyé le solde d’un devis à {to} via BandWith. BandWith n’encaisse aucun paiement : vous payez directement {band}. Pour écrire à {band}, utilisez la page du devis.",
  },
  de: {
    subject: { sent: "{band} — Restbetrag zum Angebot {ref}", updated: "{band} — Aktualisierter Restbetrag zum Angebot {ref}", reminder: "Erinnerung: Restbetrag zum Angebot {ref} von {band}" },
    preheader: {
      sent: "Danke! Der Restbetrag für {event} beträgt {amount}. Bankverbindung und weitere Zahlungswege finden Sie hier.",
      updated: "{band} hat den Restbetrag für {event} aktualisiert: {amount}.",
      reminder: "Eine freundliche Erinnerung: Der Restbetrag von {amount} für {event} ist noch offen.",
    },
    kicker: "Restbetrag · {ref}",
    headline: { sent: "Ihr Rest-\nbetrag.", updated: "Restbetrag\naktualisiert.", reminder: "Eine kleine\nErinnerung." },
    intro: {
      sent: "Danke, dass Sie sich für {band} entschieden haben! Hier ist der Restbetrag für {event}: {amount}.",
      updated: "{band} hat den Restbetrag für {event} aktualisiert: {amount}. Die Seite zeigt immer den aktuellen Betrag.",
      reminder: "Eine freundliche Erinnerung: Der Restbetrag von {amount} für {event} ist noch offen.",
    },
    dueBy: "Bitte bis zum {date} bezahlen.",
    cta: "So bezahlen Sie",
    event: "Veranstaltung",
    date: "Datum",
    total: "Vereinbarte Summe",
    received: "Bereits bezahlt",
    balance: "Offener Betrag",
    dueLabel: "Fällig bis",
    howTitle: "So bezahlen Sie",
    bank: "Überweisung",
    reference: "Verwendungszweck",
    card: "Mit Karte: Nutzen Sie die Schaltfläche „Mit Karte bezahlen“ auf der Seite.",
    cash: "Bar",
    noteTitle: "Schon bezahlt?",
    noteText: "Dann können Sie diese E-Mail ignorieren: {band} markiert den Restbetrag als erhalten, und die Seite zeigt es an.",
    footer: "Sie erhalten diese E-Mail, weil {band} über BandWith den Restbetrag eines Angebots an {to} gesendet hat. BandWith nimmt keine Zahlungen an: Sie bezahlen {band} direkt. Um {band} zu schreiben, nutzen Sie die Angebotsseite.",
  },
  pt: {
    subject: { sent: "{band} — Saldo do orçamento {ref}", updated: "{band} — Saldo atualizado do orçamento {ref}", reminder: "Lembrete: saldo do orçamento {ref} de {band}" },
    preheader: {
      sent: "Obrigado! O saldo de {event} é {amount}. Os dados bancários e as outras formas de pagamento estão aqui dentro.",
      updated: "{band} atualizou o saldo de {event}: {amount}.",
      reminder: "Um lembrete gentil: o saldo de {amount} de {event} ainda está em aberto.",
    },
    kicker: "Saldo · {ref}",
    headline: { sent: "Seu saldo\nestá pronto.", updated: "Saldo\natualizado.", reminder: "Um lembrete\ngentil." },
    intro: {
      sent: "Obrigado por escolher {band}! Aqui está o saldo de {event}: {amount}.",
      updated: "{band} atualizou o saldo de {event}: {amount}. A página sempre mostra o valor mais recente.",
      reminder: "Um lembrete gentil: o saldo de {amount} de {event} ainda está em aberto.",
    },
    dueBy: "Por favor, pague até {date}.",
    cta: "Como pagar",
    event: "Evento",
    date: "Data",
    total: "Total combinado",
    received: "Já pago",
    balance: "Saldo a pagar",
    dueLabel: "Até",
    howTitle: "Como pagar",
    bank: "Transferência bancária",
    reference: "Referência",
    card: "Com cartão: use o botão “Pagar com cartão” na página.",
    cash: "Dinheiro",
    noteTitle: "Já pagou?",
    noteText: "Então pode ignorar este e-mail: {band} marca o saldo como recebido e a página vai mostrar isso.",
    footer: "Você está recebendo este e-mail porque {band} enviou o saldo de um orçamento para {to} pelo BandWith. O BandWith não recebe pagamentos: você paga {band} diretamente. Para escrever para {band}, use a página do orçamento.",
  },
};

/** The balance as the page stores it (quote_links.balance, src/quote/types.ts ClientBalance). */
export interface QuoteBalanceData {
  currency?: unknown;
  total?: unknown;
  received?: unknown;
  amount?: unknown;
  amountLabel?: unknown;
  dueDate?: unknown;
  reference?: unknown;
  bank?: unknown;
  stripeUrl?: unknown;
  cash?: unknown;
}

export interface QuoteBalanceEmailInput {
  kind: QuoteBalanceKind;
  lang: QuoteEmailLang;
  band: string;
  ref: string;
  event: string;
  date: string; // the gig date, already formatted
  clientName: string;
  to: string;
  url: string;
  balance: QuoteBalanceData;
}

const plain = (v: unknown, max = 300) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max) : "");
/** An amount in the client's language ("1.171 €", "€1,171"). */
export const quoteEmailMoney = (v: unknown, currency: string, locale: string) => {
  const n = Number(v);
  if (!isFinite(n)) return "";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
};

/** Template variables for "quote-balance" (raw values; renderEmail escapes them). */
export function quoteBalanceEmailVars(i: QuoteBalanceEmailInput): Record<string, string> {
  const s = QUOTE_BALANCE_STRINGS[i.lang];
  const base = QUOTE_EMAIL_STRINGS[i.lang];
  const b = i.balance ?? {};
  const currency = /^[A-Z]{3}$/.test(String(b.currency ?? "")) ? String(b.currency) : "EUR";
  const amount = plain(b.amountLabel, 40) || quoteEmailMoney(b.amount, currency, base.locale);
  const v = { band: i.band, ref: i.ref, event: i.event, to: i.to, amount };
  const greet = i.clientName ? fill(base.greet, { name: i.clientName }) : base.greetNoName;
  const due = quoteEmailDate(b.dueDate, i.lang);
  const paid = (Array.isArray(b.received) ? b.received : [])
    .reduce((sum: number, r: { amount?: unknown }) => sum + (Number(r?.amount) || 0), 0);

  const how: string[] = [];
  const bank = (Array.isArray(b.bank) ? b.bank : [])
    .map((r: { label?: unknown; value?: unknown }) => [plain(r?.label, 40), plain(r?.value, 80)])
    .filter(([l, val]) => l && val)
    .slice(0, 8);
  if (bank.length) {
    how.push(
      [s.bank, ...bank.map(([l, val]) => `${l}: ${val}`), plain(b.reference, 80) ? `${s.reference}: ${plain(b.reference, 80)}` : ""]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (typeof b.stripeUrl === "string" && /^https:\/\//.test(b.stripeUrl)) how.push(s.card);
  if (plain(b.cash)) how.push(`${s.cash}: ${plain(b.cash)}`);

  return {
    Subject: fill(s.subject[i.kind], v),
    Preheader: fill(s.preheader[i.kind], v),
    Kicker: fill(s.kicker, v),
    Headline: s.headline[i.kind],
    Intro: `${greet}\n${fill(s.intro[i.kind], v)}${due ? ` ${fill(s.dueBy, { date: due })}` : ""}`,
    CtaLabel: s.cta,
    QuoteURL: i.url,
    EventLabel: s.event,
    EventName: i.event,
    DateLabel: s.date,
    EventDate: i.date || "—",
    TotalLabel: s.total,
    Total: quoteEmailMoney(b.total, currency, base.locale) || "—",
    ReceivedLabel: s.received,
    Received: paid > 0 ? quoteEmailMoney(paid, currency, base.locale) : "—",
    BalanceLabel: s.balance,
    Balance: amount || "—",
    DueLabel: s.dueLabel,
    DueDate: due || "—",
    HowTitle: s.howTitle,
    HowText: how.join("\n\n") || "—",
    NoteTitle: s.noteTitle,
    NoteText: fill(s.noteText, v),
    FallbackTitle: base.fallbackTitle,
    FallbackText: base.fallbackText,
    FooterReason: fill(s.footer, v),
    To: i.to,
  };
}
