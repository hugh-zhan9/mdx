import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import "./prism-themes.css";

export const metadata: Metadata = {
    title: "MDX",
    description: "Markdown 工作区编辑器",
};

/**
 * Runs synchronously before React hydrates so `data-theme` is set on the
 * first paint (no FOUC). The preference can be light, dark, or system.
 * Legacy `theme` values are accepted as a migration fallback.
 */
const themeInitScript = `
(function () {
  var read = function () {
    try { return localStorage.getItem("themePreference") || localStorage.getItem("theme") || "system"; } catch (_) { return "system"; }
  };
  var osDark = function () {
    return matchMedia("(prefers-color-scheme: dark)").matches;
  };
  var apply = function (theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  };
  var resolve = function () {
    var preference = read();
    if (preference === "dark" || preference === "light") return preference;
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
            <body className="h-full bg-base-100 text-base-content">
                {children}
            </body>
        </html>
    );
}
