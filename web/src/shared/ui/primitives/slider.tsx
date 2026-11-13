import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/shared/lib/utils"

/** One thumb per value. A plain number (or nothing) is one thumb, never two
 * at min and max, which would render a range out of a single volume. */
function thumbCount(value: SliderPrimitive.Root.Props["value"], defaultValue: SliderPrimitive.Root.Props["defaultValue"]): number {
  const current = value ?? defaultValue
  return Array.isArray(current) ? current.length : 1
}

/**
 * `thumbAlignment="edge"` keeps the thumb inside the track at 0 % and 100 %,
 * and Base UI then sizes the indicator to the thumb's centre (it measures the
 * thumb), so the fill always ends under the middle of the thumb.
 *
 * The control is only as tall as the 4 px track. Its ::before adds 8 px of hit
 * area on each side without moving the layout (20 px with a mouse); under a
 * finger the control also takes real padding, 36 px of layout and 52 px to
 * hit, past the 44 px minimum of iOS and Android. Padding rather than a bigger
 * ::before, so the hit area never reaches into a menu item above or below
 * (the ::before stays inside the 8 px every call site leaves around it). The
 * thumb grows on touch too, with a 44 px circle of its own to grab.
 */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  size = "default",
  "aria-label": ariaLabel,
  "aria-valuetext": ariaValueText,
  ...props
}: SliderPrimitive.Root.Props & {
  /** `sm` for media players' compact controls */
  size?: "default" | "sm"
}) {
  return (
    <SliderPrimitive.Root
      className={cn(
        "data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full",
        className
      )}
      data-slot="slider"
      data-size={size}
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control
        className={cn(
          "relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
          "before:absolute before:content-[''] data-[orientation=horizontal]:before:inset-x-0 data-[orientation=horizontal]:before:-inset-y-2 data-[orientation=vertical]:before:inset-y-0 data-[orientation=vertical]:before:-inset-x-2",
          "pointer-coarse:data-[orientation=horizontal]:py-4 pointer-coarse:data-[orientation=vertical]:px-4"
        )}
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-muted select-none data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary select-none data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: thumbCount(value, defaultValue) }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            getAriaLabel={ariaLabel ? () => ariaLabel : undefined}
            aria-valuetext={ariaValueText}
            className={cn(
              "relative block shrink-0 rounded-full border border-ring bg-white ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:content-[''] hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50",
              size === "sm"
                ? "size-2.5 after:-inset-2 pointer-coarse:size-4 pointer-coarse:after:-inset-3.5"
                : "size-3 after:-inset-2 pointer-coarse:size-5 pointer-coarse:after:-inset-3"
            )}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
