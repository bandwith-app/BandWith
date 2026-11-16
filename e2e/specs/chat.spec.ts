import { test, expect, type App } from '../fixtures';
import { back, eventDetail, SEED } from '../support/flows';
import { openChatTab } from '../support/hub';

/**
 * Chat: the list, the band chat (send a message), the event chat's strip
 * that opens the gig, and Back at every step. Admin and member.
 */

const chatItem = (app: App, name: string) =>
  app.page.getByRole('button', { name: new RegExp(`^${name}(,|$)`) }).first();

const composer = (app: App) => app.page.getByRole('textbox', { name: app.t('Message') });

for (const role of ['admin', 'member'] as const) {
  test.describe(`chat as ${role}`, () => {
    test.use({ role });

    test('the list shows the band, event and direct chats; the band chat sends a message', async ({ app }) => {
      await openChatTab(app);
      await expect(chatItem(app, 'Velvet Static')).toBeVisible();
      await expect(chatItem(app, SEED.gigToday)).toBeVisible();
      // Direct chats: members only talk one-to-one with an admin
      // (src/lib/services/chats.ts), so the member doesn't list Marta's.
      if (role === 'admin') await expect(chatItem(app, 'Marta C.')).toBeVisible();
      else await expect(chatItem(app, 'Marta C.')).toHaveCount(0);
      await app.check('Chat list');

      await chatItem(app, 'Velvet Static').click();
      await expect(composer(app)).toBeVisible();
      await expect(app.page.getByText('+1, then straight into September').first()).toBeVisible();
      await app.check('Band chat');

      const text = `Soundcheck moved to 18:45 (${role})`;
      await composer(app).fill(text);
      await app.page.getByRole('button', { name: app.t('Send message'), exact: true }).click();
      await expect(app.page.getByText(text).first()).toBeVisible();
      await expect(composer(app)).toHaveValue('');
      await app.check('Band chat after sending');

      await back(app);
      await expect(composer(app)).toBeHidden();
      await expect(chatItem(app, 'Velvet Static')).toBeVisible();
      // The list shows the new last message.
      await expect(chatItem(app, 'Velvet Static')).toContainText('Soundcheck moved');
    });

    test('the event chat strip opens the gig, and Back returns to the chat, then to the list', async ({ app }) => {
      await openChatTab(app);
      await chatItem(app, SEED.gigToday).click();
      const strip = app.page.getByRole('button', { name: new RegExp(`${app.t('Open event')}.*${SEED.gigToday}`) });
      await expect(strip).toBeVisible();
      await app.check('Event chat');

      await strip.click();
      await expect(eventDetail(app)).toBeVisible();
      await expect(eventDetail(app).getByText(SEED.gigToday).first()).toBeVisible();
      await app.check('Gig opened from the chat');

      await back(app);
      await expect(eventDetail(app)).toBeHidden();
      await expect(composer(app)).toBeVisible();
      await expect(strip).toBeVisible();

      await back(app);
      await expect(composer(app)).toBeHidden();
      await expect(chatItem(app, 'Velvet Static')).toBeVisible();
    });
  });
}
