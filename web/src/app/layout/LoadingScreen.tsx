export function LoadingScreen({ reconnecting = false, onRetry }: { reconnecting?: boolean; onRetry?: () => void }) {
  return (
    <div className="flex h-dvh items-center justify-center bg-bg-primary">
      <div className="flex flex-col items-center gap-5">
        <div className="flex flex-col items-center gap-3 select-none">
          <img src="/logo.svg" alt="" className="h-auto w-28 flex-none" />
          <span className="text-display font-bold tracking-tight text-text-primary">Linkord</span>
        </div>
        <div className="relative h-1 w-40 overflow-hidden rounded-full bg-bg-secondary">
          <div className="animate-sweep absolute inset-y-0 w-1/3 rounded-full bg-primary" />
        </div>
        {reconnecting && (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-label text-text-muted">Aguardando conexão com o servidor...</p>
            <button type="button" onClick={onRetry} className="min-h-11 rounded-lg border border-border-strong px-4 text-label font-medium text-text-primary hover:bg-bg-secondary">
              Tentar reconectar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
