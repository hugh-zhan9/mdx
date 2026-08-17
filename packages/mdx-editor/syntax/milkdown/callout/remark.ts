import type { RemarkPluginRaw } from "@milkdown/kit/transformer";

import { formatCalloutMarker, parseCalloutMarker } from "./marker";

/**
 * mdast node type produced by the transformer and consumed by the node schema.
 *
 * Typed as `string` rather than a string literal so the serializer handler can
 * be registered under a computed key without colliding with the closed set of
 * built-in mdast node names.
 */
export const CALLOUT_MDAST_TYPE: string = "mdxCallout";

/**
 * Structural view of an mdast node. Narrower than remark's own unions, which
 * cannot describe a node type they do not know about.
 */
export interface MdastNode {
    type: string;
    value?: unknown;
    children?: MdastNode[];
    position?: {
        start: { line: number; offset?: number | undefined };
        end: { line: number; offset?: number | undefined };
    };
}

export interface CalloutMdastNode extends MdastNode {
    kind: string;
    title: string;
    /**
     * Whether a blank quoted line separated the marker from the body. Recorded
     * so `> [!NOTE]\n>\n> body` and `> [!NOTE]\n> body` each come back as they
     * were written.
     */
    spaced: boolean;
}

/** Reads callout fields off a node the parser already matched by type. */
export function readCalloutFields(node: MdastNode): {
    kind: string;
    title: string;
    spaced: boolean;
} {
    const candidate = node as Partial<CalloutMdastNode>;
    return {
        kind: typeof candidate.kind === "string" ? candidate.kind : "",
        title: typeof candidate.title === "string" ? candidate.title : "",
        spaced: candidate.spaced === true,
    };
}

interface CalloutTrackFields {
    lineShift: number;
}

interface CalloutTracker {
    move(value: string): string;
    shift(value: number): void;
    current(): CalloutTrackFields;
}

/**
 * The slice of `mdast-util-to-markdown`'s serializer state this handler needs.
 *
 * Declared with method syntax so the members stay bivariant and the real state
 * satisfies this shape without importing the serializer's own types.
 */
interface CalloutSerializerState {
    enter(name: "blockquote"): () => void;
    createTracker(info: CalloutTrackFields): CalloutTracker;
    containerFlow(parent: CalloutMdastNode, info: CalloutTrackFields): string;
    indentLines(
        value: string,
        map: (line: string, index: number, blank: boolean) => string,
    ): string;
}

type CalloutHandle = (
    node: CalloutMdastNode,
    parent: unknown,
    state: CalloutSerializerState,
    info: CalloutTrackFields,
) => string;

function quotedLine(line: string, _index: number, blank: boolean): string {
    return blank ? ">" : `> ${line}`;
}

const calloutToMarkdown: CalloutHandle = (node, _parent, state, info) => {
    const exit = state.enter("blockquote");
    const tracker = state.createTracker(info);
    tracker.move("> ");
    tracker.shift(2);
    const marker = formatCalloutMarker(node);
    const body = state.containerFlow(node, tracker.current());
    const separator = node.spaced ? "\n\n" : "\n";
    const flow = body.length === 0 ? marker : `${marker}${separator}${body}`;
    const value = state.indentLines(flow, quotedLine);
    exit();
    return value;
};

interface MarkerLine {
    /** First line of the paragraph, without its line ending. */
    text: string;
    /** Whether the paragraph carries content past that line. */
    continues: boolean;
}

/**
 * Reads the paragraph's first line straight from the source.
 *
 * Read from source rather than from the text nodes because a title may hold
 * inline syntax, which remark has already turned into a subtree by this point.
 */
function readMarkerLine(
    paragraph: MdastNode,
    source: string,
): MarkerLine | null {
    const start = paragraph.position?.start.offset;
    const end = paragraph.position?.end.offset;
    if (start === undefined || end === undefined) return null;
    const newline = source.indexOf("\n", start);
    const lineEnd = newline === -1 || newline > end ? end : newline;
    return {
        text: source.slice(start, lineEnd).replace(/\r$/, ""),
        continues: lineEnd < end,
    };
}

function bodyParagraph(rest: MdastNode[]): MdastNode[] {
    return rest.length === 0 ? [] : [{ type: "paragraph", children: rest }];
}

/**
 * Everything the marker paragraph holds after its first line, as body blocks.
 *
 * The break is either a newline still inside a text node or a `break` node, as
 * CommonMark's `remarkLineBreak` may already have split the paragraph by the
 * time this runs. Returns `null` when the break falls inside a nested inline
 * node, where the marker line is not a line of its own and the blockquote is
 * left alone.
 */
function bodyAfterMarkerLine(paragraph: MdastNode): MdastNode[] | null {
    const children = paragraph.children ?? [];
    for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child.type === "break") {
            return bodyParagraph(children.slice(index + 1));
        }
        if (child.type !== "text" || typeof child.value !== "string") continue;
        const newline = child.value.indexOf("\n");
        if (newline === -1) continue;
        const tail = child.value.slice(newline + 1);
        const rest: MdastNode[] = [];
        if (tail.length > 0) rest.push({ ...child, value: tail });
        rest.push(...children.slice(index + 1));
        return bodyParagraph(rest);
    }
    return null;
}

/** Converts a blockquote to a callout, or returns `null` to leave it alone. */
function toCalloutNode(
    blockquote: MdastNode,
    source: string,
): CalloutMdastNode | null {
    const children = blockquote.children ?? [];
    const head = children[0];
    if (!head || head.type !== "paragraph") return null;
    const line = readMarkerLine(head, source);
    if (line === null) return null;
    const marker = parseCalloutMarker(line.text);
    if (!marker) return null;

    if (line.continues) {
        const body = bodyAfterMarkerLine(head);
        if (body === null) return null;
        return {
            type: CALLOUT_MDAST_TYPE,
            ...marker,
            spaced: false,
            children: [...body, ...children.slice(1)],
            position: blockquote.position,
        };
    }

    const next = children[1];
    const headLine = head.position?.end.line;
    const nextLine = next?.position?.start.line;
    return {
        type: CALLOUT_MDAST_TYPE,
        ...marker,
        spaced:
            headLine !== undefined &&
            nextLine !== undefined &&
            nextLine > headLine + 1,
        children: children.slice(1),
        position: blockquote.position,
    };
}

/** Rewrites every callout blockquote in the tree, innermost first. */
function replaceCallouts(parent: MdastNode, source: string): void {
    const children = parent.children;
    if (!children) return;
    for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        replaceCallouts(child, source);
        if (child.type !== "blockquote") continue;
        const callout = toCalloutNode(child, source);
        if (callout) children[index] = callout;
    }
}

export type CalloutRemarkOptions = Record<string, never>;

/**
 * Recognizes GitHub alert blockquotes on the way in and writes them back out
 * verbatim on the way out.
 *
 * The serializer half has to be registered here rather than in the node schema:
 * Milkdown's node serializer can only build mdast, and the default CommonMark
 * text handler escapes the leading `[` of the marker.
 */
export const calloutRemarkPlugin: RemarkPluginRaw<CalloutRemarkOptions> =
    function calloutRemark() {
        const data = this.data();
        const extensions = data.toMarkdownExtensions ?? [];
        extensions.push({
            handlers: { [CALLOUT_MDAST_TYPE]: calloutToMarkdown },
        });
        data.toMarkdownExtensions = extensions;

        return (tree, file) => {
            replaceCallouts(tree, String(file));
        };
    };
