import type { ComponentProps } from 'react';
import { Button } from '@/shared/ui/primitives/button';
import { useAnimatedIcon, type AnimatedIcon } from './useAnimatedIcon';

type ButtonProps = ComponentProps<typeof Button>;

/** An icon-only Button whose icon animates when the button is hovered or
 * focused, not just when the pointer happens to be over the glyph. */
export function AnimatedIconButton({ icon: Icon, iconSize = 16, onPointerEnter, onPointerLeave, onFocus, onBlur, ...props }: ButtonProps & {
  icon: AnimatedIcon;
  iconSize?: number;
}) {
  const { ref, triggerProps } = useAnimatedIcon();
  return (
    <Button
      {...props}
      onPointerEnter={(event) => { triggerProps.onPointerEnter(); onPointerEnter?.(event); }}
      onPointerLeave={(event) => { triggerProps.onPointerLeave(); onPointerLeave?.(event); }}
      onFocus={(event) => { triggerProps.onFocus(); onFocus?.(event); }}
      onBlur={(event) => { triggerProps.onBlur(); onBlur?.(event); }}
    >
      <Icon ref={ref} size={iconSize} aria-hidden />
    </Button>
  );
}
