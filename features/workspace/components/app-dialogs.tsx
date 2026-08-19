"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    PrimaryTextControlButton,
    TextControlButton,
    DialogOverlay,
} from "../../../common/components/ui-controls";

interface AlertOptions {
    title?: string;
    message: string;
}

interface ConfirmOptions extends AlertOptions {
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
}

interface PromptOptions {
    title?: string;
    message?: string;
    label?: string;
    initialValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
}

interface ChoiceOption {
    label: string;
    value: string;
    destructive?: boolean;
}

interface ChoiceOptions extends AlertOptions {
    choices: ChoiceOption[];
    cancelLabel?: string;
}

interface AppDialogs {
    alert: (options: AlertOptions | string) => Promise<void>;
    confirm: (options: ConfirmOptions) => Promise<boolean>;
    prompt: (options: PromptOptions) => Promise<string | null>;
    choice: (options: ChoiceOptions) => Promise<string | null>;
}

type DialogRequest =
    | (AlertOptions & {
          id: number;
          kind: "alert";
          resolve: () => void;
      })
    | (ConfirmOptions & {
          id: number;
          kind: "confirm";
          resolve: (confirmed: boolean) => void;
      })
    | (PromptOptions & {
          id: number;
          kind: "prompt";
          resolve: (value: string | null) => void;
      })
    | (ChoiceOptions & {
          id: number;
          kind: "choice";
          resolve: (value: string | null) => void;
      });

type DialogRequestInput =
    | (AlertOptions & {
          kind: "alert";
      })
    | (ConfirmOptions & {
          kind: "confirm";
      })
    | (PromptOptions & {
          kind: "prompt";
      })
    | (ChoiceOptions & {
          kind: "choice";
      });

const AppDialogContext = createContext<AppDialogs | null>(null);

export function AppDialogProvider({
    children,
}: {
    children: React.ReactNode;
}) {
    const [activeDialog, setActiveDialog] = useState<DialogRequest | null>(
        null,
    );
    const activeDialogRef = useRef<DialogRequest | null>(null);
    const nextDialogIdRef = useRef(1);
    const queueRef = useRef<DialogRequest[]>([]);

    const drainQueue = useCallback(() => {
        if (activeDialogRef.current || queueRef.current.length === 0) {
            return;
        }

        const nextDialog = queueRef.current.shift() ?? null;
        activeDialogRef.current = nextDialog;
        setActiveDialog(nextDialog);
    }, []);

    const enqueueDialog = useCallback(
        <T,>(
            request: DialogRequestInput,
        ): Promise<T> =>
            new Promise<T>((resolve) => {
                const dialog = {
                    ...request,
                    id: nextDialogIdRef.current,
                    resolve,
                } as DialogRequest;

                nextDialogIdRef.current += 1;
                queueRef.current.push(dialog);
                drainQueue();
            }),
        [drainQueue],
    );

    const closeDialog = useCallback(
        (value: unknown) => {
            const dialog = activeDialogRef.current;

            if (!dialog) {
                return;
            }

            if (dialog.kind === "alert") {
                dialog.resolve();
            } else if (dialog.kind === "confirm") {
                dialog.resolve(Boolean(value));
            } else if (dialog.kind === "prompt") {
                dialog.resolve(
                    typeof value === "string" ? value : null,
                );
            } else {
                dialog.resolve(
                    typeof value === "string" ? value : null,
                );
            }

            activeDialogRef.current = null;
            setActiveDialog(null);
            window.setTimeout(drainQueue, 0);
        },
        [drainQueue],
    );

    const dialogs = useMemo<AppDialogs>(
        () => ({
            alert(options) {
                const normalized =
                    typeof options === "string"
                        ? { message: options }
                        : options;

                return enqueueDialog<void>({
                    kind: "alert",
                    title: normalized.title ?? "提示",
                    message: normalized.message,
                });
            },
            confirm(options) {
                return enqueueDialog<boolean>({
                    kind: "confirm",
                    title: options.title ?? "确认",
                    message: options.message,
                    confirmLabel: options.confirmLabel ?? "确定",
                    cancelLabel: options.cancelLabel ?? "取消",
                    destructive: options.destructive,
                });
            },
            prompt(options) {
                return enqueueDialog<string | null>({
                    kind: "prompt",
                    title: options.title ?? "输入",
                    message: options.message,
                    label: options.label,
                    initialValue: options.initialValue ?? "",
                    placeholder: options.placeholder,
                    confirmLabel: options.confirmLabel ?? "确定",
                    cancelLabel: options.cancelLabel ?? "取消",
                });
            },
            choice(options) {
                return enqueueDialog<string | null>({
                    kind: "choice",
                    title: options.title ?? "选择操作",
                    message: options.message,
                    choices: options.choices,
                    cancelLabel: options.cancelLabel ?? "取消",
                });
            },
        }),
        [enqueueDialog],
    );

    return (
        <AppDialogContext.Provider value={dialogs}>
            {children}
            <DialogSurface
                dialog={activeDialog}
                onClose={closeDialog}
            />
        </AppDialogContext.Provider>
    );
}

