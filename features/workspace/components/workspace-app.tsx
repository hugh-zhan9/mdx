export function WorkspaceApp() {
    return (
        <main
            data-mdx-root
            className="h-screen min-h-0 bg-base-100 text-base-content"
        >
            <div className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)_280px] grid-rows-[44px_minmax(0,1fr)]">
                <header className="col-span-3 flex items-center justify-between border-b border-base-300 bg-base-200 px-4">
                    <div className="text-sm font-semibold">MDX</div>
                    <div className="text-xs text-base-content/60">
                        Workspace
                    </div>
                </header>

                <aside className="min-h-0 border-r border-base-300 bg-base-100">
                    <div className="flex h-10 items-center border-b border-base-300 px-3 text-xs font-medium uppercase tracking-wide text-base-content/55">
                        Files
                    </div>
                    <div className="p-3 text-sm text-base-content/55">
                        No workspace open
                    </div>
                </aside>

                <section className="min-h-0 bg-base-100">
                    <div className="flex h-10 items-center border-b border-base-300 px-4 text-sm text-base-content/65">
                        Untitled
                    </div>
                    <div className="flex h-[calc(100%-2.5rem)] items-center justify-center px-6 text-sm text-base-content/50">
                        Select a markdown file to start.
                    </div>
                </section>

                <aside className="min-h-0 border-l border-base-300 bg-base-100">
                    <div className="flex h-10 items-center border-b border-base-300 px-3 text-xs font-medium uppercase tracking-wide text-base-content/55">
                        Outline
                    </div>
                    <div className="p-3 text-sm text-base-content/55">
                        No headings
                    </div>
                </aside>
            </div>
        </main>
    );
}
