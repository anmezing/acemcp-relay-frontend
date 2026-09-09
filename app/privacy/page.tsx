import Link from "next/link";

export default function PrivacyPage() { return <main className="min-h-screen bg-[#060b14] px-6 py-16 text-slate-200"><article className="mx-auto max-w-3xl space-y-6"><Link href="/" className="text-cyan-400">← LCE</Link><h1 className="text-3xl font-semibold text-white">隐私政策</h1><p>我们仅收集提供 LCE 服务所需的信息，包括账户资料、登录会话和服务使用记录。</p><p>Google 等第三方登录会向我们提供姓名、邮箱和头像。我们不会出售个人信息，并会采取合理措施保护数据安全。</p><p>你可以联系我们请求访问、更正或删除账户数据。继续使用服务即表示你同意本政策。</p></article></main>; }
