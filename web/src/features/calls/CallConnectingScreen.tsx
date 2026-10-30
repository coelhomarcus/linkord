import { ArrowLeftIcon, PhoneIcon } from '@phosphor-icons/react';
import { Button } from '@/shared/ui/primitives/button';

export function CallConnectingScreen({ onCancel }: { onCancel: () => void }) {
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-bg-call text-text-primary">
      <div className="flex h-header items-center px-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} aria-label="Cancelar entrada na chamada">
          <ArrowLeftIcon size={18} /> Voltar
        </Button>
      </div>
      <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <PhoneIcon size={36} className="animate-pulse text-green" aria-hidden />
        <p className="text-title font-semibold">Conectando à chamada…</p>
        <p className="text-label text-text-muted">Aguarde a confirmação da conexão.</p>
      </div>
    </main>
  );
}
