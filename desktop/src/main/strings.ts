// The few words the desktop app itself shows (tray, menu, update prompts).
// It follows the system's language: the account's language lives in the
// page, which the menu is built before. pt-BR is the source, as in web/.

const PT_BR = {
  open: 'Abrir o Linkord',
  openInBrowser: 'Abrir no navegador',
  startAtLogin: 'Iniciar com o sistema',
  checkForUpdates: 'Procurar atualizações…',
  restartToUpdate: 'Reiniciar para atualizar',
  downloadUpdate: 'Baixar a versão {{version}}',
  about: 'Sobre o Linkord',
  quit: 'Sair do Linkord',
  hide: 'Ocultar o Linkord',
  hideOthers: 'Ocultar os outros',
  showAll: 'Mostrar tudo',
  services: 'Serviços',
  file: 'Arquivo',
  edit: 'Editar',
  undo: 'Desfazer',
  redo: 'Refazer',
  cut: 'Recortar',
  copy: 'Copiar',
  paste: 'Colar',
  pasteAndMatchStyle: 'Colar sem formatação',
  selectAll: 'Selecionar tudo',
  view: 'Visualizar',
  reload: 'Recarregar',
  actualSize: 'Tamanho real',
  zoomIn: 'Aumentar',
  zoomOut: 'Diminuir',
  toggleFullScreen: 'Tela cheia',
  developerTools: 'Ferramentas de desenvolvedor',
  window: 'Janela',
  minimize: 'Minimizar',
  zoom: 'Zoom',
  front: 'Trazer tudo para a frente',
  help: 'Ajuda',
  updateUpToDate: 'Você está usando a versão mais recente ({{version}}).',
  updateFailed: 'Não foi possível procurar atualizações.',
  updateAvailableTitle: 'Nova versão do Linkord',
  updateAvailableBody: 'A versão {{version}} está disponível para download.',
  updateReadyTitle: 'Atualização pronta',
  updateReadyBody: 'A versão {{version}} será instalada quando o Linkord reiniciar.',
  updateReadyRestart: 'Reiniciar agora',
  updateReadyLater: 'Depois',
  updateDownloadOpen: 'Baixar',
  ok: 'OK',
};

export type Strings = typeof PT_BR;

const EN_US: Strings = {
  open: 'Open Linkord',
  openInBrowser: 'Open in browser',
  startAtLogin: 'Start at login',
  checkForUpdates: 'Check for updates…',
  restartToUpdate: 'Restart to update',
  downloadUpdate: 'Download version {{version}}',
  about: 'About Linkord',
  quit: 'Quit Linkord',
  hide: 'Hide Linkord',
  hideOthers: 'Hide others',
  showAll: 'Show all',
  services: 'Services',
  file: 'File',
  edit: 'Edit',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  pasteAndMatchStyle: 'Paste and match style',
  selectAll: 'Select all',
  view: 'View',
  reload: 'Reload',
  actualSize: 'Actual size',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  toggleFullScreen: 'Full screen',
  developerTools: 'Developer tools',
  window: 'Window',
  minimize: 'Minimize',
  zoom: 'Zoom',
  front: 'Bring all to front',
  help: 'Help',
  updateUpToDate: 'You are on the latest version ({{version}}).',
  updateFailed: 'Could not check for updates.',
  updateAvailableTitle: 'New Linkord version',
  updateAvailableBody: 'Version {{version}} is available to download.',
  updateReadyTitle: 'Update ready',
  updateReadyBody: 'Version {{version}} will be installed when Linkord restarts.',
  updateReadyRestart: 'Restart now',
  updateReadyLater: 'Later',
  updateDownloadOpen: 'Download',
  ok: 'OK',
};

export const STRINGS = { 'pt-BR': PT_BR, 'en-US': EN_US } as const;

/** pt-BR for any Portuguese system, English otherwise. */
export function stringsFor(preferredLanguages: readonly string[]): Strings {
  return preferredLanguages[0]?.toLowerCase().startsWith('pt') ? PT_BR : EN_US;
}

export function format(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => values[name] ?? match);
}
