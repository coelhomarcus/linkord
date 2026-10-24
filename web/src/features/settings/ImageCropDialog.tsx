import { CircleNotchIcon, MagnifyingGlassPlusIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Button } from '@/shared/ui/primitives/button';
import { Slider } from '@/shared/ui/primitives/slider';

interface ImageCropDialogProps {
  open: boolean;
  imageSrc: string | null;
  aspect: number;
  cropShape: 'round' | 'rect';
  title: string;
  processing?: boolean;
  error?: string | null;
  onCancel: () => void;
  // Just the crop rect — pixels are cut with ImageMagick WASM after confirm
  // (see cropProfileImage.ts) so animated GIFs/WebPs stay animated instead
  // of being flattened by a <canvas> round-trip.
  onConfirm: (crop: Area) => void;
}

export function ImageCropDialog({ open, imageSrc, aspect, cropShape, title, processing = false, error, onCancel, onConfirm }: ImageCropDialogProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  useEffect(() => {
    if (open) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
    }
  }, [open, imageSrc]);

  function handleSave() {
    if (!croppedAreaPixels) return;
    onConfirm(croppedAreaPixels);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !processing) onCancel(); }}>
      <DialogContent aria-busy={processing} className="relative max-h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-bg-modal p-0 sm:max-w-125">
        <DialogHeader className="px-6 pt-6 pr-12">
          <DialogTitle className="text-title font-semibold text-text-primary">{processing ? 'Processando imagem…' : title}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-4">
          {imageSrc && (
            <div className="relative h-80 w-full flex-none overflow-hidden rounded-md bg-black">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
                cropShape={cropShape}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_area, pixels) => setCroppedAreaPixels(pixels)}
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <MagnifyingGlassPlusIcon size={20} className="flex-none text-text-muted" />
            <Slider
              value={[zoom]}
              disabled={processing}
              onValueChange={(v) => setZoom(Array.isArray(v) ? (v[0] ?? 1) : (v as number))}
              min={1}
              max={3}
              step={0.01}
            />
          </div>
          {error && !processing && <p role="alert" className="text-label text-red">{error}</p>}
        </div>

        <DialogFooter className="border-border-subtle bg-bg-tertiary/60 px-6 py-4">
          <Button type="button" variant="ghost" disabled={processing} onClick={onCancel}>
            <span>Cancelar</span>
          </Button>
          <Button type="button" disabled={processing || !croppedAreaPixels} onClick={handleSave}>
            <span>Salvar</span>
          </Button>
        </DialogFooter>

        {processing && (
          <div role="status" aria-live="polite" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg-modal/95 px-8 text-center">
            <CircleNotchIcon size={28} className="animate-spin text-primary" />
            <div className="space-y-1">
              <p className="text-title font-semibold text-text-primary">Processando imagem…</p>
              <DialogDescription>Preparando a imagem para o upload. GIFs animados podem levar alguns segundos.</DialogDescription>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
