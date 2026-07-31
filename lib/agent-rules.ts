// CLAUDE.md / AGENTS.md 建议片段：让 AI 代理检索代码时优先使用 LCE 工具。
// 只添加 MCP 服务器并不保证代理会用它——需要在项目规则文件里显式要求。
// 首页「开始使用」与控制台「配置说明」共用此文案。
export const AGENT_RULES_SNIPPET = `## 代码检索（LCE）

- 查找、理解、定位代码一律优先使用 \`codebase-retrieval\`（语义检索），用自然语言描述要找的功能、符号或逻辑，不要先用 grep / 逐文件浏览。
- 分析调用关系与修改影响用 \`codebase_symbol_graph\`；查看远程索引规模用 \`codebase_tenant_stats\`。
- 仅当 LCE 工具不可用，或需要精确的正则 / 字面量匹配时，才退回本地全文搜索。`;
