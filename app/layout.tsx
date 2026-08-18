import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import "./prism-themes.css";

export const metadata: Metadata = {
    title: "Loam",
    description: "Markdown 工作区编辑器",
};

/**
 * Runs synchronously before React hydrates so the theme is set on the first
 * paint (no FOUC). The preference is `system` or a theme id; legacy `theme`
 * values are accepted as a migration fallback.
 *
 * The appearance table is duplicated from `features/workspace/lib/themes.ts`
 * because this runs as a string before any module has loaded. It is only ever
 * read to decide light-or-dark for the first frame — the module takes over on
 * hydration — so a theme missing here paints one frame with a mismatched
 * scrollbar rather than the wrong palette.
 */
const themeInitScript = `
(function () {
  var DARK = { dark: 1, midnight: 1, ink: 1, cocoa: 1, obsidian: 1 };
  var read = function () {
    try { return localStorage.getItem("themePreference") || localStorage.getItem("theme") || "system"; } catch (_) { return "system"; }
  };
  var osDark = function () {
    return matchMedia("(prefers-color-scheme: dark)").matches;
  };
  var apply = function (theme) {
    var appearance = DARK[theme] ? "dark" : "light";
    if (theme.indexOf("user:") === 0) {
      // A theme from a file: its palette cannot be read this early, so the one
      // generated last time is reinstated for the first frame. React replaces
      // both the rules and this guess as soon as the directory is read.
      try {
        var cached = localStorage.getItem("userThemeCss");
        if (cached) {
          var style = document.createElement("style");
          style.id = "mdx-user-themes";
          style.textContent = cached;
          document.head.appendChild(style);
        }
        var meta = JSON.parse(localStorage.getItem("userThemeMeta") || "[]");
        for (var i = 0; i < meta.length; i += 1) {
          if (meta[i] && meta[i].id === theme) {
            appearance = meta[i].appearance === "dark" ? "dark" : "light";
          }
        }
      } catch (_) {}
    }
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mdxAppearance = appearance;
    document.documentElement.style.colorScheme = appearance;
  };
  var resolve = function () {
    var preference = read();
    if (preference && preference !== "system") return preference;
    return osDark() ? "dark" : "light";
  };
  apply(resolve());
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
    if (read() !== "system") return;
    apply(e.matches ? "dark" : "light");
  });
})();
`;

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="zh-CN" className="h-full" suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
            </head>
            <body className="h-full bg-base-100 text-base-content antialiased">
                {children}
            </body>
        </html>
    );
}
