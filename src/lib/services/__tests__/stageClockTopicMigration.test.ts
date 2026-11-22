import { describe, it, expect } from 'vitest';
import sql191 from '../../../../supabase/migrations/191_stage_clock_topic.sql?raw';
import sql085 from '../../../../supabase/migrations/085_stage_live_channel.sql?raw';
import sql087 from '../../../../supabase/migrations/087_stage_keys.sql?raw';
import { stageClockTopic, stageTopic } from '@/lib/stageLive';

/** Static guards on 191 (audit #9); the dry run checks the behaviour. */
const sql = sql191.replace(/--.*$/gm, '');
const STRICT_UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
/** One function's CREATE ... $$; block. */
const fn = (src: string, name: string) => {
  const m = src.replace(/--.*$/gm, '').match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`));
  return m ? m[0] : '';
};

describe('191 the stage clock topic', () => {
  it('members read and write broadcasts on stage-clock:event:<id> only', () => {
    expect(fn(sql191, 'bw_stage_clock_topic_allowed')).toContain(`'^stage-clock:event:(${STRICT_UUID})$'`);
    expect(sql).toMatch(/bw_stage_clock_write ON realtime\.messages\s+FOR INSERT TO authenticated/);
    expect(sql).toMatch(/bw_stage_clock_read ON realtime\.messages\s+FOR SELECT TO authenticated/);
    expect(sql).toMatch(/RETURN public\.bw_is_band_member\(band\)/);
  });

  it("only members who may see the gig: a tentative quote's hidden lineup stays hidden (111)", () => {
    expect(sql).toMatch(/RETURN public\.bw_is_band_member\(band\) AND public\.bw_can_view_event\(ev::uuid\)/);
  });

  it("no policy depends on the event: Realtime's write probe has none", () => {
    expect(sql).not.toMatch(/messages\.event/);
    // 103's policy stays: older builds keep whatever it gives them (nothing, by Realtime's source).
    expect(sql).not.toMatch(/bw_stage_click_ping_write/);
  });

  it('nothing for anon, and the stage topic policies are untouched (admins only)', () => {
    expect(sql).not.toMatch(/TO anon/);
    expect(sql).not.toMatch(/bw_stage_broadcast_write|bw_stage_read|bw_stage_presence_write/);
  });

  it("a topic with 36 characters that aren't a UUID is refused, not an error inside the policy (Claude on #283)", () => {
    // '[0-9a-fA-F-]{36}' let '------------------------------------' through to ::uuid, which raises.
    expect(sql).not.toMatch(/\[0-9a-fA-F-\]\{36\}/);
    const stage = fn(sql191, 'bw_stage_topic_allowed');
    expect(stage).toContain(`'^stage:event:(${STRICT_UUID})$'`);
    // 085's helper, the same in every other way (see the next test for who may see the gig).
    expect(stage.replace(STRICT_UUID, '[0-9a-fA-F-]{36}').replace(/ AND public\.bw_can_view_event\(ev::uuid\)/g, '')).toBe(
      fn(sql085, 'bw_stage_topic_allowed'),
    );
    // Its grants come again with it.
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.bw_stage_topic_allowed\(text, boolean\) FROM PUBLIC, anon;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.bw_stage_topic_allowed\(text, boolean\) TO authenticated;/);
  });

  it("the stage topic (085) and the band key (087) only for who may see the gig: a quote's hidden lineup and ex-members are refused (main session on #283)", () => {
    // Both admins and members go through bw_can_view_event (111): active
    // member, and for a tentative quote only admins, its creator and its lineup.
    const stage = fn(sql191, 'bw_stage_topic_allowed');
    expect(stage).toMatch(/RETURN public\.bw_is_band_admin\(band\) AND public\.bw_can_view_event\(ev::uuid\);/);
    expect(stage).toMatch(/RETURN public\.bw_is_band_member\(band\) AND public\.bw_can_view_event\(ev::uuid\);/);
    const key = fn(sql191, 'bw_stage_key');
    expect(key).toMatch(/IF band IS NULL OR NOT public\.bw_is_band_member\(band\) OR NOT public\.bw_can_view_event\(p_event_id\) THEN\s+RETURN NULL;/);
    // 087's function otherwise, same signature (released apps call it as before).
    expect(key.replace(' OR NOT public.bw_can_view_event(p_event_id)', '')).toBe(fn(sql087, 'bw_stage_key'));
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.bw_stage_key\(uuid\) FROM PUBLIC, anon;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.bw_stage_key\(uuid\) TO authenticated;/);
  });

  it("with 178 applied first, its rule (a quote is the admins' only) is spelled out in all three helpers (main session on #283; behaviour: supabase/tests/stage_topic_quote.pglite.mjs)", () => {
    expect(sql).toMatch(/IF to_regprocedure\('public\.bw_event_quote_hidden\(uuid, uuid\)'\) IS NULL THEN\s+RETURN;/);
    expect(sql).toContain('OR NOT public.bw_can_view_event(p_event_id) OR public.bw_event_quote_hidden(p_event_id) THEN');
    expect(sql.match(/AND NOT public\.bw_event_quote_hidden\(ev::uuid\);/g)?.length).toBe(2);
    for (const f of ['bw_stage_key(uuid)', 'bw_stage_topic_allowed(text, boolean)', 'bw_stage_clock_topic_allowed(text)'])
      expect(sql).toContain(`pg_get_functiondef('public.${f}'::regprocedure)`);
  });

  it('a kept band key stops working for whoever may no longer see the gig: new keys on triggers, none callable by clients (Codex on #283; behaviour: stage_topic_quote.pglite.mjs)', () => {
    expect(sql).toMatch(/AFTER UPDATE OF event_id, user_id OR DELETE ON public\.event_members/);
    expect(sql).toMatch(/AFTER UPDATE OF band_id, status, event_type, quote_id ON public\.events/);
    for (const f of ['bw_stage_new_band_key(uuid)', 'bw_stage_lineup_left()', 'bw_stage_event_hidden()'])
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.bw_stage_(new_band_key|lineup_left|event_hidden)/);
  });

  it("a member who leaves the band (inactive, removed, moved) takes no working band key along for the band's coming gigs (Claude on #283; behaviour: stage_topic_quote.pglite.mjs)", () => {
    const f = fn(sql191, 'bw_stage_member_left');
    expect(f).toMatch(/COALESCE\(OLD\.is_active, true\)/);
    expect(f).toMatch(/TG_OP = 'DELETE'/);
    expect(f).toMatch(/NOT COALESCE\(NEW\.is_active, true\)/);
    expect(f).toMatch(/NEW\.band_id IS DISTINCT FROM OLD\.band_id/);
    expect(f).toMatch(/e\.band_id = OLD\.band_id/);
    expect(f).toMatch(/coalesce\(e\.event_date, e\."date"\) IS NULL OR coalesce\(e\.event_date, e\."date"\) >= current_date/);
    expect(sql).toMatch(/CREATE TRIGGER bw_stage_member_left\s+AFTER UPDATE OF is_active, role, band_id, user_id OR DELETE ON public\.band_members/);
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.bw_stage_member_left() FROM PUBLIC, anon, authenticated;');
  });

  it("an admin made a member: the band's coming quote gigs get a new key (Claude on #283; behaviour: stage_topic_quote.pglite.mjs)", () => {
    const f = fn(sql191, 'bw_stage_member_left');
    expect(f).toMatch(/OLD\.role = 'admin' AND NEW\.role IS DISTINCT FROM 'admin'/);
    expect(f).toMatch(/public\.bw_stage_quote_gig\(e\.id, e\.status::text, e\.event_type::text, e\.quote_id\)/);
  });

  it("with 178 applied first, the triggers use its bw_event_quote_private, not 111's rule alone (Claude on #283)", () => {
    expect(sql).toMatch(/IF to_regprocedure\('public\.bw_event_quote_private\(uuid, text, text, uuid\)'\) IS NOT NULL THEN/);
    expect(sql).toContain('SELECT public.bw_event_quote_private(p_event_id, p_status, p_event_type, p_quote_id);');
    for (const name of ['bw_stage_lineup_left', 'bw_stage_event_hidden']) {
      expect(fn(sql191, name)).toContain('public.bw_stage_quote_gig(');
      expect(fn(sql191, name)).not.toContain('bw_event_is_quote');
    }
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.bw_stage_quote_gig(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;');
  });

  it('applying 191 changes no key by itself (main session on #283): only the triggers do, from then on', () => {
    expect(sql).not.toMatch(/^\s*SELECT public\.bw_stage_new_band_key/m);
  });

  it('the strict pattern takes UUIDs and nothing else', () => {
    const re = new RegExp(`^stage-clock:event:(${STRICT_UUID})$`);
    expect(re.test('stage-clock:event:0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true);
    expect(re.test(`stage-clock:event:${'-'.repeat(36)}`)).toBe(false);
    expect(re.test('stage-clock:event:0f8fad5bd9cb469fa16570867728950e0000')).toBe(false);
  });

  it('the app uses the same topic names', () => {
    expect(stageClockTopic('e1')).toBe('stage-clock:event:e1');
    expect(stageTopic('e1')).toBe('stage:event:e1');
  });
});
