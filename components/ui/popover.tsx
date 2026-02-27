import * as React from "react";

import { cn } from "@/lib/utils";

type PopoverContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  contentRef: React.RefObject<HTMLDivElement>;
  triggerRef: React.RefObject<HTMLElement>;
};

const PopoverContext = React.createContext<PopoverContextValue | null>(null);

const Popover = ({ children }: { children: React.ReactNode }) => {
  const [open, setOpen] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (contentRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <PopoverContext.Provider value={{ open, setOpen, contentRef, triggerRef }}>
      <span className="relative inline-flex">{children}</span>
    </PopoverContext.Provider>
  );
};

type PopoverTriggerProps = React.HTMLAttributes<HTMLElement> & { asChild?: boolean };

const PopoverTrigger = ({ asChild, children, ...props }: PopoverTriggerProps) => {
  const ctx = React.useContext(PopoverContext);
  if (!ctx) return <>{children}</>;
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    props.onClick?.(event);
    ctx.setOpen(!ctx.open);
  };

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement, {
      onClick: handleClick,
      ref: ctx.triggerRef,
    });
  }

  return (
    <button type="button" onClick={handleClick} ref={ctx.triggerRef as React.RefObject<HTMLButtonElement>} {...props}>
      {children}
    </button>
  );
};

type PopoverContentProps = React.HTMLAttributes<HTMLDivElement> & {
  align?: "center" | "start" | "end";
  sideOffset?: number;
};

const PopoverContent = React.forwardRef<HTMLDivElement, PopoverContentProps>(
  ({ className, align = "center", sideOffset = 6, style, ...props }, ref) => {
    const ctx = React.useContext(PopoverContext);
    if (!ctx || !ctx.open) return null;
    const alignment =
      align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2";

    return (
      <div
        ref={(node) => {
          ctx.contentRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }}
        className={cn(
          "absolute top-full z-50 w-64 rounded-xl border bg-popover p-3 text-popover-foreground shadow-md outline-none",
          "animate-in fade-in-0 zoom-in-95",
          alignment,
          className
        )}
        style={{ marginTop: sideOffset, ...style }}
        {...props}
      />
    );
  }
);
PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverTrigger, PopoverContent };
