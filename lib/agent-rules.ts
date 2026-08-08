export const AGENT_RULES_CLOUD = `## 代码检索（LCE）

- 查找、理解、定位代码一律优先使用 \`codebase-retrieval\`（语义检索），用自然语言描述要找的功能、符号或逻辑，不要先用 grep / 逐文件浏览。
- 分析符号的定义、引用、调用链、依赖关系与修改影响用 \`codebase_symbol_graph\`。
- Git 状态、diff、提交历史、blame、分支上下文用 \`codebase_git_context\`。
- 变更评审（review range、风险点、检索计划、测试计划）用 \`codebase_review_changes\`。
- 仅当 LCE 工具不可用，或需要精确的正则 / 字面量匹配时，才退回本地全文搜索。`;

export const AGENT_RULES_REMOTE = `## 代码检索（LCE）

- 首次处理项目或代码发生变化后，先调用 \`codebase_index\` 建立索引：提交完整文本文件清单，只上传服务端返回的待更新文件，并在全部批次成功后完成任务。
- 查找、理解、定位代码一律优先使用 \`codebase-retrieval\`（语义检索），用自然语言描述要找的功能、符号或逻辑，不要先用 grep / 逐文件浏览。
- 分析调用关系与修改影响用 \`codebase_symbol_graph\`。
- 本地文件读取和 Git 状态/历史仍使用当前编码 Agent 自身工具；不要把 .env、密钥、二进制、依赖目录或构建产物提交到索引。
- 仅当 LCE 工具不可用，或需要精确的正则 / 字面量匹配时，才退回本地全文搜索。`;

// 兼容旧导入
export const AGENT_RULES_SNIPPET = AGENT_RULES_REMOTE;
