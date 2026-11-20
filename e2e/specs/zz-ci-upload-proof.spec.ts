// Throwaway: fails on purpose so CI uploads its trace (proof for #233). Never merge.
import { test, expect } from '../fixtures';
test('@smoke CI upload proof (fails on purpose)', async ({ app }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone-portrait', 'one device is enough');
  await expect(app.page.getByText('this text is not on the page')).toBeVisible({ timeout: 1000 });
});
