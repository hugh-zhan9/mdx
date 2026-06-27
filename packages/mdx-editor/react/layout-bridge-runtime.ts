"use client";

import type { Node as ProseMirrorNode } from "prosemirror-model";
import { normalizeProseMirrorLayoutDocument } from "../layout-ir/from-prosemirror";
import { normalizeLayoutDocument } from "../layout-ir/normalizer";
import type { LayoutDocument, LayoutViewport } from "../layout-ir";
import { loadLayoutWasmModule } from "./layout-wasm-loader";
import {
    createLayoutBridge,
    type LayoutBridge,
    type LayoutSnapshot,
} from "./wasm-layout-bridge";

let bridgePromise: Promise<LayoutBridge> | null = null;

export function getRuntimeLayoutBridge(): Promise<LayoutBridge> {
    bridgePromise ??= loadLayoutWasmModule().then(createLayoutBridge);
    return bridgePromise;
}

export async function snapshotFromMarkdownViaLayoutBridge(
    markdown: string,
    viewport: LayoutViewport,
): Promise<LayoutSnapshot> {
    const document: LayoutDocument = normalizeLayoutDocument(markdown, viewport);
    return (await getRuntimeLayoutBridge()).initialize(document);
}

export async function snapshotFromProseMirrorViaLayoutBridge(
    doc: ProseMirrorNode,
    revision: number,
    viewport: LayoutViewport,
): Promise<LayoutSnapshot> {
    const document = normalizeProseMirrorLayoutDocument(doc, {
        documentId: "active-document",
        revision,
        viewport: {
            width: viewport.width,
            height: viewport.height,
        },
    });

    return (await getRuntimeLayoutBridge()).initialize({
        ...document,
        styleContext: {
            ...document.styleContext,
            devicePixelRatio: viewport.devicePixelRatio,
        },
    });
}
