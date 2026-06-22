import { Schema } from "prosemirror-model";
import type { SyntaxRegistry } from "./types";

export function buildSchemaFromRegistry(registry: SyntaxRegistry): Schema {
    return new Schema({
        nodes: registry.nodes,
        marks: registry.marks,
    });
}
