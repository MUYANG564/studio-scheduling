import { type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "ghost" | "danger" | "subtle";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  outline: "border border-input bg-background hover:bg-accent",
  ghost: "hover:bg-accent",
  danger: "bg-destructive text-white hover:opacity-90",
  subtle: "bg-secondary text-secondary-foreground hover:opacity-80",
};

export function Button({
  variant = "primary", className, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition disabled:pointer-events-none disabled:opacity-50",
        variants[variant], className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm", className)}>{children}</div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
      {right}
    </div>
  );
}

type Tone = "green" | "amber" | "red" | "gray" | "blue";
const tones: Record<Tone, string> = {
  green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  gray: "bg-neutral-100 text-neutral-600",
  blue: "bg-blue-100 text-blue-700",
};
export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{children}</div>;
}
