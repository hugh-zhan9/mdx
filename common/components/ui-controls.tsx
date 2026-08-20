import { Search } from "lucide-react";
import { Fragment, useEffect } from "react";
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
        /**
         * Why it cannot be chosen, for the segments that are disabled.
         *
         * A greyed segment with nothing to explain it reads as a broken
         * control, and the user's next move is to click it again harder.
         */
        title?: string;
        /**
         * Drawn instead of the label, which becomes the accessible name.
         *
         * For a control that sits in a row of icon buttons: two words among
         * six icons reads as two different kinds of control rather than one
         * toolbar. The words are still there for a screen reader and for the
         * tooltip — they are just not painted.
         */
        icon?: ReactNode;
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
                        aria-label={option.icon ? option.label : undefined}
                        title={option.title ?? (option.icon ? option.label : undefined)}
                        className={[
                            `flex h-7 min-w-0 items-center justify-center truncate rounded text-xs ${option.icon ? "px-2" : "px-2.5"} ${fill ? "flex-1" : ""}`,
                            " outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:text-base-content/35",
                            selected
                                ? "bg-base-100 text-base-content shadow-[var(--mdx-raised-shadow)]"
                                : "text-base-content/55 hover:text-base-content/80",
                        ].join(" ")}
                        onClick={() => onChange(option.value)}
                    >
                        {option.icon ? (
                            <span
                                aria-hidden="true"
                                className="inline-flex h-4 w-4 items-center justify-center [&>svg]:h-4 [&>svg]:w-4"
                            >
                                {option.icon}
                            </span>
                        ) : (
                            option.label
                        )}
                    </button>
                );
            })}
        </div>
    );
}

export function TextControlButton({
    outlined = false,
    className,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    /**
     * Drawn with an edge at rest.
     *
     * For a form's submit. A row action can be borderless — it is beside the thing
     * it acts on, and the row explains it — but the button that sends a form has
     * nothing beside it, and with no edge at all it reads as a caption in the
     * corner rather than as the control that submits.
     */
    outlined?: boolean;
}) {
    return (
        <button
            type="button"
            className={[
                baseButtonClass,
                "h-7 min-w-0 max-w-full gap-1.5 whitespace-nowrap px-2.5 text-xs font-medium text-base-content/72 hover:bg-[var(--mdx-control-hover-bg)] hover:text-base-content active:bg-[var(--mdx-control-active-bg)] [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0",
                outlined
                    // An inset ring rather than a border, because the shared base
                    // class already sets `border-transparent` and which of the two
                    // wins depends on the order Tailwind emits them, not on the order
                    // they are written here. Same technique as IconButton's pressed
                    // edge. A shade stronger than a text field's 12%: a field is a
                    // large rectangle, a 28px button at that value reads as no edge.
                    ? "bg-base-100 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-base-content)_20%,transparent)]"
                    : undefined,
                className,
            ].filter(Boolean).join(" ")}
            {...props}
        />
    );
}

