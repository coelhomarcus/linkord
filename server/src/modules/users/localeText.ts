import type { Locale } from './locale.js';

type TextKey =
  | 'push.mentionChannelTitle' | 'push.mentionDirectTitle' | 'push.serverInvitationTitle' | 'push.serverInvitationBody'
  | 'push.friendRequestTitle' | 'push.friendAcceptedTitle'
  | 'push.chatEmptyBody' | 'push.chatEmptyBodyDirect' | 'push.stickerBody' | 'push.stickerBodyDirect' | 'push.callInviteBody' | 'push.callInviteBodyDirect'
  | 'push.dmCall' | 'push.dmCallLasted' | 'push.deletedRole'
  | 'push.callSecond_one' | 'push.callSecond_other' | 'push.callMinute_one' | 'push.callMinute_other'
  | 'push.callHour_one' | 'push.callHour_other' | 'push.callHourMinute'
  | 'email.recoverySubject' | 'email.changeSubject' | 'email.recoveryTitle' | 'email.changeTitle'
  | 'email.recoveryIntro' | 'email.changeIntro' | 'email.recoveryAccountLine' | 'email.expires' | 'email.appLine'
  | 'email.loginSubject' | 'email.loginTitle' | 'email.loginIntro' | 'email.loginExpires'
  | 'email.twoFactorSetupSubject' | 'email.twoFactorSetupTitle' | 'email.twoFactorSetupIntro'
  | 'email.loginAlertSubject' | 'email.loginAlertTitle' | 'email.loginAlertIntro' | 'email.loginAlertDevice' | 'email.loginAlertIp'
  | 'email.loginAlertTime' | 'email.loginAlertAction' | 'email.loginAlertOptOut'
  | 'email.deviceBrowserOn' | 'email.deviceUnknownBrowserOn' | 'email.deviceUnknown' | 'email.deviceAutomated'
  | 'email.deletionCodeSubject' | 'email.deletionCodeTitle' | 'email.deletionCodeIntro'
  | 'email.deletionScheduledSubject' | 'email.deletionScheduledTitle' | 'email.deletionScheduledIntro' | 'email.deletionScheduledCancel'
  | 'email.deletionDoneSubject' | 'email.deletionDoneTitle' | 'email.deletionDoneIntro'
  | 'email.exportReadySubject' | 'email.exportReadyTitle' | 'email.exportReadyIntro' | 'email.exportReadyExpires'
  | 'email.changeCurrentSubject' | 'email.changeCurrentTitle' | 'email.changeCurrentIntro'
  | 'email.twoFactorDisableSubject' | 'email.twoFactorDisableTitle' | 'email.twoFactorDisableIntro'
  | 'email.loginAlertDisableSubject' | 'email.loginAlertDisableTitle' | 'email.loginAlertDisableIntro'
  | 'email.changedSubject' | 'email.changedTitle' | 'email.changedIntro' | 'email.changedWarning'
  | 'server.textCategory' | 'server.textChannel' | 'server.voiceCategory' | 'server.voiceChannel';

