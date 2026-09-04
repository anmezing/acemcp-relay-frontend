// Agent 规则中的工具面与 lce 仓库 docs/contracts/cloud-protocol.json 保持一致。
// 见 lib/agent-rules.contract.test.ts；工具改名或增删必须跨仓库同步。
const SERVER_TOOLS = [
  { name: "codebase-retrieval", location: "server", desc: "融合语义、关键词和精确术语，召回带文件路径与行号的相关代码", descEn: "Retrieve relevant code with file paths and line ranges using semantic, keyword, and exact-term search" },
  { name: "codebase_symbol_graph", location: "server", desc: "查询符号定义、引用、调用链、导入依赖、相关测试和影响范围", descEn: "Query definitions, references, call chains, imports, related tests, and impact" },
  { name: "codebase_deep_graph", location: "server", desc: "在已就绪的 Neo4j 根投影上查询多跳影响、路径、环和有界邻域分析", descEn: "Query multi-hop impact, paths, cycles, and bounded-neighborhood analysis on a ready Neo4j root projection" },
  { name: "codebase_graph_algorithm", location: "server", desc: "提交或查询异步 SCC、中心性图算法任务，并明确报告执行器是否可用", descEn: "Submit or inspect asynchronous SCC and centrality jobs, with explicit executor availability" },
  { name: "codebase_enhance_prompt", location: "server", desc: "结合已索引的真实代码，将自然语言任务整理为目标、约束和验证步骤", descEn: "Ground a natural-language task in indexed code and produce goals, constraints, and verification steps" },
  { name: "codebase_index_status", location: "server", desc: "查看各项目根的索引状态、处理进度与失败原因", descEn: "Report index readiness, progress, and failure details for each project root" },
] as const;

export const NPM_LOCAL_TOOLS = [
  { name: "codebase_git_context", location: "local", desc: "读取当前工作区的 Git 状态、diff、提交历史、blame 与分支上下文", descEn: "Read Git status, diffs, history, blame, and branch context from the current workspace" },
  { name: "codebase_review_changes", location: "local", desc: "基于本地变更生成风险、检索计划和测试计划，可按需联动云端检索", descEn: "Review local changes for risks, retrieval plans, and test plans, with optional cloud retrieval" },
] as const;

export const CLOUD_TOOLS = [
  ...SERVER_TOOLS,
  ...NPM_LOCAL_TOOLS,
] as const;

export const AGENT_RULES_CLOUD = `## LCE 工具使用规则

- 查找、理解、定位代码优先使用 \`codebase-retrieval\`，用自然语言描述功能、符号或逻辑，不要先用 grep、rg 或逐文件浏览。
- 分析符号定义、引用、调用链、依赖关系与修改影响使用 \`codebase_symbol_graph\`。
- 需要 3 跳以上的传播链、多路径、环或有界邻域分析时使用 \`codebase_deep_graph\`；必须传当前索引分支对应的 \`root_id\`。结果中的 SCC/中心性仅代表返回的有界邻域，不能表述为全租户图结论。
- 需要整根图的 SCC 或中心性时使用 \`codebase_graph_algorithm\`：提交任务传 \`operation=submit\`、\`root_id\` 和 \`algorithm\`，查询任务传 \`operation=status\` 和 \`job_id\`。这是异步能力；若返回执行器不可用，应如实说明，不要假装已计算或退回同步全图计算。
- 当用户明确要求增强/优化提示词，或要求先生成基于当前代码的实施说明时，调用 \`codebase_enhance_prompt\`：完整原始任务放入 \`prompt\`，已知符号、文件名或错误码放入可选的 \`technical_terms\`。将返回结果作为补充计划，原始要求始终优先；不要对每个普通任务自动调用。
- 当检索提示索引未就绪、正在构建或失败，或者用户询问索引进度时，调用 \`codebase_index_status\`；已知项目路径时传 \`repo_path\`，已知索引根标识时传 \`root_id\`，都不传则查看全部项目根。直接向用户说明状态、进度和失败原因，不要要求用户打开控制台确认。
- Git 状态、diff、提交历史、blame 与分支上下文使用 \`codebase_git_context\`。
- 评审当前变更的风险、检索范围和测试计划使用 \`codebase_review_changes\`。
- 仅当 LCE 工具不可用，或需要精确的正则 / 字面量匹配时，才退回本地全文搜索。`;

export const AGENT_RULES_CLOUD_EN = `## LCE Tool Usage

- Use \`codebase-retrieval\` first when finding, understanding, or locating code. Describe the feature, symbol, or logic in natural language instead of starting with grep, rg, or browsing files.
- Use \`codebase_symbol_graph\` for symbol definitions, references, call chains, dependencies, and change impact.
- Use \`codebase_deep_graph\` for propagation chains beyond three hops, multiple paths, cycles, or bounded-neighborhood analysis, and pass the \`root_id\` for the current indexed branch. Treat online SCC and centrality as bounded-neighborhood results, not tenant-wide graph conclusions.
- Use \`codebase_graph_algorithm\` for whole-root SCC or centrality: submit with \`operation=submit\`, \`root_id\`, and \`algorithm\`; inspect with \`operation=status\` and \`job_id\`. This is asynchronous. If the executor is unavailable, report that explicitly instead of claiming a result or running a synchronous whole-graph fallback.
- When the user explicitly asks to enhance/refine a prompt or requests a code-grounded implementation brief first, call \`codebase_enhance_prompt\`: put the complete original task in \`prompt\` and known symbols, file names, or error codes in optional \`technical_terms\`. Treat the result as a supplemental plan and keep the original request authoritative; do not call it automatically for every ordinary task.
- When retrieval reports that an index is not ready, building, or failed, or when the user asks about indexing progress, call \`codebase_index_status\`. Pass \`repo_path\` when the project path is known, \`root_id\` when the indexed root ID is known, or neither to inspect all roots. Report the state, progress, and failure reason directly instead of asking the user to open the console.
- Use \`codebase_git_context\` for Git status, diffs, commit history, blame, and branch context.
- Use \`codebase_review_changes\` to review change risks, retrieval scope, and test plans.
- Fall back to local text search only when LCE is unavailable or exact regex/literal matching is required.`;
