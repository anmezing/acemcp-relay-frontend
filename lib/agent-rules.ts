// Agent 规则中的工具面与 lce 仓库 docs/contracts/cloud-protocol.json 保持一致。
// 见 lib/agent-rules.contract.test.ts；工具改名或增删必须跨仓库同步。
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

- 查找、理解、定位代码优先使用 \`codebase-retrieval\`，用自然语言描述功能、符号或逻辑，不要先用 grep 或逐文件浏览。
- 分析符号定义、引用、调用链、依赖关系与修改影响使用 \`codebase_symbol_graph\`。
- 当用户明确要求增强/优化提示词，或要求先生成基于当前代码的实施说明时，调用 \`codebase_enhance_prompt\`：完整原始任务放入 \`prompt\`，已知符号、文件名或错误码放入可选的 \`technical_terms\`。将返回结果作为补充计划，原始要求始终优先；不要对每个普通任务自动调用。
- Git 状态、diff、提交历史、blame 与分支上下文使用 \`codebase_git_context\`。
- 评审当前变更的风险、检索范围和测试计划使用 \`codebase_review_changes\`。
- 仅当 LCE 工具不可用，或需要精确的正则 / 字面量匹配时，才退回本地全文搜索。`;

export const AGENT_RULES_REMOTE = `## LCE 工具使用规则

- 首次处理项目、代码发生变化或切换分支后，调用 \`codebase_index\` 更新索引：提交完整文本文件清单，只上传服务端返回的待更新文件，并在全部批次成功后完成任务。
- 查找、理解、定位代码优先使用 \`codebase-retrieval\`，用自然语言描述功能、符号或逻辑，不要先用 grep 或逐文件浏览。
- 分析符号定义、引用、调用链和修改影响使用 \`codebase_symbol_graph\`。
- 当用户明确要求增强/优化提示词，或要求先生成基于当前代码的实施说明时，调用 \`codebase_enhance_prompt\`：完整原始任务放入 \`prompt\`，已知符号、文件名或错误码放入可选的 \`technical_terms\`。将返回结果作为补充计划，原始要求始终优先；不要对每个普通任务自动调用。
- Git 状态、历史、blame 和变更评审使用编码 Agent 自身的本地工具。构建索引清单时遵循仓库的 Git 忽略规则，不要提交 .env、证书、私钥、二进制、依赖目录或构建产物。
- 仅当 LCE 工具不可用，或需要精确的正则 / 字面量匹配时，才退回本地全文搜索。`;

export const AGENT_RULES_CLOUD_EN = `## LCE Tool Usage

- Use \`codebase-retrieval\` first when finding, understanding, or locating code. Describe the feature, symbol, or logic in natural language instead of starting with grep or browsing files.
- Use \`codebase_symbol_graph\` for symbol definitions, references, call chains, dependencies, and change impact.
- When the user explicitly asks to enhance/refine a prompt or requests a code-grounded implementation brief first, call \`codebase_enhance_prompt\`: put the complete original task in \`prompt\` and known symbols, file names, or error codes in optional \`technical_terms\`. Treat the result as a supplemental plan and keep the original request authoritative; do not call it automatically for every ordinary task.
- Use \`codebase_git_context\` for Git status, diffs, commit history, blame, and branch context.
- Use \`codebase_review_changes\` to review change risks, retrieval scope, and test plans.
- Fall back to local text search only when LCE is unavailable or exact regex/literal matching is required.`;

export const AGENT_RULES_REMOTE_EN = `## LCE Tool Usage

- When first working with a project, after code changes, or after switching branches, call \`codebase_index\`: submit the complete list of text files, upload only files requested by the server, and finish after every batch succeeds.
- Use \`codebase-retrieval\` first when finding, understanding, or locating code. Describe the feature, symbol, or logic in natural language instead of starting with grep or browsing files.
- Use \`codebase_symbol_graph\` for symbol definitions, references, call chains, and change impact.
- When the user explicitly asks to enhance/refine a prompt or requests a code-grounded implementation brief first, call \`codebase_enhance_prompt\`: put the complete original task in \`prompt\` and known symbols, file names, or error codes in optional \`technical_terms\`. Treat the result as a supplemental plan and keep the original request authoritative; do not call it automatically for every ordinary task.
- Use the coding agent's own local tools for Git status, history, blame, and change review. Follow the repository's Git ignore rules when building the index manifest; never submit .env files, certificates, private keys, binaries, dependency directories, or build output.
- Fall back to local text search only when LCE is unavailable or exact regex/literal matching is required.`;
