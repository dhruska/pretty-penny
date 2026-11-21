import * as React from 'react';
import { cn } from 'cn';
import { Dialog as DialogPrimitive } from 'radix-ui';

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/**
 * Where the dialog sits: centered, as a panel rising from the bottom, filling the screen, or as
 * a menu sliding in from the left.
 */
type Placement = 'center' | 'bottom' | 'full' | 'left';

// Each placement fades and moves in from where it sits, briefly.
const PLACEMENT: Record<Placement, string> = {
  center:
    'top-1/2 left-1/2 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border sm:max-w-md max-h-[calc(100svh-2rem)] data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
  bottom:
    'inset-x-0 bottom-0 max-h-[85svh] rounded-t-xl border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
  full: 'inset-0 data-[state=open]:slide-in-from-bottom-8 data-[state=closed]:slide-out-to-bottom-8',
  left: 'inset-y-0 left-0 w-[85vw] max-w-80 border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
};

const MOTION =
  'duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0';

function DialogContent({
  className,
  placement = 'center',
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { placement?: Placement }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cn('fixed inset-0 z-50 bg-black/50', MOTION)} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed z-50 overflow-y-auto bg-background p-4 shadow-lg outline-hidden',
          MOTION,
          PLACEMENT[placement],
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** A dialog's title row, with a close button. */
function DialogHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description
          className={description ? 'text-sm text-muted-foreground' : 'sr-only'}
        >
          {description ?? title}
        </DialogPrimitive.Description>
      </div>
      <DialogPrimitive.Close
        aria-label="Close"
        className="-m-1 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-xl text-muted-foreground hover:bg-muted"
      >
        ×
      </DialogPrimitive.Close>
    </div>
  );
}

export { Dialog, DialogClose, DialogContent, DialogHeader, DialogTrigger };
