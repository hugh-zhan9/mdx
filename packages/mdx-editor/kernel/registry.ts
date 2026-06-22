import type {
    BlockParserContribution,
    InlineParserContribution,
    RegisteredBlockParser,
    RegisteredInlineParser,
    SyntaxPhase,
    SyntaxPlugin,
    SyntaxRegistry,
} from "./types";

const syntaxPhaseOrder: Record<SyntaxPhase, number> = {
    block: 0,
    inline: 1,
    fallback: 2,
    clipboard: 3,
};

const allowedSyntaxPhases = new Set<SyntaxPhase>([
    "block",
    "inline",
    "fallback",
    "clipboard",
]);

export function createSyntaxRegistry(plugins: SyntaxPlugin[]): SyntaxRegistry {
    const seenPlugins = new Set<string>();
    const nodes: SyntaxRegistry["nodes"] = {};
    const marks: SyntaxRegistry["marks"] = {};
    const blockParsers: RegisteredBlockParser[] = [];
    const inlineParsers: RegisteredInlineParser[] = [];
    const serializers: SyntaxRegistry["serializers"] = [];
    const nodeViews: SyntaxRegistry["nodeViews"] = {};
    const editorPlugins: SyntaxRegistry["editorPlugins"] = [];
    const clipboard: SyntaxRegistry["clipboard"] = [];

    for (const plugin of plugins) {
        if (seenPlugins.has(plugin.id)) {
            throw new Error(`Duplicate syntax plugin id: ${plugin.id}`);
        }
        seenPlugins.add(plugin.id);

        for (const [name, spec] of Object.entries(plugin.nodes ?? {})) {
            if (nodes[name]) {
                throw new Error(`Duplicate schema node: ${name}`);
            }
            nodes[name] = spec;
        }

        for (const [name, spec] of Object.entries(plugin.marks ?? {})) {
            if (marks[name]) {
                throw new Error(`Duplicate schema mark: ${name}`);
            }
            marks[name] = spec;
        }

        blockParsers.push(
            ...(plugin.blockParsers ?? []).map((parser) =>
                registerParserContribution(plugin.id, parser),
            ),
        );
        inlineParsers.push(
            ...(plugin.inlineParsers ?? []).map((parser) =>
                registerParserContribution(plugin.id, parser),
            ),
        );

        if (plugin.serializers) {
            serializers.push(plugin.serializers);
        }
        Object.assign(nodeViews, plugin.nodeViews ?? {});
        editorPlugins.push(...(plugin.editorPlugins ?? []));
        if (plugin.clipboard) {
            clipboard.push(plugin.clipboard);
        }
    }

    blockParsers.sort(compareContributions);
    inlineParsers.sort(compareContributions);

    return {
        plugins,
        nodes,
        marks,
        blockParsers,
        inlineParsers,
        serializers,
        nodeViews,
        editorPlugins,
        clipboard,
    };
}

function registerParserContribution<
    T extends BlockParserContribution | InlineParserContribution,
>(pluginId: string, parser: T): T & { pluginId: string } {
    validateParserContribution(pluginId, parser);
    return {
        ...parser,
        pluginId,
    };
}

function validateParserContribution(
    pluginId: string,
    parser: BlockParserContribution | InlineParserContribution,
) {
    if (!allowedSyntaxPhases.has(parser.phase)) {
        throw new Error(
            `Invalid parser phase for syntax plugin ${pluginId}: ${String(parser.phase)}`,
        );
    }

    if (typeof parser.priority !== "number" || !Number.isFinite(parser.priority)) {
        throw new Error(
            `Invalid parser priority for syntax plugin ${pluginId}: expected a finite number`,
        );
    }
}

function compareContributions(
    a: { phase: SyntaxPhase; priority: number },
    b: { phase: SyntaxPhase; priority: number },
) {
    if (a.phase !== b.phase) {
        return syntaxPhaseOrder[a.phase] - syntaxPhaseOrder[b.phase];
    }
    return b.priority - a.priority;
}
