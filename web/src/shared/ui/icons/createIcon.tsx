import type { ReactElement, Ref, SVGProps } from 'react';

// Only the weights the app draws: Phosphor's other three (thin, light,
// duotone) were most of the icons' weight in the main chunk and never shown.
export type IconWeight = 'regular' | 'bold' | 'fill';

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

/** Draws the same <svg> as @phosphor-icons/react's IconBase, without its context. */
export function createIcon(name: string, regular: Paths, bold: Paths, fill: Paths): IconComponent {
  const weights: Record<IconWeight, Paths> = { regular, bold, fill };
  function Icon({ size = '1em', weight = 'regular', color = 'currentColor', mirrored = false, alt, children, ...rest }: IconProps) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill={color} viewBox="0 0 256 256" transform={mirrored ? 'scale(-1, 1)' : undefined} {...rest}>
        {alt ? <title>{alt}</title> : null}
        {children}
        {weights[weight].map((d, index) => <path key={index} d={d} />)}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}
