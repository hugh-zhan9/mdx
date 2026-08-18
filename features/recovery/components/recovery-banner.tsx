"use client";

import {
    PrimaryTextControlButton,
    TextControlButton,
} from "../../../common/components/ui-controls";

interface RecoveryBannerProps {
    title: string;
    message: string;
    /**
     * The file the banner is about, kept out of the sentence.
     *
     * An absolute path inlined into prose wraps mid-word and turns a one-line
     * notice into four lines of gibberish. On its own line it can be truncated
     * with the whole path still available on hover.
     */
    path?: string | null;
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
    path,
    priority = "normal",
    actions,
}: RecoveryBannerProps) {
    // The primary action sits last, where the diff dialog and every other
    // confirmation in the app put it. The same decision offered in two places
    // used to be offered in two orders.
    const orderedActions = [
        ...actions.filter((action) => !action.primary),
        ...actions.filter((action) => action.primary),
    ];

    return (
        <section
            className={[
                "flex w-full min-w-0 flex-col gap-3 border-b px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between",
                priority === "high"
                    ? "border-warning/40 bg-warning/10 text-base-content"
                    : "border-[var(--mdx-separator)] bg-base-200/70 text-base-content",
            ].join(" ")}
        >
            <div className="min-w-0 flex-1">
                <div className="font-semibold">{title}</div>
                {path ? (
                    <div
                        className="mt-0.5 truncate font-mono text-xs text-base-content/55"
                        title={path}
                    >
                        {path}
                    </div>
                ) : null}
                <div className="mt-0.5 break-words text-xs leading-relaxed text-base-content/70">
                    {message}
                </div>
            </div>
            <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                {orderedActions.map((action) =>
                    action.primary ? (
                        <PrimaryTextControlButton
                            key={action.label}
                            disabled={action.disabled}
                            onClick={action.onClick}
                        >
                            {action.label}
                        </PrimaryTextControlButton>
                    ) : (
                        <TextControlButton
                            key={action.label}
                            disabled={action.disabled}
                            onClick={action.onClick}
                            className={
                                action.destructive
                                    ? "hover:bg-error/10 hover:text-error active:bg-error/15"
                                    : undefined
                            }
                        >
                            {action.label}
                        </TextControlButton>
                    ),
                )}
            </div>
        </section>
    );
}
