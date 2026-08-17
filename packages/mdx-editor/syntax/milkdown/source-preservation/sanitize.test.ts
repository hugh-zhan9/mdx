// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { sanitizePastedHtml } from "./clipboard-guard";
import { SanitizeError, sanitizeToFragment } from "./sanitize";
import { SESSION_TOKEN, SOURCE_TOKEN_ATTR } from "./session";

function sanitize(html: string): HTMLElement {
    const holder = document.createElement("div");
    holder.append(sanitizeToFragment(html, document));
    return holder;
}

function markup(html: string): string {
    return sanitize(html).innerHTML;
}

function attributeNames(root: ParentNode): string[] {
    const names: string[] = [];
    for (const element of Array.from(root.querySelectorAll("*"))) {
        for (const attribute of Array.from(element.attributes)) {
            names.push(attribute.name.toLowerCase());
        }
    }
    return names;
}

/**
 * Payloads that must all reduce to inert markup. Grouped by the vector they
 * exercise so a regression names the vector it reopened.
 */
const executionVectors: Array<[string, string]> = [
    ["plain script", "<script>window.__pwned = true;</script>"],
    ["uppercase script", "<SCRIPT>window.__pwned = true;</SCRIPT>"],
    ["script with type", '<script type="text/javascript">x()</script>'],
    ["script inside svg", "<svg><script>window.__pwned = true;</script></svg>"],
    ["script inside math", "<math><script>x()</script></math>"],
    ["script after a broken tag", "<div<script>window.__pwned = true;</script>"],
    ["img onerror", '<img src="x" onerror="window.__pwned = true">'],
    ["img onerror unquoted", "<img src=x onerror=alert(1)>"],
    ["body onload", '<body onload="window.__pwned = true">'],
    ["svg onload", '<svg onload="window.__pwned = true"></svg>'],
    ["div onclick", '<div onclick="window.__pwned = true">x</div>'],
    ["mixed case handler", '<div OnMouseOver="x()">y</div>'],
    ["a javascript url", '<a href="javascript:window.__pwned=true">x</a>'],
    ["a javascript url mixed case", '<a href="JaVaScRiPt:alert(1)">x</a>'],
    ["a javascript url with spaces", '<a href="  javascript:alert(1)">x</a>'],
    ["a javascript url with a newline", '<a href="jav&#x0A;ascript:alert(1)">x</a>'],
    ["a javascript url with a tab", '<a href="jav&#x09;ascript:alert(1)">x</a>'],
    ["a javascript url entity encoded", '<a href="&#106;avascript:alert(1)">x</a>'],
    ["a javascript url double encoded", '<a href="&amp;#106;avascript:alert(1)">x</a>'],
    ["a vbscript url", '<a href="vbscript:msgbox(1)">x</a>'],
    ["a data url", '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>'],
    ["form action", '<form action="javascript:alert(1)"><input formaction="javascript:alert(1)"></form>'],
    ["iframe", '<iframe src="javascript:window.__pwned=true"></iframe>'],
    [
        "iframe srcdoc",
        '<iframe srcdoc="&lt;script&gt;window.__pwned=true&lt;/script&gt;"></iframe>',
    ],
    ["object", '<object data="evil.swf"></object>'],
    ["embed", '<embed src="evil.swf">'],
    ["base", '<base href="https://evil.test/">'],
    ["meta refresh", '<meta http-equiv="refresh" content="0;url=https://evil.test">'],
    ["style element", "<style>@import 'evil.css'; body { background: url(javascript:alert(1)) }</style>"],
    ["style attribute", '<div style="background:url(javascript:alert(1))">x</div>'],
    ["style attribute with expression", '<div style="width:expression(alert(1))">x</div>'],
    ["moz binding", '<div style="-moz-binding:url(evil.xml#x)">x</div>'],
    ["link stylesheet", '<link rel="stylesheet" href="https://evil.test/x.css">'],
    ["svg use xlink", '<svg><use xlink:href="data:image/svg+xml;base64,PHN2Zz4="/></svg>'],
    ["noscript mxss", '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'],
    ["comment mxss", "<!--<img src=x onerror=alert(1)>-->"],
    ["template", "<template><img src=x onerror=alert(1)></template>"],
    ["dom clobbering", '<form><input name="attributes"><input id="body"></form>'],
];

