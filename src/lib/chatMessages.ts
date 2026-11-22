import type { Message } from '@/lib/services/chats';

/** Messages per request; a full page means there may be older ones. */
export const CHAT_PAGE_SIZE = 50;

export type ChatKind = 'direct' | 'band' | 'event';

/** Stored chat types → the three the UI knows ("group" is a band chat). */
export const normalizeChatType = (type: string | null | undefined): ChatKind | null => {
  if (type === 'direct') return 'direct';
  if (type === 'band' || type === 'group') return 'band';
  if (type === 'event') return 'event';
  return null;
};

const isTemp = (m: Message) => m.id.startsWith('temp-');

const sameMessage = (a: Message, b: Message) =>
  a.id === b.id &&
  a.content === b.content &&
  a.edited === b.edited &&
  a.deleted === b.deleted &&
  a.failed === b.failed &&
  a.created_at === b.created_at &&
  a.sender?.full_name === b.sender?.full_name &&
  a.sender?.avatar_url === b.sender?.avatar_url &&
  a.live === b.live &&
  // The quote too (Codex review #291 r4): deleted or edited since.
  a.reply_to?.id === b.reply_to?.id &&
  a.reply_to?.content === b.reply_to?.content &&
  a.reply_to?.deleted === b.reply_to?.deleted;

const sameList = (a: Message[], b: Message[]) => a.length === b.length && a.every((m, i) => sameMessage(m, b[i]));

/**
 * The server copy of a message still being sent: new to the list, from the
 * same sender, same text. Each pending message hides at most one copy, so an
 * older "ok" already on screen stays while a new "ok" is on its way.
 */
const pendingCopies = (prev: Message[], incoming: Message[]): { copies: Set<string>; arrived: Set<string> } => {
  const have = new Set(prev.map((m) => m.id));
  const pending = prev.filter(isTemp);
  const copies = new Set<string>();
  // Bubbles marked failed whose message reached the server after all.
  const arrived = new Set<string>();
  for (const d of incoming) {
    if (have.has(d.id)) continue;
    const i = pending.findIndex((o) => o.content === d.content && o.sender_id === d.sender_id);
    if (i === -1) continue;
    const [o] = pending.splice(i, 1);
    if (o.failed) arrived.add(o.id);
    else copies.add(d.id);
  }
  return { copies, arrived };
};

/**
 * Applies the latest page from the poll. Older messages the user loaded stay,
 * optimistic ones stay at the end (hiding only their own server copy until
 * the send completes), and an unchanged result returns `prev` itself so
 * nothing re-renders or scrolls.
 */
/** Edited later than `b` (an edit the other copy does not have yet). */
const editedLater = (a: Message, b: Message) => !!a.edited_at && (!b.edited_at || a.edited_at > b.edited_at);

/**
 * `known`: the ids on screen when the page was requested. A message not
 * among them and not in the page came by Realtime meanwhile and stays
 * (Codex review #291 r3: it disappeared). Without `known`, the page wins,
 * as before (a message deleted since is gone from the page and the list).
 */
export const mergeLatestPage = (prev: Message[], page: Message[], known?: ReadonlySet<string>): Message[] => {
  const { copies, arrived } = pendingCopies(prev, page);
  const optimistic = prev.filter((m) => isTemp(m) && !arrived.has(m.id));
  const pageIds = new Set(page.map((m) => m.id));
  const mine = new Map(prev.map((m) => [m.id, m]));
  // Same message in both: the newer row wins.
  const fromServer = page
    .filter((d) => !copies.has(d.id))
    .map((d) => {
      const had = mine.get(d.id);
      if (!had || !editedLater(had, d)) return d;
      const { live: _live, ...confirmed } = had;
      return confirmed as Message;
    });
  const meanwhile = known
    ? prev.filter((m) => !isTemp(m) && !pageIds.has(m.id) && !known.has(m.id))
    : [];
  const meanwhileIds = new Set(meanwhile.map((m) => m.id));
  const oldest = page[0]?.created_at;
  const older = oldest
    ? prev.filter((m) => !isTemp(m) && !pageIds.has(m.id) && !meanwhileIds.has(m.id) && m.created_at < oldest)
    : [];
  const settled = [...fromServer, ...meanwhile].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const next = [...older, ...settled, ...optimistic];
  return sameList(prev, next) ? prev : next;
};

/**
 * Too far behind to catch up: the latest page replaces the list ("Load
 * earlier" from there), keeping pending bubbles and what Realtime brought
 * while it was fetched (`known`: the ids on screen when it was requested).
 */
export const restartFromLatest = (prev: Message[], page: Message[], known: ReadonlySet<string>): Message[] =>
  mergeLatestPage(prev.filter((m) => isTemp(m) || !known.has(m.id)), page, known);

/** Puts an older page in front of the list, skipping messages already there. */
export const prependOlder = (prev: Message[], olderPage: Message[]): Message[] => {
  const have = new Set(prev.map((m) => m.id));
  const fresh = olderPage.filter((m) => !have.has(m.id));
  return fresh.length ? [...fresh, ...prev] : prev;
};

/**
 * A message from realtime. It replaces the pending bubble it is the copy of
 * (same sender and text); other pending bubbles stay at the end, so someone
 * else's message never makes yours vanish while it is being sent.
 */
