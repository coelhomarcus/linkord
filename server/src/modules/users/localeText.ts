import type { Locale } from './locale.js';

type TextKey =
  | 'push.mentionChannelTitle' | 'push.mentionDirectTitle' | 'push.serverInvitationTitle' | 'push.serverInvitationBody'
  | 'push.friendRequestTitle' | 'push.friendAcceptedTitle'
  | 'push.chatEmptyBody' | 'push.chatEmptyBodyDirect' | 'push.callInviteBody' | 'push.callInviteBodyDirect'
  | 'push.dmCall' | 'push.dmCallLasted'
  | 'push.callSecond_one' | 'push.callSecond_other' | 'push.callMinute_one' | 'push.callMinute_other'
  | 'push.callHour_one' | 'push.callHour_other' | 'push.callHourMinute'
  | 'email.recoverySubject' | 'email.changeSubject' | 'email.recoveryTitle' | 'email.changeTitle'
  | 'email.recoveryIntro' | 'email.changeIntro' | 'email.recoveryAccountLine' | 'email.expires'
  | 'server.textCategory' | 'server.textChannel' | 'server.voiceCategory' | 'server.voiceChannel';

const TEXT: Record<Locale, Record<TextKey, string>> = {
  'pt-BR': {
    'push.mentionChannelTitle': '{{name}} em #{{channel}} · {{server}}', 'push.mentionDirectTitle': '{{name}} mencionou você',
    'push.serverInvitationTitle': 'Convite para {{server}}', 'push.serverInvitationBody': '{{name}} convidou você',
    'push.friendRequestTitle': '{{name}} enviou um pedido de amizade',
    'push.friendAcceptedTitle': '{{name}} aceitou seu pedido de amizade',
    'push.chatEmptyBody': '{{name}} enviou uma mensagem', 'push.chatEmptyBodyDirect': 'Enviou uma mensagem',
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
    'server.textCategory': 'Canais de texto', 'server.textChannel': 'geral',
    'server.voiceCategory': 'Canais de voz', 'server.voiceChannel': 'Geral',
  },
  'en-US': {
    'push.mentionChannelTitle': '{{name}} in #{{channel}} · {{server}}', 'push.mentionDirectTitle': '{{name}} mentioned you',
    'push.serverInvitationTitle': 'Invitation to {{server}}', 'push.serverInvitationBody': '{{name}} invited you',
    'push.friendRequestTitle': '{{name}} sent you a friend request',
    'push.friendAcceptedTitle': '{{name}} accepted your friend request',
    'push.chatEmptyBody': '{{name}} sent a message', 'push.chatEmptyBodyDirect': 'Sent a message',
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
    'server.textCategory': 'Text Channels', 'server.textChannel': 'general',
    'server.voiceCategory': 'Voice Channels', 'server.voiceChannel': 'General',
  },
};

export function localeText(locale: Locale, key: TextKey, vars: Record<string, string | number> = {}): string {
  return Object.entries(vars).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), TEXT[locale][key]);
}
