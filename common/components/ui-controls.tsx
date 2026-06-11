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
    "inline-flex items-center justify-center border border-transparent outline-none transition-colors focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-base-content/40 disabled:hover:bg-transparent";

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
        ? "text-error hover:bg-error/10"
        : active
          ? "bg-base-300 text-base-content"
          : "text-base-content/75 hover:bg-base-200 hover:text-base-content";

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
                "inline-flex h-7 min-w-0 max-w-full items-center gap-1 whitespace-nowrap px-2 text-xs text-base-content/75 hover:bg-base-200 hover:text-base-content [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0",
                className,
            ].filter(Boolean).join(" ")}
            {...props}
        />
    );
}

export function PanelHeader({ title, actions }: PanelHeaderProps) {
    return (
        <div className="flex h-10 min-w-0 items-center justify-between border-b border-base-300 px-3">
            <div className="min-w-0 truncate text-xs font-semibold text-base-content/75">
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
                    className="mt-4 h-8 border border-base-content bg-base-content px-3 text-sm text-base-100 outline-none transition-colors hover:bg-base-content/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:border-base-content/30 disabled:bg-base-content/30"
                    onClick={onAction}
                    disabled={actionDisabled}
                >
                    {actionLabel}
                </button>
            ) : null}
        </div>
    );
}
