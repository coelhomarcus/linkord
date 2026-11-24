import { cn } from '@/shared/lib/utils';
import { pixelIconRuns } from './pixelIcons';
import type { PixelIconName } from './pixelIcons';

export type { PixelIconName } from './pixelIcons';

/** A playground icon (pixelIcons.ts) as crisp SVG, in the text's colour. */
export function PixelIcon({ name, off = false, glass = 'rgb(255 255 255 / 0.35)', className }: {
  name: PixelIconName; off?: boolean; glass?: string; className?: string;
}) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" shapeRendering="crispEdges" className={cn('size-6 flex-none drop-shadow-[2px_2px_0_rgb(0_0_0/0.55)]', className)}>
      {pixelIconRuns(name, { color: 'currentColor', glass, off }).map((run) => <rect key={`${run.fill} ${run.x},${run.y}`} x={run.x} y={run.y} width={run.width} height={1} fill={run.fill} />)}
    </svg>
  );
}
