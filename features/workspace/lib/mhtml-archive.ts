import { rewriteCssUrls } from "./html-preview-security";

export interface ParsedMhtmlArchive {
	html: string;
	resourceUrls: Map<string, string>;
	diagnostics: string[];
}

type ParsedPart = {
	headers: Map<string, string>;
	mimeType: string;
	charset: string;
	transferEncoding: string;
	body: string;
};

type CssResource = {
	aliases: string[];
	css: string;
	mimeType: string;
};

const DEFAULT_MIME_TYPE = "text/plain";
const DEFAULT_CHARSET = "utf-8";

export function parseMhtmlArchive(archive: string): ParsedMhtmlArchive {
	const normalizedArchive = normalizeLineEndings(archive);
	const topLevelHeaders = parseHeaders(readHeaderSection(normalizedArchive));
	const topLevelContentType = parseContentType(topLevelHeaders.get("content-type"));
	const boundary = topLevelContentType.params.get("boundary");

	if (boundary === undefined || boundary.length === 0) {
		throw new Error("MHTML archive is missing a multipart boundary.");
	}

	const parts = splitMultipartParts(normalizedArchive, boundary).map(parsePart);
	const htmlPart = parts.find((part) => part.mimeType === "text/html");

	if (htmlPart === undefined) {
		throw new Error("MHTML archive does not contain a text/html part.");
	}

	const resourceUrls = new Map<string, string>();
	const diagnostics: string[] = [];
	const cssResources: CssResource[] = [];
	const htmlBaseLocation = getContentLocation(htmlPart.headers);
	const cssBaseLocations = parts
		.filter((part) => part.mimeType === "text/css")
		.map((part) => getContentLocation(part.headers))
		.filter((location): location is string => location !== undefined);

	for (const part of parts) {
		if (part === htmlPart || part.mimeType === "text/html") {
			continue;
		}

		const relativeBaseLocations =
			part.mimeType === "text/css"
				? [htmlBaseLocation].filter((location): location is string => location !== undefined)
				: [htmlBaseLocation, ...cssBaseLocations].filter(
						(location): location is string => location !== undefined,
					);
		const aliases = createResourceAliases(part.headers, relativeBaseLocations);

		if (aliases.length === 0) {
			diagnostics.push(
				`Skipped ${part.mimeType} part without Content-ID or Content-Location.`,
			);
			continue;
		}

		if (part.mimeType === "text/css") {
			cssResources.push({
				aliases,
				css: decodeTextBody(part),
				mimeType: part.mimeType,
			});
			continue;
		}

		const dataUrl = isTextMimeType(part.mimeType)
			? createTextDataUrl(part.mimeType, decodeTextBody(part))
			: createBinaryDataUrl(part.mimeType, part.body, part.transferEncoding);

		addResourceAliases(resourceUrls, aliases, dataUrl);
	}

	for (const cssResource of cssResources) {
		const rewrittenCss = rewriteCssUrls(cssResource.css, resourceUrls);
		addResourceAliases(
			resourceUrls,
			cssResource.aliases,
			createTextDataUrl(cssResource.mimeType, rewrittenCss),
		);
	}

	return {
		html: decodeTextBody(htmlPart),
		resourceUrls,
		diagnostics,
	};
}

function normalizeLineEndings(value: string): string {
	return value.replace(/\r\n?/g, "\n");
}

function readHeaderSection(value: string): string {
	const headerEnd = value.indexOf("\n\n");
	return headerEnd === -1 ? value : value.slice(0, headerEnd);
}

function parsePart(part: string): ParsedPart {
	const headerEnd = part.indexOf("\n\n");
	const headerSection = headerEnd === -1 ? part : part.slice(0, headerEnd);
	const body = headerEnd === -1 ? "" : part.slice(headerEnd + 2);
	const headers = parseHeaders(headerSection);
	const contentType = parseContentType(headers.get("content-type"));

	return {
		headers,
		mimeType: contentType.mimeType,
		charset: contentType.params.get("charset") ?? DEFAULT_CHARSET,
		transferEncoding:
			headers.get("content-transfer-encoding")?.trim().toLowerCase() ?? "7bit",
		body,
	};
}

function parseHeaders(headerSection: string): Map<string, string> {
	const headers = new Map<string, string>();
	let currentHeaderName: string | undefined;

	for (const line of headerSection.split("\n")) {
		if (/^[\t ]/.test(line) && currentHeaderName !== undefined) {
			headers.set(
				currentHeaderName,
				`${headers.get(currentHeaderName) ?? ""} ${line.trim()}`.trim(),
			);
			continue;
		}

		const separatorIndex = line.indexOf(":");
		if (separatorIndex === -1) {
			currentHeaderName = undefined;
			continue;
		}

		currentHeaderName = line.slice(0, separatorIndex).trim().toLowerCase();
		headers.set(currentHeaderName, line.slice(separatorIndex + 1).trim());
	}

	return headers;
}

