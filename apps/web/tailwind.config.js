import tailwindcssAnimate from 'tailwindcss-animate'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background:  'oklch(var(--background) / <alpha-value>)',
        foreground:  'oklch(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT:    'oklch(var(--card) / <alpha-value>)',
          foreground: 'oklch(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT:    'oklch(var(--popover) / <alpha-value>)',
          foreground: 'oklch(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT:    'oklch(var(--primary) / <alpha-value>)',
          foreground: 'oklch(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT:    'oklch(var(--secondary) / <alpha-value>)',
          foreground: 'oklch(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT:    'oklch(var(--muted) / <alpha-value>)',
          foreground: 'oklch(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT:    'oklch(var(--accent) / <alpha-value>)',
          foreground: 'oklch(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT:    'oklch(var(--destructive) / <alpha-value>)',
          foreground: 'oklch(var(--destructive-foreground) / <alpha-value>)',
        },
        border: 'oklch(var(--border) / <alpha-value>)',
        input:  'oklch(var(--input) / <alpha-value>)',
        ring:   'oklch(var(--ring) / <alpha-value>)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm:      'var(--radius-sm)',
        md:      'var(--radius-md)',
        lg:      'var(--radius-lg)',
        xl:      'var(--radius-xl)',
      },
      // tailwindcss-animate reads transitionTimingFunction and exposes
      // ease-* utilities that set --tw-animate-easing (consumed by the
      // animate-in / animate-out keyframes). Naming the curves avoids
      // the JIT scanner bug where commas inside cubic-bezier() break
      // parsing when prefixed with a data-* variant (e.g. data-open:).
      transitionTimingFunction: {
        // Spring with ~5% overshoot — y1 = 1.56 > 1.0 causes the panel
        // to briefly overshoot its rest position before settling.
        // Approximates iOS UIKit spring / Framer Motion spring(300, 30).
        spring:     'cubic-bezier(0.22, 1, 0.36, 1)',
        // Expo-in exit — panel accelerates away cleanly.
        'sharp-out': 'cubic-bezier(0.55, 0, 1, 0.45)',
      },
    },
  },
  plugins: [
    // Enables data-open / data-closed animation utilities consumed by
    // Radix-based primitives (Sheet, Dialog, DropdownMenu). Without it
    // the utility classes resolve to no-ops and panels appear without
    // transition — see NN/G "Executing UX Animations: Duration and
    // Motion Characteristics" (nngroup.com/articles/animation-duration)
    // for why 200–300 ms with ease-out is the default for panels/drawers.
    tailwindcssAnimate,
  ],
}
