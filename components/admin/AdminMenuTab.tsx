"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConsoleMenuId, USER_MENU_IDS } from "@/lib/menu-config";
export function AdminMenuTab() {
  const [menus, setMenus] = useState<{id:string;label:string;group:string}[]>([]);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  useEffect(() => { fetch("/api/admin/menu-config").then(r => r.json()).then(d => { setMenus((d.menus ?? []).filter((m: {id:string}) => USER_MENU_IDS.includes(m.id as ConsoleMenuId))); setVisibility(d.visibility ?? {}); }).catch(() => setMessage("加载失败")); }, []);
  const save = async () => { const r = await fetch("/api/admin/menu-config", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ visibility }) }); setMessage(r.ok ? "已保存，刷新页面后生效" : "保存失败"); };
  return <Card className="bg-[#0a0f1a]/60 border-white/[0.06]"><CardContent className="p-4 space-y-4"><p className="text-slate-400 text-sm">配置普通用户端菜单展示。管理员始终可以看到全部菜单，隐藏菜单不会改变服务端权限。</p><div className="grid gap-2 sm:grid-cols-2">{menus.map(m => <label key={m.id} className="flex items-center gap-3 rounded border border-white/[0.06] p-3"><Checkbox checked={visibility[m.id] !== false} onCheckedChange={v => setVisibility(x => ({...x, [m.id]: v === true}))}/><span className="text-sm text-white">{m.label}</span><span className="ml-auto text-xs text-slate-500">{m.group}</span></label>)}</div><div className="flex items-center gap-3"><Button variant="glass" size="sm" onClick={save}>保存</Button>{message && <span className="text-xs text-slate-400">{message}</span>}</div></CardContent></Card>;
}
