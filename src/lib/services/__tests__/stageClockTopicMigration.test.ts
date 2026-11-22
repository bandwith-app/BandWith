import { describe, it, expect } from 'vitest';
import sql191 from '../../../../supabase/migrations/191_stage_clock_topic.sql?raw';
import { stageClockTopic, stageTopic } from '@/lib/stageLive';

/** Static guards on 191 (audit #9); the dry run checks the behaviour. */
const sql = sql191.replace(/--.*$/gm, '');

describe('191 the stage clock topic', () => {
  it('members read and write broadcasts on stage-clock:event:<id> only', () => {
    expect(sql).toMatch(/\^stage-clock:event:\(\[0-9a-fA-F-\]\{36\}\)\$/);
    expect(sql).toMatch(/bw_stage_clock_write ON realtime\.messages\s+FOR INSERT TO authenticated/);
    expect(sql).toMatch(/bw_stage_clock_read ON realtime\.messages\s+FOR SELECT TO authenticated/);
    expect(sql).toMatch(/RETURN public\.bw_is_band_member\(band\)/);
  });

  it("no policy depends on the event: Realtime's write probe has none", () => {
    expect(sql).not.toMatch(/messages\.event/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS bw_stage_click_ping_write/);
  });

  it('nothing for anon, and the stage topic itself is untouched (admins only)', () => {
    expect(sql).not.toMatch(/TO anon/);
    expect(sql).not.toMatch(/bw_stage_broadcast_write/);
    expect(sql).not.toMatch(/'\^stage:event:/);
  });

  it('the app uses the same topic names', () => {
    expect(stageClockTopic('e1')).toBe('stage-clock:event:e1');
    expect(stageTopic('e1')).toBe('stage:event:e1');
  });
});
