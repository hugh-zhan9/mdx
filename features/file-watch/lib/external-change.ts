import { normalizeWorkspacePath } from "../../workspace/lib/path";
import type { WorkspaceState, WorkspaceTab } from "../../workspace/lib/types";
import type { FrontendFileWatchEvent, SelfWriteMarker } from "./types";

export type WorkspaceExternalChangeDecision =
    | { kind: "ignore" }
    | { kind: "refreshTree"; path: string }
    | { kind: "remapPath"; fromPath: string; toPath: string }
    | {
          kind: "remapPathAndPrefix";
          fromPath: string;
          toPath: string;
          oldPrefix: string;
          newPrefix: string;
      }
    | { kind: "reloadCleanTab"; tabId: string; path: string }
    | { kind: "showConflict"; tabId: string; path: string }
    | {
          kind: "showDeletedPrompt";
          tabId: string;
          path: string;
          dirty: boolean;
      };

export interface DecideWorkspaceExternalChangeOptions {
    workspace: WorkspaceState;
    event: FrontendFileWatchEvent;
    selfWrite: SelfWriteMarker | null;
}

export function decideWorkspaceExternalChange({
    workspace,
    event,
    selfWrite,
}: DecideWorkspaceExternalChangeOptions): WorkspaceExternalChangeDecision {
    const path = normalizeWorkspacePath(event.path);

    if (
        event.kind === "changed" &&
        selfWrite &&
        normalizeWorkspacePath(selfWrite.path) === path &&
        event.fingerprint !== undefined &&
        event.fingerprint ===
            (selfWrite.fingerprint ?? documentFingerprint(selfWrite.markdown))
    ) {
        return { kind: "ignore" };
    }

    if (event.kind === "renamed") {
        const toPath = normalizeWorkspacePath(event.newPath);

        return {
            kind: "remapPathAndPrefix",
            fromPath: path,
            toPath,
            oldPrefix: path,
            newPrefix: toPath,
        };
    }

    const tab = findOpenTabByPath(workspace, path);

    if (event.kind === "created") {
        if (!tab) {
            return { kind: "refreshTree", path };
        }

        return tab.dirty
            ? { kind: "showConflict", tabId: tab.tabId, path }
            : { kind: "reloadCleanTab", tabId: tab.tabId, path };
    }

    if (!tab) {
        return { kind: "refreshTree", path };
    }

    if (event.kind === "deleted") {
        return {
            kind: "showDeletedPrompt",
            tabId: tab.tabId,
            path,
            dirty: tab.dirty,
        };
    }

    return tab.dirty
        ? { kind: "showConflict", tabId: tab.tabId, path }
        : { kind: "reloadCleanTab", tabId: tab.tabId, path };
}

function findOpenTabByPath(
    workspace: WorkspaceState,
    path: string,
): WorkspaceTab | null {
    const normalizedPath = normalizeWorkspacePath(path);

    for (const tabId of workspace.tabOrder) {
        const tab = workspace.tabs[tabId];

        if (tab && normalizeWorkspacePath(tab.path) === normalizedPath) {
            return tab;
        }
    }

    return null;
}

const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
    0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
    0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
    0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export function documentFingerprint(content: string): string {
    const bytes = new TextEncoder().encode(content);
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const message = new Uint8Array(paddedLength);
    message.set(bytes);
    message[bytes.length] = 0x80;

    const bitLengthHigh = Math.floor(bytes.length / 0x20000000);
    const bitLengthLow = (bytes.length * 8) >>> 0;
    writeUint32(message, paddedLength - 8, bitLengthHigh);
    writeUint32(message, paddedLength - 4, bitLengthLow);

    let hash0 = 0x6a09e667;
    let hash1 = 0xbb67ae85;
    let hash2 = 0x3c6ef372;
    let hash3 = 0xa54ff53a;
    let hash4 = 0x510e527f;
    let hash5 = 0x9b05688c;
    let hash6 = 0x1f83d9ab;
    let hash7 = 0x5be0cd19;
    const words = new Uint32Array(64);

    for (let chunkOffset = 0; chunkOffset < message.length; chunkOffset += 64) {
        for (let index = 0; index < 16; index += 1) {
            const offset = chunkOffset + index * 4;
            words[index] =
                ((message[offset] << 24) |
                    (message[offset + 1] << 16) |
                    (message[offset + 2] << 8) |
                    message[offset + 3]) >>>
                0;
        }

        for (let index = 16; index < 64; index += 1) {
            const word15 = words[index - 15];
            const word2 = words[index - 2];
            const sigma0 =
                rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
            const sigma1 =
                rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);

            words[index] =
                (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
        }

        let a = hash0;
        let b = hash1;
        let c = hash2;
        let d = hash3;
        let e = hash4;
        let f = hash5;
        let g = hash6;
        let h = hash7;

        for (let index = 0; index < 64; index += 1) {
            const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
            const choice = (e & f) ^ (~e & g);
            const temp1 = (h + sigma1 + choice + SHA256_K[index] + words[index]) >>> 0;
            const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (sigma0 + majority) >>> 0;

            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        hash0 = (hash0 + a) >>> 0;
        hash1 = (hash1 + b) >>> 0;
        hash2 = (hash2 + c) >>> 0;
        hash3 = (hash3 + d) >>> 0;
        hash4 = (hash4 + e) >>> 0;
        hash5 = (hash5 + f) >>> 0;
        hash6 = (hash6 + g) >>> 0;
        hash7 = (hash7 + h) >>> 0;
    }

    return [
        hash0,
        hash1,
        hash2,
        hash3,
        hash4,
        hash5,
        hash6,
        hash7,
    ]
        .map(toHexWord)
        .join("");
}

function rotateRight(value: number, bits: number) {
    return (value >>> bits) | (value << (32 - bits));
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
}

function toHexWord(value: number) {
    return value.toString(16).padStart(8, "0");
}
