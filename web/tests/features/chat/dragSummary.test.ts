import { describe, expect, it } from 'vitest';
import { FileIcon, FilePdfIcon, FilesIcon } from '@phosphor-icons/react';
import { carriesFiles, summarizeDrag } from '@/features/chat/dragSummary';

function transfer(items: { kind: string; type: string }[], types = ['Files']): DataTransfer {
  return { types, items, files: [] } as unknown as DataTransfer;
}

describe('summarizeDrag', () => {
  it('counts only file items and shows their type when they share one', () => {
    const summary = summarizeDrag(transfer([{ kind: 'file', type: 'application/pdf' }, { kind: 'file', type: 'application/pdf' }, { kind: 'string', type: 'text/uri-list' }]));
    expect(summary.count).toBe(2);
    expect(summary.icon).toBe(FilePdfIcon);
  });

  it('falls back to a generic icon for mixed types', () => {
    const summary = summarizeDrag(transfer([{ kind: 'file', type: 'application/pdf' }, { kind: 'file', type: 'image/png' }]));
    expect(summary.icon).toBe(FilesIcon);
  });

  it('shows the unknown-file icon for a type it cannot tell', () => {
    expect(summarizeDrag(transfer([{ kind: 'file', type: '' }])).icon).toBe(FileIcon);
  });

  it('reports 0 when the browser lists no items yet', () => {
    expect(summarizeDrag(transfer([])).count).toBe(0);
  });
});

describe('carriesFiles', () => {
  it('is true only for drags that carry files', () => {
    expect(carriesFiles(transfer([], ['Files']))).toBe(true);
    expect(carriesFiles(transfer([], ['text/plain', 'text/html']))).toBe(false);
  });
});
