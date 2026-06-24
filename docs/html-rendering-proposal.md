# HTML 渲染改进方案

## 背景

当前编辑器对 HTML 的支持有限：
- 行内 HTML 只支持 `<kbd>` 标签实时渲染
- 块级 HTML 作为 fallback 处理，点击才能编辑
- 没有折叠展开交互

## 需求

1. 一般 HTML 实时渲染
2. 点击显示原 HTML 代码
3. 带折叠的 HTML（如 `<details>`）支持点击打开/关闭
4. 保持安全性（防止 XSS）

## 方案对比

### 方案 A：扩展安全行内标签白名单 ⭐️ 推荐

**适用场景：** 常见行内语义标签

**支持标签：**
- `<kbd>` - 键盘按键
- `<mark>` - 高亮标记
- `<sup>` - 上标
- `<sub>` - 下标
- `<abbr>` - 缩写
- `<cite>` - 引用
- `<code>` - 代码（已有 backtick 语法，作为补充）
- `<var>` - 变量
- `<samp>` - 示例输出
- `<time>` - 时间
- `<small>` - 小号文本

**实现思路：**
```typescript
// 1. 扩展 parser/inline-markdown.ts 的 tryParseInlineHtml()
function tryParseInlineHtml(text: string, startIndex: number) {
    // 支持的安全标签列表
    const safeInlineTags = ['kbd', 'mark', 'sup', 'sub', 'abbr', 'cite', 'var', 'samp', 'time', 'small'];
    
    // 匹配 <tag>content</tag> 或 <tag attr="value">content</tag>
    const match = text.slice(startIndex).match(/^<([a-zA-Z][\w:-]*)\b([^>]*)>(.*?)<\/\1>/);
    
    if (!match) return null;
    
    const tag = match[1].toLowerCase();
    if (!safeInlineTags.includes(tag)) return null;
    
    return {
        html: match[0],
        tag: tag,
        content: match[3],
        nextIndex: startIndex + match[0].length,
    };
}

// 2. 更新 InlineHtmlNodeView.tsx 的渲染逻辑
function inlineHtmlPreview(html: string) {
    const tag = firstHtmlTag(html);
    const text = inlineHtmlText(html);
    
    // 使用 dangerouslySetInnerHTML 渲染安全的 HTML
    // 已经通过 parser 白名单过滤
    return (
        <span 
            className="mdx-inline-html-rendered"
            dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(html) }}
        />
    );
}

// 3. 添加点击切换编辑模式
<button
    aria-label="Edit inline HTML"
    className="mdx-inline-html-preview"
    onClick={() => setEditing(true)}
    onDoubleClick={() => setEditing(true)}  // 双击编辑
    type="button"
>
    {inlineHtmlPreview(html)}
</button>
```

**优点：**
- ✅ 实现简单，风险可控
- ✅ 符合现有架构
- ✅ 白名单确保安全
- ✅ 支持大部分语义化标签

**缺点：**
- ❌ 不支持块级 HTML（`<details>`, `<div>` 等）
- ❌ 不支持复杂嵌套

---

### 方案 B：块级 HTML 节点类型

**适用场景：** 块级交互元素（`<details>`, `<dialog>` 等）

**实现思路：**

```typescript
// 1. 在 schema.ts 添加新节点类型
html_block: {
    group: "block",
    content: "text*",
    attrs: {
        html: {},
        tag: { default: null },
        collapsed: { default: true },  // 用于 <details>
        sourceId: { default: null },
    },
    toDOM: (node) => [
        "div",
        {
            "data-mdx-node-type": "html_block",
            "data-mdx-html": node.attrs.html,
            "data-mdx-collapsed": node.attrs.collapsed ? "true" : "false",
        },
        0,
    ],
}

// 2. parser/block-markdown.ts 扩展 HTML 识别
function tryParseHtmlBlock(logicalLines, cursor, markdown, sourceSlices) {
    const firstLine = logicalLines[cursor]?.text ?? "";
    
    // 识别 <details>, <div>, <section> 等块级元素
    const blockMatch = firstLine.match(/^<(details|div|section|article|aside|blockquote)(\s[^>]*)?>$/);
    if (!blockMatch) return null;
    
    const tag = blockMatch[1];
    let endLine = cursor;
    
    // 查找闭合标签
    const closeTag = `</${tag}>`;
    for (let i = cursor + 1; i < logicalLines.length; i++) {
        if (logicalLines[i]?.text.trim() === closeTag) {
            endLine = i;
            break;
        }
    }
    
    if (endLine === cursor) return null;
    
    const start = logicalLines[cursor].start;
    const end = logicalLines[endLine].end;
    const html = markdown.slice(start, end);
    
    return {
        node: mdxEditorSchema.nodes.html_block.create({
            html: html,
            tag: tag,
            collapsed: tag === 'details',
        }),
        nextCursor: endLine + 1,
    };
}

// 3. react/html-block-node-view.tsx 新建组件
export function HtmlBlockNodeView({ node, updateAttrs }: NodeViewProps) {
    const html = String(node.attrs.html ?? "");
    const tag = String(node.attrs.tag ?? "");
    const [editing, setEditing] = useState(false);
    const [collapsed, setCollapsed] = useState(node.attrs.collapsed);
    
    if (tag === 'details') {
        return (
            <details 
                open={!collapsed}
                onClick={(e) => {
                    if (e.target.tagName === 'SUMMARY') {
                        setCollapsed(!collapsed);
                        updateAttrs({ collapsed: !collapsed });
                    }
                }}
                onDoubleClick={() => setEditing(true)}
            >
                <summary>
                    {extractSummary(html) || "Details"}
                    <button onClick={() => setEditing(true)}>编辑</button>
                </summary>
                <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(extractContent(html)) }} />
            </details>
        );
    }
    
    // 其他块级元素
    return (
        <div 
            className="mdx-html-block"
            onDoubleClick={() => setEditing(true)}
        >
            {editing ? (
                <textarea value={html} onChange={...} />
            ) : (
                <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
            )}
        </div>
    );
}
```

