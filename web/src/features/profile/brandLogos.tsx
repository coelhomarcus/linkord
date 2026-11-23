import type { ComponentType, SVGProps } from 'react';
import { FaXbox } from 'react-icons/fa';
import {
  SiBehance, SiEpicgames, SiGithub, SiIgdb, SiInstagram, SiKick, SiMyanimelist, SiSnapchat, SiSoundcloud,
  SiSteam, SiThreads, SiTwitch, SiVk, SiX,
} from 'react-icons/si';
import LogosBluesky from '~icons/logos/bluesky';
import LogosDiscordIcon from '~icons/logos/discord-icon';
import LogosDribbbleIcon from '~icons/logos/dribbble-icon';
import LogosFacebook from '~icons/logos/facebook';
import LogosLinkedinIcon from '~icons/logos/linkedin-icon';
import LogosPinterest from '~icons/logos/pinterest';
import LogosRedditIcon from '~icons/logos/reddit-icon';
import LogosSpotifyIcon from '~icons/logos/spotify-icon';
import LogosTelegram from '~icons/logos/telegram';
import LogosTiktokIcon from '~icons/logos/tiktok-icon';
import LogosWhatsappIcon from '~icons/logos/whatsapp-icon';
import LogosYoutubeIcon from '~icons/logos/youtube-icon';
import { BrandIcon, type LinkKind } from './profileLinks';

// Full-colour marks where the brand has one that reads on a dark surface (the
// `logos` set, CC0, bundled at build time). The rest keep the single-colour
// glyph in the brand's own colour, or the text colour where that is black, as
// Discord shows GitHub, Steam and X in white.
const FULL_COLOR: Partial<Record<LinkKind, ComponentType<SVGProps<SVGSVGElement>>>> = {
  youtube: LogosYoutubeIcon,
  linkedin: LogosLinkedinIcon,
  tiktok: LogosTiktokIcon,
  spotify: LogosSpotifyIcon,
  discord: LogosDiscordIcon,
  reddit: LogosRedditIcon,
  facebook: LogosFacebook,
  bluesky: LogosBluesky,
  telegram: LogosTelegram,
  pinterest: LogosPinterest,
  dribbble: LogosDribbbleIcon,
  whatsapp: LogosWhatsappIcon,
};

const TINTED: Partial<Record<LinkKind, { Icon: ComponentType<{ size?: number; color?: string }>; color?: string }>> = {
  twitter: { Icon: SiX },
  github: { Icon: SiGithub },
  steam: { Icon: SiSteam },
  threads: { Icon: SiThreads },
  epicgames: { Icon: SiEpicgames },
  xbox: { Icon: FaXbox },
  twitch: { Icon: SiTwitch, color: '#9146ff' },
  instagram: { Icon: SiInstagram, color: '#ff0069' },
  igdb: { Icon: SiIgdb, color: '#9147ff' },
  snapchat: { Icon: SiSnapchat, color: '#fffc00' },
  kick: { Icon: SiKick, color: '#53fc18' },
  soundcloud: { Icon: SiSoundcloud, color: '#ff5500' },
  behance: { Icon: SiBehance, color: '#1769ff' },
  vk: { Icon: SiVk, color: '#0077ff' },
};

/** A service's logo in its own colours, for lists of accounts (Discord's
 * connections). Marks laid over art or text keep the plain `BrandIcon`. */
export function BrandLogo({ kind, size = 17 }: { kind: LinkKind; size?: number }) {
  const FullColor = FULL_COLOR[kind];
  if (FullColor) return <FullColor aria-hidden width={size} height={size} />;
  // MyAnimeList's blue is too dark for a glyph on our surfaces: its app icon instead, white on blue
  if (kind === 'myanimelist') {
    return (
      <span aria-hidden className="grid place-items-center rounded-[22%] bg-[#2e51a2] text-white" style={{ width: size, height: size }}>
        <SiMyanimelist size={Math.round(size * 0.8)} />
      </span>
    );
  }
  const tinted = TINTED[kind];
  if (tinted) return <tinted.Icon size={size} color={tinted.color} />;
  return <BrandIcon kind={kind} size={size} />;
}
