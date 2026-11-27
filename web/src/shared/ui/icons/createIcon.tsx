import type { ReactElement, Ref, SVGProps } from 'react';

/** Fluent's two styles: `fill` for an active or emphasised icon, and for a line
 * icon (check, chevron, dismiss) that needs a heavier stroke. */
export type IconWeight = 'regular' | 'fill';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  size?: string | number;
  weight?: IconWeight;
  color?: string;
  mirrored?: boolean;
  alt?: string;
  ref?: Ref<SVGSVGElement>;
}

export type IconComponent = ((props: IconProps) => ReactElement) & { displayName?: string };

type Paths = readonly string[];

/** One Fluent icon, drawn from its 20 px artwork in either style. */
export function createIcon(name: string, regular: Paths, fill: Paths): IconComponent {
  const weights: Record<IconWeight, Paths> = { regular, fill };
  function Icon({ size = '1em', weight = 'regular', color = 'currentColor', mirrored = false, alt, children, ...rest }: IconProps) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill={color} viewBox="0 0 20 20" transform={mirrored ? 'scale(-1, 1)' : undefined} {...rest}>
        {alt ? <title>{alt}</title> : null}
        {children}
        {weights[weight].map((d, index) => <path key={index} d={d} />)}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}
