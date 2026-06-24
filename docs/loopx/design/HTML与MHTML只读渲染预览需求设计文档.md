# HTML与MHTML只读渲染预览设计文档

## 一、修订历史

| 版本号 | 修订内容 | 修订时间 | 修订人 |
|---|---|---|---|
| V1.0.0 | 新建初稿，基于 clarify 结果恢复 Workspace Mode HTML/MHTML 渲染预览 | 2026-06-18 | Codex |

## 二、需求信息

### 2.1 需求背景

- 背景：用户反馈 `.mhtml` 文件之前支持显示，当前不支持了。仓库证据显示 `.mhtml` 在 `features/workspace/lib/path.ts` 中被归为 plain text，`features/workspace/components/editor-stage.tsx` 将 text/html tab 都路由到 `TextPreview`，因此 `.mhtml/.html` 当前显示源码而不是渲染页面。
- 需求目的：恢复 Workspace Mode 中 `.html/.htm/.mhtml` 的只读渲染预览能力，尤其是 `.mhtml` 浏览器归档文件的正文、图片和 CSS。
- 目标用户/使用方：MDX Workspace Mode 用户；不面向 Document Mode 和 `mdx-cli` 编辑自动化。
- 需求链接：无外部 PRD。
- 关联原始材料：
  - `.loopx/intake/clarify-editor-wysiwyg-and-mhtml-preview-20260618144226.md`
  - `features/workspace/lib/path.ts`
  - `features/workspace/components/editor-stage.tsx`
  - `src-tauri/src/workspace_fs.rs`
  - `src-tauri/src/workspace_fs_tests.rs`

### 2.2 需求范围

- 本期范围：
  - Workspace Mode 点击 `.html/.htm` 时显示只读渲染预览。
  - Workspace Mode 点击 `.mhtml` 时解析 MHTML 归档，渲染主 HTML、归档内图片和 CSS。
  - 预览必须允许用户选中并复制页面文本。
  - 预览必须禁用脚本、表单提交、弹窗、外部导航、Tauri API 访问。
  - 预览默认不加载外部网络资源，只使用文件自身和 MHTML 归档内资源。
  - 解析失败时显示错误，并可提供源码兜底视图用于诊断。
- 非目标：
  - 不支持 HTML/MHTML 编辑、保存、dirty 状态、草稿恢复、CLI insert/selection。
  - 不扩展 Document Mode 或系统文件关联。
  - 不实现完整浏览器兼容层，不执行 JS。
  - 不让外部网络资源自动请求。
- 决策边界：
  - plan 可决定 MHTML MIME parser 库、resource rewrite 数据结构、组件文件名、错误文案、fixture 组织。
  - 必须回 spec：允许脚本执行、允许外部网络自动加载、把 HTML/MHTML 纳入编辑/保存。
  - 必须回 clarify：要求 Document Mode 支持 HTML/MHTML，或要求对 MHTML 内 JS 行为完整兼容。
- 依赖方：
  - 前端 Workspace preview route。
  - Tauri preview file read commands。
  - 可选开源 MIME/MHTML 解析库，许可证需为 MIT/Apache/BSD 等商业友好许可。
- 约束条件：
  - 只读预览必须保持 workspace root 防逃逸。
  - iframe 必须 sandbox，且不得授予 `allow-scripts`。
  - 外部链接可以展示，但点击不应在 iframe 内导航到外网；如后续支持打开，应走系统浏览器并显式触发。

### 2.3 可行性分析

- 业务可行性：这是用户明确的回归修复，且只涉及 Workspace 只读预览，边界清晰。
- 技术可行性：`.html/.htm` 可通过 `Blob(type: "text/html")` + sandbox iframe 渲染；`.mhtml` 可解析 multipart MIME，抽取主 HTML 和 resource parts 后重写资源引用为 blob/data URL。
- 团队接受能力：中等复杂度；MHTML 解析兼容性是主要工作量，但不牵涉 Markdown 编辑器内核。
- 时间成本：小到中。HTML 预览较快，MHTML 归档资源解析需要 fixture 覆盖常见编码和 content-id 引用。
- 资源成本：仅本地前端处理和临时 object URL；不需要新增后端存储。
- 替代方案：
  - 继续 TextPreview：成本低，但不满足用户恢复渲染显示的要求。
  - 交给系统默认应用打开：安全简单，但丢失工作区内预览体验。
  - 使用 unsandboxed iframe：兼容性高，但安全风险不可接受。
