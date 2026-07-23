import { Header } from "@/components/Header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <div className="relative min-h-screen bg-[#0a0f1a] overflow-x-hidden animate-page-fade-in">
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
                LCE Relay
              </span>
            </h1>
          </div>

          <div className="flex items-center justify-center gap-3 opacity-0 animate-float-up animate-delay-100">
            <div className="w-12 h-px bg-gradient-to-r from-transparent to-slate-600" />
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/60" />
            <div className="w-12 h-px bg-gradient-to-l from-transparent to-slate-600" />
          </div>

          <p className="text-lg md:text-xl text-slate-400 font-light tracking-wide opacity-0 animate-float-up animate-delay-200 max-w-2xl mx-auto leading-relaxed">
            AI 编码代理的代码上下文引擎，为 Cursor、Claude Desktop 等 IDE 提供语义级代码理解能力
          </p>

          <div className="flex flex-wrap justify-center gap-4 pt-4">
            {[
              { label: "语义检索", color: "emerald", delay: "animate-delay-300" },
              { label: "符号图谱", color: "cyan", delay: "animate-delay-400" },
              { label: "零配置接入", color: "blue", delay: "animate-delay-500" },
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
                LCE（Local Code Engine）是一个<span className="text-white">代码上下文引擎</span>，它将代码仓库索引为结构化语义数据，让 AI 编码代理能像理解人类语言一样理解你的代码。
              </p>
              <p>
                传统的代码搜索依赖关键词匹配——你必须精确知道函数名、变量名才能找到它。LCE 不同：它理解代码的<span className="text-white">语义</span>。
                你可以用自然语言描述你要找的东西，比如&ldquo;处理用户认证的逻辑&rdquo;或&ldquo;数据库连接池的错误恢复机制&rdquo;，LCE 会返回最相关的代码片段及其上下文。
              </p>
              <p>
                LCE Relay 是 LCE 的云端中继服务。你无需在本地安装任何组件，只需在 IDE 中添加一个 MCP 服务器地址，AI 代理就能直接使用全部检索能力。
              </p>
            </div>
          </section>

          {/* Core capabilities */}
          <section>
            <SectionTitle>核心能力</SectionTitle>
            <div className="grid md:grid-cols-2 gap-4">
              <FeatureCard
                title="语义代码理解"
                description={`不只是关键词匹配。用自然语言描述意图——"处理支付失败后的重试逻辑"——引擎理解语义，从整个仓库中找到最相关的代码片段并附带上下文。`}
              />
              <FeatureCard
                title="Bug 溯源"
                description="结合 Git 历史和符号图谱，追溯一个 bug 是什么时候、由谁、在哪次提交中引入的。不再手动翻 git log，AI 代理直接给出引入变更和影响范围。"
              />
              <FeatureCard
                title="符号关系图谱"
                description="基于 AST 和编译器分析构建的代码图谱。追踪函数调用链、类型引用、导入依赖——修改一个函数前，先看清谁在调用它、影响哪些模块。"
              />
              <FeatureCard
                title="变更影响分析"
                description="提交代码前，自动分析变更影响的范围：关联的调用者、受影响的测试、潜在的回归风险。让 AI 代理的 code review 真正有据可依。"
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
              <StepCard step={2} title="在 IDE 中添加 MCP 服务器">
                <div className="space-y-3">
                  <span>在 Cursor 或 Claude Desktop 的 MCP 设置中添加以下配置。登录控制台后，可在「配置说明」中一键复制已填充密钥的完整配置：</span>
                  <div className="mt-3 bg-[#0a0f1a] border border-white/[0.08] rounded-lg p-4 font-mono text-sm overflow-x-auto">
                    <pre className="text-slate-300 whitespace-pre">{`{
  "mcpServers": {
    "lce-relay": {
      "url": "https://513689.xyz/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}</pre>
                  </div>
                </div>
              </StepCard>
              <StepCard step={3} title="初始化代码索引">
                <div className="space-y-3">
                  <span>首次使用时，AI 代理会自动建立代码索引。连接 MCP 后，让代理执行索引即可——整个过程全自动：</span>
                  <div className="mt-3 bg-[#0a0f1a] border border-white/[0.08] rounded-lg p-4 space-y-3">
                    <div className="flex gap-3">
                      <span className="text-cyan-400 font-mono text-xs shrink-0 mt-0.5">1.</span>
                      <p className="text-slate-400 text-sm">
                        代理扫描项目，检查哪些文件需要索引
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <span className="text-cyan-400 font-mono text-xs shrink-0 mt-0.5">2.</span>
                      <p className="text-slate-400 text-sm">
                        自动完成语义分析、全文索引和向量嵌入
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <span className="text-cyan-400 font-mono text-xs shrink-0 mt-0.5">3.</span>
                      <p className="text-slate-400 text-sm">
                        后续修改会增量更新，无需重新索引全部代码
                      </p>
                    </div>
                  </div>
                </div>
              </StepCard>
              <StepCard step={4} title="开始检索">
                索引就绪后，AI 代理在编码过程中会自动调用语义检索搜索相关代码。你也可以直接要求代理搜索特定功能或符号。
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
                    <span>本服务不替代 IDE 的本地功能（跳转定义、自动补全等），它是 AI 代理的上下文补充</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-slate-600 shrink-0">-</span>
                    <span>请勿将包含敏感凭证的文件（如 .env、密钥文件）纳入索引</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </section>
        </div>

        {/* Bottom accent line */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-700/50 to-transparent" />
      </main>
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
