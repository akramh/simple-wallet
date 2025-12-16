/**
 * @fileoverview Detox smoke test: app launches.
 */

describe('Launch', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('launches successfully', async () => {
    // A deliberately minimal smoke assertion; tighten once stable testIDs exist.
    await expect(device.getPlatform()).toBeTruthy();
  });
});


