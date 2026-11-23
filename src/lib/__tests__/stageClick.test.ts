import { describe, expect, it } from 'vitest';
import { beatAt, beatsInBar, bestSample, BLE_MAX_CLOCK_RTT_MS, clockSample, MAX_CLOCK_RTT_MS, parseClickState } from '../stageClick';

const state = { seq: 1, from: 'lead', on: true, bpm: 120, beats: 4, bars: null, startAt: 10_000, songId: 'row-1' };

describe('stage click', () => {
  it('checks messages', () => {
    expect(parseClickState(state)).toEqual(state);
    expect(parseClickState({ ...state, bpm: 5 })).toBeNull();
    expect(parseClickState({ ...state, beats: 0 })).toBeNull();
    expect(parseClickState({ ...state, bars: 2 })).toMatchObject({ bars: 2 });
    expect(parseClickState({ ...state, from: '' })).toBeNull();
    expect(parseClickState('x')).toBeNull();
  });

  it('measures the clock offset from the fastest round trip', () => {
    // Their clock is 250 ms ahead; the trips take 40, 200 and 60 ms (uneven).
    const s1 = clockSample(1000, 1000 + 250 + 20, 1040);
    const s2 = clockSample(2000, 2000 + 250 + 150, 2200);
    const s3 = clockSample(3000, 3000 + 250 + 30, 3060);
    expect(bestSample([s1, s2, s3])).toEqual({ offset: 250, rtt: 40 });
    expect(bestSample([])).toBeNull();
  });

  it('never uses a slow round trip: a pong that took over half a second may be a replay (Claude on #283)', () => {
    expect(MAX_CLOCK_RTT_MS).toBe(500);
    // A real ping answered 2 s later by a replay: offset +1 s, round trip 2 s.
    const replay = clockSample(1000, 1000 + 2000, 3000);
    expect(bestSample([replay])).toBeNull();
    expect(bestSample([clockSample(0, 0 + 250, 500)])).toEqual({ offset: 0, rtt: 500 });
    expect(bestSample([replay, clockSample(5000, 5000 + 260, 5020)])).toEqual({ offset: 250, rtt: 20 });
  });

  it('puts every phone on the same beat whatever its clock', () => {
    // Leader time 11_250 = beat 2 at 120 BPM (500 ms a beat), half way through.
    const leader = beatAt(state, 11_250, 0);
    const member = beatAt(state, 11_000, 250); // member's clock is 250 ms behind
    expect(leader).toEqual(member);
    expect(leader).toMatchObject({ beat: 2, phase: 0.5, count: 3, downbeat: false, done: false });
    expect(beatAt(state, 9_000, 0).beat).toBe(-1);
    expect(beatAt(state, 12_000, 0)).toMatchObject({ beat: 4, downbeat: true, count: 1 });
  });

  it('stops a count-in after its bars', () => {
    const countIn = { ...state, bars: 1 };
    expect(beatAt(countIn, 11_999, 0).done).toBe(false);
    expect(beatAt(countIn, 12_000, 0).done).toBe(true);
  });

  it('reads beats in a bar from the time signature', () => {
    expect(beatsInBar('3/4')).toBe(3);
    expect(beatsInBar('6/8')).toBe(6);
    expect(beatsInBar(undefined)).toBe(4);
  });

  it('nothing under the ceiling: with a few samples the fastest is used (a slow network), a lone slow one is not (a replay)', () => {
    const slow = [clockSample(0, 1350, 700), clockSample(1000, 2400, 1800), clockSample(2000, 3450, 2900)];
    expect(bestSample(slow)).toEqual({ offset: 1000, rtt: 700 });
    expect(bestSample([slow[0]])).toBeNull();
  });

  it('Bluetooth keeps its own, wider ceiling (2 s): a read of 1.5 s still counts there', () => {
    const read = clockSample(0, 750 + 40, 1500);
    expect(BLE_MAX_CLOCK_RTT_MS).toBe(2000);
    expect(bestSample([read], BLE_MAX_CLOCK_RTT_MS)).toEqual({ offset: 40, rtt: 1500 });
  });
});

describe('the click in compound and odd meters', () => {
  it('6/8 the admin set: ticks at three times the dotted BPM, counted in two', async () => {
    const { clickForSong } = await import('../stageClick');
    const { songMeter } = await import('../meter');
    const c = clickForSong(60, songMeter({ timeSignature: '6/8' }));
    expect(c).toEqual({ bpm: 180, beats: 6, groups: [3, 3] });
    const state = { bpm: c.bpm, beats: c.beats, groups: c.groups, bars: null, startAt: 0 };
    const at = (tick: number) => beatAt(state, tick * (60000 / 180) + 1, 0);
    expect([0, 1, 2, 3, 4, 5].map((k) => at(k).count)).toEqual([1, 1, 1, 2, 2, 2]);
    expect([0, 1, 2, 3, 4, 5].map((k) => at(k).onBeat)).toEqual([true, false, false, true, false, false]);
    expect(at(6).downbeat).toBe(true);
  });

  it('7/8 the admin set, grouped 2+2+3; 4/4 unchanged (every tick a beat, no groups)', async () => {
    const { clickForSong } = await import('../stageClick');
    const { songMeter } = await import('../meter');
    expect(clickForSong(120, songMeter({ timeSignature: '7/8' }))).toEqual({ bpm: 240, beats: 7, groups: [2, 2, 3] });
    expect(clickForSong(96, songMeter({ timeSignature: '4/4' }))).toEqual({ bpm: 96, beats: 4, groups: null });
  });

  it('a song with no time signature of its own (a 6/8 chart, an iReal import) clicks exactly as before: BPM = every tick', async () => {
    const { clickForSong } = await import('../stageClick');
    const { songMeter } = await import('../meter');
    const fromChart = songMeter({ chart: { time: '6/8', sections: [] } });
    expect(clickForSong(120, fromChart)).toEqual({ bpm: 120, beats: 6, groups: null });
    expect(clickForSong(120, songMeter({ chart: { time: '7/8', sections: [] } }))).toEqual({ bpm: 120, beats: 7, groups: null });
  });

  it('never goes past 300 BPM for the song, whatever the meter', async () => {
    const { clickForSong } = await import('../stageClick');
    const { songMeter } = await import('../meter');
    expect(clickForSong(400, songMeter({ timeSignature: '4/4' })).bpm).toBe(300);
    expect(clickForSong(400, songMeter({ chart: { time: '6/8', sections: [] } })).bpm).toBe(300);
    expect(clickForSong(400, songMeter({ timeSignature: '7/16' })).bpm).toBe(1200);
  });
});

