import { useRoom } from '@/state/RoomContext';
import { Switch } from '@/shared/ui/primitives/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/primitives/select';
import { SettingsRow, SettingsSection, SettingsSections } from './SettingsLayout';
import { COLOR_THEME_IDS, COLOR_THEME_LABELS, type ColorThemeId } from './useColorThemePreference';

export function PreferencesSettings() {
  const {
    colorTheme, setColorTheme,
    showTileBanners, setShowTileBanners, showStats, setShowStats,
    hideAudioOnlyTiles, setHideAudioOnlyTiles, compressImagesDefault, setCompressImagesDefault,
  } = useRoom();

  return (
    <SettingsSections>
      <SettingsSection id="app-appearance" title="Aparência do app">
        <SettingsRow
          label="Tema de cores"
          description="Muda fundos, textos e botões da interface neste dispositivo."
        >
          <Select value={colorTheme} onValueChange={(value) => value && setColorTheme(value as ColorThemeId)}>
            <SelectTrigger aria-label="Tema de cores" className="w-full max-w-xs">
              <SelectValue>{() => COLOR_THEME_LABELS[colorTheme]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COLOR_THEME_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {COLOR_THEME_LABELS[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection id="call-appearance" title="Aparência da chamada">
        <SettingsRow label="Mostrar banners dos participantes" description="Exibe o banner do perfil como fundo dos cartões da chamada.">
          <Switch checked={showTileBanners} onCheckedChange={setShowTileBanners} aria-label="Mostrar banners nos tiles" />
        </SettingsRow>
        <SettingsRow label="Ocultar participantes sem vídeo" description="Some com os cartões de quem só está no áudio, deixando o palco só para quem está com câmera ou tela ligada.">
          <Switch checked={hideAudioOnlyTiles} onCheckedChange={setHideAudioOnlyTiles} aria-label="Ocultar participantes sem vídeo" />
        </SettingsRow>
        <SettingsRow label="Mostrar estatísticas" description="Bitrate e tempo no ar no menu de cada transmissão.">
          <Switch checked={showStats} onCheckedChange={setShowStats} aria-label="Mostrar estatísticas" />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection id="image-uploads" title="Envio de imagens">
        <SettingsRow label="Compactar imagens por padrão" description="Reduz o tamanho antes de enviar. Vale para novos anexos a partir de agora. Um que você já preparou não é reprocessado.">
          <Switch checked={compressImagesDefault} onCheckedChange={setCompressImagesDefault} aria-label="Compactar imagens por padrão" />
        </SettingsRow>
      </SettingsSection>
    </SettingsSections>
  );
}
