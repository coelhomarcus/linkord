import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchGitHub, parseContributionCalendar } from '../../../src/integrations/github/github.js';
import { ConnectionFetchError } from '../../../src/integrations/connectionHttp.js';
import { githubCalendarFixture, githubUserFixture } from '../../fixtures/githubFixture.js';

describe('GitHub adapter without credentials', () => {
  it('reads the public REST profile and calendar without authorization or cookies', async () => {
    const requests: string[] = [];
    const checkHeaders = (init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.has('authorization'), false); assert.equal(headers.has('cookie'), false);
      assert.equal(headers.get('accept-language'), 'en-US');
    };
    const snapshot = await fetchGitHub('octocat', async (url, init) => {
      requests.push(url); checkHeaders(init);
      assert.equal(url, 'https://api.github.com/users/octocat');
      assert.equal(new Headers(init?.headers).get('accept'), 'application/vnd.github+json');
      return githubUserFixture;
    }, async (url, init) => {
      requests.push(url); checkHeaders(init);
      assert.equal(url, 'https://github.com/users/octocat/contributions');
      return githubCalendarFixture();
    });
    assert.equal(requests.length, 2);
    assert.deepEqual(snapshot.widgets['github-profile'], { kind: 'github-profile', login: 'octocat', name: null, avatarUrl: 'https://avatars.githubusercontent.com/u/1', repositories: 5, followers: 10, following: 2 });
    const calendar = snapshot.widgets['github-calendar'];
    if (calendar?.kind !== 'github-calendar') return assert.fail('missing calendar');
    assert.equal(calendar.days.length, 365);
    assert.deepEqual(calendar.days[0], { date: '2025-11-06', count: 0, level: 0 });
    assert.deepEqual(calendar.days[1], { date: '2025-11-07', count: 1234, level: 1 });
    assert.equal(calendar.total, calendar.days.reduce((sum, day) => sum + day.count, 0));
  });
  it('uses a renamed account canonical login for the public calendar', async () => {
    await fetchGitHub('oldname', async () => ({ ...githubUserFixture, login: 'newname' }), async (url) => {
      assert.equal(url, 'https://github.com/users/newname/contributions'); return githubCalendarFixture();
    });
  });
  it('rejects missing profile fields and organizations before reading the calendar', async () => {
    for (const value of [{}, { ...githubUserFixture, public_repos: null }, { ...githubUserFixture, type: 'Organization' }, { ...githubUserFixture, login: '../redirect' }]) {
      await assert.rejects(fetchGitHub('octocat', async () => value, async () => assert.fail('must not fetch an invalid profile calendar')), ConnectionFetchError);
    }
  });
  it('propagates missing users, rate limits, and calendar failures without producing partial snapshots', async () => {
    for (const code of ['not_found', 'rate_limited', 'unavailable']) {
      await assert.rejects(fetchGitHub('octocat', async () => { throw new ConnectionFetchError(code, 60000); }, async () => assert.fail('must not read the calendar after a REST error')), (error: ConnectionFetchError) => error.code === code);
    }
    await assert.rejects(fetchGitHub('octocat', async () => githubUserFixture, async () => { throw new ConnectionFetchError('unavailable'); }), ConnectionFetchError);
  });
});

describe('public GitHub contribution calendar parser', () => {
  it('supports tooltip counts, zero activity, commas, chronological sorting, and legacy data-count cells', () => {
    const modern = parseContributionCalendar(githubCalendarFixture());
    assert.deepEqual(parseContributionCalendar(githubCalendarFixture('legacy')), modern);
    const empty = githubCalendarFixture('legacy').replace(/data-count='\d+'/g, "data-count='0'").replace(/data-level='\d+'/g, "data-level='0'");
    assert.equal(parseContributionCalendar(empty).total, 0);
  });
  it('rejects login pages, changed markup, incomplete years, missing tooltips, duplicate dates and invalid counts', () => {
    const html = githubCalendarFixture();
    for (const value of ['<html>Sign in</html>', '<td data-date="2026-11-05" data-level="0" data-count="0"></td>', html.replace('id="day-0"', 'id="missing"'), html.replace('data-level="0"', 'data-level="5"'), html.replace('No contributions', 'Unknown activity'), html.replace('2025-11-07', '2025-11-06'), html.replace('2025-11-07', '2025-02-30')]) {
      assert.throws(() => parseContributionCalendar(value), ConnectionFetchError);
    }
  });
});
