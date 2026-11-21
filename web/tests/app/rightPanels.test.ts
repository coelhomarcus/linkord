import { describe, expect, it } from 'vitest';
import { rightPanelsVisible } from '@/app/rightPanels';

const base = { detailsOpen: true, onChatPage: true, stageShown: false, conversationType: 'text' as const };

describe('rightPanelsVisible', () => {
  it('shows a text channel member list while it is open', () => {
    expect(rightPanelsVisible(base)).toEqual({ details: true });
    expect(rightPanelsVisible({ ...base, detailsOpen: false })).toEqual({ details: false });
  });

  it('a call that already ended does not keep them shut: only the stage on screen does', () => {
    // the regression: after leaving a call the last picked view stayed 'call',
    // and the toggle did nothing until another conversation was opened
    expect(rightPanelsVisible({ ...base, stageShown: false })).toEqual({ details: true });
    expect(rightPanelsVisible({ ...base, stageShown: true })).toEqual({ details: false });
  });

  it("a DM's details are its profile panel; a voice channel has none", () => {
    expect(rightPanelsVisible({ ...base, conversationType: 'direct' })).toEqual({ details: true });
    expect(rightPanelsVisible({ ...base, conversationType: 'voice' })).toEqual({ details: false });
  });

  it('nothing opens off the chat pages or with no conversation shown', () => {
    expect(rightPanelsVisible({ ...base, onChatPage: false })).toEqual({ details: false });
    expect(rightPanelsVisible({ ...base, conversationType: null })).toEqual({ details: false });
  });
});
