/**
 * Made-up scores for the demo build (never real songs): a lazily loaded
 * chunk, so the app's own bundle never carries them. Referenced from the
 * demo seed as `demo://scores/<file>` (src/lib/score.ts).
 */
import HARBOR_LIGHTS from './harbor-lights.musicxml?raw';
import NIGHT_FERRY from './night-ferry.musicxml?raw';
import PAPER_BOATS from './paper-boats.musicxml?raw';

export const DEMO_SCORES: Record<string, string> = {
  'harbor-lights.musicxml': HARBOR_LIGHTS,
  'night-ferry.musicxml': NIGHT_FERRY,
  'paper-boats.musicxml': PAPER_BOATS,
};
