import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const mod = await import("../packages/mdx-editor/react/wasm/layout-core/layout_core.js");
const wasmBytes = await readFile(
    resolve("packages/mdx-editor/react/wasm/layout-core/layout_core_bg.wasm"),
);
await mod.default({ module_or_path: wasmBytes });

const requiredExports = [
    "layout_initialize_document",
    "layout_update_document",
    "layout_get_viewport_snapshot",
    "layout_hit_test",
    "layout_get_selection_geometry",
];

for (const exportName of requiredExports) {
    if (typeof mod[exportName] !== "function") {
        throw new Error(`layout wasm export ${exportName} is missing`);
    }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const document = {
    document_id: "doc-1",
    revision: 1,
    blocks: [
        {
            block_id: "p1",
            kind: "Paragraph",
            pm_from: 0,
            pm_to: 5,
            depth: 0,
            inlines: [
                {
                    text: "Hello",
                    kind: "Text",
                    from: 0,
                    to: 5,
                    style: {
                        bold: false,
                        italic: false,
                        code: false,
                        link: null,
                        strike: false,
                        underline: false,
                    },
                },
            ],
            style: {
                heading_level: null,
                text_align: "Left",
                font_size: 14,
                font_family: "Inter",
                line_height: 1.5,
                math_display: "Inline",
            },
        },
    ],
    style_context: {
        default_font_size: 14,
        default_font_family: "Inter",
        default_line_height: 1.5,
        viewport_width: 960,
        viewport_height: 720,
        device_pixel_ratio: 1,
    },
};

const encodeJson = (value) => encoder.encode(JSON.stringify(value));
const decodeJson = (bytes) => JSON.parse(decoder.decode(bytes));

const initialized = decodeJson(
    mod.layout_initialize_document(
        "doc-1",
        encodeJson(document),
        encodeJson(document.style_context),
        encodeJson({ width: 960, height: 720, device_pixel_ratio: 1 }),
        encodeJson({}),
    ),
);
if (initialized.revision !== 1) {
    throw new Error("layout wasm initialize returned wrong revision");
}

decodeJson(
    mod.layout_update_document(
        "doc-1",
        2n,
        encodeJson({ ...document, revision: 2 }),
        encodeJson([]),
        encodeJson({ width: 960, height: 720, device_pixel_ratio: 1 }),
    ),
);
decodeJson(
    mod.layout_get_viewport_snapshot(
        "doc-1",
        3n,
        encodeJson({ ...document, revision: 3 }),
        1,
    ),
);
decodeJson(mod.layout_hit_test("doc-1", 3n, 1, 1, encodeJson([])));
decodeJson(mod.layout_get_selection_geometry("doc-1", 3n, 0, 5));

console.log("layout wasm smoke: PASS");