const TEXT: Record<Locale, Record<TextKey, string>> = {
  'pt-BR': {
    'push.mentionChannelTitle': '{{name}} em #{{channel}} · {{server}}', 'push.mentionDirectTitle': '{{name}} mencionou você',
    'push.deletedRole': 'cargo-excluído',
    'push.serverInvitationTitle': 'Convite para {{server}}', 'push.serverInvitationBody': '{{name}} convidou você',
    'push.friendRequestTitle': '{{name}} enviou um pedido de amizade',
    'push.friendAcceptedTitle': '{{name}} aceitou seu pedido de amizade',
    'push.chatEmptyBody': '{{name}} enviou uma mensagem', 'push.chatEmptyBodyDirect': 'Enviou uma mensagem',
    'push.stickerBody': '{{name}} enviou uma figurinha', 'push.stickerBodyDirect': 'Enviou uma figurinha',
    'push.callInviteBody': '{{name}} chamou você para o canal de voz {{channel}} em {{server}}',
    'push.callInviteBodyDirect': 'Chamou você para o canal de voz {{channel}} em {{server}}',
    'push.dmCall': 'Iniciou uma chamada',
    'push.dmCallLasted': 'Iniciou uma chamada · {{duration}}',
    'push.callSecond_one': '{{count}} segundo', 'push.callSecond_other': '{{count}} segundos',
    'push.callMinute_one': '{{count}} minuto', 'push.callMinute_other': '{{count}} minutos',
    'push.callHour_one': '{{count}} hora', 'push.callHour_other': '{{count}} horas',
    'push.callHourMinute': '{{hours}} e {{minutes}}',
    'email.recoverySubject': 'Código para recuperar sua conta Linkord', 'email.changeSubject': 'Confirme seu novo e-mail no Linkord',
    'email.recoveryTitle': 'Recuperação de conta', 'email.changeTitle': 'Confirmação de e-mail',
    'email.recoveryIntro': 'Use este código para redefinir a senha da sua conta Linkord:', 'email.changeIntro': 'Use este código para confirmar o novo e-mail da sua conta Linkord:',
    'email.recoveryAccountLine': 'Esse código é para a conta de usuário "{{username}}", associada a este e-mail ({{email}}).',
    'email.expires': 'O código expira em 30 minutos. Se você não solicitou isso, ignore este e-mail.',
    'email.appLine': 'Você também pode acessar {{url}}.',
    'email.loginSubject': 'Seu código de login no Linkord', 'email.loginTitle': 'Verificação em duas etapas',
    'email.loginIntro': 'Alguém entrou com a senha da conta "{{username}}". Use este código para concluir o login:',
    'email.loginExpires': 'O código expira em 10 minutos. Se não foi você, troque sua senha agora: quem tentou entrar sabe a senha atual.',
    'email.twoFactorSetupSubject': 'Ative a verificação em duas etapas no Linkord', 'email.twoFactorSetupTitle': 'Verificação em duas etapas',
    'email.twoFactorSetupIntro': 'Use este código para ativar a verificação em duas etapas da sua conta Linkord:',
    'email.loginAlertSubject': 'Novo login na sua conta Linkord', 'email.loginAlertTitle': 'Novo login na sua conta',
    'email.loginAlertIntro': 'Um navegador que não usava sua conta "{{username}}" há um tempo acabou de entrar nela.',
    'email.loginAlertDevice': 'Navegador: {{device}}', 'email.loginAlertIp': 'Endereço IP: {{ip}}', 'email.loginAlertTime': 'Horário: {{time}}',
    'email.loginAlertAction': 'Se não foi você, encerre essa sessão e troque sua senha em Configurações → Segurança:',
    'email.loginAlertOptOut': 'Você pode desativar este aviso em Configurações → Segurança.',
    'email.deviceBrowserOn': '{{browser}} em {{os}}', 'email.deviceUnknownBrowserOn': 'Desconhecido no {{os}}',
    'email.deviceUnknown': 'Navegador desconhecido', 'email.deviceAutomated': 'Aplicativo ou script',
    'email.deletionCodeSubject': 'Confirme a exclusão da sua conta Linkord', 'email.deletionCodeTitle': 'Exclusão de conta',
    'email.deletionCodeIntro': 'Use este código para confirmar a exclusão da conta "{{username}}":',
    'email.deletionScheduledSubject': 'Sua conta Linkord será excluída', 'email.deletionScheduledTitle': 'Exclusão de conta agendada',
    'email.deletionScheduledIntro': 'A conta "{{username}}" será excluída em {{date}}, com seu perfil, amizades e arquivos. Os servidores que você criou passam para o membro mais antigo.',
    'email.deletionScheduledCancel': 'Mudou de ideia? Entre na sua conta antes dessa data e a exclusão é cancelada. Se não foi você, entre agora e troque sua senha.',
    'email.deletionDoneSubject': 'Sua conta Linkord foi excluída', 'email.deletionDoneTitle': 'Conta excluída',
    'email.deletionDoneIntro': 'A conta "{{username}}" foi excluída, como você pediu. Este é o último e-mail que enviamos para ela.',
    'email.exportReadySubject': 'Seus dados do Linkord estão prontos', 'email.exportReadyTitle': 'Cópia dos seus dados',
    'email.exportReadyIntro': 'A cópia dos dados da conta "{{username}}" que você pediu está pronta. Baixe-a com a conta conectada:',
    'email.exportReadyExpires': 'O link vale até {{date}}. Depois disso, peça uma nova cópia em Configurações → Dados e privacidade.',
    'email.changeCurrentSubject': 'Confirme a troca de e-mail da sua conta Linkord', 'email.changeCurrentTitle': 'Troca de e-mail',
    'email.changeCurrentIntro': 'Alguém pediu para trocar o e-mail da conta "{{username}}". Use este código para confirmar que foi você. Se não foi, troque sua senha agora:',
    'email.twoFactorDisableSubject': 'Confirme a desativação da verificação em duas etapas', 'email.twoFactorDisableTitle': 'Verificação em duas etapas',
    'email.twoFactorDisableIntro': 'Use este código para desativar a verificação em duas etapas da conta "{{username}}". Se não foi você, troque sua senha agora:',
    'email.loginAlertDisableSubject': 'Confirme a desativação dos avisos de login', 'email.loginAlertDisableTitle': 'Avisos de login',
    'email.loginAlertDisableIntro': 'Use este código para desativar os avisos de login da conta "{{username}}". Se não foi você, troque sua senha agora:',
    'email.changedSubject': 'O e-mail da sua conta Linkord foi trocado', 'email.changedTitle': 'E-mail trocado',
    'email.changedIntro': 'O e-mail da conta "{{username}}" agora é {{email}}. Este endereço não recebe mais códigos nem avisos dela.',
    'email.changedWarning': 'Se não foi você, entre em contato com o administrador do servidor o quanto antes.',
    'server.textCategory': 'Canais de texto', 'server.textChannel': 'geral',
    'server.voiceCategory': 'Canais de voz', 'server.voiceChannel': 'Geral',
  },
  'en-US': {
    'push.mentionChannelTitle': '{{name}} in #{{channel}} · {{server}}', 'push.mentionDirectTitle': '{{name}} mentioned you',
    'push.deletedRole': 'deleted-role',
    'push.serverInvitationTitle': 'Invitation to {{server}}', 'push.serverInvitationBody': '{{name}} invited you',
    'push.friendRequestTitle': '{{name}} sent you a friend request',
    'push.friendAcceptedTitle': '{{name}} accepted your friend request',
    'push.chatEmptyBody': '{{name}} sent a message', 'push.chatEmptyBodyDirect': 'Sent a message',
    'push.stickerBody': '{{name}} sent a sticker', 'push.stickerBodyDirect': 'Sent a sticker',
    'push.callInviteBody': '{{name}} invited you to the {{channel}} voice channel in {{server}}',
    'push.callInviteBodyDirect': 'Invited you to the {{channel}} voice channel in {{server}}',
    'push.dmCall': 'Started a call',
    'push.dmCallLasted': 'Started a call · {{duration}}',
    'push.callSecond_one': '{{count}} second', 'push.callSecond_other': '{{count}} seconds',
    'push.callMinute_one': '{{count}} minute', 'push.callMinute_other': '{{count}} minutes',
    'push.callHour_one': '{{count}} hour', 'push.callHour_other': '{{count}} hours',
    'push.callHourMinute': '{{hours}} and {{minutes}}',
    'email.recoverySubject': 'Your Linkord account recovery code', 'email.changeSubject': 'Confirm your new Linkord email',
    'email.recoveryTitle': 'Account recovery', 'email.changeTitle': 'Email confirmation',
    'email.recoveryIntro': 'Use this code to reset your Linkord account password:', 'email.changeIntro': 'Use this code to confirm your new Linkord account email:',
    'email.recoveryAccountLine': 'This code is for the user account "{{username}}", associated with this email ({{email}}).',
    'email.expires': 'The code expires in 30 minutes. If you did not request this, ignore this email.',
    'email.appLine': 'You can also open {{url}}.',
    'email.loginSubject': 'Your Linkord login code', 'email.loginTitle': 'Two-step verification',
    'email.loginIntro': 'Someone signed in with the password of the account "{{username}}". Use this code to finish signing in:',
    'email.loginExpires': 'The code expires in 10 minutes. If this was not you, change your password now: whoever tried to sign in knows the current one.',
    'email.twoFactorSetupSubject': 'Turn on two-step verification on Linkord', 'email.twoFactorSetupTitle': 'Two-step verification',
    'email.twoFactorSetupIntro': 'Use this code to turn on two-step verification for your Linkord account:',
    'email.loginAlertSubject': 'New sign-in to your Linkord account', 'email.loginAlertTitle': 'New sign-in to your account',
    'email.loginAlertIntro': 'A browser that has not used your account "{{username}}" for a while just signed in to it.',
    'email.loginAlertDevice': 'Browser: {{device}}', 'email.loginAlertIp': 'IP address: {{ip}}', 'email.loginAlertTime': 'Time: {{time}}',
    'email.loginAlertAction': 'If this was not you, end that session and change your password in Settings → Security:',
    'email.loginAlertOptOut': 'You can turn this alert off in Settings → Security.',
    'email.deviceBrowserOn': '{{browser}} on {{os}}', 'email.deviceUnknownBrowserOn': 'Unknown on {{os}}',
    'email.deviceUnknown': 'Unknown browser', 'email.deviceAutomated': 'App or script',
    'email.deletionCodeSubject': 'Confirm deleting your Linkord account', 'email.deletionCodeTitle': 'Account deletion',
    'email.deletionCodeIntro': 'Use this code to confirm deleting the account "{{username}}":',
    'email.deletionScheduledSubject': 'Your Linkord account will be deleted', 'email.deletionScheduledTitle': 'Account deletion scheduled',
    'email.deletionScheduledIntro': 'The account "{{username}}" will be deleted on {{date}}, with its profile, friends and files. The servers you created pass to their longest-standing member.',
    'email.deletionScheduledCancel': 'Changed your mind? Sign in to your account before that date and the deletion is cancelled. If this was not you, sign in now and change your password.',
    'email.deletionDoneSubject': 'Your Linkord account was deleted', 'email.deletionDoneTitle': 'Account deleted',
    'email.deletionDoneIntro': 'The account "{{username}}" was deleted, as you asked. This is the last email we send to it.',
    'email.exportReadySubject': 'Your Linkord data is ready', 'email.exportReadyTitle': 'A copy of your data',
    'email.exportReadyIntro': 'The copy of the data of the account "{{username}}" you asked for is ready. Download it while signed in to the account:',
    'email.exportReadyExpires': 'The link works until {{date}}. After that, ask for a new copy in Settings → Data & privacy.',
    'email.changeCurrentSubject': 'Confirm changing your Linkord email', 'email.changeCurrentTitle': 'Email change',
    'email.changeCurrentIntro': 'Someone asked to change the email of the account "{{username}}". Use this code to confirm it was you. If it was not, change your password now:',
    'email.twoFactorDisableSubject': 'Confirm turning off two-step login', 'email.twoFactorDisableTitle': 'Two-step login',
    'email.twoFactorDisableIntro': 'Use this code to turn off two-step login for the account "{{username}}". If it was not you, change your password now:',
    'email.loginAlertDisableSubject': 'Confirm turning off sign-in alerts', 'email.loginAlertDisableTitle': 'Sign-in alerts',
    'email.loginAlertDisableIntro': 'Use this code to turn off sign-in alerts for the account "{{username}}". If it was not you, change your password now:',
    'email.changedSubject': 'Your Linkord email was changed', 'email.changedTitle': 'Email changed',
    'email.changedIntro': 'The email of the account "{{username}}" is now {{email}}. This address no longer gets its codes or alerts.',
    'email.changedWarning': 'If this was not you, contact the server administrator as soon as possible.',
    'server.textCategory': 'Text Channels', 'server.textChannel': 'general',
    'server.voiceCategory': 'Voice Channels', 'server.voiceChannel': 'General',
  },
};

export function localeText(locale: Locale, key: TextKey, vars: Record<string, string | number> = {}): string {
  return Object.entries(vars).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), TEXT[locale][key]);
}
