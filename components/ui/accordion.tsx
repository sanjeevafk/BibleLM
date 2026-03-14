import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

const Accordion = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { type?: string }
>(({ className, type, ...props }, ref) => (
  <div ref={ref} className={className} {...props} />
));
Accordion.displayName = "Accordion";

const AccordionItem = React.forwardRef<
  HTMLDetailsElement,
  React.HTMLAttributes<HTMLDetailsElement> & { value?: string }
>(({ className, value, ...props }, ref) => (
  <details
    ref={ref}
    data-value={value}
    className={cn("group rounded-xl border bg-card px-3", className)}
    {...props}
  />
));
AccordionItem.displayName = "AccordionItem";

const AccordionTrigger = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<'summary'>
>(({ className, children, ...props }, ref) => (
  <summary
    ref={ref}
    className={cn(
      "flex w-full cursor-pointer list-none items-center justify-between gap-3 py-3 text-left text-sm font-semibold transition-all hover:text-primary [&::-webkit-details-marker]:hidden",
      className
    )}
    {...props}
  >
    {children}
    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
  </summary>
));
AccordionTrigger.displayName = "AccordionTrigger";

const AccordionContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("pb-4 pt-2 text-sm", className)} {...props}>
    {children}
  </div>
));
AccordionContent.displayName = "AccordionContent";

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
