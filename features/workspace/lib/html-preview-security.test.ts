// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
	HTML_PREVIEW_IFRAME_SANDBOX,
	createSafePreviewHtml,
	rewriteCssUrls,
} from "./html-preview-security";

describe("html preview security", () => {
	it("uses an iframe sandbox without script, form, or same-origin privileges", () => {
		expect(HTML_PREVIEW_IFRAME_SANDBOX).toBe("");
		expect(HTML_PREVIEW_IFRAME_SANDBOX).not.toContain("allow-scripts");
		expect(HTML_PREVIEW_IFRAME_SANDBOX).not.toContain("allow-forms");
		expect(HTML_PREVIEW_IFRAME_SANDBOX).not.toContain("allow-same-origin");
	});

	it("removes executable HTML and injects a restrictive CSP", () => {
		const safe = createSafePreviewHtml(`
            <!doctype html>
            <html>
              <head><title>X</title></head>
              <body onload="steal()">
                <script>window.__ran = true</script>
                <style>body{background:url(https://tracker.example/bg.png)}</style>
                <a href="javascript:steal()" onclick="steal()">Run</a>
                <form action="https://example.test/post"><button formaction="https://example.test/post">Send</button></form>
              </body>
            </html>
        `);

		expect(safe).toContain("default-src 'none'");
		expect(safe).not.toContain("<script");
		expect(safe).not.toContain("onload=");
		expect(safe).not.toContain("onclick=");
		expect(safe).not.toContain("javascript:steal");
		expect(safe).not.toContain("https://tracker.example/bg.png");
		expect(safe).toContain("body{background:none}");
		expect(safe).not.toContain("action=\"https://example.test/post\"");
		expect(safe).not.toContain("formaction=");
	});

	it("rewrites archive resources and blocks external automatic resources", () => {
		const safe = createSafePreviewHtml(
			`
            <html><body>
              <img src="cid:image-1">
              <img src="https://tracker.example/pixel.png">
              <link rel="stylesheet" href="https://tracker.example/app.css">
              <link rel="stylesheet" href="style.css">
              <a href="https://example.test/page">external link</a>
            </body></html>
            `,
			{
				resourceUrls: new Map([
					["cid:image-1", "data:image/png;base64,AAAA"],
					["style.css", "data:text/css;charset=utf-8,body%7Bcolor%3Ared%7D"],
				]),
			},
		);

		expect(safe).toContain('src="data:image/png;base64,AAAA"');
		expect(safe).toContain('href="data:text/css;charset=utf-8,body%7Bcolor%3Ared%7D"');
		expect(safe).not.toContain("https://tracker.example");
		expect(safe).toContain('data-mdx-original-href="https://example.test/page"');

		const document = new DOMParser().parseFromString(safe, "text/html");
		const anchor = document.querySelector("a");
		expect(anchor?.hasAttribute("href")).toBe(false);
		expect(anchor?.getAttribute("data-mdx-original-href")).toBe(
			"https://example.test/page",
		);
	});

	it("rewrites CSS url references through the same resource map", () => {
		expect(
			rewriteCssUrls(
				"body{background:url('cid:bg-1')} .x{background:url(https://tracker.example/a.png)}",
				new Map([["cid:bg-1", "data:image/png;base64,BBBB"]]),
			),
		).toBe("body{background:url('data:image/png;base64,BBBB')} .x{background:none}");
	});
});
