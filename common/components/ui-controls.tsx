import type {
    ButtonHTMLAttributes,
    InputHTMLAttributes,
    ReactNode,
    TextareaHTMLAttributes,
} from "react";

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
    "inline-flex items-center justify-center rounded-[var(--mdx-control-radius)] border border-transparent outline-none transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:text-base-content/40 disabled:hover:bg-transparent disabled:hover:text-base-content/40";

export function IconButton({
    label,
    icon,
    destructive = false,
    active = false,
    className,
    title,
    ...props
}: IconButtonProps) {
    // A destructive action rests in the same neutral tone as its neighbours and
    // turns red under the pointer. Colouring it red at rest makes the toolbar
    // shout a warning nobody asked for, and it is the single most eye-catching
    // thing in a window whose subject is the document.
    const toneClass = destructive
        ? "text-base-content/70 hover:bg-error/10 hover:text-error active:bg-error/15"
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

/**
 * One control with several positions, drawn the way macOS draws one: a recessed
 * track with a raised slice on the current segment.
 *
 * Shared because it was written five separate times — the right panel, the
 * memory provider, the storage backend, the API mode, the wiki tabs — and every
 * copy had drifted. Each drew its own square boxes with their own borders,
 * which reads as several adjacent buttons rather than one control with a
 * position, and no two agreed on radius or weight. One definition is what makes
 * "the same control" true rather than a coincidence that has to be maintained.
 */
export function SegmentedControl<Value extends string>({
    value,
    options,
    onChange,
    disabled = false,
    label,
    variant = "control",
    fill = false,
    className,
}: {
    value: Value;
    options: ReadonlyArray<{
        value: Value;
        label: string;
        /** Selectable but not right now — a backend with no configuration yet. */
        disabled?: boolean;
    }>;
    onChange: (value: Value) => void;
    disabled?: boolean;
    /** Names the group for assistive technology when there is no visible label. */
    label?: string;
    /**
     * What the segments mean, which decides the semantics but not the drawing.
     *
     * `control` picks a value — a provider, a storage backend — and is a group
     * of pressable buttons. `tabs` picks which panel is shown, which is a
     * tablist. They look identical on purpose and are announced differently on
     * purpose: a screen reader user needs to know whether they just changed a
     * setting or moved to another view.
     */
    variant?: "control" | "tabs";
    /**
     * Whether the control stretches to its container.
     *
     * Off by default, because a control is as wide as its labels need — the
     * alternative put three two-character labels across seven hundred pixels
     * and called the result a tab bar. Turn it on where the segments are meant
     * to line up with something else, such as fields in a form.
     */
    fill?: boolean;
    className?: string;
}) {
    const isTabs = variant === "tabs";
    return (
        <div
            role={isTabs ? "tablist" : "group"}
            aria-label={label}
            className={[
                `${fill ? "flex" : "inline-flex"} gap-0.5 ${radiusClass} bg-[var(--mdx-track-bg)] p-0.5`,
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {options.map((option) => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role={isTabs ? "tab" : undefined}
                        aria-selected={isTabs ? selected : undefined}
                        aria-pressed={isTabs ? undefined : selected}
                        disabled={disabled || option.disabled}
                        className={[
                            `h-7 min-w-0 truncate rounded px-2.5 text-xs ${fill ? "flex-1" : ""}`,
                            " outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:text-base-content/35",
                            selected
                                ? "bg-base-100 text-base-content shadow-[var(--mdx-raised-shadow)]"
                                : "text-base-content/55 hover:text-base-content/80",
                        ].join(" ")}
                        onClick={() => onChange(option.value)}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
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

/**
 * The shared shapes for fields and grouped information.
 *
 * These exist because the same Tailwind strings were being written out by hand
 * wherever they were needed — one card pattern appeared eleven times, an input
 * pattern half a dozen — and no two copies had stayed identical. Radii, focus
 * rings and border weights had all drifted apart, which is what makes an
 * interface look assembled rather than designed.
 *
 * The point is not brevity. It is that "the same kind of thing looks the same"
 * becomes a fact about the code rather than something each new screen has to
 * remember.
 */

/** The focus treatment every field and pressable surface shares. */
const focusRingClass =
    "outline-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20";

/** Shape and weight come from the variables; only structure lives here. */
const radiusClass = "rounded-[var(--mdx-control-radius)]";

const fieldClass = `w-full min-w-0 ${radiusClass} border border-[var(--mdx-field-border)] bg-base-100 text-base-content placeholder:text-base-content/45 focus:border-[var(--mdx-field-border-focus)] disabled:cursor-not-allowed disabled:bg-base-200/60 disabled:text-base-content/40 ${focusRingClass}`;

/** A single-line field. */
export function TextInput({
    className,
    ...props
}: InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            className={[fieldClass, "h-8 px-2.5 text-sm", className]
                .filter(Boolean)
                .join(" ")}
            {...props}
        />
    );
}

/** A multi-line field. Grows by drag, not by content. */
export function TextArea({
    className,
    ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return (
        <textarea
            className={[fieldClass, "resize-y p-2.5 text-sm", className]
                .filter(Boolean)
                .join(" ")}
            {...props}
        />
    );
}

/**
 * A group of related facts, set off from the text around it.
 *
 * Tinted rather than outlined: a border around every group draws far more lines
 * than there are groupings, which is most of what made these panels look busy.
 */
export function Card({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={[
                `${radiusClass} bg-[var(--mdx-card-bg)] p-2.5`,
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {children}
        </div>
    );
}

/**
 * Preformatted output — a log, a report, a diagnostic dump.
 *
 * Scrolls inside itself, so a long log cannot stretch the panel holding it.
 */
export function LogBlock({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <pre
            className={[
                `max-h-72 overflow-auto whitespace-pre-wrap ${radiusClass} bg-[var(--mdx-card-bg)] p-2.5 font-sans text-xs leading-relaxed text-base-content/75`,
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {children}
        </pre>
    );
}
