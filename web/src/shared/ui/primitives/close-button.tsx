import { XIcon } from '@phosphor-icons/react';
import { forwardRef } from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/shared/lib/utils"
import { useTranslation } from 'react-i18next';

// The one close control of the app: a modal or panel, dismissing a notice, removing
// an item. `overlay` is for sitting on top of an image or banner, where a bare
// icon can vanish into the picture.
const closeButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full outline-none transition-colors select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        ghost: "text-text-secondary hover:text-text-primary",
        danger: "text-text-muted hover:bg-red/12 hover:text-red-text",
        surface: "rounded-lg border border-border-control bg-bg-control text-text-secondary shadow-popover hover:bg-bg-control-hover hover:text-text-primary",
      },
      size: {
        xs: "size-6",
        sm: "size-7",
        md: "size-8",
      },
    },
    defaultVariants: { variant: "ghost", size: "sm" },
  }
)

const ICON_SIZE = { xs: 13, sm: 16, md: 18 } as const

const CloseButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonPrimitive.Props, "children"> & VariantProps<typeof closeButtonVariants> & { label?: string }
>(function CloseButton({ className, variant = "ghost", size = "sm", label, ...props }, ref) {
  const { t } = useTranslation('common');
  return (
    <ButtonPrimitive
      ref={ref}
      data-slot="close-button"
      aria-label={label ?? t('page.close')}
      className={cn(closeButtonVariants({ variant, size }), className)}
      {...props}
    >
      <XIcon size={ICON_SIZE[size ?? "sm"]} aria-hidden />
    </ButtonPrimitive>
  )
})

export { CloseButton }