- 关键风险：
  - MHTML 方言差异，quoted-printable/base64、charset、Content-Location、cid 引用处理不一致。
  - sandbox 配置错误可能允许脚本或导航。
  - 大型 MHTML 资源多，可能带来内存峰值。

## 三、概要设计

### 3.1 方案总述

- 设计目标：
  - 恢复 HTML/MHTML 在 Workspace Mode 内的只读渲染预览。
  - 支持 MHTML 归档内图片和 CSS。
  - 禁脚本、禁自动外网请求，避免任意本地网页获得应用执行能力。
- 总体思路：
  - 调整 `EditorStage` 的文件类型路由：`.html/.htm/.mhtml` 使用新的 `HtmlPreview`，不再使用 `TextPreview`。
  - `.html/.htm` 读取文本后进行安全重写，生成 sandbox iframe source。
  - `.mhtml` 读取文本后解析 MIME parts，选取主 HTML part，将归档内 CSS/image resources 转成 object URL 或 data URL，重写 HTML 内的 `src`、`href`、CSS `url(...)`。
  - iframe 使用 `sandbox`，不授予 `allow-scripts`，通过 CSP/meta 或重写策略禁止网络外链加载。
- 核心模块：
  - `features/workspace/lib/html-preview-security.ts`
  - `features/workspace/lib/mhtml-archive.ts`
  - `features/workspace/components/html-preview.tsx`
  - `features/workspace/components/editor-stage.tsx`
- 主要难点：
  - MIME multipart 边界和编码解析。
  - resource URL 匹配：`cid:...`、relative path、Content-Location absolute URL。
  - 禁止网络请求同时保留归档内资源。
- 技术指标：
  - 常见浏览器保存的 MHTML 能渲染主正文、样式和图片。
  - 预览加载失败不影响其他 tab。
  - 切换 tab 或卸载组件时释放 object URL。

### 3.2 整体架构设计

- 业务模式：Workspace 内文件只读预览。
- 系统边界：
  - 前端负责 HTML/MHTML 解析、资源重写、iframe sandbox。
  - Rust/Tauri 继续负责 workspace root 校验和文件读取。
  - 不进入 Markdown editor bridge，不参与 dirty/save/CLI。
- 上下游系统：
  - 上游：Workspace tab path、`read_preview_text_file`。
  - 下游：sandbox iframe、用户复制操作。
- 应用架构：
  - `EditorStage` 识别 `html` kind 后渲染 `HtmlPreview`。
  - `HtmlPreview` 根据扩展名选择 plain HTML 处理或 MHTML 处理。
  - `HtmlPreview` 管理 object URL 生命周期和错误状态。
- 技术架构：
  - HTML sanitizer/rewrite 只做预览级安全约束，不试图生成永久文件。
  - MHTML parser 输出 `{ html, resources, diagnostics }`。
  - Resource rewriter 把归档内资源映射到 blob/data URL，并移除或中和外部资源。
- 数据流转：
  - `.html/.htm`：read text -> sanitize/rewrite -> Blob HTML URL -> iframe。
  - `.mhtml`：read text -> parse MIME -> decode parts -> select HTML -> rewrite resource references -> Blob HTML URL -> iframe。

### 3.3 核心流程设计

| 流程 | 触发条件 | 参与系统/模块 | 主流程 | 异常/补偿 | 输出 |
|---|---|---|---|---|---|
| HTML 预览 | 用户打开 `.html/.htm` tab | EditorStage、HtmlPreview、Tauri read command | 读取文本，移除脚本能力，重写外链资源，创建 sandbox iframe | 读取或处理失败显示错误，可显示源码兜底 | 渲染页面 |
| MHTML 预览 | 用户打开 `.mhtml` tab | HtmlPreview、MHTML parser、resource rewriter | 解析 MIME，选主 HTML part，解码 CSS/image，重写引用，创建 iframe | 主 HTML 缺失时报错；资源缺失保留占位或断图 | 渲染归档页面 |
| 卸载清理 | 切换 tab 或关闭预览 | HtmlPreview | revoke iframe/object/resource URLs | 清理失败不阻断 UI | 释放内存 |

### 3.4 功能模块

| 模块 | 职责 | 关键功能 | 依赖 | 备注 |
|---|---|---|---|---|
| `HtmlPreview` | 渲染 HTML/MHTML tab | 加载、错误、iframe、URL 清理 | Tauri read command | 替代 html/text preview 路由 |
| `mhtml-archive` | 解析 MHTML | multipart boundary、headers、quoted-printable/base64、resource map | 可选 MIME 库 | 需 fixture 测试 |
| `html-preview-security` | 安全重写 | 移除 script、禁止外链自动加载、注入 CSP/meta、sandbox 参数 | DOMParser 或字符串处理 | 不执行用户 HTML |
| `EditorStage` 路由 | 选择预览组件 | `.html/.htm/.mhtml` 走 HtmlPreview | path helpers | `.mhtml` 不再 plain text |

