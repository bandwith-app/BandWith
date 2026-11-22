/**
 * Account deletion (#282, owner decision 11-22): direct messages go, band and
 * gig chat messages stay as a former member's. Every edition of the Privacy
 * Policy must say so, and name what stays as it was (Claude review round 4):
 * an @mention typed into a message, and how notifications follow the
 * messages (round 4).
 */
import { describe, it, expect } from 'vitest';

// The app's tsconfig has no Node types, hence the loose import.
const NODE_FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync: (path: string, enc: 'utf8') => string };
const { process } = globalThis as unknown as { process: { cwd(): string } };
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8'); // vitest runs from the repo root

const editions = {
  en: { file: 'public/legal/privacy.html', old: /personal gigs and messages are deleted/, dms: /direct messages are deleted/, former: /former member/, kept: /@mention[\s\S]{0,200}notifications/, notifs: /Notifications about your direct messages are deleted/, group: /band, gig and group chat/ },
  it: { file: 'public/legal/privacy-it.html', old: /concerti personali e i messaggi vengono eliminati/, dms: /messaggi privati vengono eliminati/, former: /ex membro/, kept: /@menzione[\s\S]{0,200}notifiche/, notifs: /notifiche dei tuoi messaggi privati vengono eliminate/, group: /dei concerti e di gruppo/ },
  es: { file: 'public/legal/privacy-es.html', old: /conciertos personales y tus mensajes se borran/, dms: /mensajes directos se borran/, former: /antiguo miembro/, kept: /@mención[\s\S]{0,200}notificaciones/, notifs: /se borran las notificaciones de tus mensajes directos/, group: /de los conciertos y de grupo/ },
};

describe.each(Object.entries(editions))('Privacy Policy on account deletion (%s)', (_lang, e) => {
  const policy = read(e.file);

  it('no longer promises that every message is deleted', () => {
    expect(policy).not.toMatch(e.old);
  });

  it('says direct messages go and band and gig messages stay as a former member', () => {
    expect(policy).toMatch(e.dms);
    expect(policy).toMatch(e.former);
  });

  it('names what stays as it was: @mentions in the text and other notifications already received', () => {
    expect(policy).toMatch(e.kept);
  });

  // Codex review round 4 (B2): notifications follow the messages.
  it('says notifications about direct messages go too', () => {
    expect(policy).toMatch(e.notifs);
  });

  // Claude review round 4: group chats stay as well.
  it('counts group chats among the ones that stay', () => {
    expect(policy).toMatch(e.group);
  });
});
