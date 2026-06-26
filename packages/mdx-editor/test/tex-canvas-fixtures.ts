export const TEX_CANVAS_FIXTURE_BLOCK_KINDS = [
    "fallback",
    "math",
    "mermaid",
    "paragraph",
    "table",
] as const;

export type TexCanvasFixtureBlockKind =
    (typeof TEX_CANVAS_FIXTURE_BLOCK_KINDS)[number];

export interface TexCanvasFixtureExpectations {
    blockKinds: TexCanvasFixtureBlockKind[];
    canvasBlockKinds: Exclude<TexCanvasFixtureBlockKind, "paragraph">[];
    lineSnippets: string[];
    mirrorText: string;
    hasMathInline?: boolean;
}

export interface TexCanvasFixture {
    id: string;
    markdown: string;
    expected: TexCanvasFixtureExpectations;
}

export const TEX_CANVAS_FIXTURE_CORPUS_JSON = String.raw`[
  {
    "id": "paragraph-cjk",
    "markdown": "中文 English 混排段落。\nSecond line stays textual.\n",
    "expected": {
      "blockKinds": ["paragraph"],
      "canvasBlockKinds": [],
      "lineSnippets": ["中文 English", "Second line"],
      "mirrorText": "中文 English 混排段落。 Second line stays textual."
    }
  },
  {
    "id": "math-inline",
    "markdown": "公式 $x^2 + y^2 = z^2$ 跟正文混排。\n",
    "expected": {
      "blockKinds": ["paragraph"],
      "canvasBlockKinds": [],
      "lineSnippets": ["公式 ", " 跟正文混排。"],
      "mirrorText": "公式 x^2 + y^2 = z^2 跟正文混排。",
      "hasMathInline": true
    }
  },
  {
    "id": "table-basic",
    "markdown": "| 列 A | 列 B |\n| --- | --- |\n| 1 | 2 |\n",
    "expected": {
      "blockKinds": ["table"],
      "canvasBlockKinds": ["table"],
      "lineSnippets": ["列 A", "1", "2"],
      "mirrorText": "列 A 列 B 1 2"
    }
  },
  {
    "id": "mermaid-basic",
    "markdown": "\u0060\u0060\u0060mermaid\ngraph TD\n  A --> B\n\u0060\u0060\u0060\n",
    "expected": {
      "blockKinds": ["mermaid"],
      "canvasBlockKinds": ["mermaid"],
      "lineSnippets": ["graph TD", "A --> B"],
      "mirrorText": "graph TD A --> B"
    }
  },
  {
    "id": "html-fallback",
    "markdown": "<div data-x=\"1\">\n  <span>HTML</span>\n</div>\n",
    "expected": {
      "blockKinds": ["fallback"],
      "canvasBlockKinds": ["fallback"],
      "lineSnippets": ["<div data-x=\"1\">", "<span>HTML</span>"],
      "mirrorText": "<div data-x=\"1\"> <span>HTML</span> </div>"
    }
  },
  {
    "id": "mixed-layout",
    "markdown": "开场段落里有行内公式 $a+b$，后面接一个流程图。\n\n\u0060\u0060\u0060mermaid\ngraph LR\n  Start --> Stop\n\u0060\u0060\u0060\n\n<div class=\"unsupported\">raw html block</div>\n\n| 列 A | 列 B |\n| --- | --- |\n| 左 | 右 |\n",
    "expected": {
      "blockKinds": ["paragraph", "mermaid", "fallback", "table"],
      "canvasBlockKinds": ["mermaid", "fallback", "table"],
      "lineSnippets": [
        "开场段落里有行内公式 ",
        "graph LR",
        "<div class=\"unsupported\">raw html block</div>",
        "列 A",
        "左",
        "右"
      ],
      "mirrorText": "开场段落里有行内公式 a+b，后面接一个流程图。 graph LR Start --> Stop <div class=\"unsupported\">raw html block</div> 列 A 列 B 左 右",
      "hasMathInline": true
    }
  }
]`;

export const TEX_CANVAS_FIXTURES: TexCanvasFixture[] = JSON.parse(
    TEX_CANVAS_FIXTURE_CORPUS_JSON,
) as TexCanvasFixture[];

export const texCanvasFixtures = TEX_CANVAS_FIXTURES;
