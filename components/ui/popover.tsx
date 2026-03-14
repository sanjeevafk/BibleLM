import * as React from "react";

import { cn } from "@/lib/utils";

type PopoverTriggerChildProps = React.HTMLAttributes<HTMLElement> &
  React.RefAttributes<HTMLElement> & {
    role?: string;
    tabIndex?: number;
  };

type PopoverContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  setContentNode: (node: HTMLDivElement | null) => void;
};

const PopoverContext = React.createContext<PopoverContextValue | null>(null);

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (value: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(value);
      } else if (ref) {
        (ref as React.MutableRefObject<T | null>).current = value;
      }
    }
  };
}

const Popover = ({ children }: { children: React.ReactNode }) => {
  const [open, setOpen] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const setContentNode = React.useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node;
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (contentRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const value = React.useMemo(
    () => ({ open, setOpen, setContentNode }),
    [open, setContentNode]
  );

  return (
    <PopoverContext.Provider value={value}>
      <span className="relative inline-flex">{children}</span>
    </PopoverContext.Provider>
  );
};

type PopoverTriggerProps = React.HTMLAttributes<HTMLElement> & { asChild?: boolean };

const PopoverTrigger = ({ asChild, children, ...props }: PopoverTriggerProps) => {
  const ctx = React.useContext(PopoverContext);
  if (!ctx) return <>{children}</>;
  const { open, setOpen } = ctx;
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    props.onClick?.(event);
    setOpen(!open);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    props.onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(!open);
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  };

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<PopoverTriggerChildProps>;
    const childOnClick = child.props.onClick;
    const childOnKeyDown = child.props.onKeyDown;
    return React.cloneElement(child, {
      onClick: (event) => {
        childOnClick?.(event);
        if (event.defaultPrevented) return;
        handleClick(event);
      },
      onKeyDown: (event) => {
        childOnKeyDown?.(event);
        if (event.defaultPrevented) return;
        handleKeyDown(event);
      },
      role: child.props.role || "button",
      tabIndex: child.props.tabIndex ?? 0,
      "aria-haspopup": "dialog",
      "aria-expanded": open,
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-haspopup="dialog"
      aria-expanded={open}
      {...props}
    >
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
    const { setContentNode } = ctx;
    const alignment =
      align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2";

    return (
      <div
        role="dialog"
        aria-modal="false"
        ref={mergeRefs(ref, setContentNode)}
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
