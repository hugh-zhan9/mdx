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

	it("makes image map area links inert and preserves the original URL", () => {
		const safe = createSafePreviewHtml(`
			<html><body>
				<map name="preview-map">
					<area href="https://example.test/map" ping="https://tracker.example/p" target="_blank" download>
				</map>
			</body></html>
		`);

		const document = new DOMParser().parseFromString(safe, "text/html");
		const area = document.querySelector("area");
		expect(area?.hasAttribute("href")).toBe(false);
		expect(area?.hasAttribute("ping")).toBe(false);
		expect(area?.hasAttribute("target")).toBe(false);
		expect(area?.hasAttribute("download")).toBe(false);
		expect(area?.getAttribute("data-mdx-original-href")).toBe(
			"https://example.test/map",
		);
	});

	it("rewrites srcset and inline style resources while dropping unresolved external URLs", () => {
		const safe = createSafePreviewHtml(
			`
			<html><body>
				<img srcset="cid:small 1x, https://tracker.example/large.png 2x">
				<div style="background:url('cid:bg-2'); border-image:url(https://tracker.example/border.png) 1"></div>
			</body></html>
			`,
			{
				resourceUrls: new Map([
					["cid:small", "data:image/png;base64,SMALL"],
					["cid:bg-2", "data:image/png;base64,BG2"],
				]),
			},
		);

		const document = new DOMParser().parseFromString(safe, "text/html");
		expect(document.querySelector("img")?.getAttribute("srcset")).toBe(
			"data:image/png;base64,SMALL 1x",
		);
		expect(document.querySelector("div")?.getAttribute("style")).toBe(
			"background:url('data:image/png;base64,BG2'); border-image:none 1",
		);
		expect(safe).not.toContain("https://tracker.example");
	});

	it("rewrites svg href resources without restoring active document links", () => {
		const safe = createSafePreviewHtml(
			`
			<html><body>
				<a href="https://example.test/page">link</a>
				<svg><image href="cid:svg-image"></image></svg>
			</body></html>
			`,
			{
				resourceUrls: new Map([
					["cid:svg-image", "data:image/png;base64,SVG"],
				]),
			},
		);

		const document = new DOMParser().parseFromString(safe, "text/html");
		expect(document.querySelector("a")?.hasAttribute("href")).toBe(false);
		expect(document.querySelector("image")?.getAttribute("href")).toBe(
			"data:image/png;base64,SVG",
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