### 3.5 新增/调整功能说明

- 新增 HTML/MHTML 渲染预览组件。
- 调整 `getTabKind` 顺序或分类，确保 `.mhtml` 不被 plain text 分支提前捕获。
- 调整 path helper：可新增 `isMhtmlFilePath`，并让 `isHtmlFilePath` 或 `isRenderableHtmlFilePath` 表达 `.html/.htm/.mhtml` 预览语义。
- 保留 `TextPreview` 给 `.txt/.json/.xml` 等文本文件。

## 四、详细设计

### 4.1 HTML/MHTML 路由详细设计

#### 4.1.1 需求内容

- 入口：`EditorStage` 根据 active tab path 选择 preview。
- 操作人/调用方：Workspace Mode 用户。
- 前置条件：active tab 是 previewable file。
- 输出结果：HTML/MHTML 使用渲染预览，而非源码 `<pre>`。

#### 4.1.2 方案设计

- 核心逻辑：新增 `.mhtml` 类型判断，并在 `getTabKind` 中让 `.mhtml` 返回 `"html"` 或 `"mhtml"`，避免被 plain text 分支捕获。
- 状态流转：active tab -> tab kind -> `HtmlPreview`。
- 数据变更：无持久化变更。
- 计算公式：不涉及。
- 幂等设计：相同 path 反复打开渲染结果一致。
- 权限/越权控制：继续使用后端 preview read command 的 root/path guard。
- 异常处理：未知扩展仍走 unsupported/default app 逻辑。
- 补偿/重试：用户可切换 tab 后重新进入触发加载。
- 日志与审计：开发环境可 `console.warn` 解析失败，不记录文件正文。

#### 4.1.3 流程步骤

1. `EditorStage` 调用 path helper 判定 active tab 类型。
2. `.html/.htm/.mhtml` 返回 HTML preview kind。
3. 渲染 `HtmlPreview`。
4. 其他文本文件继续渲染 `TextPreview`。

#### 4.1.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| `.mhtml` 同时在 plain text extensions 中 | HTML/MHTML 判断优先 | 显示渲染预览 | 测试覆盖 |
| 不支持扩展 | 保持 default/unsupported 行为 | 不在应用内渲染 | 无 |

### 4.2 MHTML 解析与资源重写详细设计

#### 4.2.1 需求内容

- 入口：`parseMhtmlArchive(rawText)`。
- 操作人/调用方：`HtmlPreview`。
- 前置条件：已读取 `.mhtml` 文本。
- 输出结果：主 HTML、归档内资源 map、diagnostics。

#### 4.2.2 方案设计

- 核心逻辑：
  - 解析顶层 MIME headers，找到 multipart boundary。
  - 拆分 parts，读取每个 part 的 `Content-Type`、`Content-Transfer-Encoding`、`Content-Location`、`Content-ID`。
  - 解码 quoted-printable/base64/7bit/8bit。
  - 选择第一个 `text/html` part 为主文档；CSS parts 和 image parts 进入资源表。
  - 对 HTML 的 `src/href/srcset` 和 style/CSS 的 `url(...)` 做引用替换：匹配 `cid:`、Content-ID、Content-Location、相对 URL。
  - 未匹配的外部网络资源中和为空或保留不可自动加载链接。
- 状态流转：raw MHTML -> MIME parts -> decoded resources -> rewritten HTML。
- 数据变更：只创建内存对象和 object URL。
- 计算公式：不涉及。
- 幂等设计：同一输入生成相同 HTML 和资源映射。
- 权限/越权控制：不从磁盘读取 MHTML 之外的资源，不请求网络。
- 异常处理：MIME boundary 缺失、主 HTML 缺失、解码失败返回 diagnostic 和错误状态。
- 补偿/重试：可显示源码兜底。
- 日志与审计：不上传或记录文件内容。

#### 4.2.3 流程步骤

1. 读取 MHTML 文本。
2. 解析 boundary 和 parts。
3. 解码每个 part。
4. 选择主 HTML。
5. 为 CSS/image 创建 object URL 或 data URL。
6. 重写 HTML/CSS 引用。
7. 生成 iframe blob URL。

