/**
 * The public iReal Pro forum, to import chord charts by tapping their links.
 *
 * On iOS and Android the forum opens inside the app (IrealForumPlugin, see
 * ios/App/App/IrealForumPlugin.swift and the Android twin): a tap on an
 * irealb:// link comes back here instead of opening the iReal Pro app,
 * because phones and tablets don't offer "Copy Link" for those links. On the
 * web the forum can't sit inside the app (it refuses to be framed:
 * X-Frame-Options SAMEORIGIN), so it opens in its own window beside it; the
 * user copies or drags a link back, and that window closes once a link is in.
 *
 * Nothing is read, scraped or indexed from the forum: only the link the user
 * taps is passed back.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

/** The forum's song and playlist boards. */
export const IREAL_FORUM_URL = 'https://forums.irealpro.com/';

interface IrealForumPlugin {
  /** Rejects when the forum can't be loaded (offline). */
  open(opts: { url: string; title?: string; closeLabel?: string; backLabel?: string }): Promise<{ link: string | null }>;
}

const IrealForum = registerPlugin<IrealForumPlugin>('IrealForum');

/** True where a tapped link can come back to the app (iOS and Android). */
export const canBrowseForumInApp = () => Capacitor.isNativePlatform();

/**
 * Opens the forum. In the app: resolves the irealb:// link the user tapped,
 * or null when they closed it. On the web: opens a new tab and resolves null.
 * Rejects when the forum can't be loaded. `labels`: the browser's buttons, for
 * screen readers in the app's language.
 */
export async function browseIrealForum(title?: string, labels?: { close: string; back: string }): Promise<string | null> {
  if (!canBrowseForumInApp()) {
    openForumWindow();
    return null;
  }
  const { link } = await IrealForum.open({ url: IREAL_FORUM_URL, title, closeLabel: labels?.close, backLabel: labels?.back });
  return link || null;
}

let forumWindow: Window | null = null;

/** Web: the forum in a window of its own, beside the app where the screen allows. Throws when blocked. */
function openForumWindow(): void {
  if (forumWindow && !forumWindow.closed) {
    forumWindow.focus();
    return;
  }
  const scr = window.screen;
  const wide = (scr?.availWidth ?? 0) >= 1100 && window.matchMedia?.('(pointer: fine)').matches;
  const width = Math.min(960, Math.round((scr?.availWidth ?? 960) * 0.55));
  const height = Math.min(900, scr?.availHeight ?? 900);
  // Phones and touch tablets open a tab whatever the features say.
  const features = wide ? `popup,width=${width},height=${height},left=${(scr.availWidth ?? width) - width},top=0` : '';
  const w = window.open(IREAL_FORUM_URL, 'bw-ireal-forum', features);
  if (!w) throw new Error('blocked');
  try {
    // The forum gets no handle on the app.
    w.opener = null;
  } catch {
    /* cross-origin: nothing to do */
  }
  forumWindow = w;
}

/** Web: closes the forum window opened by the app once a link came back. */
export function closeForumWindow(): void {
  try {
    if (forumWindow && !forumWindow.closed) forumWindow.close();
  } catch {
    /* already gone */
  }
  forumWindow = null;
}

/** An iReal Pro link in a drop or a paste: a link list, a plain URL, or HTML with an <a href>. */
export function irealLinkFrom(data: { getData(type: string): string } | null | undefined): string | null {
  if (!data) return null;
  const candidates = [data.getData('text/uri-list'), data.getData('text/plain'), data.getData('text/html')];
  for (const raw of candidates) {
    const hit = raw?.match(/irealb(?:ook)?:\/\/[^\s"'<>]+/i);
    if (hit) return hit[0];
  }
  return null;
}
