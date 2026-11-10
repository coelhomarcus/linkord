import {
  $createLineBreakNode, $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isTextNode,
  type ElementNode, type LexicalNode, type PointType, type TextNode,
} from 'lexical';

import { splitEmoji } from '@/features/emoji/twemoji';
import { ROLE_MENTION_TOKEN } from '@/features/chat/messageMarkup';
import { $createCustomEmojiNode, $createTwemojiNode, $isCustomEmojiNode, $isTwemojiNode, type CustomEmojiRef } from './emojiNodes';
import { $createRoleMentionNode, $isRoleMentionNode, type RoleRef } from './roleMentionNode';

// The field as plain text: what it holds (its one paragraph, line breaks as
// "\n"), and the caret as an offset into that text, the way a textarea has
// them. Every node's share of the text is its getTextContent().

/** `:name:` or `:name~2:`, not glued to a word; mirrors customEmojiText.ts. */
const CUSTOM_RE = /(?<![\w:<]):([a-z0-9_]{2,32})(?:~(\d{1,2}))?:(?![\w])/g;
// code is quoted text: a `:name:` in it stays text, as it is sent
const CODE_RE = /```[\s\S]*?```|`[^`\n]+`/g;

export type ResolveCustomEmoji = (name: string, nth: number | null) => CustomEmojiRef | null;
export type ResolveRole = (roleId: string) => RoleRef | null;

const ROLE_RE = new RegExp(ROLE_MENTION_TOKEN, 'g');

function paragraph(): ElementNode {
  const root = $getRoot();
  const first = root.getFirstChild();
  if ($isElementNode(first)) return first;
  const created = $createParagraphNode();
  root.append(created);
  return created;
}

export function $fieldText(): string {
  return $getRoot().getTextContent();
}

/** Replaces everything with `text`, caret at the end. Emojis are made into
 * their nodes by the field's transform. */
export function $setFieldText(text: string): void {
  const root = $getRoot();
  root.clear();
  const p = $createParagraphNode();
  text.split('\n').forEach((line, index) => {
    if (index > 0) p.append($createLineBreakNode());
    if (line) p.append($createTextNode(line));
  });
  root.append(p);
  p.selectEnd();
}

function offsetBefore(node: LexicalNode): number {
  let offset = 0;
  for (let sibling = node.getPreviousSibling(); sibling; sibling = sibling.getPreviousSibling()) offset += sibling.getTextContentSize();
  return offset;
}

function pointOffset(point: PointType): number {
  const node = point.getNode();
  if (point.type === 'text') return offsetBefore(node) + point.offset;
  if (node.is($getRoot())) return point.offset === 0 ? 0 : $fieldText().length;
  return ($isElementNode(node) ? node.getChildren() : []).slice(0, point.offset).reduce((sum, child) => sum + child.getTextContentSize(), 0);
}

/** The selection as text offsets, start first; the end of the text without one. */
export function $fieldSelection(): { start: number; end: number } {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    const end = $fieldText().length;
    return { start: end, end };
  }
  const [a, b] = [pointOffset(selection.anchor), pointOffset(selection.focus)];
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** Puts the caret at text offset `offset`; one that falls inside an emoji
 * lands after it. */
export function $setFieldCaret(offset: number): void {
  const p = paragraph();
  let consumed = 0;
  const children = p.getChildren();
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!;
    const size = child.getTextContentSize();
    if (offset <= consumed + size) {
      const inside = offset - consumed;
      if ($isTextNode(child) && !$isTwemojiNode(child)) { child.select(inside, inside); return; }
      // an emoji, a server emoji or a line break: before it or after it
      const at = inside === 0 ? index : index + 1;
      p.select(at, at);
      return;
    }
    consumed += size;
  }
  p.selectEnd();
}

function codeRanges(text: string): [number, number][] {
  return [...text.matchAll(CODE_RE)].map((match) => [match.index, match.index + match[0].length]);
}

const inCode = (ranges: [number, number][], start: number, end: number) => ranges.some(([a, b]) => start >= a && end <= b);

/** Turns the first emoji of a plain text node into its node; the transform
 * runs again on what is left, until nothing is. A word being composed by an
 * IME is left alone until it is done. */
export function $convertEmojis(node: TextNode, resolve: ResolveCustomEmoji): void {
  if (node.getType() !== 'text' || !node.isSimpleText() || node.isComposing()) return;
  const parent = node.getParent();
  if (!parent) return;
  const own = node.getTextContent();
  if (!own) return;
  const full = parent.getTextContent();
  const code = codeRanges(full);
  // a backtick typed after an emoji can put it inside code, where it is sent as text
  if (own.includes('`') && $revertEmojisInCode(parent, code)) return;
  const start = offsetBefore(node);
  const end = start + own.length;

  let found: { from: number; to: number; make: () => LexicalNode } | null = null;
  for (const match of full.matchAll(CUSTOM_RE)) {
    const from = match.index;
    const to = from + match[0].length;
    if (to <= start) continue;
    if (from >= end) break;
    if (from < start || to > end || inCode(code, from, to)) continue;
    const nth = match[2] ? Number(match[2]) : null;
    const emoji = resolve(match[1]!, nth);
    if (!emoji) continue;
    found = { from: from - start, to: to - start, make: () => $createCustomEmojiNode(emoji, nth) };
    break;
  }

  let at = 0;
  for (const part of splitEmoji(own)) {
    const size = typeof part === 'string' ? part.length : part.emoji.length;
    if (found && at >= found.from) break;
    if (typeof part !== 'string' && !inCode(code, start + at, start + at + size)) {
      const emoji = part.emoji;
      found = { from: at, to: at + size, make: () => $createTwemojiNode(emoji) };
      break;
    }
    at += size;
  }
  if (!found) return;

  const parts = node.splitText(found.from, found.to);
  const target = found.from === 0 ? parts[0] : parts[1];
  target?.replace(found.make());
}

function $revertEmojisInCode(parent: ElementNode, code: [number, number][]): boolean {
  let offset = 0;
  let reverted = false;
  for (const child of parent.getChildren()) {
    const size = child.getTextContentSize();
    if (($isTwemojiNode(child) || $isCustomEmojiNode(child) || $isRoleMentionNode(child)) && inCode(code, offset, offset + size)) {
      child.replace($createTextNode(child.getTextContent()));
      reverted = true;
    }
    offset += size;
  }
  return reverted;
}

/** Turns the first `<@&id>` of a plain text node whose role is known into its
 * chip; like $convertEmojis, the transform runs again on what is left. A
 * token in code stays text, as it is sent. */
export function $convertRoleMentions(node: TextNode, resolve: ResolveRole): void {
  if (node.getType() !== 'text' || !node.isSimpleText() || node.isComposing()) return;
  const own = node.getTextContent();
  const parent = node.getParent();
  if (!parent || !own.includes('<@&')) return;
  const code = codeRanges(parent.getTextContent());
  const start = offsetBefore(node);
  for (const match of own.matchAll(ROLE_RE)) {
    const from = match.index;
    const to = from + match[0].length;
    if (inCode(code, start + from, start + to)) continue;
    const role = resolve(match[1]!);
    if (!role) continue;
    const parts = node.splitText(from, to);
    (from === 0 ? parts[0] : parts[1])?.replace($createRoleMentionNode(role));
    return;
  }
}