#### 4.2.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 无 `text/html` part | 报错并可展示源码兜底 | 看到错误 | 测试 |
| 图片 part 无可匹配 URL | 不渲染该图片 | 断图或空白 | diagnostic |
| quoted-printable 软换行 | 正确合并 | 页面正常 | fixture |
| base64 图片 | 解码为 Blob URL | 图片显示 | fixture |
| 外部 `https://` CSS/image | 移除或阻断 | 不加载外网资源 | fixture |

### 4.3 安全预览详细设计

#### 4.3.1 需求内容

- 入口：`HtmlPreview` 渲染 iframe。
- 操作人/调用方：Workspace 用户。
- 前置条件：已生成 preview HTML blob URL。
- 输出结果：可读、可复制、安全受限的网页预览。

#### 4.3.2 方案设计

- 核心逻辑：
  - iframe 使用 `sandbox`，不包含 `allow-scripts`。
  - 允许文本选择复制；如需要同源样式访问，优先不授予 `allow-same-origin`，除非 plan 证明必须且不会扩大 Tauri API 风险。
  - 删除 `<script>`、事件 handler 属性、`javascript:` URL。
  - 注入 CSP meta，限制 `default-src 'none'`，允许 `img-src blob: data:`、`style-src 'unsafe-inline' blob: data:`，禁止网络。
  - 链接默认不在 iframe 内导航。
- 状态流转：rewritten HTML -> sandbox iframe。
- 数据变更：无。
- 计算公式：不涉及。
- 幂等设计：渲染是只读操作。
- 权限/越权控制：sandbox + CSP + URL rewrite。
- 异常处理：iframe load error 显示错误状态。
- 补偿/重试：重新打开 tab。
- 日志与审计：不记录正文。

#### 4.3.3 流程步骤

1. 生成安全 HTML 字符串。
2. 创建 Blob URL。
3. 渲染 iframe。
4. 组件卸载时 revoke URL。

#### 4.3.4 边界条件

| 场景 | 处理方式 | 用户/调用方感知 | 监控/告警 |
|---|---|---|---|
| 页面包含 JS | 不执行 | 动态功能不可用 | 安全测试 |
| 页面包含外链 | 不自动加载 | 样式/图片可能缺失 | fixture |
| 页面表单 | 禁止提交或无效 | 不提交数据 | 安全测试 |

## 五、存储类设计

### 5.1 库表设计

不涉及数据库。

#### 5.1.1 数据库模型图

不涉及。

#### 5.1.2 表结构

不涉及。

字段明细：不涉及。

### 5.2 数据迁移/初始化

- DDL：不涉及。
- DML：不涉及。
- 数据回填：不涉及。
- 老数据兼容：现有 `.html/.htm/.mhtml` 文件无需迁移。
- 新老系统读写关系：只读预览，不产生写入。

### 5.3 缓存设计

| 场景 | Key | Value | 数据结构 | 过期时长 | 容量预估 | 失效/刷新策略 |
|---|---|---|---|---|---|---|
| 预览资源 URL | 当前组件实例 | Blob/Object URL | 内存 | 组件生命周期 | 单文件资源大小 | 组件卸载 revoke |

## 六、其他组件设计

### 6.1 消息设计

不涉及消息。

### 6.2 配置设计

| 配置项 | 环境 | 默认值 | 是否动态生效 | 说明 | 风险 |
|---|---|---|---|---|---|
| 外部网络资源加载 | 全环境 | 禁用 | 否 | 本期固定禁用，不设用户开关 | 若误开放会产生隐私和安全风险 |

### 6.3 定时任务/批处理

不涉及。

### 6.4 技术组件

- 分布式锁：不涉及。
- 唯一 ID：object URL 由浏览器生成。
- 加解密/验签：不涉及。
- 字典转换：文件扩展名到 preview kind。
- Excel/文件处理：不涉及。
- 用户信息透传：不涉及。
- 限流/熔断：不涉及。

## 七、接口设计

### 7.1 接口设计原则

- 优先复用现有 Tauri preview read command。
- 所有文件读取必须保持 workspace root 校验。
- HTML/MHTML 预览不新增写接口。

### 7.2 接口清单

| 接口 | 调用方 | 服务方 | 权限/认证 | 幂等 | 文档地址 | 备注 |
|---|---|---|---|---|---|---|
| `read_preview_text_file` | `HtmlPreview` | Tauri/Rust | Workspace root path guard | 查询幂等 | 本文 | 读取 `.html/.htm/.mhtml` 文本 |

### 7.3 接口明细

