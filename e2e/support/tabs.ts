import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The main tabs' own screens.
 *
 * The app swaps them one after the other (AuthenticatedApp: AnimatePresence
 * mode "wait"): the header and the tab bar switch at once, but the screen
 * that was there plays its exit first and only then does the new one mount.
 * On a slow machine that takes a second or two, and until then
 * - the old screen's cards and buttons are still there to be found, and go
 *   away under the test ("Element is not attached to the DOM": the Calendar
 *   test took Home's hold card, CI 11-23);
 * - the new screen does not hear the app's events yet (`bw:new-chat` reached
 *   nobody, CI 11-23).
 * "The screen stopped moving" (settle) does not tell the two apart: a runner
 * that draws a frame or two a second looks still in between.
 */
export type TabName = 'Home' | 'Calendar' | 'Create' | 'Chat' | 'Settings';
type T = (source: string) => string;

/** Something only the Calendar screen draws (in Laptop pose too, on the Planner's Deck). */
export const calendarScreen = (page: Page, t: T): Locator => page.getByRole('group', { name: t('Filter by type'), exact: true });
/** Something only the Chat screen draws. */
export const chatScreen = (page: Page, t: T): Locator => page.getByRole('tablist', { name: t('Chat filters'), exact: true });

/**
 * Presses a control of the Duo rail or the tab bar itself, not the spot where
 * it was a moment ago.
 *
 * A Playwright click aims at the control's centre and then presses that
 * point. The Duo rail re-centres whenever a screen adds or removes its
 * buttons: Home opening its next gig beside the dashboard, a moment after
 * launch, adds Back and Stage mode and moves the tabs up by a button. A press
 * aimed just before that landed on the neighbour (Create instead of Calendar:
 * CI 11-24, duo-book; the tab never changed).
 * The trial click still checks what a tap needs (on screen, enabled, at rest,
 * not covered) and lets the suite close the urgent pop-up; the press itself
 * then goes to the control.
 */
export async function pressItself(control: Locator) {
  await control.click({ trial: true });
  await control.evaluate((el) => (el as HTMLElement).click());
}

/** Waits until the tab's own screen has taken the place of the one before it. */
export async function tabScreenUp(page: Page, t: T, name: TabName) {
  const calendar = calendarScreen(page, t);
  const chat = chatScreen(page, t);
  if (name === 'Calendar') await expect(calendar.first(), 'the Calendar screen is up').toBeAttached();
  // (A solo account has no chats: its Chat tab shows the Calendar.)
  else if (name === 'Chat') await expect(chat.or(calendar).first(), 'the Chat screen is up').toBeAttached();
  else if (name === 'Home') {
    // The Calendar or Chat screen has left: Home mounts in the same step.
    await expect(calendar, 'the Calendar screen has left').toHaveCount(0);
    await expect(chat, 'the Chat screen has left').toHaveCount(0);
  }
  // Create and Settings open a menu or the hub over the screen that is there: no swap.
}
