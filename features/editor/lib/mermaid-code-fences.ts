export interface MermaidCodeFence {
    code: string;
    codeBlockIndex: number;
    fenceChar: "`" | "~";
    fenceLength: number;
    info: string;
    language: "mermaid";
}

const OPENING_FENCE = /^([`~]{3,})([^\n`]*)$/;

export function isMermaidFenceLanguage(info: string): boolean {
    const firstToken = info.trim().split(/\s+/, 1)[0] ?? "";
    return firstToken.toLowerCase() === "mermaid";
}

export function findMermaidCodeFences(markdown: string): MermaidCodeFence[] {
    const lines = markdown.split(/\r?\n/);
    const fences: MermaidCodeFence[] = [];
    let codeBlockIndex = 0;
    let open:
        | {
              code: string[];
              codeBlockIndex: number;
              fenceChar: "`" | "~";
              fenceLength: number;
              info: string;
              isMermaid: boolean;
          }
        | null = null;

    for (const line of lines) {
        if (!open) {
            const match = line.match(OPENING_FENCE);
            if (!match) {
                continue;
            }

            const marker = match[1];
            const fenceChar = marker[0] as "`" | "~";
            open = {
                code: [],
                codeBlockIndex,
                fenceChar,
                fenceLength: marker.length,
                info: match[2].trim(),
                isMermaid: isMermaidFenceLanguage(match[2]),
            };
            continue;
        }

        if (isClosingFence(line, open.fenceChar, open.fenceLength)) {
            if (open.isMermaid) {
                fences.push({
                    code: open.code.join("\n"),
                    codeBlockIndex: open.codeBlockIndex,
                    fenceChar: open.fenceChar,
                    fenceLength: open.fenceLength,
                    info: open.info,
                    language: "mermaid",
                });
            }
            codeBlockIndex += 1;
            open = null;
            continue;
        }

        open.code.push(line);
    }

    return fences;
}

function isClosingFence(
    line: string,
    fenceChar: "`" | "~",
    fenceLength: number,
): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== fenceChar) {
        return false;
    }

    for (const char of trimmed) {
        if (char !== fenceChar) {
            return false;
        }
    }

    return trimmed.length >= fenceLength;
}