export function useAppDialogs() {
    const dialogs = useContext(AppDialogContext);

    if (!dialogs) {
        throw new Error("useAppDialogs must be used within AppDialogProvider");
    }

    return dialogs;
}

function DialogSurface({
    dialog,
    onClose,
}: {
    dialog: DialogRequest | null;
    onClose: (value: unknown) => void;
}) {
    if (!dialog) {
        return null;
    }

    return (
        <DialogBody
            key={dialog.id}
            dialog={dialog}
            onClose={onClose}
        />
    );
}

function DialogBody({
    dialog,
    onClose,
}: {
    dialog: DialogRequest;
    onClose: (value: unknown) => void;
}) {
    const [value, setValue] = useState(
        dialog.kind === "prompt" ? dialog.initialValue ?? "" : "",
    );
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (dialog.kind === "prompt") {
            window.setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 0);
        }
    }, [dialog.kind]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose(null);
            }
        };

        window.addEventListener("keydown", onKeyDown);

        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const submitPrompt = () => {
        const trimmed = value.trim();
        onClose(trimmed.length > 0 ? trimmed : null);
    };

    return (
        <DialogOverlay>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={`mdx-dialog-title-${dialog.id}`}
                className="w-full max-w-sm rounded-xl bg-base-100 p-5 text-base-content shadow-[var(--mdx-panel-shadow)]"
            >
                <div
                    id={`mdx-dialog-title-${dialog.id}`}
                    className="text-sm font-semibold"
                >
                    {dialog.title}
                </div>
                {dialog.message ? (
                    <div className="mt-2 whitespace-pre-wrap text-sm text-base-content/70">
                        {dialog.message}
                    </div>
                ) : null}

                {dialog.kind === "prompt" ? (
                    <label className="mt-3 block text-xs text-base-content/60">
                        {dialog.label ? (
                            <span className="mb-1 block">
                                {dialog.label}
                            </span>
                        ) : null}
                        <input
                            ref={inputRef}
                            className="h-8 w-full rounded-md border border-base-content/12 bg-base-100 px-2.5 text-sm text-base-content outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                            value={value}
                            placeholder={dialog.placeholder}
                            onChange={(event) =>
                                setValue(event.target.value)
                            }
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    submitPrompt();
                                }
                            }}
                        />
                    </label>
                ) : null}

                {/*
                 * The same two buttons the rest of the app uses: what the
                 * dialog is asking for is primary, everything else is quiet.
                 * These were five hand-written variants with no radius, no
                 * focus ring, and a near-black confirm that matched nothing.
                 */}
                <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                    {dialog.kind === "alert" ? (
                        <PrimaryTextControlButton onClick={() => onClose(true)}>
                            知道了
                        </PrimaryTextControlButton>
                    ) : null}

                    {dialog.kind === "confirm" ? (
                        <>
                            <TextControlButton onClick={() => onClose(false)}>
                                {dialog.cancelLabel ?? "取消"}
                            </TextControlButton>
                            <PrimaryTextControlButton
                                destructive={dialog.destructive}
                                onClick={() => onClose(true)}
                            >
                                {dialog.confirmLabel ?? "确定"}
                            </PrimaryTextControlButton>
                        </>
                    ) : null}

                    {dialog.kind === "prompt" ? (
                        <>
                            <TextControlButton onClick={() => onClose(null)}>
                                {dialog.cancelLabel ?? "取消"}
                            </TextControlButton>
                            <PrimaryTextControlButton onClick={submitPrompt}>
                                {dialog.confirmLabel ?? "确定"}
                            </PrimaryTextControlButton>
                        </>
                    ) : null}

                    {dialog.kind === "choice" ? (
                        <>
                            {dialog.choices.map((choice) => (
                                <TextControlButton
                                    key={choice.value}
                                    className={
                                        choice.destructive
                                            ? "hover:bg-error/10 hover:text-error active:bg-error/15"
                                            : undefined
                                    }
                                    onClick={() => onClose(choice.value)}
                                >
                                    {choice.label}
                                </TextControlButton>
                            ))}
                            <TextControlButton onClick={() => onClose(null)}>
                                {dialog.cancelLabel ?? "取消"}
                            </TextControlButton>
                        </>
                    ) : null}
                </div>
            </div>
        </DialogOverlay>
    );
}
