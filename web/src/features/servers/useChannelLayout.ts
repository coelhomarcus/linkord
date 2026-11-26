import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { describeApiError } from '@/shared/api/errorText';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { TOUCH_FIRST_QUERY } from '@/shared/hooks/useLongPress';
import { announce } from '@/shared/lib/announce';
import type { ChannelSummary, ServerSummary } from '@/shared/types/protocol';
import { moveChannel, type ChannelDestination } from './serversApi';
import { PERMISSIONS } from './permissionBits';
import { can, canInChannel, groupChannels } from './serverUtils';

const CHANNEL_DRAG = 'application/x-overcord-channel';

type DropTarget = { categoryId: string | null; channel?: ChannelSummary };
type Hover = { zone: string; edge?: 'before' | 'after' };

export function useChannelLayout(server: ServerSummary) {
  const { t } = useTranslation('servers');
  const touchFirst = useMediaQuery(TOUCH_FIRST_QUERY);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<{ source: ChannelSummary[]; channels: ChannelSummary[] } | null>(null);
  const [dragged, setDragged] = useState<ChannelSummary | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const channels = optimistic?.source === server.channels ? optimistic.channels : server.channels;
  const groups = groupChannels({ ...server, channels });
  const canManage = server.status === 'active' && can(server, PERMISSIONS.MANAGE_CHANNELS);

  function canMove(channel: ChannelSummary) {
    return canManage && canInChannel(channel, PERMISSIONS.MANAGE_CHANNELS);
  }

  function siblingsOf(channel: ChannelSummary, categoryId: string | null) {
    return groups.find(({ category }) => (category?.id ?? null) === categoryId)?.channels
      .filter((item) => item.type === channel.type) ?? [];
  }

  function neighbors(channel: ChannelSummary) {
    const siblings = siblingsOf(channel, channel.categoryId);
    const index = siblings.findIndex((item) => item.id === channel.id);
    return { previous: siblings[index - 1], next: siblings[index + 1] };
  }

  async function move(channel: ChannelSummary, destination: ChannelDestination) {
    if (pending.current || !canMove(channel)) return;
    const previous = siblingsOf(channel, destination.categoryId);
    const ordered = previous.filter((item) => item.id !== channel.id);
    const anchor = destination.target;
    const anchorIndex = anchor ? ordered.findIndex((item) => item.id === anchor.channelId) : -1;
    if (anchor && anchorIndex < 0) return;
    const slot = anchor ? anchorIndex + Number(anchor.edge === 'after') : ordered.length;
    ordered.splice(slot, 0, channel);
    if (channel.categoryId === destination.categoryId && previous.every((item, index) => item.id === ordered[index]?.id)) return;

    const positions = new Map(ordered.map((item, position) => [item.id, position]));
    const next = channels.map((item) => {
      const position = positions.get(item.id);
      return position === undefined ? item : { ...item, categoryId: destination.categoryId, position };
    });
    const before = optimistic;
    pending.current = true;
    setSaving(true);
    setError(null);
    setOptimistic({ source: server.channels, channels: next });
    try {
      await moveChannel(channel.id, destination);
      announce(t('channelLayout.moved', { name: channel.name }));
    } catch (err) {
      setOptimistic(before);
      setError(describeApiError(err, 'servers:channelLayout.failed'));
    }
    pending.current = false;
    setSaving(false);
  }

  function endDrag() {
    setDragged(null);
    setHover(null);
  }

  function dragProps(channel: ChannelSummary) {
    return {
      draggable: !touchFirst && !saving && canMove(channel),
      onDragStart(event: DragEvent<HTMLElement>) {
        if (!event.currentTarget.draggable || event.target !== event.currentTarget) return;
        event.dataTransfer.setData(CHANNEL_DRAG, channel.id);
        event.dataTransfer.effectAllowed = 'move';
        setDragged(channel);
      },
      onDragEnd: endDrag,
    };
  }

  function dropProps({ categoryId, channel }: DropTarget) {
    const zone = channel?.id ?? `category:${categoryId ?? ''}`;
    function accepts(event: DragEvent<HTMLElement>) {
      return !!dragged && event.dataTransfer.types.includes(CHANNEL_DRAG)
        && (!channel || (channel.id !== dragged.id && channel.type === dragged.type));
    }

    function edgeAt(event: DragEvent<HTMLElement>) {
      const rect = event.currentTarget.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    }

    return {
      'data-channel-drop': hover?.zone === zone ? hover.edge ?? 'category' : undefined,
      onDragOver(event: DragEvent<HTMLElement>) {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const edge = channel ? edgeAt(event) : undefined;
        setHover((current) => current?.zone === zone && current.edge === edge ? current : { zone, edge });
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setHover((current) => current?.zone === zone ? null : current);
      },
      onDrop(event: DragEvent<HTMLElement>) {
        if (!dragged || !accepts(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer.getData(CHANNEL_DRAG) === dragged.id) {
          void move(dragged, { categoryId, target: channel ? { channelId: channel.id, edge: edgeAt(event) } : undefined });
        }
        endDrag();
      },
    };
  }

  return { groups, saving, error, dragged, canMove, neighbors, move, dragProps, dropProps };
}
