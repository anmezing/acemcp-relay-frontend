// 控制台"可用工具"列表的单一源头。cloud 工具面与 lce 仓库
// docs/contracts/cloud-protocol.json 的 cloudToolSurface 契约钉住
// （见 lib/agent-rules.contract.test.ts），改名/增删必须三仓库同步。
const SHARED_REMOTE_TOOLS = [
  { name: "codebase-retrieval", desc: "语义检索项目代码上下文", descEn: "Semantic retrieval for project code context" },
  { name: "codebase_symbol_graph", desc: "符号调用关系与依赖分析", descEn: "Symbol calls and dependency analysis" },
  { name: "codebase_enhance_prompt", desc: "基于真实代码上下文增强任务提示词", descEn: "Enhance tasks with verified repository context" },
] as const;

export const NPM_LOCAL_TOOLS = [
  { name: "codebase_git_context", desc: "Git 状态、diff、提交历史、blame", descEn: "Git status, diffs, history, and blame" },
  { name: "codebase_review_changes", desc: "变更评审与检索计划", descEn: "Change review and retrieval planning" },
] as const;

export const CLOUD_TOOLS = [
  ...SHARED_REMOTE_TOOLS,
  ...NPM_LOCAL_TOOLS,
] as const;

export const REMOTE_TOOLS = [
  ...SHARED_REMOTE_TOOLS,
  { name: "codebase_index", desc: "首次与增量建立项目代码索引", descEn: "Initial and incremental project indexing" },
] as const;

export const AGENT_RULES_CLOUD = `## 代码检索（LCE）

- 查找、理解、定位代码一律优先使用 \`codebase-retrieval\`（语义检索），用自然语言描述要找的功能、符号或逻辑，不要先用 grep / 逐文件浏览。
- 分析符号的定义、引用、调用链、依赖关系与修改影响用 \`codebase_symbol_graph\`。
- 需要把自然语言任务整理为带代码证据的目标、要求、约束和验证步骤时，用 \`codebase_enhance_prompt\`。
- Git 状态、diff、提交历史、blame、分支上下文用 \`codebase_git_context\`。
- 变更评审（review range、风险点、检索计划、测试计划）用 \`codebase_review_changes\`。
- 仅当 LCE 工具不可用，或需要精确的正则 / 字面量匹配时，才退回本地全文搜索。`;

export const AGENT_RULES_REMOTE = `## 代码检索（LCE）

- 首次处理项目或代码发生变化后，先调用 \`codebase_index\` 建立索引：提交完整文本文件清单，只上传服务端返回的待更新文件，并在全部批次成功后完成任务。
- 查找、理解、定位代码一律优先使用 \`codebase-retrieval\`（语义检索），用自然语言描述要找的功能、符号或逻辑，不要先用 grep / 逐文件浏览。
- 分析调用关系与修改影响用 \`codebase_symbol_graph\`。
- 需要把自然语言任务整理为带代码证据的目标、要求、约束和验证步骤时，用 \`codebase_enhance_prompt\`。
- 本地文件读取和 Git 状态/历史仍使用当前编码 Agent 自身工具；不要把 .env、密钥、二进制、依赖目录或构建产物提交到索引。
- 仅当 LCE 工具不可用，或需要精确的正则 / 字面量匹配时，才退回本地全文搜索。`;

export const AGENT_RULES_CLOUD_EN = `## Code Retrieval (LCE)

- Always use \`codebase-retrieval\` first when finding, understanding, or locating code. Describe the feature, symbol, or logic in natural language instead of starting with grep or browsing files.
- Use \`codebase_symbol_graph\` for symbol definitions, references, call chains, dependencies, and change impact.
- Use \`codebase_enhance_prompt\` to turn a natural-language task into goals, requirements, constraints, and verification steps grounded in verified repository context.
- Use \`codebase_git_context\` for Git status, diffs, commit history, blame, and branch context.
- Use \`codebase_review_changes\` for review ranges, risks, retrieval plans, and test plans.
- Fall back to local text search only when LCE is unavailable or exact regex/literal matching is required.`;

export const AGENT_RULES_REMOTE_EN = `## Code Retrieval (LCE)

- When first working with a project or after code changes, call \`codebase_index\`: submit the complete list of text files, upload only files requested by the server, and finish after every batch succeeds.
- Always use \`codebase-retrieval\` first when finding, understanding, or locating code. Describe the feature, symbol, or logic in natural language instead of starting with grep or browsing files.
- Use \`codebase_symbol_graph\` for call relationships and change impact.
- Use \`codebase_enhance_prompt\` to turn a natural-language task into goals, requirements, constraints, and verification steps grounded in verified repository context.
- Continue to use the coding agent's local tools for file reads and Git status/history. Never submit .env files, keys, binaries, dependency directories, or build output to the index.
- Fall back to local text search only when LCE is unavailable or exact regex/literal matching is required.`;