/** The parser in builds before live mode (TestFlight 202611211045, APK 1.0.13). */
const oldBuildParse = (p: Record<string, unknown>) => {
  const n = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (!n(p.seq, 0, Number.MAX_SAFE_INTEGER) || typeof p.from !== 'string' || !p.from) return null;
  if (typeof p.on !== 'boolean' || !n(p.bpm, 30, 300) || !n(p.beats, 1, 16)) return null;
  if (p.bars !== null && !n(p.bars, 1, 64)) return null;
  if (!n(p.startAt, 0, Number.MAX_SAFE_INTEGER)) return null;
  return { bpm: p.bpm as number, beats: Math.round(p.beats as number), bars: p.bars as number | null };
};
/** Bar length an old build works out from what it read. */
const oldBar = (o: { bpm: number; beats: number }) => (o.beats * 60000) / o.bpm;

describe('click on the wire: older builds keep working', () => {
  const base = { seq: 3, from: 'lead', on: true, bars: null, startAt: 5_000, songId: 'row-1' };

  it('a song without its own meter goes out exactly as today (no new field)', async () => {
    const { clickWire } = await import('../stageClick');
    const wire = clickWire({ ...base, bpm: 120, beats: 6 });
    expect(wire).toEqual({ ...base, bpm: 120, beats: 6 });
  });

  it('6/8 at a dotted 120: old builds read 2 beats at 120, new builds the 6 ticks at 360', async () => {
    const { clickWire, parseClickState } = await import('../stageClick');
    const state = { ...base, bpm: 360, beats: 6, groups: [3, 3] };
    const wire = clickWire(state) as Record<string, unknown>;
    expect(oldBuildParse(wire)).toEqual({ bpm: 120, beats: 2, bars: null });
    expect(wire.tick).toEqual({ bpm: 360, beats: 6, groups: [3, 3] });
    expect(parseClickState(wire)).toEqual(state);
  });

  it('7/8 at 120: old builds read the 7 ticks at 240 (same bar), new builds the groups too', async () => {
    const { clickWire, parseClickState } = await import('../stageClick');
    const state = { ...base, bpm: 240, beats: 7, groups: [2, 2, 3] };
    const wire = clickWire(state) as Record<string, unknown>;
    expect(oldBuildParse(wire)).toEqual({ bpm: 240, beats: 7, bars: null });
    expect(parseClickState(wire)).toEqual(state);
  });

  it('7/16 at 250 (1000 ticks a minute): new builds take it, old ones get one click a bar', async () => {
    const { clickForSong, clickWire, parseClickState } = await import('../stageClick');
    const { songMeter } = await import('../meter');
    const c = clickForSong(250, songMeter({ timeSignature: '7/16' }));
    expect(c).toEqual({ bpm: 1000, beats: 7, groups: [2, 2, 3] });
    const state = { ...base, ...c, bars: 2 };
    const wire = clickWire(state) as Record<string, unknown>;
    const old = oldBuildParse(wire);
    expect(old).toMatchObject({ beats: 1, bars: 2 });
    expect(oldBar(old!)).toBeCloseTo(420, 0);
    expect(parseClickState(wire)).toEqual(state);
  });

  it('Stop reaches old builds too, whatever the meter', async () => {
    const { clickWire } = await import('../stageClick');
    for (const s of [
      { bpm: 360, beats: 6, groups: [3, 3] },
      { bpm: 1000, beats: 7, groups: [2, 2, 3] },
      { bpm: 900, beats: 12, groups: [3, 3, 3, 3] },
    ]) {
      const wire = clickWire({ ...base, ...s, on: false }) as Record<string, unknown>;
      expect(oldBuildParse(wire)).toMatchObject({});
      expect(oldBuildParse(wire)).not.toBeNull();
      expect(oldBar(oldBuildParse(wire)!)).toBeCloseTo((s.beats * 60000) / s.bpm, 0);
    }
  });

  it('new builds: a message from an old build (no tick) is read as before; a bad tick is ignored, bad top fields refused', async () => {
    const { parseClickState } = await import('../stageClick');
    expect(parseClickState({ ...base, bpm: 120, beats: 6 })).toEqual({ ...base, bpm: 120, beats: 6 });
    expect(parseClickState({ ...base, bpm: 120, beats: 2, tick: { bpm: 360, beats: 6, groups: [3, 2] } })).toEqual({ ...base, bpm: 120, beats: 2 });
    expect(parseClickState({ ...base, bpm: 120, beats: 2, tick: { bpm: 5000, beats: 6 } })).toEqual({ ...base, bpm: 120, beats: 2 });
    expect(parseClickState({ ...base, bpm: 360, beats: 6 })).toBeNull();
  });
});
