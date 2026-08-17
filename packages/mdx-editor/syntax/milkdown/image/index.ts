import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { imageSchema } from "@milkdown/kit/preset/commonmark";
import { $view } from "@milkdown/kit/utils";

import { editorServicesCtx } from "../../../adapter/editor-services";
import { createImageNodeView } from "./node-view";

export { isDirectImageSource } from "./node-view";
export {
    IMAGE_DOM_MARKER,
    IMAGE_NODE_NAME,
    IMAGE_RESOLVED_SOURCE_MARKER,
} from "./syntax";

const imageView = $view(imageSchema.node, (ctx: Ctx) =>
    // Read on every resolution rather than captured here, so the loader that
    // answers is the one the product offers at the time the picture is drawn.
    createImageNodeView(() => ctx.get(editorServicesCtx.key)().imageLoader),
);

/**
 * Images that draw: the view that turns the reference a document holds into
 * something the browser can load.
 *
 * The node is CommonMark's — nothing here parses, writes or validates an image,
 * and `![alt](assets/pic.png)` serializes to those exact bytes whether the
 * asset was found or not. Only the rendered element ever carries the resolved
 * URL.
 *
 * {@link editorServicesCtx} is contributed here as well as by the product's own
 * installer, because the view reads it and a composition built without the
 * product — a test, the shared analyzer, a preflight parse — must still find a
 * slice to read. Its default answers that nothing is on offer, which renders
 * the reference as written; a plugin store keyed by identity means naming it
 * twice registers it once.
 */
export function imagePlugins(): MilkdownPlugin[] {
    return [editorServicesCtx, imageView].flat();
}