#### 7.3.1 `read_preview_text_file`

- 路径/方法：Tauri invoke `read_preview_text_file`
- 请求头：不涉及。
- 请求参数：`rootPath: string`，`path: string`
- 响应参数：文件文本内容。
- 错误码：`not_found`、`invalid_name`、`outside_workspace`、`read_failed` 等现有错误。
- 业务校验：文件必须在 workspace root 内，扩展名必须是允许的 preview text/html 类型。
- 数据变更：无。
- 日志字段：不记录正文；错误可记录 path/error code。

## 八、系统发布

### 8.1 灰度方案

- 灰度范围：本地单用户应用，不设用户灰度。
- 灰度开关：无。
- 验证指标：手动打开 fixture `.html/.mhtml`，测试通过。
- 放量节奏：随本地版本发布。

### 8.2 降级方案

- 降级触发条件：MHTML 解析失败或安全策略误伤严重。
- 降级行为：显示错误和源码兜底；不回退为默认源码展示的正常路径。
- 用户影响：无法渲染个别归档，但可看到诊断。
- 恢复方式：修复 parser/resource rewrite。

### 8.3 关联系统/功能影响

| 系统/功能 | 影响 | 依赖动作 | 负责人 | 验证方式 |
|---|---|---|---|---|
| Workspace file preview | HTML/MHTML 从源码预览改为渲染预览 | 调整路由和组件 | 前端 | 组件测试/手动 |
| TextPreview | 不再处理 `.html/.htm/.mhtml` | 保持其他文本扩展 | 前端 | path tests |
| Tauri preview read | 继续复用 | 无或补充测试 | Rust | cargo test |

### 8.4 回滚方案

- 回滚条件：预览安全策略存在严重缺陷。
- 回滚步骤：回滚 `EditorStage` HTML/MHTML 路由到错误提示或默认系统打开，不建议回到源码作为正常行为。
- 数据回滚：无。
- 配置回滚：无。
- 风险：用户暂时无法在应用内渲染 HTML/MHTML。

## 九、系统监控与维护

### 9.1 监控与告警

- 系统异常：前端显示 load/parse error。
- 业务异常：MHTML 缺主 HTML、资源解码失败。
- 重试异常：用户重新打开 tab。
- 超时：大型文件可在 plan 中加入软超时或大小提示。
- 关键接口指标：本地应用无集中监控。
- 告警渠道：不涉及。

### 9.2 性能与容量

- TPS/吞吐：单用户交互。
- CPU/内存/磁盘 IO/网络 IO：MHTML 解析和资源 Blob 会占用内存；网络 IO 必须为 0。
- 数据容量：受单个归档大小影响。
- 缓存容量：组件生命周期内资源 URL。
- 跑批耗时：不涉及。
- 是否压测：不需要压测，但需要大文件手动验证。

### 9.3 可靠性与兜底

- 幂等击穿：不涉及。
- 并发失效：快速切换 tab 时必须取消 stale state update 并 revoke URL。
- 冷热备：不涉及。
- 兜底：错误状态和源码兜底视图。

## 十、排期与规划

### Planning Handoff

`plan-to-exec` 可决定：

- 是否引入 MIME/MHTML 解析库，以及具体库。
- `HtmlPreview` 和 parser 文件拆分。
- Object URL vs data URL 细节。
- fixture 文件和测试命名。
- 错误 UI 细节。

必须返回 `spec` 或 `clarify`：

- 允许脚本执行。
- 允许外部网络资源自动加载。
- HTML/MHTML 变成可编辑或可保存。
- Document Mode 支持 HTML/MHTML。

建议下一步：

```text
$plan-to-exec docs/loopx/design/HTML与MHTML只读渲染预览需求设计文档.md
```

## 十一、QA

- 单元测试：
  - path helper：`.html/.htm/.mhtml` 进入 HTML preview kind。
  - MHTML parser：boundary、base64、quoted-printable、Content-ID、Content-Location。
  - resource rewrite：归档内图片/CSS 成功替换，外部 URL 被阻断。
  - security rewrite：script、event handler、`javascript:` 被移除。
- 组件测试：
  - `EditorStage` 对 `.mhtml` 渲染 `HtmlPreview`，不渲染 `TextPreview`。
  - load error 显示错误。
  - 卸载 revoke object URL。
- 手动验证：
  - 打开浏览器保存的 `.mhtml`，正文、样式、图片显示。
  - 页面文本可选择复制。
  - JS 不执行，外链资源不请求。
  - Markdown/PDF/image/text preview 不回归。
