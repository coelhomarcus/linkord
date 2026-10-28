import { describe, expect, it } from 'vitest';
import { rightPanelsVisible } from '@/app/rightPanels';

const base = { detailsOpen: true, mediaOpen: true, onChatPage: true, stageShown: false, conversationType: 'group' as const };

describe('rightPanelsVisible', () => {
  it('opens over the chat of a group or a bot', () => {
    expect(rightPanelsVisible(base)).toEqual({ details: true, media: true });
    expect(rightPanelsVisible({ ...base, conversationType: 'bot' })).toEqual({ details: true, media: true });
  });

  it('a call that already ended does not keep them shut: only the stage on screen does', () => {
    // the regression: after leaving a call the last picked view stayed 'call',
    // and clicking ⓘ did nothing until another conversation was opened
    expect(rightPanelsVisible({ ...base, stageShown: false })).toEqual({ details: true, media: true });
    expect(rightPanelsVisible({ ...base, stageShown: true })).toEqual({ details: false, media: false });
  });

  it('a DM has media but no details', () => {
    expect(rightPanelsVisible({ ...base, conversationType: 'direct' })).toEqual({ details: false, media: true });
  });

  it('nothing opens off the chat pages or with no conversation shown', () => {
    expect(rightPanelsVisible({ ...base, onChatPage: false })).toEqual({ details: false, media: false });
    expect(rightPanelsVisible({ ...base, conversationType: null })).toEqual({ details: false, media: false });
  });

  it('a closed panel stays closed', () => {
    expect(rightPanelsVisible({ ...base, detailsOpen: false, mediaOpen: false })).toEqual({ details: false, media: false });
  });
});
