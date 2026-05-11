import * as React from "react";
import { cn } from "@/src/lib/utils";
import { motion } from "motion/react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const variants = {
      default: "bg-teal-600 text-white hover:bg-teal-700 shadow-sm",
      outline: "border border-slate-200 bg-white hover:bg-slate-50 text-slate-900",
      ghost: "hover:bg-slate-50 text-slate-900",
      secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
      destructive: "bg-rose-500 text-white hover:bg-rose-600 shadow-sm",
    };

    const sizes = {
      default: "h-10 px-5 py-2",
      sm: "h-8 rounded-md px-3 text-xs",
      lg: "h-12 rounded-lg px-8 text-base",
      icon: "h-10 w-10",
    };

    return (
      <motion.button
        ref={ref}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200 disabled:pointer-events-none disabled:opacity-50",
          variants[variant as keyof typeof variants],
          sizes[size as keyof typeof sizes],
          className
        )}
        {...(props as any)}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