export function PrimaryTextControlButton({
    destructive = false,
    className,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    /**
     * The action throws something away.
     *
     * Still the primary button — it is what is being asked for — but red, so the
     * one confirmation that cannot be undone does not look like every other
     * confirmation.
     */
    destructive?: boolean;
}) {
    return (
        <button
            type="button"
            className={[
                baseButtonClass,
                "h-8 min-w-0 max-w-full gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-medium shadow-sm [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0",
                destructive
                    ? "bg-error text-error-content hover:bg-error/90 hover:text-error-content disabled:bg-error/30 disabled:text-error-content/70"
                    : "bg-primary text-primary-content hover:bg-primary/90 hover:text-primary-content disabled:bg-primary/30 disabled:text-primary-content/70",
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
/**
 * A filter field, drawn the way macOS draws a search box: filled and
 * borderless.
 *
 * Shared because it had been written twice — the file tree's filter and the note
 * list's — and an outlined white box on a tinted column reads as a form control
 * borrowed from a web page rather than part of a sidebar.
 */
export function SearchField({
    value,
    onChange,
    placeholder,
    label,
    className,
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    /** The accessible name, since the placeholder is not one. */
    label: string;
    className?: string;
}) {
    return (
        <label
            className={[
                "flex min-w-0 items-center gap-2 rounded-[var(--mdx-control-radius)] bg-base-content/6 px-2.5 transition-colors focus-within:bg-base-content/9 focus-within:ring-2 focus-within:ring-primary/25",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            <Search
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-base-content/55"
            />
            <input
                type="search"
                className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-xs text-base-content outline-none transition-colors placeholder:text-base-content/65 focus:outline-none"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                aria-label={label}
            />
        </label>
    );
}

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

/**
 * A value chosen by dragging, for a setting whose right answer is found by eye.
 *
 * Here rather than in the feature that wanted it, per the rule that a new kind
 * of control is added once: the browser's own range input comes with its own
 * focus ring, and left in place it would have been the only control in the
 * application not using `focus-visible:ring-2 focus-visible:ring-primary/20`.
 *
 * The track and thumb are the platform's — `accent-color` is enough to put them
 * in the theme's palette, and a hand-drawn track would be a worse version of one
 * macOS already draws well.
 */
export function Slider({
    className,
    ...props
}: InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            type="range"
            className={[
                "w-full min-w-0 cursor-pointer accent-[var(--color-primary)] disabled:cursor-not-allowed disabled:accent-[var(--color-base-300)]",
                radiusClass,
                focusRingClass,
                className,
            ]
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
 * The type scale these panels are allowed to use.
 *
 * Four steps, in the proportions a document has rather than a form's: a heading at
 * 20px, prose at 13.5px with the line height that makes it readable rather than
 * merely fitted, the sentence that qualifies a heading at 13px, and provenance at
 * 11.5px. Anything else is a fifth size, and a fifth size is how a panel stops
 * looking designed.
 *
 * The panels used 10, 11, 12, 13 and 14px with no order among them, and they read
 * as forms: everything at one size, nothing to look at first. This is the editor's
 * own voice — the best surface in the app — applied to the panels beside it.
 */
const TITLE =
    "text-[20px] font-[650] leading-[1.3] tracking-[-0.01em] text-base-content";
const BODY = "text-[13.5px] leading-[1.75] text-base-content/85";
const HINT = "text-[13px] leading-[1.6] text-base-content/50";
const META = "text-[11.5px] leading-relaxed text-base-content/45";

/**
 * The horizontal room a panel's content keeps.
 *
 * Wide, and wider on a wide window: the whole point of the editorial direction is
 * that text has margins. Clamped so a narrow window does not spend half itself on
 * whitespace.
 */
export const PANEL_GUTTER = "px-[clamp(14px,2.1vw,24px)]";
const GUTTER = PANEL_GUTTER;

/**
 * How wide a line of text is allowed to get.
 *
 * Never a margin: it caps a paragraph inside whatever room it has, so a page can
 * use the whole window while its sentences stay readable. A page-wide cap — which
 * is what this replaced — centres the entire view and leaves dead bands down both
 * sides of a wide window, which is a different thing and looks like a mistake.
 */
const PROSE = "max-w-[68ch]";

/** A heading in the page's own voice, for the places that are not a section. */
export function PanelTitle({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <h2 className={[TITLE, className].filter(Boolean).join(" ")}>
            {children}
        </h2>
    );
}

/**
 * One occasion's worth of controls, under a heading that says which occasion.
 *
 * The heading and its explanation are one component because they were never
 * written the same way twice: a `div` with a font weight here, an `h3` with a
 * different grey there, and hints that sometimes sat above the heading they
 * qualified.
 */
export function PanelSection({
    title,
    hint,
    actions,
    children,
    className,
}: {
    title: string;
    hint?: string;
    actions?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section
            className={["min-w-0", className].filter(Boolean).join(" ")}
        >
            <header
                className={`flex min-w-0 items-start justify-between gap-4 ${GUTTER} pt-6`}
            >
                <div className="min-w-0">
                    <h3 className={TITLE}>{title}</h3>
                    {hint ? (
                        <p className={`mt-1.5 ${HINT} ${PROSE}`}>{hint}</p>
                    ) : null}
                </div>
                {actions ? (
                    <div className="flex shrink-0 items-center gap-2">
                        {actions}
                    </div>
                ) : null}
            </header>
            <div className={`min-w-0 ${GUTTER} pb-7 pt-4`}>{children}</div>
        </section>
    );
}

/**
 * The line a panel keeps under its chrome: what is true right now.
 *
 * Same gutter as the sections below it, one rule along the bottom, and nothing
 * else — it is not a section, it is the sentence a panel says about itself before
 * you read anything. Shared because both panels had drawn it by hand, with the
 * gutter measurement copied rather than referenced.
 */
export function PanelStrip({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={[
                "flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-1.5",
                `border-b border-[var(--mdx-separator)] py-2.5 ${GUTTER}`,
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
 * A view that scrolls: a page of sections, facts, forms.
 *
 * One definition because the answer kept being re-decided per panel — and the last
 * time it was decided in CSS, as a blanket cap on a marker attribute, it silently
 * applied to the two views that should fill the window.
 */
export function PanelScroll({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={[
                "min-h-0 min-w-0 flex-1 overflow-auto",
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
 * A view that is exactly the height of its panel and scrolls nothing itself.
 *
 * For content that manages its own movement — columns that scroll separately, a
 * canvas that pans and zooms. Inside a scrolling box such a view has auto height,
 * which is how a canvas ends up sized by its own aspect ratio instead of by the
 * window.
 */
export function PanelViewport({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={[
                "flex min-h-0 min-w-0 flex-1 overflow-hidden",
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
 * What just happened, said briefly and then gone.
 *
 * For the outcome of something you asked for: an install finished, a bundle was
 * written, a conclusion was adopted. It used to be a line at the foot of the panel,
 * which on a tall page was off screen at the moment it mattered — the action
 * reported and nobody saw the report.
 *
 * It takes itself away, because an outcome is not a state: leaving it on screen
 * makes the next screenful say something about the last thing you did. Errors are
 * not toasts for the same reason in reverse — they stay in a bar until dealt with.
 */
export function Toast({
    children,
    onDismiss,
    /** How long it stays. Long enough to read a sentence, not long enough to nag. */
    duration = 5000,
}: {
    children: ReactNode;
    onDismiss: () => void;
    duration?: number;
}) {
    useEffect(() => {
        const timer = setTimeout(onDismiss, duration);

        return () => clearTimeout(timer);
    }, [duration, onDismiss]);

    return (
        <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed bottom-6 left-1/2 z-40 flex max-w-[min(90vw,560px)] -translate-x-1/2 justify-center"
        >
            <button
                type="button"
                // Dismissable by clicking it: the timer is a courtesy, not a lock.
                className="pointer-events-auto min-w-0 break-words rounded-full bg-base-100 px-4 py-2 text-left text-[13px] leading-[1.6] text-base-content/85 shadow-[var(--mdx-panel-shadow)] ring-1 ring-base-content/10 transition-colors hover:bg-base-200"
                onClick={onDismiss}
            >
                {children}
            </button>
        </div>
    );
}

/**
 * The ground a modal sits on: scrim, centring, and the ways out of it.
 *
 * Five dialogs had written this themselves, and no two agreed: two scrims at
 * different opacities, two of them anchored to the top of the window with a
 * hand-picked top padding, escape handled in some and not others. Centred, because
 * a dialog is the only thing on screen while it is up.
 *
 * `onDismiss` is what makes the scrim and Escape work; a dialog that must not be
 * lost by a stray click simply does not pass it.
 */
export function DialogOverlay({
    children,
    onDismiss,
    className,
}: {
    children: ReactNode;
    onDismiss?: () => void;
    className?: string;
}) {
    useEffect(() => {
        if (!onDismiss) return;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onDismiss();
        };

        window.addEventListener("keydown", onKeyDown);

        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onDismiss]);

    return (
        <div
            className={[
                "fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-6 backdrop-blur-[2px]",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
            role="presentation"
            onMouseDown={
                onDismiss
                    ? (event) => {
                          if (event.target === event.currentTarget) onDismiss();
                      }
                    : undefined
            }
        >
            {children}
        </div>
    );
}

/**
 * The surface a modal is drawn on.
 *
 * Rounded and softly shadowed, the way macOS draws a panel, and never taller than
 * the window it is in — the size a given dialog wants is its own business, but
 * fitting on screen is not. The hairline is inside the shadow rather than a border
 * of its own, so the corner stays clean.
 */
export function DialogSurface({
    label,
    labelledBy,
    children,
    className,
    testId,
}: {
    label?: string;
    /** Id of the heading that names this dialog, for the ones that draw one. */
    labelledBy?: string;
    children: ReactNode;
    className?: string;
    /** For tests that need to find this dialog among several. */
    testId?: string;
}) {
    return (
        <section
            role="dialog"
            aria-modal="true"
            aria-label={label}
            aria-labelledby={labelledBy}
            data-testid={testId}
            className={[
                "flex max-h-full min-h-0 min-w-0 flex-col overflow-hidden",
                "rounded-[var(--mdx-panel-radius)] bg-base-100 shadow-[var(--mdx-panel-shadow)]",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {children}
        </section>
    );
}

/** A modal's top row: what it is, and the actions that close it. */
export function DialogHeader({
    children,
    actions,
}: {
    children: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <header className="flex min-w-0 shrink-0 items-center justify-between gap-3 border-b border-[var(--mdx-separator)] px-5 py-3">
            <div className="flex min-w-0 items-center gap-3 text-[13px] font-semibold text-base-content">
                {children}
            </div>
            {actions ? (
                <div className="flex shrink-0 items-center gap-2">{actions}</div>
            ) : null}
        </header>
    );
}

/**
 * A state, said as a word.
 *
 * Small, spaced, in the colour that means it — and with no fill. A row of filled
 * pills turns a list into a scoreboard; the state matters, but it is not the thing
 * you read first, and in this direction nothing gets a box unless it can be pressed.
 */
export function StateLabel({
    tone = "neutral",
    children,
}: {
    tone?: ChipTone;
    children: ReactNode;
}) {
    return (
        <span
            className={[
                "shrink-0 text-[11.5px] font-medium tracking-[0.06em]",
                tone === "success"
                    ? "text-success"
                    : tone === "warning"
                      ? "text-warning"
                      : tone === "error"
                        ? "text-error"
                        : tone === "primary"
                          ? "text-primary"
                          : "text-base-content/45",
            ].join(" ")}
        >
            {children}
        </span>
    );
}

/**
 * One entry in a list, separated by a rule rather than boxed.
 *
 * The hairline is the whole device: it says "these are separate things" without
 * drawing a container around each of them, which is what keeps a page of records
 * looking like a page rather than like a form.
 */
export function HairlineItem({
    children,
    className,
    interactive = false,
}: {
    children: ReactNode;
    className?: string;
    interactive?: boolean;
}) {
    return (
        <li
            className={[
                "min-w-0 border-t border-[var(--mdx-separator)] py-4 first:border-t-0",
                interactive
                    ? "-mx-3 px-3 transition-colors hover:bg-base-content/4"
                    : undefined,
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {children}
        </li>
    );
}

/** What a chip's colour is allowed to mean. */
export type ChipTone = "neutral" | "primary" | "success" | "warning" | "error";

const CHIP_TONES: Record<ChipTone, string> = {
    neutral: "bg-base-content/6 text-base-content/60",
    primary: "bg-primary/12 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/18 text-warning",
    error: "bg-error/12 text-error",
};

/**
 * A short label that carries a state.
 *
 * Rounded fully and never larger than 10px, so it reads as a marker on something
 * rather than as text of its own. Tone is the whole point: a chip whose colour
 * means nothing is decoration.
 */
export function Chip({
    tone = "neutral",
    children,
    className,
}: {
    tone?: ChipTone;
    children: ReactNode;
    className?: string;
}) {
    return (
        <span
            className={[
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] leading-[1.5]",
                CHIP_TONES[tone],
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {children}
        </span>
    );
}

/**
 * Label-and-value facts on one line.
 *
 * For the strip a panel keeps in view: which project, how much is stored, whether
 * the thing it needs is present. Every value in the same weight and every label in
 * the same grey, because the eye reads the shape of the row before it reads any of
 * the words.
 */
export function StatList({
    items,
    className,
    singleLine = false,
}: {
    items: Array<{
        label: string;
        value: ReactNode;
        tone?: "normal" | "warning" | "error";
        title?: string;
    }>;
    className?: string;
    /**
     * Never wraps to a second line.
     *
     * For a live strip: one of its values is a file path that changes with every
     * file processed, and a wrapping row went from one line to two and back as the
     * paths got longer and shorter — the whole page under it jumping each time,
     * which is what "it flickers once per file" was.
     */
    singleLine?: boolean;
}) {
    return (
        <div
            className={[
                "flex min-w-0 items-center gap-x-6 gap-y-1.5",
                singleLine ? "flex-nowrap overflow-hidden" : "flex-wrap",
                "text-[12px] leading-relaxed text-base-content/50",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {items.map((item) => (
                <span
                    key={item.label}
                    className={[
                        "min-w-0 truncate",
                        item.tone === "warning"
                            ? "text-warning"
                            : item.tone === "error"
                              ? "text-error"
                              : undefined,
                    ]
                        .filter(Boolean)
                        .join(" ")}
                    title={item.title}
                >
                    {item.label}{" "}
                    <span
                        className={
                            item.tone && item.tone !== "normal"
                                ? undefined
                                : "font-semibold text-base-content"
                        }
                    >
                        {item.value}
                    </span>
                </span>
            ))}
        </div>
    );
}

/**
 * The word above a field, in the one grey the panels use for it.
 *
 * Written inline at four sizes across the settings dialog and the wiki forms —
 * 11px, 12px, `text-xs`, and once at body size — which is the kind of drift that
 * makes a form look assembled rather than designed.
 */
export function FieldLabel({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <span className={[HINT, className].filter(Boolean).join(" ")}>
            {children}
        </span>
    );
}

/**
 * A checkbox, at one size.
 *
 * Four screens drew their own — `h-4 w-4`, `mt-1`, one with a hand-drawn border,
 * one with none — so no two checkboxes in the app were the same box. The accent
 * colour is the theme's, which is what makes a checked box look like it belongs to
 * this application rather than to the browser.
 */
export function Checkbox({
    className,
    ...props
}: InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            type="checkbox"
            className={[
                "size-3.5 shrink-0 accent-[var(--color-primary)] disabled:cursor-not-allowed",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
            {...props}
        />
    );
}

/**
 * Labelled facts, one per row, in a hairline table.
 *
 * Written four separate times — the overview, the diagnostics, the wiki status, the
 * settings dialog — and no two agreed on the label column: two equal columns put
 * every value at the halfway mark of whatever width the window happened to be, and
 * a `gap-x-4` grid put them wherever the longest label in *that* list ended. One
 * definition is what makes two pages look like one product.
 */
export function FactRows({
    items,
    className,
}: {
    items: Array<{ label: string; value: ReactNode; title?: string }>;
    className?: string;
}) {
    return (
        <dl
            className={[
                // Padding inside the label cell rather than a gap between the two:
                // a gap leaves a break in the rule under every row, and a row of
                // rules with a notch in each one looks like a mistake.
                // A table of short facts, at the width short facts need: stretched
                // across a wide window a value ends up a screen away from its label.
                "grid min-w-0 max-w-2xl grid-cols-[clamp(72px,20%,132px)_minmax(0,1fr)]",
                // The first row carries no rule: it is the top of the list, and a rule
                // there reads as a line under the heading above it.
                "[&>*:nth-child(1)]:border-t-0 [&>*:nth-child(2)]:border-t-0",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {items.map((item) => (
                <Fragment key={item.label}>
                    <dt
                        className={`border-t border-[var(--mdx-separator)] py-2.5 pr-6 ${HINT}`}
                    >
                        {item.label}
                    </dt>
                    <dd
                        className={`min-w-0 truncate border-t border-[var(--mdx-separator)] py-2.5 ${BODY}`}
                        title={item.title}
                    >
                        {item.value}
                    </dd>
                </Fragment>
            ))}
        </dl>
    );
}

/** Body and meta text, so a screen does not have to remember the sizes. */
export function PanelText({
    tone = "body",
    children,
    className,
}: {
    tone?: "body" | "meta";
    children: ReactNode;
    className?: string;
}) {
    return (
        <p
            className={[tone === "meta" ? META : BODY, PROSE, className]
                .filter(Boolean)
                .join(" ")}
        >
            {children}
        </p>
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
    testId,
}: {
    children: ReactNode;
    className?: string;
    /** For the tests that assert on what a long-running operation reported. */
    testId?: string;
}) {
    return (
        <pre
            data-testid={testId}
            className={[
                `max-h-72 overflow-auto whitespace-pre-wrap ${radiusClass} bg-[var(--mdx-card-bg)] p-2.5 font-[inherit] text-xs leading-relaxed text-base-content/75`,
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {children}
        </pre>
    );
}
