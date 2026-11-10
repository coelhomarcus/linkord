import type { ReactNode } from 'react';
import {
  $applyNodeReplacement, DecoratorNode, TextNode,
  type EditorConfig, type LexicalNode, type NodeKey, type SerializedLexicalNode, type SerializedTextNode, type Spread,
} from 'lexical';

import { emojiImageUrl } from '@/features/emoji/serverEmojisApi';
import { resolveTwemoji, resolvedTwemoji, twemojiUrls } from '@/features/emoji/twemoji';

// The message field's two kinds of emoji. Both keep, as their text, exactly
// what the field's plain text has: a Unicode emoji is its characters, a
// server emoji its `:name:` (`:name~2:` for the second of that name). So the
// field still reads and writes the same text as the textarea it replaces.

/** A Unicode emoji, drawn as its Twemoji picture over the real, transparent
 * characters (what is copied and what the caret steps over as one). */
export class TwemojiNode extends TextNode {
  static getType(): string { return 'twemoji'; }

  static clone(node: TwemojiNode): TwemojiNode { return new TwemojiNode(node.__text, node.__key); }

  static importJSON(json: SerializedTextNode): TwemojiNode { return $createTwemojiNode(json.text); }

  exportJSON(): SerializedTextNode { return { ...super.exportJSON(), type: 'twemoji' }; }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    paint(dom, this.__text);
    return dom;
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const changed = super.updateDOM(prevNode, dom, config);
    if (prevNode.__text !== this.__text) paint(dom, this.__text);
    return changed;
  }
}

const TWEMOJI_CLASSES = ['inline-block', 'size-[1.375em]', 'overflow-hidden', 'whitespace-nowrap', 'bg-contain', 'bg-center', 'bg-no-repeat', 'align-[-0.3em]', 'text-transparent', 'caret-text-primary'];

function paint(dom: HTMLElement, emoji: string): void {
  const apply = (url: string | null) => {
    if (!url) { dom.classList.remove(...TWEMOJI_CLASSES); dom.style.backgroundImage = ''; return; }
    dom.classList.add(...TWEMOJI_CLASSES);
    dom.style.backgroundImage = `url("${url}")`;
  };
  dom.dataset.emoji = '';
  const known = resolvedTwemoji(emoji);
  if (known) { apply(known === 'missing' ? null : known.url); return; }
  apply(twemojiUrls(emoji)[0]!);
  void resolveTwemoji(emoji).then((result) => apply(result === 'missing' ? null : result.url));
}

export function $createTwemojiNode(emoji: string): TwemojiNode {
  return $applyNodeReplacement(new TwemojiNode(emoji)).setMode('token');
}

export function $isTwemojiNode(node: LexicalNode | null | undefined): node is TwemojiNode {
  return node instanceof TwemojiNode;
}

export interface CustomEmojiRef {
  id: string;
  name: string;
  animated: boolean;
}

type SerializedCustomEmojiNode = Spread<{ emoji: CustomEmojiRef; nth: number | null }, SerializedLexicalNode>;

/** A server emoji, drawn as its picture; its text is the `:name:` it was typed as. */
export class CustomEmojiNode extends DecoratorNode<ReactNode> {
  __emoji: CustomEmojiRef;
  __nth: number | null;

  static getType(): string { return 'custom-emoji'; }

  static clone(node: CustomEmojiNode): CustomEmojiNode { return new CustomEmojiNode(node.__emoji, node.__nth, node.__key); }

  static importJSON(json: SerializedCustomEmojiNode): CustomEmojiNode { return $createCustomEmojiNode(json.emoji, json.nth); }

  constructor(emoji: CustomEmojiRef, nth: number | null, key?: NodeKey) {
    super(key);
    this.__emoji = emoji;
    this.__nth = nth;
  }

  exportJSON(): SerializedCustomEmojiNode {
    return { ...super.exportJSON(), type: 'custom-emoji', version: 1, emoji: this.__emoji, nth: this.__nth };
  }

  createDOM(): HTMLElement {
    const span = document.createElement('span');
    span.contentEditable = 'false';
    span.dataset.customEmoji = this.__emoji.id;
    return span;
  }

  updateDOM(): boolean { return false; }

  isInline(): boolean { return true; }

  getTextContent(): string {
    return `:${this.__emoji.name}${this.__nth ? `~${this.__nth}` : ''}:`;
  }

  decorate(): ReactNode {
    const label = `:${this.__emoji.name}:`;
    return (
      <img
        src={emojiImageUrl(this.__emoji.id)}
        alt={label}
        title={label}
        draggable={false}
        className="inline-block size-[1.375em] align-[-0.3em] object-contain"
      />
    );
  }
}

export function $createCustomEmojiNode(emoji: CustomEmojiRef, nth: number | null): CustomEmojiNode {
  return $applyNodeReplacement(new CustomEmojiNode(emoji, nth));
}

export function $isCustomEmojiNode(node: LexicalNode | null | undefined): node is CustomEmojiNode {
  return node instanceof CustomEmojiNode;
}
