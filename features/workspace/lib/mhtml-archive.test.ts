// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createSafePreviewHtml } from "./html-preview-security";
import { parseMhtmlArchive } from "./mhtml-archive";

describe("mhtml archive parser", () => {
	it("selects the html part and rewrites cid image and stylesheet resources", () => {
		const archive = [
			"MIME-Version: 1.0",
			'Content-Type: multipart/related; boundary="----=_NextPart_000_0000"',
			"",
			"------=_NextPart_000_0000",
			"Content-Type: text/html; charset=utf-8",
			"Content-Location: https://example.test/page.html",
			"",
			'<html><head><link rel="stylesheet" href="style.css"></head><body><h1>Hello</h1><img src="cid:image-1"></body></html>',
			"------=_NextPart_000_0000",
			"Content-Type: text/css; charset=utf-8",
			"Content-Location: style.css",
			"",
			"body{background:url('cid:bg-1');color:red}",
			"------=_NextPart_000_0000",
			"Content-Type: image/png",
			"Content-Transfer-Encoding: base64",
			"Content-ID: <image-1>",
			"",
			"iVBORw0KGgo=",
			"------=_NextPart_000_0000",
			"Content-Type: image/png",
			"Content-Transfer-Encoding: base64",
			"Content-ID: <bg-1>",
			"",
			"AAAA",
			"------=_NextPart_000_0000--",
		].join("\r\n");

		const parsed = parseMhtmlArchive(archive);
		const safe = createSafePreviewHtml(parsed.html, {
			resourceUrls: parsed.resourceUrls,
		});

		expect(parsed.diagnostics).toEqual([]);
		expect(safe).toContain("<h1>Hello</h1>");
		expect(safe).toContain('src="data:image/png;base64,iVBORw0KGgo="');
		expect(safe).toContain("data:text/css;charset=utf-8,");
		expect(decodeURIComponent(safe)).toContain("data:image/png;base64,AAAA");
	});

	it("decodes quoted-printable html bodies", () => {
		const archive = [
			"Content-Type: multipart/related; boundary=abc",
			"",
			"--abc",
			"Content-Type: text/html; charset=utf-8",
			"Content-Transfer-Encoding: quoted-printable",
			"",
			"<html><body><h1>Hello=20World</h1></body></html>",
			"--abc--",
		].join("\n");

		expect(parseMhtmlArchive(archive).html).toContain("Hello World");
	});

	it("throws when the archive has no html part", () => {
		const archive = [
			"Content-Type: multipart/related; boundary=abc",
			"",
			"--abc",
			"Content-Type: image/png",
			"Content-Transfer-Encoding: base64",
			"Content-Location: image.png",
			"",
			"AAAA",
			"--abc--",
		].join("\n");

		expect(() => parseMhtmlArchive(archive)).toThrow(
			"MHTML archive does not contain a text/html part.",
		);
	});
});
