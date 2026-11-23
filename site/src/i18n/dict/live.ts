/**
 * Live text: the capacity counter (core/capacity.ts), the waitlist form
 * (ui/forms.ts) and the analytics consent banner (ui/consent.ts). Their numbers come from the database, so the keys are
 * patterns ({n} a number, {x} the email); see i18n/translate.ts.
 */
import type { Dict } from '../translate';

export const LIVE: { it: Dict; es: Dict } = {
  it: {
    'Every spot is taken right now. Join the waitlist.': 'Al momento i posti sono tutti occupati. Mettiti in lista d’attesa.',
    'Open spots are gone. Invited by a band that’s already inside? {n} spots are still kept for you.': 'I posti liberi sono finiti. Ti ha invitato una band che è già dentro? Ci sono ancora {n} posti riservati a te.',
    'Open spots are gone. Invited by a band that’s already inside? 1 spot is still kept for you.': 'I posti liberi sono finiti. Ti ha invitato una band che è già dentro? C’è ancora 1 posto riservato a te.',
    '{n} of {n} open spots left · {n} kept for band invites': 'Restano {n} posti liberi su {n} · {n} riservati agli inviti delle band',
    'All {n} beta spots are taken': 'Tutti i {n} posti della beta sono occupati',
    '{n} of {n} beta spots taken, {n} kept for band invites': '{n} posti della beta occupati su {n}, {n} riservati agli inviti delle band',
    '<b>You’re #{n} in line.</b> We’ll write to <strong>{x}</strong> as soon as there’s room. One email, nothing else.': '<b>Sei in lista, al posto #{n}.</b> Ti scriviamo a <strong>{x}</strong> appena c’è posto. Una sola email, nient’altro.',
    '<b>You’re in line.</b> We’ll write to <strong>{x}</strong> as soon as there’s room. One email, nothing else.': '<b>Sei in lista.</b> Ti scriviamo a <strong>{x}</strong> appena c’è posto. Una sola email, nient’altro.',
    '<b>You’re already #{n} in line.</b> We’ll write to <strong>{x}</strong> as soon as there’s room.': '<b>Sei già in lista, al posto #{n}.</b> Ti scriviamo a <strong>{x}</strong> appena c’è posto.',
    '<b>You’re already in line.</b> We’ll write to <strong>{x}</strong> as soon as there’s room.': '<b>Sei già in lista.</b> Ti scriviamo a <strong>{x}</strong> appena c’è posto.',
    'We couldn’t reach the server. Check your connection and try again.': 'Non riusciamo a raggiungere il server. Controlla la connessione e riprova.',
    'That doesn’t look like an email address.': 'Non sembra un indirizzo email.',
    'Too many requests right now. Try again in a minute.': 'Troppe richieste in questo momento. Riprova tra un minuto.',
    'Something went wrong on our side. Please try again in a minute.': 'Qualcosa è andato storto da parte nostra. Riprova tra un minuto.',
    'Enter your email.': 'Inserisci la tua email.',
    'Sending…': 'Invio in corso…',
    'The waitlist opens in a few days. Nothing is sent from this form yet.': 'La lista d’attesa apre tra pochi giorni. Per ora questo modulo non invia nulla.',
    // Analytics consent (ui/consent.ts) and its footer link.
    'Cookie consent': 'Consenso ai cookie',
    'Can we count visits?': 'Possiamo contare le visite?',
    'We’d like to use Google Analytics to see which pages help musicians. It sets cookies only if you accept. No ads, and we never sell data.': 'Vorremmo usare Google Analytics per capire quali pagine sono utili a chi suona. Imposta cookie solo se accetti. Niente pubblicità, e non vendiamo mai i dati.',
    'Google Analytics cookies, only if you accept.': 'Cookie di Google Analytics, solo se accetti.',
    'Privacy policy': 'Informativa privacy',
    'Accept': 'Accetta',
    'Reject': 'Rifiuta',
    'Cookie preferences': 'Preferenze cookie',
  },
  es: {
    'Every spot is taken right now. Join the waitlist.': 'Ahora mismo no queda ninguna plaza. Únete a la lista de espera.',
    'Open spots are gone. Invited by a band that’s already inside? {n} spots are still kept for you.': 'Ya no quedan plazas libres. ¿Te invitó una banda que ya está dentro? Todavía hay {n} plazas reservadas para ti.',
    'Open spots are gone. Invited by a band that’s already inside? 1 spot is still kept for you.': 'Ya no quedan plazas libres. ¿Te invitó una banda que ya está dentro? Todavía hay 1 plaza reservada para ti.',
    '{n} of {n} open spots left · {n} kept for band invites': 'Quedan {n} de {n} plazas libres · {n} reservadas para invitaciones de bandas',
    'All {n} beta spots are taken': 'Las {n} plazas de la beta están ocupadas',
    '{n} of {n} beta spots taken, {n} kept for band invites': '{n} de {n} plazas de la beta ocupadas, {n} reservadas para invitaciones de bandas',
    '<b>You’re #{n} in line.</b> We’ll write to <strong>{x}</strong> as soon as there’s room. One email, nothing else.': '<b>Estás en la lista, en el puesto #{n}.</b> Te escribiremos a <strong>{x}</strong> en cuanto haya sitio. Un solo correo, nada más.',
    '<b>You’re in line.</b> We’ll write to <strong>{x}</strong> as soon as there’s room. One email, nothing else.': '<b>Estás en la lista.</b> Te escribiremos a <strong>{x}</strong> en cuanto haya sitio. Un solo correo, nada más.',
    '<b>You’re already #{n} in line.</b> We’ll write to <strong>{x}</strong> as soon as there’s room.': '<b>Ya estás en la lista, en el puesto #{n}.</b> Te escribiremos a <strong>{x}</strong> en cuanto haya sitio.',
    '<b>You’re already in line.</b> We’ll write to <strong>{x}</strong> as soon as there’s room.': '<b>Ya estás en la lista.</b> Te escribiremos a <strong>{x}</strong> en cuanto haya sitio.',
    'We couldn’t reach the server. Check your connection and try again.': 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
    'That doesn’t look like an email address.': 'Eso no parece una dirección de correo.',
    'Too many requests right now. Try again in a minute.': 'Demasiadas solicitudes ahora mismo. Inténtalo de nuevo en un minuto.',
    'Something went wrong on our side. Please try again in a minute.': 'Algo salió mal de nuestro lado. Inténtalo de nuevo en un minuto.',
    'Enter your email.': 'Escribe tu correo.',
    'Sending…': 'Enviando…',
    'The waitlist opens in a few days. Nothing is sent from this form yet.': 'La lista de espera abre en unos días. Este formulario todavía no envía nada.',
    // Analytics consent (ui/consent.ts) and its footer link.
    'Cookie consent': 'Consentimiento de cookies',
    'Can we count visits?': '¿Podemos contar las visitas?',
    'We’d like to use Google Analytics to see which pages help musicians. It sets cookies only if you accept. No ads, and we never sell data.': 'Nos gustaría usar Google Analytics para ver qué páginas les sirven a los músicos. Solo usa cookies si aceptas. Sin anuncios, y nunca vendemos datos.',
    'Google Analytics cookies, only if you accept.': 'Cookies de Google Analytics, solo si aceptas.',
    'Privacy policy': 'Política de privacidad',
    'Accept': 'Aceptar',
    'Reject': 'Rechazar',
    'Cookie preferences': 'Preferencias de cookies',
  },
};
