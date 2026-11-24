import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { cn } from '@/shared/lib/utils';
import { boxFaces, partLayout } from './skinFormat';
import type { PartName } from './skinFormat';
import { skinCanvas } from './skins';
import type { Skin } from './skins';

/** A skin's front, drawn at its own pixel size and scaled up crisp. */
export function SkinPreview({ skin, label, className, style }: { skin: Skin; label: string; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const source = skinCanvas(skin.pixels);
    const arm = skin.slim ? 3 : 4;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 16, 32);
    const draw = (part: PartName, x: number, y: number) => {
      const layout = partLayout(part, skin.slim);
      for (const [u, v] of [layout.inner, layout.outer]) {
        const front = boxFaces(u, v, layout.size)[4]!;
        ctx.drawImage(source, front.x, front.y, front.w, front.h, x, y, front.w, front.h);
      }
    };
    draw('rightLeg', 4, 20);
    draw('leftLeg', 8, 20);
    draw('body', 4, 8);
    draw('rightArm', 4 - arm, 8);
    draw('leftArm', 12, 8);
    draw('head', 4, 0);
  }, [skin]);
  return <canvas ref={ref} width={16} height={32} role="img" aria-label={label} className={cn('flex-none [image-rendering:pixelated]', className)} style={style} />;
}