function parseContentType(value: string | undefined): {
	mimeType: string;
	params: Map<string, string>;
} {
	if (value === undefined) {
		return { mimeType: DEFAULT_MIME_TYPE, params: new Map() };
	}

	const [rawMimeType = "", ...rawParams] = splitSemicolonSeparated(value);
	const params = new Map<string, string>();

	for (const rawParam of rawParams) {
		const separatorIndex = rawParam.indexOf("=");
		if (separatorIndex === -1) {
			continue;
		}

		const name = rawParam.slice(0, separatorIndex).trim().toLowerCase();
		const paramValue = unquoteHeaderValue(rawParam.slice(separatorIndex + 1).trim());

		if (name.length > 0) {
			params.set(name, paramValue);
		}
	}

	return {
		mimeType: rawMimeType.trim().toLowerCase() || DEFAULT_MIME_TYPE,
		params,
	};
}

function splitSemicolonSeparated(value: string): string[] {
	const parts: string[] = [];
	let current = "";
	let inQuote = false;
	let escaping = false;

	for (const char of value) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}

		if (char === "\\") {
			current += char;
			escaping = true;
			continue;
		}

		if (char === '"') {
			current += char;
			inQuote = !inQuote;
			continue;
		}

		if (char === ";" && !inQuote) {
			parts.push(current);
			current = "";
			continue;
		}

		current += char;
	}

	parts.push(current);
	return parts;
}

function unquoteHeaderValue(value: string): string {
	if (!value.startsWith('"') || !value.endsWith('"')) {
		return value;
	}

	return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
}

function splitMultipartParts(archive: string, boundary: string): string[] {
	const delimiter = `--${boundary}`;
	const closingDelimiter = `${delimiter}--`;
	const parts: string[] = [];
	let currentPartLines: string[] | undefined;

	for (const line of archive.split("\n")) {
		const marker = line.trimEnd();

		if (marker === delimiter || marker === closingDelimiter) {
			if (currentPartLines !== undefined) {
				parts.push(currentPartLines.join("\n"));
			}

			if (marker === closingDelimiter) {
				break;
			}

			currentPartLines = [];
			continue;
		}

		if (currentPartLines !== undefined) {
			currentPartLines.push(line);
		}
	}

	return parts;
}

function decodeTextBody(part: ParsedPart): string {
	if (part.transferEncoding === "base64") {
		return decodeBytes(decodeBase64ToBytes(part.body), part.charset);
	}

	if (part.transferEncoding === "quoted-printable") {
		return decodeBytes(decodeQuotedPrintableToBytes(part.body), part.charset);
	}

	return part.body;
}

function decodeQuotedPrintableToBytes(value: string): Uint8Array {
	const withoutSoftBreaks = value.replace(/=[\t ]*\n/g, "");
	const textEncoder = new TextEncoder();
	const bytes: number[] = [];

	for (let index = 0; index < withoutSoftBreaks.length; index += 1) {
		const char = withoutSoftBreaks[index] ?? "";
		const hexValue = withoutSoftBreaks.slice(index + 1, index + 3);

		if (char === "=" && /^[\da-fA-F]{2}$/.test(hexValue)) {
			bytes.push(Number.parseInt(hexValue, 16));
			index += 2;
			continue;
		}

		bytes.push(...textEncoder.encode(char));
	}

	return new Uint8Array(bytes);
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
	try {
		return new TextDecoder(charset).decode(bytes);
	} catch {
		return new TextDecoder(DEFAULT_CHARSET).decode(bytes);
	}
}

function createResourceAliases(
	headers: Map<string, string>,
	relativeBaseLocations: string[],
): string[] {
	const aliases = new Set<string>();
	const contentId = normalizeContentId(headers.get("content-id"));
	const contentLocation = getContentLocation(headers);

	if (contentId !== undefined) {
		aliases.add(`cid:${contentId}`);
		aliases.add(contentId);
	}

	if (contentLocation !== undefined && contentLocation.length > 0) {
		aliases.add(contentLocation);

		if (contentLocation.startsWith("./")) {
			aliases.add(contentLocation.replace(/^\.\/+/, ""));
		}

		addAbsoluteLocationAliases(aliases, contentLocation);
		addRelativeLocationAliases(aliases, contentLocation, relativeBaseLocations);
	}

	return [...aliases];
}

