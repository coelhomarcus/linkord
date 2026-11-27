import { FaWindows } from 'react-icons/fa6';
import type { IconComponent } from './createIcon';

// Fluent draws no brand logos, so these come from react-icons (as in profileLinks)
// behind the same props as the Fluent icons; buildIcons.ts leaves them out.

export const WindowsLogoIcon: IconComponent = ({ size = '1em', weight: _weight, color = 'currentColor', mirrored: _mirrored, alt, ...rest }) => (
  <FaWindows size={size} color={color} title={alt} {...rest} />
);
WindowsLogoIcon.displayName = 'WindowsLogoIcon';
