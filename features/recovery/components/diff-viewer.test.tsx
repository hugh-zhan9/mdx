// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiffViewer } from "./diff-viewer";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function renderDiff(leftText: string, rightText: string) {
    act(() => {
        root.render(
            <DiffViewer
                open
                title="草稿差异"
                leftTitle="磁盘版本"
                rightTitle="草稿"
                leftText={leftText}
                rightText={rightText}
                primaryAction={{ label: "恢复草稿", onClick: vi.fn() }}
                secondaryActions={[
                    { label: "保留磁盘版本", onClick: vi.fn() },
                ]}
                onClose={vi.fn()}
            />,
        );
    });
}

function buttonByText(text: string) {
    return Array.from(host.querySelectorAll("button")).find((button) =>
        button.textContent?.includes(text),
    );
}

beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    host.remove();
});

describe("DiffViewer", () => {
    it("says so when both versions are identical instead of showing a wall of unchanged lines", () => {
        const text = "# Note\n\nsame\n";

        renderDiff(text, text);

        expect(host.textContent).toContain("两侧内容一致");
        expect(host.textContent).toContain("两个版本逐行相同");
        expect(host.textContent).not.toContain("same");
    });

    it("summarizes how many lines differ", () => {
        renderDiff("a\nb\nc\n", "a\nx\nc\n");

        expect(host.textContent).toContain("1 处差异");
        expect(host.textContent).toContain("+1");
        expect(host.textContent).toContain("−1");
    });

    it("folds unchanged stretches and expands one on demand", () => {
        const unchanged = Array.from(
            { length: 30 },
            (_, index) => `line ${index + 1}`,
        ).join("\n");

        renderDiff(`changed\n${unchanged}\n`, `edited\n${unchanged}\n`);

        const expandButton = buttonByText("行未变化内容");
        expect(expandButton).toBeDefined();
        expect(host.textContent).not.toContain("line 20");

        act(() => {
            expandButton?.click();
        });

        expect(host.textContent).toContain("line 20");
        expect(buttonByText("行未变化内容")).toBeUndefined();
    });
});
