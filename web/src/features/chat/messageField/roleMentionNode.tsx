import type { ReactNode } from 'react';
import { $applyNodeReplacement, DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical';

/** What the field needs to draw a role mention. */
export interface RoleRef {
  id: string;
  name: string;
  color: string;
}

type SerializedRoleMentionNode = Spread<{ role: RoleRef }, SerializedLexicalNode>;

/** A role mention, drawn as `@Role name` in the role's colour. Its text is
 * the `<@&id>` token itself, which is what is sent: a role name may hold
 * spaces and change later, the id does neither. */
export class RoleMentionNode extends DecoratorNode<ReactNode> {
  __role: RoleRef;

  static getType(): string { return 'role-mention'; }

  static clone(node: RoleMentionNode): RoleMentionNode { return new RoleMentionNode(node.__role, node.__key); }

  static importJSON(json: SerializedRoleMentionNode): RoleMentionNode { return $createRoleMentionNode(json.role); }

  constructor(role: RoleRef, key?: NodeKey) {
    super(key);
    this.__role = role;
  }

  exportJSON(): SerializedRoleMentionNode {
    return { ...super.exportJSON(), type: 'role-mention', version: 1, role: this.__role };
  }

  createDOM(): HTMLElement {
    const span = document.createElement('span');
    span.contentEditable = 'false';
    span.dataset.roleMention = this.__role.id;
    return span;
  }

  updateDOM(): boolean { return false; }

  isInline(): boolean { return true; }

  getTextContent(): string {
    return `<@&${this.__role.id}>`;
  }

  decorate(): ReactNode {
    const { color, name } = this.__role;
    return (
      <span
        className={color ? 'rounded-sm px-0.5 font-medium' : 'rounded-sm bg-primary/15 px-0.5 font-medium text-accent-text'}
        style={color ? { color, backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` } : undefined}
      >
        @{name}
      </span>
    );
  }
}

export function $createRoleMentionNode(role: RoleRef): RoleMentionNode {
  return $applyNodeReplacement(new RoleMentionNode(role));
}

export function $isRoleMentionNode(node: LexicalNode | null | undefined): node is RoleMentionNode {
  return node instanceof RoleMentionNode;
}
