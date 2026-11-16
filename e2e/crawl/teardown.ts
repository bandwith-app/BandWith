import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeReport } from './lib/report';

/** After every crawl: merge the runs into map.json, findings.md and the diagrams. */
export default async function teardown() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const res = writeReport(path.join(here, 'out'), {
    srcDir: path.join(here, '../../src'),
    triageFile: path.join(here, 'triage.json'),
    docsDir: process.env.CRAWL_DOCS === '1' ? path.join(here, '../../docs/screen-map') : undefined,
  });
  if (res) console.log(`screen map: ${res.states} states, ${res.groups.length} findings → e2e/crawl/out/map.json, findings.md`);
}
