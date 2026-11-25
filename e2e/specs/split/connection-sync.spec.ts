import { test, expect } from '../../fixtures/test';
import { controlConnectionSync } from '../../stack/stack';

test('the API queues profile sync while its worker is stopped', async ({ users }) => {
  const owner = await users.create('sync');

  controlConnectionSync('stop');
  try {
    const response = await owner.api.post('/api/me/connections', {
      data: { provider: 'myanimelist', value: 'worker-test' },
    });
    expect(response.status()).toBe(201);
    expect(await response.json()).toMatchObject({ connections: [{ status: 'pending', syncError: null }] });
    const queued = await owner.api.get('/api/me/connections');
    expect(queued.ok()).toBe(true);
    expect(await queued.json()).toMatchObject({ connections: [{ status: 'pending', syncError: null }] });
  } finally {
    controlConnectionSync('start');
  }

  // The worker records the missing MyAnimeList credential without making an external request.
  await expect.poll(async () => (await owner.api.get('/api/me/connections')).json())
    .toMatchObject({ connections: [{ status: 'error', syncError: 'unavailable' }] });
});
