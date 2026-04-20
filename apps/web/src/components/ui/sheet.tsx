import * as React from "react"
import { Dialog as SheetPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(function SheetOverlay({ className, ...props }, ref) {
  return (
    <SheetPrimitive.Overlay
      ref={ref}
      data-slot="sheet-overlay"
      // 280 ms fade matches the panel slide-in duration below. Sits
      // inside NN/G's 200–300 ms recommendation for panel transitions
      // (nngroup.com/articles/animation-duration). Asymmetric easing —
      // ease-out on open, ease-in on close — makes the backdrop feel
      // like it's "arriving" vs "leaving" rather than a linear blend.
      className={cn(
        "fixed inset-0 z-50 bg-black/40",
        "motion-reduce:duration-0",
        // Overlay fade: entra suave (240ms), sale más rápido (180ms).
        // No necesita spring — es un elemento de fondo, no interactivo.
        "data-[state=open]:animate-in  data-[state=open]:fade-in-0  data-[state=open]:duration-[240ms]  data-[state=open]:ease-out",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-[180ms] data-[state=closed]:ease-in",
        className
      )}
      {...props}
    />
  )
})

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> & {
    side?: "top" | "right" | "bottom" | "left"
    showCloseButton?: boolean
  }
>(function SheetContent({ className, children, side = "right", showCloseButton = true, ...props }, ref) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          // Base positioning per side.
          "fixed z-50 flex flex-col gap-4 bg-white text-sm text-slate-900",
          "data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t",
          "data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:sm:max-w-sm",
          "data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:sm:max-w-sm",
          "data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b",
          // Motion — spring physics para entrada, salida rápida asimétrica.
          //
          // OPEN  (360 ms): cubic-bezier(0.34, 1.56, 0.64, 1)
          //   y1 = 1.56 > 1.0 → overshoot del ~5%: el panel llega hasta su
          //   posición final y la sobrepasa levemente antes de asentarse.
          //   Es la aproximación CSS del spring de Framer Motion / iOS UIKit.
          //   Fuentes: Framer docs "spring stiffness:300 damping:30",
          //   Apple HIG "Use spring animations for elements entering the screen".
          //
          // CLOSE (220 ms): cubic-bezier(0.4, 0, 0.8, 0.4)
          //   Sale con aceleración inicial brusca — se "va rápido".
          //   Asimetría open/close recomendada por NN/G y Material Design 3:
          //   la salida es siempre ~40% más corta que la entrada.
          //
          // SCALE: empieza en 0.97 y crece a 1.0 al abrir (y viceversa).
          //   Añade una dimensión sutil — el panel parece "emerger hacia el
          //   usuario" en vez de simplemente deslizarse.
          //
          // motion-reduce: duración 0 para accesibilidad (epilepsia/vértigo).
          "motion-reduce:duration-0",
          // Timing via CSS vars (--ease-spring / --ease-sharp-out en index.css).
          // Radix setea data-state="open/closed", NO data-open/data-closed —
          // por eso se usa data-[state=open]: (selector explícito) en lugar
          // de data-open: (que esperaría un atributo [data-open] distinto).
          "data-[state=open]:animate-in  data-[state=open]:duration-[380ms] data-[state=open]:[animation-timing-function:var(--ease-spring)]",
          "data-[state=closed]:animate-out data-[state=closed]:duration-[220ms] data-[state=closed]:[animation-timing-function:var(--ease-sharp-out)]",
          // Arbitrary CSS variables drive the translate — keeps the
          // slide amount at 100% of the panel regardless of the
          // viewport-dependent width (w-3/4 on phones, max-w-sm on
          // desktop). tailwindcss-animate consumes --tw-enter-* and
          // --tw-exit-* vars through its `animate-in` / `animate-out`
          // keyframes.
          "data-[side=left]:data-[state=open]:[--tw-enter-translate-x:-100%]",
          "data-[side=left]:data-[state=closed]:[--tw-exit-translate-x:-100%]",
          "data-[side=right]:data-[state=open]:[--tw-enter-translate-x:100%]",
          "data-[side=right]:data-[state=closed]:[--tw-exit-translate-x:100%]",
          "data-[side=top]:data-[state=open]:[--tw-enter-translate-y:-100%]",
          "data-[side=top]:data-[state=closed]:[--tw-exit-translate-y:-100%]",
          "data-[side=bottom]:data-[state=open]:[--tw-enter-translate-y:100%]",
          "data-[side=bottom]:data-[state=closed]:[--tw-exit-translate-y:100%]",
          // Soft drop shadows on each side for depth perception.
          "data-[side=left]:shadow-[20px_0_60px_rgba(0,0,0,0.18),_4px_0_16px_rgba(0,0,0,0.08)]",
          "data-[side=right]:shadow-[-20px_0_60px_rgba(0,0,0,0.18),_-4px_0_16px_rgba(0,0,0,0.08)]",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-3 right-3"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
})

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