describe("the sanitizer rebuilds only what is on the allowlist", () => {
    for (const [name, payload] of executionVectors) {
        it(`neutralizes ${name}`, () => {
            const sanitized = sanitize(payload);
            expect(sanitized.querySelectorAll("script")).toHaveLength(0);
            expect(sanitized.querySelectorAll("iframe")).toHaveLength(0);
            expect(sanitized.querySelectorAll("object")).toHaveLength(0);
            expect(sanitized.querySelectorAll("embed")).toHaveLength(0);
            expect(sanitized.querySelectorAll("base")).toHaveLength(0);
            expect(sanitized.querySelectorAll("meta")).toHaveLength(0);
            expect(sanitized.querySelectorAll("style")).toHaveLength(0);
            expect(sanitized.querySelectorAll("link")).toHaveLength(0);
            expect(sanitized.querySelectorAll("form")).toHaveLength(0);
            expect(sanitized.querySelectorAll("input")).toHaveLength(0);
            expect(sanitized.querySelectorAll("svg")).toHaveLength(0);
            expect(sanitized.querySelectorAll("math")).toHaveLength(0);
            expect(sanitized.querySelectorAll("template")).toHaveLength(0);
            expect(sanitized.querySelectorAll("noscript")).toHaveLength(0);
            expect(sanitized.querySelector("[srcdoc]")).toBeNull();
            expect(sanitized.querySelector("[style]")).toBeNull();
            expect(sanitized.querySelector("[id]")).toBeNull();
            expect(sanitized.querySelector("[name]")).toBeNull();
            for (const attribute of attributeNames(sanitized)) {
                expect(attribute.startsWith("on"), attribute).toBe(false);
            }
            expect(sanitized.innerHTML.toLowerCase()).not.toContain("javascript:");
            expect(sanitized.innerHTML.toLowerCase()).not.toContain("vbscript:");
            expect(sanitized.innerHTML.toLowerCase()).not.toContain("expression(");
            expect(sanitized.innerHTML.toLowerCase()).not.toContain("-moz-binding");
            // Text is not a vector — `<div<script>` parses the tag as an
            // attribute name and leaves the body as characters — so the
            // invariant is that no markup survives, not that no string does.
            expect(sanitized.innerHTML.toLowerCase()).not.toContain("<script");
        });
    }

    it("keeps ordinary markup", () => {
        expect(markup('<div class="note"><p>Hello <b>there</b>.</p></div>')).toBe(
            '<div class="note"><p>Hello <b>there</b>.</p></div>',
        );
        expect(markup("<kbd>Cmd</kbd>")).toBe("<kbd>Cmd</kbd>");
        expect(markup("<table><tbody><tr><td>1</td></tr></tbody></table>")).toBe(
            "<table><tbody><tr><td>1</td></tr></tbody></table>",
        );
    });

    it("keeps safe links and images", () => {
        expect(markup('<a href="https://example.test/x">go</a>')).toBe(
            '<a href="https://example.test/x">go</a>',
        );
        expect(markup('<a href="#anchor">go</a>')).toBe('<a href="#anchor">go</a>');
        expect(markup('<a href="./relative.md">go</a>')).toBe(
            '<a href="./relative.md">go</a>',
        );
        expect(markup('<a href="mailto:a@b.test">go</a>')).toBe(
            '<a href="mailto:a@b.test">go</a>',
        );
        expect(markup('<img src="pic.png" alt="a">')).toBe(
            '<img src="pic.png" alt="a">',
        );
    });

    it("unwraps an unknown element but keeps its text", () => {
        expect(markup("<my-widget>kept</my-widget>")).toBe("kept");
        expect(markup('<my-widget onclick="x()">kept</my-widget>')).toBe("kept");
    });

    it("drops the content of an element whose content is the payload", () => {
        expect(sanitize("<style>p{color:red}</style>").textContent).toBe("");
        expect(sanitize("<script>secret</script>").textContent).toBe("");
        expect(sanitize("<textarea>secret</textarea>").textContent).toBe("");
    });

    it("escapes text rather than reinterpreting it", () => {
        expect(markup("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe(
            "&lt;script&gt;alert(1)&lt;/script&gt;",
        );
    });
});

describe("the sanitizer rejects what it cannot check", () => {
    it("rejects markup nested past the depth budget", () => {
        const deep = `${"<div>".repeat(150)}x${"</div>".repeat(150)}`;
        expect(() => sanitizeToFragment(deep, document)).toThrow(SanitizeError);
    });

    it("rejects markup past the node budget", () => {
        const wide = "<span>x</span>".repeat(20000);
        expect(() => sanitizeToFragment(wide, document)).toThrow(SanitizeError);
    });
});

describe("clipboard sanitizing is stable under re-parsing", () => {
    it("does not gain anything on a second pass", () => {
        for (const [, payload] of executionVectors) {
            const once = sanitizePastedHtml(payload, document);
            const twice = sanitizePastedHtml(once, document);
            expect(twice, payload).toBe(once);
            expect(once.toLowerCase(), payload).not.toContain("<script");
            expect(once.toLowerCase(), payload).not.toContain("javascript:");
        }
    });

    it("returns plain text rather than throwing when input is rejected", () => {
        const deep = `${"<div>".repeat(150)}x${"</div>".repeat(150)}`;
        expect(sanitizePastedHtml(deep, document)).toBe("");
    });

    it("strips data attributes an outside document supplied", () => {
        const sanitized = sanitizePastedHtml(
            '<div data-callout="" data-mdx-wikilink="" data-mdx-node-type="math_block">x</div>',
            document,
        );
        expect(sanitized).not.toContain("data-");
        expect(sanitized).toContain("x");
    });

    it("keeps data attributes this session stamped", () => {
        const sanitized = sanitizePastedHtml(
            `<div data-callout="" data-mdx-node-type="math_block" ${SOURCE_TOKEN_ATTR}="${SESSION_TOKEN}">x</div>`,
            document,
        );
        expect(sanitized).toContain('data-callout=""');
        expect(sanitized).toContain('data-mdx-node-type="math_block"');
    });

    it("rejects a stamp that is not this session's", () => {
        const sanitized = sanitizePastedHtml(
            `<div data-mdx-node-type="math_block" ${SOURCE_TOKEN_ATTR}="not-the-token">x</div>`,
            document,
        );
        expect(sanitized).not.toContain("data-mdx-node-type");
    });
});
