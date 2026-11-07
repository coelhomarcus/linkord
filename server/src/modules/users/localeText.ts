import type { Locale } from './locale.js';

type TextKey =
  | 'push.mentionedTitle' | 'push.mentionedBody' | 'push.serverInvitationTitle' | 'push.serverInvitationBody'
  | 'push.friendRequestTitle' | 'push.friendRequestBody' | 'push.friendAcceptedTitle' | 'push.friendAcceptedBody'
  | 'push.chatEmptyBody' | 'push.chatSentBody_one' | 'push.chatSentBody_other' | 'push.callInviteBody'
  | 'push.dmCall' | 'push.dmCallLasted'
  | 'push.callSecond_one' | 'push.callSecond_other' | 'push.callMinute_one' | 'push.callMinute_other'
  | 'push.callHour_one' | 'push.callHour_other' | 'push.callHourMinute'
  | 'email.recoverySubject' | 'email.changeSubject' | 'email.recoveryTitle' | 'email.changeTitle'
  | 'email.recoveryIntro' | 'email.changeIntro' | 'email.recoveryAccountLine' | 'email.expires'
  | 'server.textCategory' | 'server.textChannel' | 'server.voiceCategory' | 'server.voiceChannel';

const TEXT: Record<Locale, Record<TextKey, string>> = {
  'pt-BR': {
    'push.mentionedTitle': 'Você foi mencionado', 'push.mentionedBody': 'Abra a conversa para ver a mensagem.',
    'push.serverInvitationTitle': 'Convite para servidor', 'push.serverInvitationBody': 'Você recebeu um convite no Linkord.',
    'push.friendRequestTitle': 'Solicitação de amizade', 'push.friendRequestBody': 'Você recebeu uma solicitação no Linkord.',
    'push.friendAcceptedTitle': 'Solicitação aceita', 'push.friendAcceptedBody': 'Uma pessoa aceitou sua solicitação.',
    'push.chatEmptyBody': '{{name}} enviou uma mensagem', 'push.chatSentBody_one': '{{name}} enviou {{count}} mensagem', 'push.chatSentBody_other': '{{name}} enviou {{count}} mensagens',
    'push.callInviteBody': '{{name}} chamou você para o canal de voz {{channel}} em {{server}}',
    'push.dmCall': '{{name}} iniciou uma chamada.',
    'push.dmCallLasted': '{{name}} iniciou uma chamada que durou {{duration}}.',
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
    'push.mentionedTitle': 'You were mentioned', 'push.mentionedBody': 'Open the conversation to see the message.',
    'push.serverInvitationTitle': 'Server invitation', 'push.serverInvitationBody': 'You received an invitation on Linkord.',
    'push.friendRequestTitle': 'Friend request', 'push.friendRequestBody': 'You received a friend request on Linkord.',
    'push.friendAcceptedTitle': 'Request accepted', 'push.friendAcceptedBody': 'Someone accepted your friend request.',
    'push.chatEmptyBody': '{{name}} sent a message', 'push.chatSentBody_one': '{{name}} sent {{count}} message', 'push.chatSentBody_other': '{{name}} sent {{count}} messages',
    'push.callInviteBody': '{{name}} invited you to the {{channel}} voice channel in {{server}}',
    'push.dmCall': '{{name}} started a call.',
    'push.dmCallLasted': '{{name}} started a call that lasted {{duration}}.',
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
