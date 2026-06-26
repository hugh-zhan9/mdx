import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LightMirror } from "./light-mirror";

describe("LightMirror", () => {
    it("renders a lightweight semantic DOM mirror for canvas-only blocks", () => {
        const html = renderToStaticMarkup(
            <LightMirror
                blocks={[
                    {
                        blockId: "math-1",
                        pmFrom: 12,
                        pmTo: 15,
                        semanticText: "x squared",
                        ariaLabel: "math x squared",
                    },
                ]}
            />,
        );

        expect(html).toContain("data-layout-light-mirror");
        expect(html).toContain('class="sr-only"');
        expect(html).toContain('aria-hidden="false"');
        expect(html).toContain('data-mirror-block-id="math-1"');
        expect(html).toContain('data-mirror-pm-from="12"');
        expect(html).toContain('data-mirror-pm-to="15"');
        expect(html).toContain('aria-label="math x squared"');
        expect(html).toContain("x squared");
    });
});
