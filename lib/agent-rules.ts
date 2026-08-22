// 控制台"可用工具"列表的单一源头。cloud 工具面与 lce 仓库
// docs/contracts/cloud-protocol.json 的 cloudToolSurface 契约钉住
// （见 lib/agent-rules.contract.test.ts），改名/增删必须三仓库同步。
const SHARED_REMOTE_TOOLS = [
  { name: "codebase-retrieval", location: "server", desc: "融合语义、关键词和精确术语，召回带文件路径与行号的相关代码", descEn: "Retrieve relevant code with file paths and line ranges using semantic, keyword, and exact-term search" },
  { name: "codebase_symbol_graph", location: "server", desc: "查询符号定义、引用、调用链、导入依赖、相关测试和影响范围", descEn: "Query definitions, references, call chains, imports, related tests, and impact" },
  { name: "codebase_enhance_prompt", location: "server", desc: "结合已索引的真实代码，将自然语言任务整理为目标、约束和验证步骤", descEn: "Ground a natural-language task in indexed code and produce goals, constraints, and verification steps" },
] as const;

export const NPM_LOCAL_TOOLS = [
  { name: "codebase_git_context", location: "local", desc: "读取当前工作区的 Git 状态、diff、提交历史、blame 与分支上下文", descEn: "Read Git status, diffs, history, blame, and branch context from the current workspace" },
  { name: "codebase_review_changes", location: "local", desc: "基于本地变更生成风险、检索计划和测试计划，可按需联动云端检索", descEn: "Review local changes for risks, retrieval plans, and test plans, with optional cloud retrieval" },
] as const;

export const CLOUD_TOOLS = [
  ...SHARED_REMOTE_TOOLS,
  ...NPM_LOCAL_TOOLS,
] as const;

export const REMOTE_TOOLS = [
  ...SHARED_REMOTE_TOOLS,
  { name: "codebase_index", location: "server", desc: "远程 HTTP 模式下显式执行首次索引和增量索引", descEn: "Explicitly run initial and incremental indexing in Remote HTTP mode" },
] as const;

export const AGENT_RULES_CLOUD = `## LCE 工具使用规则

- 默认 npx 配置会自动下载并运行 npm 客户端，无需全局安装；本规则适用于完整的 5 工具模式。
- （服务端）查找、理解、定位代码一律优先使用 \`codebase-retrieval\`，用自然语言描述要找的功能、符号或逻辑，不要先用 grep / 逐文件浏览。
- （服务端）分析符号的定义、引用、调用链、依赖关系与修改影响用 \`codebase_symbol_graph\`。
- （服务端）需要把自然语言任务整理为带代码证据的目标、要求、约束和验证步骤时，用 \`codebase_enhance_prompt\`。
- （本地 npm 客户端）Git 状态、diff、提交历史、blame、分支上下文用 \`codebase_git_context\`。
- （本地 npm 客户端）变更评审（review range、风险点、检索计划、测试计划）用 \`codebase_review_changes\`。
- 若改用远程 HTTP 直连而不运行 npm 客户端，\`codebase_git_context\` 和 \`codebase_review_changes\` 不可用，也没有自动文件监听、增量索引与分支视图跟踪。
- 仅当 LCE 工具不可用，或需要精确的正则 / 字面量匹配时，才退回本地全文搜索。`;

export const AGENT_RULES_REMOTE = `## LCE 工具使用规则

- 当前为远程 HTTP 直连模式，不运行 npm 客户端；只提供 4 个服务端工具，不提供本地工具 \`codebase_git_context\` 和 \`codebase_review_changes\`，也没有自动文件监听、增量索引与分支视图跟踪。
- （服务端）首次处理项目或代码发生变化后，先调用 \`codebase_index\` 建立索引：提交完整文本文件清单，只上传服务端返回的待更新文件，并在全部批次成功后完成任务。
- （服务端）查找、理解、定位代码一律优先使用 \`codebase-retrieval\`，用自然语言描述要找的功能、符号或逻辑，不要先用 grep / 逐文件浏览。
- （服务端）分析调用关系与修改影响用 \`codebase_symbol_graph\`。
- （服务端）需要把自然语言任务整理为带代码证据的目标、要求、约束和验证步骤时，用 \`codebase_enhance_prompt\`。
- Git 状态、历史、blame 和变更评审使用当前编码 Agent 自身的本地工具；不要把 .env、密钥、二进制、依赖目录或构建产物提交到索引。
- 仅当 LCE 工具不可用，或需要精确的正则 / 字面量匹配时，才退回本地全文搜索。`;

export const AGENT_RULES_CLOUD_EN = `## LCE Tool Usage

- The default npx configuration downloads and runs the npm client automatically; no global install is required. These rules apply to the complete five-tool mode.
- (Server-provided) Always use \`codebase-retrieval\` first when finding, understanding, or locating code. Describe the feature, symbol, or logic in natural language instead of starting with grep or browsing files.
- (Server-provided) Use \`codebase_symbol_graph\` for symbol definitions, references, call chains, dependencies, and change impact.
- (Server-provided) Use \`codebase_enhance_prompt\` to turn a natural-language task into goals, requirements, constraints, and verification steps grounded in verified repository context.
- (Local npm client) Use \`codebase_git_context\` for Git status, diffs, commit history, blame, and branch context.
- (Local npm client) Use \`codebase_review_changes\` for review ranges, risks, retrieval plans, and test plans.
- A direct Remote HTTP connection without the npm client omits \`codebase_git_context\` and \`codebase_review_changes\`, local file watching, automatic incremental indexing, and branch-view tracking.
- Fall back to local text search only when LCE is unavailable or exact regex/literal matching is required.`;

export const AGENT_RULES_REMOTE_EN = `## LCE Tool Usage

- This is direct Remote HTTP mode without the npm client. It exposes only four server-provided tools; \`codebase_git_context\` and \`codebase_review_changes\` are unavailable, along with local file watching, automatic incremental indexing, and branch-view tracking.
- (Server-provided) When first working with a project or after code changes, call \`codebase_index\`: submit the complete list of text files, upload only files requested by the server, and finish after every batch succeeds.
- (Server-provided) Always use \`codebase-retrieval\` first when finding, understanding, or locating code. Describe the feature, symbol, or logic in natural language instead of starting with grep or browsing files.
- (Server-provided) Use \`codebase_symbol_graph\` for call relationships and change impact.
- (Server-provided) Use \`codebase_enhance_prompt\` to turn a natural-language task into goals, requirements, constraints, and verification steps grounded in verified repository context.
- Use the coding agent's own local tools for Git status, history, blame, and change review. Never submit .env files, keys, binaries, dependency directories, or build output to the index.
- Fall back to local text search only when LCE is unavailable or exact regex/literal matching is required.`;
