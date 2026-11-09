import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { config } from '../../src/config/env.js';
import { authCodes } from '../../src/db/schema.js';
import { issueAuthCode, verifyAuthCode } from '../../src/modules/auth/codes.js';
import { db, makeUser, pool } from './helpers.js';

// Verification runs against the real database: the guarantees below come from single SQL statements,
// so only parallel calls on real Postgres can show them holding.

after(async () => { await pool.end(); });

const EMAIL = 'codes@example.com';
const MAX = config.AUTH_CODE_MAX_ATTEMPTS;
const attemptsOf = async (userId: string) => (await db.select().from(authCodes).where(eq(authCodes.userId, userId)))[0]!;

/** Six-digit strings that are never `code`, so every one of them is a wrong guess. */
const wrongGuesses = (code: string, n: number) =>
  Array.from({ length: n }, (_, i) => String(100000 + ((Number(code) - 100000 + 1 + i) % 900000)));

describe('auth code verification under parallel requests', () => {
  it('spends at most the attempt ceiling on parallel wrong guesses', async () => {
    const user = await makeUser('codes');
    const code = await issueAuthCode(user.id, 'password_reset', EMAIL);

    const results = await Promise.all(wrongGuesses(code, 100).map((guess) => verifyAuthCode(user.id, 'password_reset', EMAIL, guess)));

    assert.ok(results.every((r) => !r.ok));
    assert.equal((await attemptsOf(user.id)).attempts, MAX);
    assert.equal(results.filter((r) => !r.ok && r.reason === 'invalid_code').length, MAX - 1);
    assert.ok(results.some((r) => !r.ok && r.reason === 'too_many_attempts'));
  });

  it('does not accept the right code once parallel guesses used up the attempts', async () => {
    const user = await makeUser('codes');
    const code = await issueAuthCode(user.id, 'password_reset', EMAIL);

    await Promise.all(wrongGuesses(code, 50).map((guess) => verifyAuthCode(user.id, 'password_reset', EMAIL, guess)));

    const late = await verifyAuthCode(user.id, 'password_reset', EMAIL, code);
    assert.equal(late.ok, false);
    assert.ok((await attemptsOf(user.id)).consumedAt);
  });

  it('lets exactly one of several parallel correct verifications win', async () => {
    const user = await makeUser('codes');
    const code = await issueAuthCode(user.id, 'login', EMAIL, { challengeHash: `challenge-${user.id}` });

    const results = await Promise.all(Array.from({ length: 20 }, () => verifyAuthCode(user.id, 'login', EMAIL, code, { challengeHash: `challenge-${user.id}` })));

    assert.equal(results.filter((r) => r.ok).length, 1);
  });

  it('still accepts the right code on the last allowed attempt', async () => {
    const user = await makeUser('codes');
    const code = await issueAuthCode(user.id, 'password_reset', EMAIL);
    for (const guess of wrongGuesses(code, MAX - 1)) {
      assert.deepEqual(await verifyAuthCode(user.id, 'password_reset', EMAIL, guess), { ok: false, reason: 'invalid_code' });
    }

    assert.equal((await verifyAuthCode(user.id, 'password_reset', EMAIL, code)).ok, true);
    assert.equal((await verifyAuthCode(user.id, 'password_reset', EMAIL, code)).ok, false);
  });
});
