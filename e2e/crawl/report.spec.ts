import { test } from '@playwright/test';
import teardown from './teardown';

test('merge the crawl runs into the screen map', async () => {
  await teardown();
});
