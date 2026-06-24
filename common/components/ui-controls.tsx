import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    label: string;
    icon: ReactNode;
    destructive?: boolean;
    active?: boolean;
}

interface EmptyStateProps {
    title: string;
    description: string;
    actionLabel?: string | null;
    onAction?: () => void;
    actionDisabled?: boolean;
}

interface PanelHeaderProps {
    title: string;
    actions?: ReactNode;
}

const baseButtonClass =
    "inline-flex items-center justify-center rounded-md border border-transparent outline-none transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:text-base-content/40 disabled:hover:bg-transparent disabled:hover:text-base-content/40";

export function IconButton({
    label,
    icon,
    destructive = false,
    active = false,
    className,
    title,
    ...props
}: IconButtonProps) {
    const toneClass = destructive
        ? "text-error hover:bg-error/10 hover:text-error"
        : active
          ? "border-base-content/10 bg-base-content/10 text-base-content shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--color-base-content)_10%,transparent)]"
          : "text-base-content/70 hover:bg-[var(--mdx-control-hover-bg)] hover:text-base-content active:bg-[var(--mdx-control-active-bg)]";

    return (
        <button
            type="button"
            aria-label={label}
            title={title ?? label}
            className={[
                baseButtonClass,
                "h-7 min-w-7 px-1.5 text-xs leading-none",
                toneClass,
                className,
            ].filter(Boolean).join(" ")}
            {...props}
        >
            <span
                aria-hidden="true"
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0"
            >
                {icon}
            </span>
        </button>
    );
}

export function TextControlButton({
    className,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            type="button"
            className={[
                baseButtonClass,
                "h-7 min-w-0 max-w-full gap-1.5 whitespace-nowrap px-2.5 text-xs font-medium text-base-content/72 hover:bg-[var(--mdx-control-hover-bg)] hover:text-base-content active:bg-[var(--mdx-control-active-bg)] [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0",
                className,
            ].filter(Boolean).join(" ")}
            {...props}
        />
    );
}

export function PrimaryTextControlButton({
    className,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            type="button"
            className={[
                baseButtonClass,
                "h-8 min-w-0 max-w-full gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 text-xs font-medium text-primary-content shadow-sm hover:bg-primary/90 hover:text-primary-content disabled:bg-primary/30 disabled:text-primary-content/70 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0",
                className,
            ].filter(Boolean).join(" ")}
            {...props}
        />
    );
}

export function PanelHeader({ title, actions }: PanelHeaderProps) {
    return (
        <div className="flex h-10 min-w-0 items-center justify-between border-b border-base-content/10 bg-transparent px-3">
            <div className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.02em] text-base-content/55">
                {title}
            </div>
            {actions ? (
                <div className="flex shrink-0 items-center gap-1">
                    {actions}
                </div>
            ) : null}
        </div>
    );
}

export function EmptyState({
    title,
    description,
    actionLabel,
    onAction,
    actionDisabled,
}: EmptyStateProps) {
    return (
        <div className="mx-auto max-w-md px-6 text-center">
            <div className="text-sm font-semibold text-base-content">
                {title}
            </div>
            <div className="mt-2 text-sm leading-relaxed text-base-content/70">
                {description}
            </div>
            {actionLabel && onAction ? (
                <button
                    type="button"
                    className="mt-4 h-8 rounded-md border border-base-content bg-base-content px-3 text-sm font-medium text-base-100 outline-none transition-colors hover:bg-base-content/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:border-base-content/30 disabled:bg-base-content/30"
                    onClick={onAction}
                    disabled={actionDisabled}
                >
                    {actionLabel}
                </button>
            ) : null}
        </div>
    );
}
