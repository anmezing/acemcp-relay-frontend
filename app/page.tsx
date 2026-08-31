import { Header } from "@/components/Header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LceBrand } from "@/components/LceBrand";
import { I18nText } from "@/components/I18nText";

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
            <h1 className="relative">
              <LceBrand
                iconSize={112}
                priority
                className="flex-col gap-4"
                iconClassName="w-24 h-24 md:w-28 md:h-28 drop-shadow-[0_18px_46px_rgba(87,214,193,0.2)]"
                textClassName="text-5xl md:text-7xl"
              />
            </h1>
          </div>

          <div className="flex items-center justify-center gap-3 opacity-0 animate-float-up animate-delay-100">
            <div className="w-12 h-px bg-gradient-to-r from-transparent to-slate-600" />
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/60" />
            <div className="w-12 h-px bg-gradient-to-l from-transparent to-slate-600" />
          </div>

          <p className="text-lg md:text-xl text-slate-400 font-light tracking-wide opacity-0 animate-float-up animate-delay-200 max-w-2xl mx-auto leading-relaxed">
            <I18nText
              id="aCodeContextEngineThatGivesCursor"
            />
          </p>

          <div className="flex flex-wrap justify-center gap-4 pt-4">
            {[
              { id: "semanticSearch", color: "emerald", delay: "animate-delay-300" },
              { id: "crossProjectContext", color: "cyan", delay: "animate-delay-300" },
              { id: "lineLevelResults", color: "blue", delay: "animate-delay-400" },
              { id: "symbolGraph", color: "emerald", delay: "animate-delay-400" },
              { id: "incrementalIndexingBadge", color: "blue", delay: "animate-delay-400" },
              { id: "multiLanguage", color: "emerald", delay: "animate-delay-500" },
              { id: "changeAnalysis", color: "cyan", delay: "animate-delay-500" },
              { id: "promptEnhancementBadge", color: "emerald", delay: "animate-delay-500" },
              { id: "cloudMode", color: "blue", delay: "animate-delay-500" },
            ].map((item) => (
              <Badge
                key={item.id}
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
                  <span className="text-sm text-slate-300 font-light">
                    <I18nText id={item.id} />
                  </span>
                </div>
              </Badge>
            ))}
          </div>
        </section>

        <div className="max-w-4xl mx-auto space-y-20">
          {/* What is LCE */}
          <section>
            <SectionTitle><I18nText id="whatIsLce" /></SectionTitle>
            <div className="space-y-4 text-slate-400 text-[15px] leading-relaxed">
              <p>
                <I18nText id="lceIsA" /><span className="text-white"><I18nText id="codeContextEngine" /></span><I18nText id="itIndexesRepositoriesIntoStructuredSemanticData" />
              </p>
              <p>
                <I18nText id="codingAgentsUsuallyUnderstandRepositoriesThroughRepeated" /><span className="text-white"><I18nText id="contextWindow" /></span><I18nText id="lceTurnsThisIntoOneCallThe" /><span className="text-white"><I18nText id="threeRetrievalPaths" /></span><I18nText id="withStructuredEvidenceSuchAsCallChains" />
              </p>
              <p>
                <I18nText id="lceProvidesReadyCloud" />
              </p>
            </div>
          </section>

          {/* Core capabilities */}
          <section>
            <SectionTitle><I18nText id="coreCapabilities" /></SectionTitle>
            <div className="grid items-stretch gap-4 md:grid-cols-2">
              <FeatureCard
                title={<I18nText id="semanticCodeUnderstanding" />}
                description={<I18nText id="combinesSemanticKeywordAndExactTermRetrieval" />}
              />
              <FeatureCard
                title={<I18nText id="crossFileAndCrossProjectContext" />}
                description={<I18nText id="connectsWorkflowsAcrossFilesModulesAndProjects" />}
              />
              <FeatureCard
                title={<I18nText id="preciseCodeLocation" />}
                description={<I18nText id="resultsIncludeFilePathsSymbolsAndExact" />}
              />
              <FeatureCard
                title={<I18nText id="incrementalIndexing" />}
                description={<I18nText id="processesOnlyAddedAndChangedFilesRemoves" />}
              />
              <FeatureCard
                title={<I18nText id="gitHistoryUnderstanding" />}
                description={<I18nText id="readsGitStatusBranchesDiffsHistoryAndBlame" />}
              />
              <FeatureCard
                title={<I18nText id="multiLanguageSupport" />}
                description={<I18nText id="supportsTypescriptJavascriptPythonGoRustJava" />}
              />
              <FeatureCard
                title={<I18nText id="symbolRelationshipGraph" />}
                description={<I18nText id="buildsACodeGraphFromAstAnd" />}
              />
              <FeatureCard
                title={<I18nText id="changeImpactAnalysis" />}
                description={<I18nText id="identifiesCallersDependentModulesAffectedTestsAnd" />}
              />
              <FeatureCard
                title={<I18nText id="bugLocation" />}
                description={<I18nText id="combinesNaturalLanguageRetrievalExactTermsAnd" />}
              />
              <FeatureCard
                title={<I18nText id="codeGroundedPromptEnhancement" />}
                description={<I18nText id="enhancesNaturalLanguageCodingRequestsWithRetrievedCodeContext" />}
              />
            </div>
          </section>

          {/* How to start */}
          <section>
            <SectionTitle><I18nText id="getStarted" /></SectionTitle>
            <div className="space-y-4">
              <StepCard step={1} title={<I18nText id="signUpAndGetAnApiKey" />}>
                <I18nText id="openTheConsoleAndGenerateAnApi" />
              </StepCard>
              <StepCard step={2} title={<I18nText id="optionalInstallTheClientInAdvance" />}>
                <I18nText id="globalInstallationAvoidsRepeatedPackageResolution" />
              </StepCard>
              <StepCard step={3} title={<I18nText id="addTheMcpConfiguration" />}>
                <I18nText id="addTheMcpConfigurationToYourIde" />
              </StepCard>
              <StepCard step={4} title={<I18nText id="startSearching" />}>
                <I18nText id="afterSetupYourCodingAgentCanCall" />
              </StepCard>
            </div>
          </section>

          {/* Limitations */}
          <section>
            <SectionTitle><I18nText id="limitations" /></SectionTitle>
            <Card className="bg-[#0d1424]/60 border-white/[0.06]">
              <CardContent className="p-6">
                <ul className="space-y-4 text-slate-400 text-[15px]">
                  <li className="flex gap-3">
                    <span className="text-slate-600 shrink-0">-</span>
                    <span><I18nText id="lceIsA" /><span className="text-white"><I18nText id="readOnly" /></span><I18nText id="retrievalEngineItDoesNotEditCode" /></span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-slate-600 shrink-0">-</span>
                    <span><I18nText id="retrievalQualityDependsOnIndexCoverageFiles" /></span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-slate-600 shrink-0">-</span>
                    <span><I18nText id="theServerRejectsEnvFilesKeysBinaries" /></span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </section>
        </div>

      </main>

      <footer className="relative px-6 py-6 text-center">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-700/50 to-transparent" />
        <div className="space-y-2">
          <p className="text-sm text-slate-500">
            <I18nText id="theFrontendAndAdminConsoleAreBased" /> <span className="text-slate-300">heroman</span><I18nText id="withThanks" />
          </p>
          <p className="text-sm text-slate-500">
            <I18nText id="feedbackAndContact" />{" "}
            <span className="font-mono text-cyan-300">wx_exception</span>
          </p>
          <p className="text-sm text-slate-500">
            <I18nText id="copyrightNotice" />
          </p>
        </div>
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

function FeatureCard({ title, description }: { title: React.ReactNode; description: React.ReactNode }) {
  return (
    <Card className="h-full bg-[#0d1424]/60 border-white/[0.06] text-left transition-colors hover:border-white/[0.12]">
      <CardContent className="h-full p-5 text-left">
        <h3 className="text-white font-medium mb-2">{title}</h3>
        <p className="text-slate-400 text-sm leading-relaxed">{description}</p>
      </CardContent>
    </Card>
  );
}

function StepCard({ step, title, children }: { step: number; title: React.ReactNode; children: React.ReactNode }) {
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
