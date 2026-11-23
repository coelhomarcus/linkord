import { DomUtils, parseDocument } from 'htmlparser2';
import { ConnectionFetchError, record, textValue } from '../connectionHttp.js';

const { findAll, findOne, textContent } = DomUtils;

function hasClass(element: { attribs: Record<string, string> }, name: string): boolean {
  return element.attribs.class?.split(/\s+/).includes(name) ?? false;
}

export function readSteamPublicProfile(html: string, steamId: string, profileUrl: string) {
  const document = parseDocument(html);
  const sidebar = findOne((element) => hasClass(element, 'profile_rightcol'), document);
  if (!sidebar) {
    const privateProfile = findOne((element) => hasClass(element, 'profile_private_info'), document);
    throw new ConnectionFetchError(privateProfile ? 'private' : 'invalid_response');
  }

  const profileScript = findOne((element) => element.name === 'script' && /\bg_rgProfileData\s*=/.test(textContent(element.children)), document);
  const profileData = profileScript && /^[ \t]*g_rgProfileData\s*=\s*(\{[^\r\n]*\});/m.exec(textContent(profileScript.children))?.[1];
  try {
    if (!profileData || record(JSON.parse(profileData)).steamid !== steamId) throw new ConnectionFetchError('invalid_response');
  } catch {
    throw new ConnectionFetchError('invalid_response');
  }

  // Read the counts and in-game status that Steam displays to a signed-out viewer.
  const gamesLink = `${profileUrl}/games/?tab=all`;
  const library = findOne((element) => element.name === 'a' && element.attribs.href === gamesLink, sidebar);
  const count = library && findOne((element) => hasClass(element, 'profile_count_link_total'), library);
  if (!count) throw new ConnectionFetchError('private');
  const countText = textContent(count).trim();
  const owned = Number(countText.replaceAll(',', ''));
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(countText) || !Number.isSafeInteger(owned)) throw new ConnectionFetchError('invalid_response');

  const status = findOne((element) => hasClass(element, 'profile_in_game'), sidebar);
  const playing = status && hasClass(status, 'in-game') && findOne((element) => hasClass(element, 'profile_in_game_name'), status);
  const currentGame = playing ? textValue(textContent(playing).trim()) : null;

  const activity = findOne((element) => hasClass(element, 'recent_games'), document);
  const recentIds = new Set<number>();
  if (activity) {
    for (const game of findAll((element) => hasClass(element, 'recent_game'), activity)) {
      const name = findOne((element) => hasClass(element, 'game_name'), game);
      const link = name && findOne((element) => element.name === 'a', name);
      const appId = link && /^https:\/\/steamcommunity\.com\/app\/(\d+)\/?$/.exec(link.attribs.href ?? '')?.[1];
      const details = findOne((element) => hasClass(element, 'game_info_details'), game);
      const id = Number(appId);
      if (Number.isSafeInteger(id) && id > 0 && details && /\b(?:hrs?|hours?) on record\b/.test(textContent(details))) recentIds.add(id);
    }
  }
  return { owned, currentGame, recentIds };
}