**优点：**
- ✅ 支持块级 HTML
- ✅ 原生 `<details>` 折叠交互
- ✅ 可扩展支持更多块级元素

**缺点：**
- ❌ 实现复杂度较高
- ❌ 需要新增节点类型
- ❌ 安全性需要仔细处理

---

### 方案 C：统一的 HTML 预览模式（混合方案）

**特点：** 结合方案 A 和 B，提供统一体验

**实现分层：**

1. **安全行内标签** → 直接渲染（方案 A）
2. **交互块级标签**（`<details>`）→ 特殊节点（方案 B）
3. **其他 HTML** → source_fallback（现有方案）

```typescript
// parser 决策树
function parseHtmlToken(text, context) {
    const tag = extractTag(text);
    
    if (isSafeInlineTag(tag)) {
        return createInlineHtml(text);  // 方案 A
    }
    
    if (isInteractiveBlockTag(tag)) {
        return createHtmlBlock(text);   // 方案 B
    }
    
    return createSourceFallback(text);  // 现有
}
```

---

## 推荐实施路径

### 阶段 1：快速改进（1-2 天）
✅ **实施方案 A**
- 扩展行内 HTML 白名单
- 更新 `InlineHtmlNodeView` 渲染逻辑
- 添加双击编辑交互

### 阶段 2：完整支持（3-5 天）
📋 **实施方案 B** - 如需要块级 HTML
- 添加 `html_block` 节点类型
- 实现 `<details>` 折叠交互
- 支持 `<div>` 等容器元素

### 阶段 3：优化体验（可选）
🎨 **UI/UX 改进**
- 添加编辑/预览切换按钮
- 优化样式和交互动画
- 添加 HTML 语法高亮

---

## 安全考虑

### 必须过滤的危险内容：
```typescript
function sanitizeHtml(html: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // 1. 移除危险标签
    doc.querySelectorAll('script, iframe, object, embed, link, meta, style').forEach(el => el.remove());
    
    // 2. 移除危险属性
    doc.querySelectorAll('*').forEach(el => {
        Array.from(el.attributes).forEach(attr => {
            if (attr.name.startsWith('on') || 
                attr.value.includes('javascript:') ||
                attr.value.includes('data:text/html')) {
                el.removeAttribute(attr.name);
            }
        });
    });
    
    return doc.body.innerHTML;
}
```

### 白名单策略：
- **行内标签：** 只渲染明确列出的标签
- **块级标签：** 只支持有限的安全块级元素
- **属性：** 过滤掉所有事件处理器和脚本

---

## CSS 样式建议

```css
/* 行内 HTML 渲染 */
.mdx-inline-html-rendered kbd {
    padding: 0.1em 0.3em;
    border: 1px solid #ccc;
    border-radius: 3px;
    background: #f4f4f4;
    font-family: monospace;
}

.mdx-inline-html-rendered mark {
    background: #ffeb3b;
    padding: 0 0.2em;
}

/* 编辑状态 */
.mdx-inline-html[data-mdx-editing="true"] {
    outline: 2px solid #2196f3;
    outline-offset: 2px;
}

/* 块级 HTML */
.mdx-html-block {
    position: relative;
}

.mdx-html-block:hover .mdx-html-edit-button {
    opacity: 1;
}

/* details 折叠样式 */
details[data-mdx-node-type="html_block"] summary {
    cursor: pointer;
    user-select: none;
}

details[data-mdx-node-type="html_block"] summary::-webkit-details-marker {
    display: none;
}
```

---

## 测试用例

```markdown
# 行内 HTML 测试

这是 <kbd>Command</kbd> + <kbd>Z</kbd> 快捷键。

这是 <mark>高亮文本</mark> 和 <sup>上标</sup> 以及 <sub>下标</sub>。

化学式：H<sub>2</sub>O，数学：x<sup>2</sup> + y<sup>2</sup>

# 块级 HTML 测试

<details>
  <summary>展开查看详情</summary>
  <p>这是详细内容。</p>
  <ul>
    <li>列表项 1</li>
    <li>列表项 2</li>
  </ul>
</details>

<div class="custom-block">
  <p>自定义块级内容</p>
</div>
```

---

## 下一步行动

1. ✅ **确认需求优先级**
   - 只需要行内 HTML？→ 方案 A
   - 需要 `<details>` 折叠？→ 方案 B
   - 需要完整支持？→ 方案 C

2. 📝 **创建实现任务**
   - [ ] 更新 parser 逻辑
   - [ ] 扩展 schema 定义（如需）
   - [ ] 实现 NodeView 组件
   - [ ] 添加样式
   - [ ] 编写测试

3. 🧪 **测试验证**
   - [ ] 单元测试
   - [ ] 渲染测试
   - [ ] 安全测试
   - [ ] 用户交互测试

请告诉我你更倾向哪个方案，我可以立即开始实现！
