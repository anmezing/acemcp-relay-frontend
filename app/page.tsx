import { Header } from "@/components/Header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AGENT_RULES_SNIPPET } from "@/lib/agent-rules";
import { buildMcpConfigJson, buildMcpConfigToml } from "@/lib/mcp-config";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-clip bg-[#0a0f1a] animate-page-fade-in">
      {/* Ambient light effects */}
      <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-radial from-cyan-500/8 via-blue-500/4 to-transparent rounded-full blur-3xl" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-gradient-radial from-indigo-500/6 to-transparent rounded-full blur-3xl" />

      {/* Subtle grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />

      {/* Noise texture overlay */}
      <div className="absolute inset-0 opacity-[0.015] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PC9maWx0ZXI+PHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSIzMDAiIGZpbHRlcj0idXJsKCNhKSIgb3BhY2l0eT0iMSIvPjwvc3ZnPg==')]" />

      <Header />

      <main className="relative pt-28 pb-20 px-6">
        {/* Hero */}
        <section className="text-center space-y-8 mb-24">
          <div className="relative inline-block opacity-0 animate-scale-in">
            <div className="absolute -inset-x-48 -inset-y-24 pointer-events-none">
              <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-[300px] h-[200px] bg-cyan-500/60 blur-[80px] rounded-full animate-aurora-1" />
              <div className="absolute top-1/3 right-1/4 w-[250px] h-[180px] bg-emerald-500/50 blur-[70px] rounded-full animate-aurora-2" />
              <div className="absolute bottom-1/3 left-1/3 w-[280px] h-[160px] bg-blue-500/55 blur-[75px] rounded-full animate-aurora-3" />
              <div className="absolute top-1/2 right-1/3 -translate-y-1/2 w-[220px] h-[140px] bg-indigo-500/45 blur-[60px] rounded-full animate-aurora-4" />
            </div>
            <h1 className="relative text-5xl md:text-7xl font-semibold tracking-tight">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-cyan-400 to-blue-400">
                LCE
              </span>
            </h1>
          </div>

          <div className="flex items-center justify-center gap-3 opacity-0 animate-float-up animate-delay-100">
            <div className="w-12 h-px bg-gradient-to-r from-transparent to-slate-600" />
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/60" />
            <div className="w-12 h-px bg-gradient-to-l from-transparent to-slate-600" />
          </div>

          <p className="text-lg md:text-xl text-slate-400 font-light tracking-wide opacity-0 animate-float-up animate-delay-200 max-w-2xl mx-auto leading-relaxed">
            AI 编码 Agent 的代码上下文引擎，为 Cursor、Claude Code、Codex 提供语义级代码理解能力
          </p>

          <div className="flex flex-wrap justify-center gap-4 pt-4">
            {[
              { label: "语义检索", color: "emerald", delay: "animate-delay-300" },
              { label: "跨项目理解", color: "cyan", delay: "animate-delay-300" },
              { label: "行级定位", color: "blue", delay: "animate-delay-400" },
              { label: "符号图谱", color: "emerald", delay: "animate-delay-400" },
              { label: "增量索引", color: "blue", delay: "animate-delay-400" },
              { label: "多语言支持", color: "emerald", delay: "animate-delay-500" },
              { label: "变更分析", color: "cyan", delay: "animate-delay-500" },
              { label: "远程 MCP 接入", color: "blue", delay: "animate-delay-500" },
            ].map((item) => (
              <Badge
                key={item.label}
                variant="outline"
                className={cn(
                  "px-4 py-2 rounded-full bg-white/[0.03] border-white/[0.06] backdrop-blur-sm opacity-0 animate-float-up",
                  item.delay
                )}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      item.color === "emerald" && "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]",
                      item.color === "cyan" && "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]",
                      item.color === "blue" && "bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]"
                    )}
                  />
                  <span className="text-sm text-slate-300 font-light">{item.label}</span>
                </div>
              </Badge>
            ))}
          </div>
        </section>

        <div className="max-w-4xl mx-auto space-y-20">
          {/* What is LCE */}
          <section>
            <SectionTitle>LCE 是什么</SectionTitle>
            <div className="space-y-4 text-slate-400 text-[15px] leading-relaxed">
              <p>
                LCE 是一个<span className="text-white">代码上下文引擎</span>，它将代码仓库索引为结构化语义数据，让 AI 编码 Agent 能像理解人类语言一样理解你的代码。
              </p>
              <p>
                AI 编程 Agent 通常靠 grep 逐次搜索来理解代码库——一次搜一个关键词，猜对了才能找到，猜错了就漏掉相关调用和修改，每轮都在消耗<span className="text-white">上下文窗口</span>。
                LCE 把这件事变成一次调用：Agent 描述它要解决的问题，LCE 返回一整包相关代码——语义向量、全文索引、符号图谱<span className="text-white">三路召回</span>合并排序，附带调用链、定义、引用等结构化证据。Agent 不需要提前知道该搜什么关键词，也不需要多轮试探。
              </p>
              <p>
                LCE 提供开箱即用的云端服务。你无需在本地安装任何组件，只需在编码 Agent 中添加一个 MCP 服务器地址，就能直接使用全部检索能力。
              </p>
            </div>
          </section>

          {/* Core capabilities */}
          <section>
            <SectionTitle>核心能力</SectionTitle>
            <div className="grid md:grid-cols-2 gap-4">
              <FeatureCard
                title="语义代码理解"
                description="融合语义、关键词与精确术语检索。直接描述任务或问题，LCE 会理解意图并召回相关实现，无需提前知道函数名或变量名。"
              />
              <FeatureCard
                title="跨文件与跨项目理解"
                description="跨越文件、模块与多个项目串联同一业务流程，结合调用、导入、类型和符号关系补全上下文，让 AI Agent 看见完整实现而非孤立片段。"
              />
              <FeatureCard
                title="精准代码定位"
                description="检索结果携带文件路径、符号名称与精确行号范围，AI Agent 可直接定位关键实现，减少逐文件扫描和无效上下文占用。"
              />
              <FeatureCard
                title="增量索引更新"
                description="Agent 再次提交项目清单时，服务端仅要求上传新增和修改的文件，并自动处理删除，同步更新语义索引、全文索引和符号关系。"
              />
              <FeatureCard
                title="多语言代码支持"
                description="覆盖 TypeScript/JavaScript、Python、Go、Rust、Java、C/C++、C#、PHP、Swift、Kotlin 等主流语言，并可统一索引常见配置与文档文件。"
              />
              <FeatureCard
                title="符号关系图谱"
                description="基于 AST 与编译器分析构建代码图谱，追踪函数调用、类型引用、符号定义与导入依赖，清晰呈现代码的上下游关系。"
              />
              <FeatureCard
                title="变更影响分析"
                description="提交代码前分析关联调用者、依赖模块、受影响测试与潜在回归风险，让 AI Agent 的实现计划和 code review 都有代码证据。"
              />
              <FeatureCard
                title="Bug 定位"
                description="结合自然语言检索、精确术语匹配和符号调用关系，快速收敛异常路径、相关实现与潜在影响范围，减少无目的逐文件排查。"
              />
            </div>
          </section>

          {/* How to start */}
          <section>
            <SectionTitle>开始使用</SectionTitle>
            <div className="space-y-4">
              <StepCard step={1} title="注册并获取 API Key">
                登录控制台，在「密钥管理」中生成你的 API Key。
              </StepCard>
              <StepCard step={2} title="添加远程 MCP 服务器">
                <div className="space-y-3">
                  <span>Cursor 与 Claude Code 使用远程 HTTP JSON，Codex 使用 TOML。登录控制台后，可在「配置说明」中选择客户端并一键复制完整配置：</span>
                  <p className="text-xs text-slate-500">Cursor / Claude Code</p>
                  <div className="mt-3 bg-[#0a0f1a] border border-white/[0.08] rounded-lg p-4 font-mono text-sm overflow-x-auto">
                    <pre className="text-slate-300 whitespace-pre">{buildMcpConfigJson(null, null)}</pre>
                  </div>
                  <p className="pt-2 text-xs text-slate-500">Codex</p>
                  <div className="mt-3 bg-[#0a0f1a] border border-white/[0.08] rounded-lg p-4 font-mono text-sm overflow-x-auto">
                    <pre className="text-slate-300 whitespace-pre">{buildMcpConfigToml(null, null)}</pre>
                  </div>
                </div>
              </StepCard>
              <StepCard step={3} title="要求 AI Agent 优先使用 LCE">
                <div className="space-y-3">
                  <span>
                    只添加 MCP 服务器并不保证 Agent 会用它。在项目根目录的 CLAUDE.md、
                    AGENTS.md 或 .cursor/rules 中加入以下规则，
                    要求 Agent 查找、理解代码时必须优先使用 LCE 工具，而不是 grep 或逐文件浏览。
                    登录控制台后可在「配置说明」中一键复制：
                  </span>
                  <div className="mt-3 bg-[#0a0f1a] border border-white/[0.08] rounded-lg p-4 font-mono text-xs overflow-x-auto">
                    <pre className="text-slate-300 whitespace-pre-wrap break-words">{AGENT_RULES_SNIPPET}</pre>
                  </div>
                </div>
              </StepCard>
              <StepCard step={4} title="初始化代码索引">
                <div className="space-y-3">
                  <span>连接 MCP 后，让 AI Agent 同步当前项目。Agent 使用自身文件读取能力，云端服务负责差量计算与索引处理：</span>
                  <div className="mt-3 bg-[#0a0f1a] border border-white/[0.08] rounded-lg p-4 space-y-3">
                    <div className="flex gap-3">
                      <span className="text-cyan-400 font-mono text-xs shrink-0 mt-0.5">1.</span>
                      <p className="text-slate-400 text-sm">
                        Agent 扫描可索引的文本文件，计算清单并调用 codebase_index
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <span className="text-cyan-400 font-mono text-xs shrink-0 mt-0.5">2.</span>
                      <p className="text-slate-400 text-sm">
                        服务端返回待更新文件，Agent 仅分批上传这些内容
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <span className="text-cyan-400 font-mono text-xs shrink-0 mt-0.5">3.</span>
                      <p className="text-slate-400 text-sm">
                        服务端完成语义、全文、向量和符号索引；再次同步时只处理差异
                      </p>
                    </div>
                  </div>
                </div>
              </StepCard>
              <StepCard step={5} title="开始检索">
                索引就绪后，AI Agent 在编码过程中会自动调用语义检索搜索相关代码。你也可以直接要求 Agent 搜索特定功能或符号。
              </StepCard>
            </div>
          </section>

          {/* Limitations */}
          <section>
            <SectionTitle>边界说明</SectionTitle>
            <Card className="bg-[#0d1424]/60 border-white/[0.06]">
              <CardContent className="p-6">
                <ul className="space-y-4 text-slate-400 text-[15px]">
                  <li className="flex gap-3">
                    <span className="text-slate-600 shrink-0">-</span>
                    <span>LCE 是<span className="text-white">只读</span>的检索引擎，不会修改你的代码、不会执行测试、不会创建 PR</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-slate-600 shrink-0">-</span>
                    <span>检索质量取决于索引覆盖率——未索引的文件不会出现在搜索结果中</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-slate-600 shrink-0">-</span>
                    <span>远程 MCP 无法主动读取本地磁盘或监听文件变化；索引同步由编码 Agent 使用自身文件工具发起</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-slate-600 shrink-0">-</span>
                    <span>Git 状态、历史、blame 与工作区 diff 由编码 Agent 的本地 Git 工具处理，不会被包装成云端能力</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-slate-600 shrink-0">-</span>
                    <span>TypeScript/JavaScript 符号图优先使用有界编译项目；超出编译预算或无法解析的文件会降级为 AST/启发式事实，并在结果中标注 coverage 与 confidence</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-slate-600 shrink-0">-</span>
                    <span>服务端拒绝 .env、密钥、二进制、依赖目录和构建产物；仍应在提交清单前检查仓库中的其他敏感内容</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </section>
        </div>

      </main>

      <footer className="relative px-6 py-6 text-center">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-700/50 to-transparent" />
        <p className="text-sm text-slate-500">
          本项目的前端与管理后台基于 <span className="text-slate-300">heroman</span> 的开源实现构建，谨致谢意。
        </p>
      </footer>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 mb-8">
      <h2 className="text-xl md:text-2xl font-medium text-white">{children}</h2>
      <div className="flex-1 h-px bg-gradient-to-r from-white/[0.08] to-transparent" />
    </div>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <Card className="bg-[#0d1424]/60 border-white/[0.06] hover:border-white/[0.12] transition-colors">
      <CardContent className="p-5">
        <h3 className="text-white font-medium mb-2">{title}</h3>
        <p className="text-slate-400 text-sm leading-relaxed">{description}</p>
      </CardContent>
    </Card>
  );
}

function StepCard({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <Card className="bg-[#0d1424]/60 border-white/[0.06]">
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 text-cyan-400 text-sm font-medium shrink-0 mt-0.5">
            {step}
          </span>
          <div className="min-w-0">
            <h3 className="text-white font-medium mb-2">{title}</h3>
            <div className="text-slate-400 text-sm leading-relaxed">{children}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