function getContentLocation(headers: Map<string, string>): string | undefined {
	const contentLocation = headers.get("content-location")?.trim();
	return contentLocation === undefined || contentLocation.length === 0
		? undefined
		: contentLocation;
}

function normalizeContentId(value: string | undefined): string | undefined {
	const trimmedValue = value?.trim();

	if (trimmedValue === undefined || trimmedValue.length === 0) {
		return undefined;
	}

	if (trimmedValue.startsWith("<") && trimmedValue.endsWith(">")) {
		const contentId = trimmedValue.slice(1, -1).trim();
		return contentId.length > 0 ? contentId : undefined;
	}

	return trimmedValue;
}

function addAbsoluteLocationAliases(
	aliases: Set<string>,
	contentLocation: string,
): void {
	let url: URL;

	try {
		url = new URL(contentLocation);
	} catch {
		return;
	}

	const pathnameWithoutLeadingSlash = url.pathname.replace(/^\/+/, "");
	if (pathnameWithoutLeadingSlash.length > 0) {
		aliases.add(url.pathname);
		aliases.add(pathnameWithoutLeadingSlash);
	}

	const pathSegments = pathnameWithoutLeadingSlash.split("/").filter(Boolean);
	const finalSegment = pathSegments[pathSegments.length - 1];
	if (finalSegment !== undefined) {
		aliases.add(finalSegment);
	}
}

function addRelativeLocationAliases(
	aliases: Set<string>,
	contentLocation: string,
	baseLocations: string[],
): void {
	for (const baseLocation of baseLocations) {
		const relativeLocation = getRelativeLocationAlias(contentLocation, baseLocation);

		if (relativeLocation !== undefined) {
			aliases.add(relativeLocation);
		}
	}
}

function getRelativeLocationAlias(
	contentLocation: string,
	baseLocation: string,
): string | undefined {
	let contentUrl: URL;
	let baseUrl: URL;

	try {
		contentUrl = new URL(contentLocation);
		baseUrl = new URL(baseLocation);
	} catch {
		return undefined;
	}

	if (contentUrl.origin !== baseUrl.origin) {
		return undefined;
	}

	const baseDirectory = baseUrl.pathname.endsWith("/")
		? baseUrl.pathname
		: baseUrl.pathname.slice(0, baseUrl.pathname.lastIndexOf("/") + 1);
	const relativePath = createRelativePath(baseDirectory, contentUrl.pathname);

	return relativePath.length > 0 ? relativePath : undefined;
}

function createRelativePath(baseDirectory: string, targetPath: string): string {
	const baseSegments = getPathSegments(baseDirectory);
	const targetSegments = getPathSegments(targetPath);
	let commonSegmentCount = 0;

	while (
		commonSegmentCount < baseSegments.length &&
		commonSegmentCount < targetSegments.length &&
		baseSegments[commonSegmentCount] === targetSegments[commonSegmentCount]
	) {
		commonSegmentCount += 1;
	}

	const parentSegments = baseSegments.slice(commonSegmentCount).map(() => "..");
	const relativeSegments = [
		...parentSegments,
		...targetSegments.slice(commonSegmentCount),
	];

	return relativeSegments.join("/");
}

function getPathSegments(path: string): string[] {
	return path.replace(/^\/+/, "").split("/").filter(Boolean);
}

function addResourceAliases(
	resourceUrls: Map<string, string>,
	aliases: string[],
	dataUrl: string,
): void {
	for (const alias of aliases) {
		resourceUrls.set(alias, dataUrl);
	}
}

function isTextMimeType(mimeType: string): boolean {
	return mimeType.startsWith("text/");
}

function createTextDataUrl(mimeType: string, text: string): string {
	return `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`;
}

function createBinaryDataUrl(
	mimeType: string,
	body: string,
	transferEncoding: string,
): string {
	if (transferEncoding === "base64") {
		return `data:${mimeType};base64,${body.replace(/\s+/g, "")}`;
	}

	return `data:${mimeType};base64,${encodeBytesToBase64(new TextEncoder().encode(body))}`;
}

function decodeBase64ToBytes(value: string): Uint8Array {
	const binary = globalThis.atob(value.replace(/\s+/g, ""));
	const bytes = new Uint8Array(binary.length);

	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}

	return bytes;
}

function encodeBytesToBase64(bytes: Uint8Array): string {
	let binary = "";

	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return globalThis.btoa(binary);
}
