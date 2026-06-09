"use client";

interface RecoveryBannerProps {
    title: string;
    message: string;
    priority?: "normal" | "high";
    actions: Array<{
        label: string;
        onClick: () => void;
        destructive?: boolean;
        primary?: boolean;
        disabled?: boolean;
    }>;
}

export function RecoveryBanner({
    title,
    message,
    priority = "normal",
    actions,
}: RecoveryBannerProps) {
    return (
        <section
            className={[
                "flex w-full min-w-0 flex-col gap-3 border-b px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between",
                priority === "high"
                    ? "border-warning/40 bg-warning/10 text-base-content"
                    : "border-base-300 bg-base-200/70 text-base-content",
            ].join(" ")}
        >
            <div className="min-w-0 flex-1 break-words">
                <div className="font-semibold">{title}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-base-content/70">
                    {message}
                </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                {actions.map((action) => (
                    <button
                        key={action.label}
                        type="button"
                        disabled={action.disabled}
                        className={[
                            "h-8 max-w-full min-w-0 px-3 text-xs outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-45",
                            action.destructive
                                ? "text-error hover:bg-error/10"
                                : action.primary
                                  ? "bg-base-content text-base-100 hover:bg-base-content/85"
                                  : "text-base-content/75 hover:bg-base-100",
                        ].join(" ")}
                        onClick={action.onClick}
                    >
                        <span className="block max-w-full break-words text-left">
                            {action.label}
                        </span>
                    </button>
                ))}
            </div>
        </section>
    );
}
