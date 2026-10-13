import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// tailwind-merge only knows Tailwind's default font sizes; without this it
// reads the theme's `text-label` etc. as colours and drops them whenever a
// text colour class follows (a primary Button lost its size to
// `text-primary-foreground`). Keep in step with the --text-* tokens in index.css.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["micro", "caption", "label", "body", "title", "display"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
