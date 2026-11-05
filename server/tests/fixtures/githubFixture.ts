export const githubUserFixture = { login: 'octocat', type: 'User', name: null, avatar_url: 'https://avatars.githubusercontent.com/u/1', public_repos: 5, followers: 10, following: 2 };
export function githubCalendarFixture(format: 'tooltip' | 'legacy' = 'tooltip'): string {
  const cells = Array.from({ length: 365 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 10, 6 + index)).toISOString().slice(0, 10);
    const count = index === 1 ? 1234 : index % 5;
    const label = count === 0 ? 'No contributions' : `${count.toLocaleString('en-US')} ${count === 1 ? 'contribution' : 'contributions'}`;
    return format === 'legacy'
      ? `<rect data-count='${count}' data-level='${index % 5}' data-date='${date}' />`
      : `<td data-date="${date}" id="day-${index}" data-level="${index % 5}"></td><tool-tip for="day-${index}">${label} on this day.</tool-tip>`;
  });
  return `<tool-tip for="unrelated-control">Open profile</tool-tip><table>${cells.reverse().join('\n')}</table>`;
}
