# MDX Product North Star

MDX 是一个本地优先的 LLM Wiki Markdown 工作区。

它以桌面 Markdown 编辑器作为人的操作界面，以本地 CLI / Agent 协议作为自动化界面。用户在本机文件夹中编辑、阅读和组织 Markdown；Agent 则可以在用户授权下消化素材、维护索引、生成实体与主题页面，并把知识库逐步演化成一个持久化、可追溯、可审计的 wiki。

MDX 基于 [Karpathy 的 LLM Wiki 方法](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 来组织长期知识：

- `raw/` 保存原始素材，作为事实来源。
- `wiki/` 保存由人和 Agent 共同维护的 Markdown 知识页面。
- `index.md` 提供内容导览，让人和 Agent 都能快速定位相关页面。
- `log.md` 记录 ingest、query、digest、lint 等关键操作。
- wikilink、frontmatter、source 引用和变更记录共同保证知识可以回溯。

MDX 的目标不是只做一个 Markdown 预览编辑器，而是让人和 Agent 能在同一个本地工作区里协作维护知识库：人负责判断、修订和确认；Agent 负责整理、连接、检索、综合和持续维护。

## Product Principles

- Local-first: 知识库优先保存在用户本机文件夹中。
- Markdown-native: 所有核心知识都应该能以普通 Markdown 文件长期保存和迁移。
- Agent-operable: 桌面应用需要提供稳定的 CLI / 本地协议，让 Agent 能安全地读取、打开、编辑和保存工作区内容。
- Auditable automation: Agent 可以自动生成和更新页面，但重要改动应该能通过来源、引用、日志和 diff 被用户审计。
- Incremental wiki: 每次素材消化和问题回答都应该有机会沉淀为可复用的 wiki 页面，而不是一次性的聊天结果。
