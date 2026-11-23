import { test, expect } from '../../fixtures/test';
import { fakeDesktop, setDesktopActivity } from '../../fixtures/activity';
import { sql, deploy } from '../../stack/stack';

test('a desktop report after a redeploy starts counting again without overlapping the previous session', async ({ users }) => {
  const alice = await users.create('alice');
  await fakeDesktop(alice.context);
  const a = await alice.app();
  await setDesktopActivity(a.page, { key: 'spotify', name: 'Spotify', kind: 'using', startedAt: Date.now() - 3600_000 });
  const sessions = () => sql(`SELECT count(*) FROM activity_sessions WHERE user_id = '${alice.id}' AND key = 'spotify'`);
  await expect.poll(sessions).toBe('1');

  await deploy();
  await expect.poll(sessions).toBe('2');
  const separated = () => sql(`SELECT count(*) FROM activity_sessions first JOIN activity_sessions second
    ON first.user_id = second.user_id AND first.id <> second.id
    WHERE first.user_id = '${alice.id}' AND first.ended_at <= second.started_at AND second.ended_at IS NULL`);
  await expect.poll(separated).toBe('1');
  await setDesktopActivity(a.page, null);
  const open = () => sql(`SELECT count(*) FROM activity_sessions WHERE user_id = '${alice.id}' AND ended_at IS NULL`);
  await expect.poll(open).toBe('0');
});