export const appendIncoming = (prev: Message[], message: Message): Message[] => {
  if (prev.some((m) => m.id === message.id)) return prev;
  const i = prev.findIndex((m) => isTemp(m) && m.sender_id === message.sender_id && m.content === message.content);
  const rest = i === -1 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)];
  const settled = rest.filter((m) => !isTemp(m));
  // In its place by time: arrivals are fetched one by one and can land out
  // of order (Codex review #291 r4). Marked live: no page has confirmed what
  // came before it (catchUpPage).
  const at = settled.findIndex((m) => m.created_at > message.created_at);
  const live = { ...message, live: true };
  const placed = at === -1 ? [...settled, live] : [...settled.slice(0, at), live, ...settled.slice(at)];
  return [...placed, ...rest.filter(isTemp)];
};

/** How far a message is dragged sideways (px) before it is answered (swipe to reply on touch). */
export const SWIPE_REPLY_PX = 56;

/** A mostly horizontal drag to the right, far enough: reply to that message. */
export const isReplySwipe = (dx: number, dy: number) => dx >= SWIPE_REPLY_PX && Math.abs(dy) < dx;

/** The quoted message a reply shows: its text and who wrote it. */
export type ReplyTarget = Pick<Message, 'id' | 'content' | 'sender_id' | 'created_at'> & { sender?: Message['sender']; deleted?: boolean };

/** Quoted messages still to load (rows that name one but don't carry it). */
export const replyTargetIds = (rows: Message[]): string[] => [
  ...new Set(rows.filter((m) => m.reply_to_id && !m.reply_to?.content).map((m) => m.reply_to_id as string)),
];

/**
 * Gives each reply its quoted message (audit 07 #11: saved, realtime and
 * older pages carried only reply_to_id, so nobody but the sender, and only
 * until reload, saw what was being answered). A quote from before the
 * reader deleted the chat (cleared_at) is not shown: that history is gone
 * for them.
 */
export const attachReplies = (rows: Message[], targets: ReplyTarget[], clearedAt: string | null | undefined): Message[] => {
  if (targets.length === 0) return rows;
  const byId = new Map(targets.map((t) => [t.id, t]));
  const cut = clearedAt ? Date.parse(clearedAt) : null;
  return rows.map((m) => {
    if (!m.reply_to_id || m.reply_to?.content) return m;
    const target = byId.get(m.reply_to_id);
    if (!target) return m;
    if (cut !== null && Date.parse(target.created_at) <= cut) return m;
    return { ...m, reply_to: target as Message };
  });
};

const newestSettled = (list: Message[]): Message | null => {
  for (let i = list.length - 1; i >= 0; i--) if (!isTemp(list[i])) return list[i];
  return null;
};

/** Pages fetched forward at most when catching up (CHAT_PAGE_SIZE each). */
export const CATCH_UP_MAX_PAGES = 20;

/**
 * Back after a while (app in the background, socket down): the latest page
 * may start after the newest message on screen, and merging it left a hole
 * (1–10 then 21–70, audit 07 #7). This fetches forward from the newest
 * message on screen until the pages meet the latest page.
 *
 * Returns the messages to merge (oldest first) and whether they meet what is
 * on screen. When they don't (too many to fetch), the caller shows only the
 * latest page and lets "Load earlier messages" page back from there.
 */
export const catchUpPage = async (
  prev: Message[],
  page: Message[],
  fetchAfter: (after: string) => Promise<Message[] | null>,
  maxPages: number = CATCH_UP_MAX_PAGES,
): Promise<{ page: Message[]; complete: boolean }> => {
  // Connected when the oldest message of the latest page is on screen. The
  // newest one on screen proves nothing: it may have come by Realtime just
  // before the refresh, with the missed ones still in between (Codex #291).
  // So catch up from the newest message on screen older than the page.
  // Round 4: page[0] counts only if a page brought it (a Realtime arrival,
  // `live`, may have missed ones right before it), and the catch-up starts
  // from the newest message a page brought.
  if (page.length < CHAT_PAGE_SIZE || prev.some((m) => !isTemp(m) && !m.live && m.id === page[0].id)) {
    return { page, complete: true };
  }
  const last = newestSettled(prev.filter((m) => !m.live && m.created_at < page[0].created_at));
  if (!last) return { page, complete: true };
  const pageIds = new Set(page.map((m) => m.id));
  const forward: Message[] = [];
  const seen = new Set<string>();
  let cursor = last.created_at;
  for (let i = 0; i < maxPages; i++) {
    const got = await fetchAfter(cursor);
    if (!got) return { page, complete: false };
    for (const m of got) {
      if (pageIds.has(m.id) || seen.has(m.id)) continue;
      seen.add(m.id);
      forward.push(m);
    }
    const met = got.some((m) => pageIds.has(m.id));
    const next = got[got.length - 1]?.created_at;
    if (met || got.length < CHAT_PAGE_SIZE) return { page: [...forward, ...page], complete: true };
    if (!next || next === cursor) break;
    cursor = next;
  }
  return { page, complete: false };
};

/** A new client id for a message being sent (Try again reuses it). */
export const newClientId = (): string => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  // messages.client_id is a uuid column: anything else would fail the insert.
  const u = c && typeof c.randomUUID === 'function' ? c.randomUUID() : '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u)) return u;
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** Saved on the server (not a bubble still sending or "Not sent"): only these can be replied to. */
export const canReplyTo = (m: Message): boolean => !isTemp(m) && !m.failed;

/** The first words of a message (about 40 characters), for a button's accessible name. */
export const firstWords = (content: string, max = 40): string => {
  const text = content.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  let out = '';
  for (const word of text.split(' ')) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > max) break;
    out = next;
  }
  return `${(out || text.slice(0, max)).replace(/[\s.,;:!?]+$/, '')}…`;
};

/** A bubble whose send failed: kept, marked, ready for Try again (07 #5). */
export const markSendFailed = (prev: Message[], tempId: string): Message[] =>
  prev.map((m) => (m.id === tempId ? { ...m, failed: true } : m));
