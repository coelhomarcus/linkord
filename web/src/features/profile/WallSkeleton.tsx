import { Skeleton, SkeletonGroup } from '@/shared/ui/primitives/skeleton';
import { ANIME_ASPECT } from './CoverLink';

/** One widget card while the Wall loads: the frame, title row and cover grid of
 * a real card (WallWidgetCard), so the first widget lands where its shape was. */
function WidgetCardSkeleton() {
  return (
    <div className="flex w-full min-w-0 flex-col gap-4 rounded-xl border border-border-strong bg-bg-secondary p-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <Skeleton shape="text" className="h-4 w-32" />
        <Skeleton shape="circle" className="h-6 w-24" />
      </div>
      <div className="grid w-full grid-cols-4 gap-2">
        {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className={`${ANIME_ASPECT} w-full rounded-lg`} />)}
      </div>
    </div>
  );
}

export function WallSkeleton({ label, cards = 2 }: { label: string; cards?: number }) {
  return (
    <SkeletonGroup label={label} className="flex w-full min-w-0 flex-col gap-4">
      {Array.from({ length: cards }, (_, index) => <WidgetCardSkeleton key={index} />)}
    </SkeletonGroup>
  );
}
