import type { Metadata } from "next";
import "./globals.css";
import "./prism-themes.css";

export const metadata: Metadata = {
    title: "MDX",
    description: "Markdown 工作区编辑器",
};

/**
 * Runs synchronously before React hydrates so `data-theme` is set on the
 * first paint (no FOUC). localStorage wins over OS; if the user hasn't
 * opted-in, we follow `prefers-color-scheme` and stay subscribed to OS flips.
 */
const themeInitScript = `
(function () {
  var read = function () {
    try { return localStorage.getItem("theme"); } catch (_) { return null; }
  };
  var osDark = function () {
    return matchMedia("(prefers-color-scheme: dark)").matches;
  };
  var apply = function (theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  };
  apply(read() || (osDark() ? "dark" : "light"));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
    if (read()) return;
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
