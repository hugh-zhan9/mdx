export const HTML_PREVIEW_IFRAME_SANDBOX = "";

const HTML_PREVIEW_CSP = [
	"default-src 'none'",
	"img-src data: blob:",
	"style-src 'unsafe-inline' data: blob:",
	"font-src data: blob:",
	"media-src data: blob:",
	"frame-src 'none'",
	"connect-src 'none'",
	"form-action 'none'",
	"base-uri 'none'",
	"object-src 'none'",
].join("; ");

type HtmlPreviewSecurityOptions = {
	resourceUrls?: ReadonlyMap<string, string>;
};

const EXECUTABLE_ELEMENT_SELECTOR = "script, iframe, object, embed";
const FORM_URL_ATTRIBUTES = new Set(["action", "formaction"]);
const INERT_LINK_ELEMENT_NAMES = new Set(["a", "area"]);
const INERT_LINK_NAVIGATION_ATTRIBUTES = ["href", "ping", "target", "download"];
const AUTOMATIC_RESOURCE_ATTRIBUTES = new Set([
	"src",
	"poster",
	"data",
	"xlink:href",
]);

export function createSafePreviewHtml(
	html: string,
	options: HtmlPreviewSecurityOptions = {},
): string {
	const parser = new DOMParser();
	const document = parser.parseFromString(html, "text/html");
	const resourceUrls = options.resourceUrls ?? new Map<string, string>();

	injectRestrictiveCsp(document);
	removeExecutableElements(document);
	rewriteElements(document, resourceUrls);

	return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

export function rewriteCssUrls(
	css: string,
	resourceUrls: ReadonlyMap<string, string>,
): string {
	return css.replace(
		/url\(\s*(?:(['"])(.*?)\1|([^'")]*?))\s*\)/gi,
		(_match, quote: string | undefined, quotedUrl: string | undefined, unquotedUrl: string | undefined) => {
			const originalUrl = (quotedUrl ?? unquotedUrl ?? "").trim();
			const rewrittenUrl = resolvePreviewUrl(originalUrl, resourceUrls);

			if (rewrittenUrl === undefined) {
				return "none";
			}

			if (quote !== undefined) {
				return `url(${quote}${rewrittenUrl}${quote})`;
			}

			return `url(${rewrittenUrl})`;
		},
	);
}

function injectRestrictiveCsp(document: Document): void {
	for (const existingCsp of document.querySelectorAll(
		'meta[http-equiv="Content-Security-Policy" i]',
	)) {
		existingCsp.remove();
	}

	const csp = document.createElement("meta");
	csp.setAttribute("http-equiv", "Content-Security-Policy");
	csp.setAttribute("content", HTML_PREVIEW_CSP);
	document.head.prepend(csp);
}

function removeExecutableElements(document: Document): void {
	for (const element of document.querySelectorAll(EXECUTABLE_ELEMENT_SELECTOR)) {
		element.remove();
	}

	for (const base of document.querySelectorAll("base")) {
		base.remove();
	}

	for (const metaRefresh of document.querySelectorAll('meta[http-equiv="refresh" i]')) {
		metaRefresh.remove();
	}
}

function rewriteElements(
	document: Document,
	resourceUrls: ReadonlyMap<string, string>,
): void {
	for (const element of document.querySelectorAll("*")) {
		removeDangerousAttributes(element);
		rewriteResourceAttributes(element, resourceUrls);
		rewriteInertLinkAttributes(element);
		rewriteLinkHref(element, resourceUrls);
		rewriteInlineStyle(element, resourceUrls);
	}

	for (const styleElement of document.querySelectorAll("style")) {
		styleElement.textContent = rewriteCssUrls(
			styleElement.textContent ?? "",
			resourceUrls,
		);
	}
}

function removeDangerousAttributes(element: Element): void {
	for (const attribute of [...element.attributes]) {
		const attributeName = attribute.name.toLowerCase();

		if (attributeName.startsWith("on")) {
			element.removeAttribute(attribute.name);
			continue;
		}

		if (FORM_URL_ATTRIBUTES.has(attributeName)) {
			element.removeAttribute(attribute.name);
			continue;
		}

		if (isDangerousUrl(attribute.value)) {
			element.removeAttribute(attribute.name);
		}
	}
}

function rewriteResourceAttributes(
	element: Element,
	resourceUrls: ReadonlyMap<string, string>,
): void {
	for (const attribute of [...element.attributes]) {
		const attributeName = attribute.name.toLowerCase();

		if (AUTOMATIC_RESOURCE_ATTRIBUTES.has(attributeName)) {
			rewriteUrlAttribute(element, attribute.name, resourceUrls);
			continue;
		}

		if (attributeName === "srcset") {
			rewriteSrcsetAttribute(element, attribute.name, resourceUrls);
		}
	}
}

function rewriteInertLinkAttributes(element: Element): void {
	if (!INERT_LINK_ELEMENT_NAMES.has(element.tagName.toLowerCase())) {
		return;
	}

	const href = element.getAttribute("href");

	for (const attributeName of INERT_LINK_NAVIGATION_ATTRIBUTES) {
		element.removeAttribute(attributeName);
	}

	if (href !== null && !isDangerousUrl(href)) {
		element.setAttribute("data-mdx-original-href", href);
	}
}

function rewriteLinkHref(
	element: Element,
	resourceUrls: ReadonlyMap<string, string>,
): void {
	if (element.tagName.toLowerCase() !== "link" || !element.hasAttribute("href")) {
		return;
	}

	const rel = element.getAttribute("rel") ?? "";
	if (!rel.split(/\s+/).some((part) => part.toLowerCase() === "stylesheet")) {
		element.removeAttribute("href");
		return;
	}

	rewriteUrlAttribute(element, "href", resourceUrls);
}

function rewriteInlineStyle(
	element: Element,
	resourceUrls: ReadonlyMap<string, string>,
): void {
	if (!element.hasAttribute("style")) {
		return;
	}

	element.setAttribute(
		"style",
		rewriteCssUrls(element.getAttribute("style") ?? "", resourceUrls),
	);
}

function rewriteUrlAttribute(
	element: Element,
	attributeName: string,
	resourceUrls: ReadonlyMap<string, string>,
): void {
	const value = element.getAttribute(attributeName);

	if (value === null) {
		return;
	}

	const rewrittenValue = resolvePreviewUrl(value, resourceUrls);

	if (rewrittenValue === undefined) {
		element.removeAttribute(attributeName);
		return;
	}

	element.setAttribute(attributeName, rewrittenValue);
}

function rewriteSrcsetAttribute(
	element: Element,
	attributeName: string,
	resourceUrls: ReadonlyMap<string, string>,
): void {
	const value = element.getAttribute(attributeName);

	if (value === null) {
		return;
	}

	const rewrittenCandidates = value
		.split(",")
		.map((candidate) => rewriteSrcsetCandidate(candidate, resourceUrls))
		.filter((candidate): candidate is string => candidate !== undefined);

	if (rewrittenCandidates.length === 0) {
		element.removeAttribute(attributeName);
		return;
	}

	element.setAttribute(attributeName, rewrittenCandidates.join(", "));
}

function rewriteSrcsetCandidate(
	candidate: string,
	resourceUrls: ReadonlyMap<string, string>,
): string | undefined {
	const trimmedCandidate = candidate.trim();

	if (trimmedCandidate.length === 0) {
		return undefined;
	}

	const [url = "", ...descriptorParts] = trimmedCandidate.split(/\s+/);
	const rewrittenUrl = resolvePreviewUrl(url, resourceUrls);

	if (rewrittenUrl === undefined) {
		return undefined;
	}

	if (descriptorParts.length === 0) {
		return rewrittenUrl;
	}

	return `${rewrittenUrl} ${descriptorParts.join(" ")}`;
}

function resolvePreviewUrl(
	url: string,
	resourceUrls: ReadonlyMap<string, string>,
): string | undefined {
	const trimmedUrl = url.trim();

	if (trimmedUrl.length === 0 || isDangerousUrl(trimmedUrl)) {
		return undefined;
	}

	const mappedUrl = resourceUrls.get(trimmedUrl);
	if (mappedUrl !== undefined) {
		return isAllowedPreviewUrl(mappedUrl) ? mappedUrl : undefined;
	}

	return isAllowedPreviewUrl(trimmedUrl) ? trimmedUrl : undefined;
}

function isAllowedPreviewUrl(url: string): boolean {
	const scheme = getUrlScheme(url);
	return scheme === "data" || scheme === "blob";
}

function isDangerousUrl(url: string): boolean {
	const normalizedUrl = url.replace(/[\u0000-\u001f\u007f\s]+/g, "").toLowerCase();
	return normalizedUrl.startsWith("javascript:");
}

function getUrlScheme(url: string): string | undefined {
	const match = /^([a-zA-Z][a-zA-Z\d+.-]*):/.exec(url.trim());
	return match?.[1]?.toLowerCase();
}
