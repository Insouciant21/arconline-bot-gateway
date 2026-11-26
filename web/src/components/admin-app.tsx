"use client";

import * as React from "react";
import {
  Activity,
  Bot,
  Check,
  Copy,
  KeyRound,
  Link2,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlink,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type ImageMode = "official" | "text" | "custom";

interface BotItem {
  id: string;
  appId: string;
  enabled: boolean;
  createdAt: string;
}

interface InstanceItem {
  id: string;
  baseUrl: string;
  imageMode: ImageMode;
  label: string | null;
  enabled: boolean;
  createdAt: string;
}

interface BindingItem {
  botId: string;
  scene: "c2c" | "group";
  openid: string;
  instanceId: string;
  createdAt: string;
  updatedAt: string;
}

interface SessionInfo {
  authenticated: boolean;
  publicBaseUrl: string | null;
}

interface BannerNotice {
  text: string;
  ok: boolean;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    ...init,
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    const err = new Error(data.error || `请求失败 (${response.status})`) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return data;
}

export function AdminApp() {
  const [checkingSession, setCheckingSession] = React.useState(true);
  const [session, setSession] = React.useState<SessionInfo | null>(null);
  const [bots, setBots] = React.useState<BotItem[]>([]);
  const [instances, setInstances] = React.useState<InstanceItem[]>([]);
  const [bindings, setBindings] = React.useState<BindingItem[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);

  const [loginSecret, setLoginSecret] = React.useState("");
  const [loginError, setLoginError] = React.useState("");
  const [loginPending, setLoginPending] = React.useState(false);

  const [botNotice, setBotNotice] = React.useState<BannerNotice | null>(null);
  const [instNotice, setInstNotice] = React.useState<BannerNotice | null>(null);
  const [bindNotice, setBindNotice] = React.useState<BannerNotice | null>(null);
  const [copiedBotId, setCopiedBotId] = React.useState<string | null>(null);
  const [testResults, setTestResults] = React.useState<Record<string, BannerNotice>>({});
  const [testingId, setTestingId] = React.useState<string | null>(null);

  // Bot create/edit dialog state
  const [botModalOpen, setBotModalOpen] = React.useState(false);
  const [editingBot, setEditingBot] = React.useState<BotItem | null>(null);
  const [botId, setBotId] = React.useState("");
  const [botAppId, setBotAppId] = React.useState("");
  const [botSecret, setBotSecret] = React.useState("");
  const [botSaving, setBotSaving] = React.useState(false);
  const [botModalError, setBotModalError] = React.useState("");

  // Instance create/edit dialog state
  const [instModalOpen, setInstModalOpen] = React.useState(false);
  const [editingInst, setEditingInst] = React.useState<InstanceItem | null>(null);
  const [instUrl, setInstUrl] = React.useState("");
  const [instSecret, setInstSecret] = React.useState("");
  const [instMode, setInstMode] = React.useState<ImageMode>("official");
  const [instLabel, setInstLabel] = React.useState("");
  const [instSaving, setInstSaving] = React.useState(false);
  const [instModalError, setInstModalError] = React.useState("");

  // Confirmation dialog state
  const [confirmState, setConfirmState] = React.useState<{
    title: string;
    description: string;
    actionLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [confirmPending, setConfirmPending] = React.useState(false);

  const loadDashboard = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const [sess, botsRes, instRes, bindRes] = await Promise.all([
        apiFetch<SessionInfo>("/admin/session"),
        apiFetch<{ bots: BotItem[] }>("/admin/bots"),
        apiFetch<{ instances: InstanceItem[] }>("/admin/instances"),
        apiFetch<{ bindings: BindingItem[] }>("/admin/bindings"),
      ]);
      setSession(sess);
      setBots(botsRes.bots);
      setInstances(instRes.instances);
      setBindings(bindRes.bindings);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401) {
        setSession(null);
      } else {
        setBotNotice({ text: error instanceof Error ? error.message : "加载数据失败", ok: false });
      }
    } finally {
      setCheckingSession(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function handleLogin(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    if (!loginSecret.trim()) {
      setLoginError("请输入 ADMIN_SECRET。");
      return;
    }
    setLoginPending(true);
    try {
      await apiFetch("/admin/login", {
        method: "POST",
        body: JSON.stringify({ secret: loginSecret.trim() }),
      });
      setLoginSecret("");
      await loadDashboard();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoginPending(false);
    }
  }

  async function handleLogout() {
    await apiFetch("/admin/logout", { method: "POST" }).catch(() => {});
    setSession(null);
  }

  function openNewBotModal() {
    setEditingBot(null);
    setBotId("");
    setBotAppId("");
    setBotSecret("");
    setBotModalError("");
    setBotModalOpen(true);
  }

  function openEditBotModal(bot: BotItem) {
    setEditingBot(bot);
    setBotId(bot.id);
    setBotAppId(bot.appId);
    setBotSecret("");
    setBotModalError("");
    setBotModalOpen(true);
  }

  async function submitBot(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBotModalError("");
    setBotSaving(true);
    try {
      if (editingBot) {
        await apiFetch(`/admin/bots/${encodeURIComponent(editingBot.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            appId: botAppId.trim(),
            ...(botSecret.trim() ? { clientSecret: botSecret.trim() } : {}),
          }),
        });
        setBotNotice({ text: `已更新 Bot「${editingBot.id}」。`, ok: true });
      } else {
        await apiFetch("/admin/bots", {
          method: "POST",
          body: JSON.stringify({
            id: botId.trim(),
            appId: botAppId.trim(),
            clientSecret: botSecret.trim(),
          }),
        });
        setBotNotice({ text: `已添加 Bot「${botId.trim()}」，请复制回调地址到 QQ 开放平台保存。`, ok: true });
      }
      setBotModalOpen(false);
      await loadDashboard();
    } catch (error) {
      setBotModalError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBotSaving(false);
    }
  }

  function openNewInstanceModal() {
    setEditingInst(null);
    setInstUrl("");
    setInstSecret("");
    setInstMode("official");
    setInstLabel("");
    setInstModalError("");
    setInstModalOpen(true);
  }

  function openEditInstanceModal(inst: InstanceItem) {
    setEditingInst(inst);
    setInstUrl(inst.baseUrl);
    setInstSecret("");
    setInstMode(inst.imageMode);
    setInstLabel(inst.label ?? "");
    setInstModalError("");
    setInstModalOpen(true);
  }

  async function submitInstance(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setInstModalError("");
    setInstSaving(true);
    try {
      if (editingInst) {
        await apiFetch(`/admin/instances/${encodeURIComponent(editingInst.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            baseUrl: instUrl.trim(),
            imageMode: instMode,
            label: instLabel.trim() || null,
            ...(instSecret.trim() ? { bridgeSecret: instSecret.trim() } : {}),
          }),
        });
        setInstNotice({ text: `已更新实例「${editingInst.id}」。`, ok: true });
      } else {
        const res = await apiFetch<{ instance: InstanceItem }>("/admin/instances", {
          method: "POST",
          body: JSON.stringify({
            baseUrl: instUrl.trim(),
            bridgeSecret: instSecret.trim(),
            imageMode: instMode,
            label: instLabel.trim() || null,
          }),
        });
        setInstNotice({ text: `已自动识别 User Code「${res.instance.id}」并完成注册。`, ok: true });
      }
      setInstModalOpen(false);
      await loadDashboard();
    } catch (error) {
      setInstModalError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setInstSaving(false);
    }
  }

  async function testInstanceConnection(id: string) {
    setTestingId(id);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>(
        `/admin/instances/${encodeURIComponent(id)}/test`,
        { method: "POST" },
      );
      setTestResults((prev) => ({ ...prev, [id]: { ok: res.ok, text: res.message } }));
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, text: error instanceof Error ? error.message : "测试失败" },
      }));
    } finally {
      setTestingId(null);
    }
  }

  async function copyWebhookUrl(botIdValue: string, base: string) {
    const url = `${base}/qq/webhook/${encodeURIComponent(botIdValue)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedBotId(botIdValue);
      setBotNotice({ text: `已复制回调地址：${url}`, ok: true });
      window.setTimeout(() => setCopiedBotId((cur) => (cur === botIdValue ? null : cur)), 1800);
    } catch {
      setBotNotice({ text: "剪贴板写入失败，请手动复制。", ok: false });
    }
  }

  if (checkingSession) {
    return (
      <main className="auth-shell">
        <div className="auth-grid" aria-hidden="true" />
        <section className="auth-content">
          <div className="auth-panel" style={{ textAlign: "center", padding: "48px 24px" }}>
            <Loader2 className="spin" size={24} style={{ color: "var(--purple)" }} />
            <p className="auth-description" style={{ margin: "14px auto 0" }}>正在检查管理会话…</p>
          </div>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-shell">
        <div className="auth-grid" aria-hidden="true" />
        <header className="auth-topbar">
          <a className="brand" href="/admin">
            <BrandMark />
            <span className="brand-lockup">
              <strong className="brand-wordmark">ArcOnline</strong>
              <small>QQ GATEWAY</small>
            </span>
          </a>
          <span className="auth-locale">WEBHOOK RELAY</span>
        </header>

        <section className="auth-content" aria-labelledby="gateway-login-title">
          <div className="hexagon-title"><span>ARCONLINE BOT GATEWAY / ADMIN ACCESS</span></div>
          <section className="auth-panel">
            <div className="auth-panel-heading">
              <span className="auth-eyebrow"><Sparkles size={14} /> GATEWAY CONSOLE</span>
              <span className="auth-index">01 / 01</span>
            </div>
            <h1 id="gateway-login-title">进入网关控制台。</h1>
            <p className="auth-description">输入网关环境变量中的 ADMIN_SECRET，管理多 QQ Bot 回调、Workers 实例与绑定关系。</p>
            <form className="login-form" onSubmit={handleLogin}>
              <label className="login-field">
                <span><KeyRound size={14} /> ADMIN SECRET</span>
                <input
                  type="password"
                  value={loginSecret}
                  onChange={(e) => setLoginSecret(e.target.value)}
                  placeholder="输入 ADMIN_SECRET"
                  autoComplete="current-password"
                  autoFocus
                />
              </label>
              {loginError ? <p className="login-error" role="alert">{loginError}</p> : null}
              <Button type="submit" className="login-submit" size="lg" disabled={loginPending}>
                {loginPending ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}
                {loginPending ? "验证中…" : "验证并进入"}
              </Button>
            </form>
            <div className="auth-panel-foot"><span>MULTI-BOT ROUTER</span><span>ED25519 WEBHOOK</span></div>
          </section>
          <p className="auth-hint">管理会话使用 HttpOnly 签名 Cookie 保护</p>
        </section>
      </main>
    );
  }

  const webhookBase = (session.publicBaseUrl || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
  const activeBots = bots.filter((b) => b.enabled).length;
  const activeInstances = instances.filter((i) => i.enabled).length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/admin">
          <BrandMark />
          <span className="brand-lockup">
            <strong className="brand-wordmark">ArcOnline</strong>
            <small>QQ GATEWAY</small>
          </span>
        </a>
        <div className="topbar-right">
          <Button type="button" variant="secondary" size="sm" onClick={() => void loadDashboard()} disabled={refreshing}>
            <RefreshCw size={13} className={refreshing ? "spin" : undefined} />
            刷新
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => void handleLogout()}>
            <LogOut size={14} />
            退出
          </Button>
        </div>
      </header>

      <div className="app-content">
        <section className="kpi-grid" aria-label="网关概览">
          <div className="kpi-card accent">
            <span><Bot size={12} /> QQ BOTS</span>
            <strong>{bots.length}</strong>
            <small>{activeBots} 个启用中</small>
          </div>
          <div className="kpi-card">
            <span><Server size={12} /> WORKERS INSTANCES</span>
            <strong>{instances.length}</strong>
            <small>{activeInstances} 个启用中（按 User Code 索引）</small>
          </div>
          <div className="kpi-card accent">
            <span><Link2 size={12} /> USER BINDINGS</span>
            <strong>{bindings.length}</strong>
            <small>C2C 单聊路由映射</small>
          </div>
          <div className="kpi-card">
            <span><Activity size={12} /> WEBHOOK ORIGIN</span>
            <strong style={{ fontSize: "15px", marginTop: "11px" }}>{session.publicBaseUrl ? "HTTPS READY" : "FALLBACK"}</strong>
            <small title={webhookBase}>{webhookBase}</small>
          </div>
        </section>

        <section className="section-card" id="bots">
          <div className="section-card-head">
            <div>
              <p className="section-kicker">01 / QQ OPEN PLATFORM</p>
              <h2>QQ Bot 接入管理</h2>
              <p>先在此登记 Bot，再复制生成的 Webhook 回调 URL 与公网 IP 填入 QQ 开放平台保存校验。</p>
            </div>
            <Button type="button" onClick={openNewBotModal}>
              <Plus size={15} />
              添加 Bot
            </Button>
          </div>
          <div className="section-card-body">
            {botNotice ? (
              <div className={`inline-banner${botNotice.ok ? "" : " error"}`}>
                <span>{botNotice.text}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setBotNotice(null)}>关闭</Button>
              </div>
            ) : null}

            {bots.length ? (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>BOT ID</th>
                      <th>APP ID</th>
                      <th>状态</th>
                      <th>WEBHOOK 回调地址</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bots.map((bot) => {
                      const webhookUrl = `${webhookBase}/qq/webhook/${encodeURIComponent(bot.id)}`;
                      return (
                        <tr key={bot.id}>
                          <td data-label="BOT ID"><span className="mono-chip">{bot.id}</span></td>
                          <td data-label="APP ID"><span className="cell-text">{bot.appId}</span></td>
                          <td data-label="状态"><span className={`status-pill ${bot.enabled ? "on" : "off"}`}>{bot.enabled ? "启用" : "禁用"}</span></td>
                          <td data-label="WEBHOOK 回调地址"><span className="mono-chip">{webhookUrl}</span></td>
                          <td data-label="操作">
                            <div className="row-actions">
                              <Button type="button" variant="secondary" size="sm" onClick={() => void copyWebhookUrl(bot.id, webhookBase)}>
                                {copiedBotId === bot.id ? <Check size={13} /> : <Copy size={13} />}
                                {copiedBotId === bot.id ? "已复制" : "复制回调"}
                              </Button>
                              <Button type="button" variant="secondary" size="sm" onClick={() => openEditBotModal(bot)}>
                                <Pencil size={13} />
                                编辑
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={async () => {
                                  await apiFetch(`/admin/bots/${encodeURIComponent(bot.id)}`, {
                                    method: "PATCH",
                                    body: JSON.stringify({ enabled: !bot.enabled }),
                                  });
                                  await loadDashboard();
                                }}
                              >
                                {bot.enabled ? "禁用" : "启用"}
                              </Button>
                              <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                onClick={() => setConfirmState({
                                  title: `删除 Bot「${bot.id}」`,
                                  description: "删除后将停止接收该 Bot 的 Webhook 回调，且关联的用户绑定也会一并清除。",
                                  actionLabel: "确认删除",
                                  onConfirm: async () => {
                                    await apiFetch(`/admin/bots/${encodeURIComponent(bot.id)}`, { method: "DELETE" });
                                    setBotNotice({ text: `已删除 Bot「${bot.id}」。`, ok: true });
                                    await loadDashboard();
                                  },
                                })}
                              >
                                <Trash2 size={13} />
                                删除
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <strong>暂无已接入的 QQ Bot</strong>
                <span>点击右上角「添加 Bot」，填写 QQ 开放平台 AppID 与 AppSecret。</span>
              </div>
            )}
          </div>
        </section>

        <section className="section-card" id="instances">
          <div className="section-card-head">
            <div>
              <p className="section-kicker">02 / ARCAEA WORKERS</p>
              <h2>Workers 实例管理</h2>
              <p>只需填写面板地址与 BOT_BRIDGE_SECRET，网关会自动读取对应账号的 Arcaea User Code 作为实例标识。</p>
            </div>
            <Button type="button" onClick={openNewInstanceModal}>
              <Plus size={15} />
              添加实例
            </Button>
          </div>
          <div className="section-card-body">
            {instNotice ? (
              <div className={`inline-banner${instNotice.ok ? "" : " error"}`}>
                <span>{instNotice.text}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setInstNotice(null)}>关闭</Button>
              </div>
            ) : null}

            {instances.length ? (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>USER CODE</th>
                      <th>BASE URL</th>
                      <th>出图模式</th>
                      <th>备注</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {instances.map((inst) => {
                      const testResult = testResults[inst.id];
                      return (
                        <tr key={inst.id}>
                          <td data-label="USER CODE"><span className="mono-chip">{inst.id}</span></td>
                          <td data-label="BASE URL">
                            <div className="cell-url">{inst.baseUrl}</div>
                            {testResult ? (
                              <div className={`test-result-note${testResult.ok ? "" : " error"}`}>{testResult.text}</div>
                            ) : null}
                          </td>
                          <td data-label="出图模式"><span className="mono-chip">{inst.imageMode}</span></td>
                          <td data-label="备注"><span className="cell-text">{inst.label || "—"}</span></td>
                          <td data-label="状态"><span className={`status-pill ${inst.enabled ? "on" : "off"}`}>{inst.enabled ? "启用" : "禁用"}</span></td>
                          <td data-label="操作">
                            <div className="row-actions">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={testingId === inst.id}
                                onClick={() => void testInstanceConnection(inst.id)}
                              >
                                {testingId === inst.id ? <Loader2 size={13} className="spin" /> : <Activity size={13} />}
                                测试连接
                              </Button>
                              <Button type="button" variant="secondary" size="sm" onClick={() => openEditInstanceModal(inst)}>
                                <Pencil size={13} />
                                编辑
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={async () => {
                                  await apiFetch(`/admin/instances/${encodeURIComponent(inst.id)}`, {
                                    method: "PATCH",
                                    body: JSON.stringify({ enabled: !inst.enabled }),
                                  });
                                  await loadDashboard();
                                }}
                              >
                                {inst.enabled ? "禁用" : "启用"}
                              </Button>
                              <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                onClick={() => setConfirmState({
                                  title: `删除实例「${inst.id}」`,
                                  description: "删除后该实例对应的 QQ 绑定关系也会清除，用户需要重新 /bind 绑定。",
                                  actionLabel: "确认删除",
                                  onConfirm: async () => {
                                    await apiFetch(`/admin/instances/${encodeURIComponent(inst.id)}`, { method: "DELETE" });
                                    setInstNotice({ text: `已删除实例「${inst.id}」。`, ok: true });
                                    await loadDashboard();
                                  },
                                })}
                              >
                                <Trash2 size={13} />
                                删除
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <strong>暂无已登记的 Workers 实例</strong>
                <span>点击右上角「添加实例」，填入部署地址和 BOT_BRIDGE_SECRET。</span>
              </div>
            )}
          </div>
        </section>

        <section className="section-card" id="bindings">
          <div className="section-card-head">
            <div>
              <p className="section-kicker">03 / ROUTE MAPPINGS</p>
              <h2>QQ 用户绑定关系</h2>
              <p>用户在 QQ 私聊发送 /bind &lt;UserCode&gt;:&lt;绑定码&gt; 后自动写入此表。</p>
            </div>
          </div>
          <div className="section-card-body">
            {bindNotice ? (
              <div className={`inline-banner${bindNotice.ok ? "" : " error"}`}>
                <span>{bindNotice.text}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setBindNotice(null)}>关闭</Button>
              </div>
            ) : null}

            {bindings.length ? (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>BOT ID</th>
                      <th>场景</th>
                      <th>USER OPENID</th>
                      <th>目标 USER CODE</th>
                      <th>更新时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bindings.map((b) => (
                      <tr key={`${b.botId}:${b.scene}:${b.openid}`}>
                        <td data-label="BOT ID"><span className="mono-chip">{b.botId}</span></td>
                        <td data-label="场景"><span className="cell-text">{b.scene.toUpperCase()}</span></td>
                        <td data-label="USER OPENID"><span className="mono-chip">{b.openid}</span></td>
                        <td data-label="目标 USER CODE"><span className="mono-chip">{b.instanceId}</span></td>
                        <td data-label="更新时间"><span className="cell-text">{new Date(b.updatedAt).toLocaleString("zh-CN", { hour12: false })}</span></td>
                        <td data-label="操作">
                          <div className="row-actions">
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              onClick={() => setConfirmState({
                                title: "解除 QQ 绑定",
                                description: `确认解除 OpenID「${b.openid}」与实例「${b.instanceId}」的绑定吗？`,
                                actionLabel: "确认解绑",
                                onConfirm: async () => {
                                  await apiFetch(
                                    `/admin/bindings/${encodeURIComponent(b.botId)}/${encodeURIComponent(b.scene)}/${encodeURIComponent(b.openid)}`,
                                    { method: "DELETE" },
                                  );
                                  setBindNotice({ text: `已解除 ${b.openid} 的绑定。`, ok: true });
                                  await loadDashboard();
                                },
                              })}
                            >
                              <Unlink size={13} />
                              解绑
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <strong>暂无绑定记录</strong>
                <span>在面板点击「绑定 QQ」生成绑定码后私聊机器人即可建立映射。</span>
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="footer">
        <span>ARCONLINE QQ BOT GATEWAY</span>
        <span>SHARED MULTI-TENANT WEBHOOK ROUTER</span>
      </footer>

      <Dialog open={botModalOpen} onOpenChange={setBotModalOpen}>
        <DialogContent>
          <DialogTitle>{editingBot ? `编辑 Bot「${editingBot.id}」` : "添加 QQ Bot"}</DialogTitle>
          <DialogDescription>
            {editingBot
              ? "修改 AppID 或轮换 AppSecret（AppSecret 留空则保持原密钥不变）。"
              : "填写自定义 Bot ID 与 QQ 开放平台凭证，保存后即可复制对应的 Webhook URL。"}
          </DialogDescription>
          <form className="dialog-form" onSubmit={submitBot}>
            {!editingBot ? (
              <label className="form-field">
                <span>BOT ID（用于回调路径）</span>
                <input
                  required
                  pattern="[A-Za-z0-9_-]{1,64}"
                  value={botId}
                  onChange={(e) => setBotId(e.target.value)}
                  placeholder="例如 main 或 indev"
                />
              </label>
            ) : null}
            <label className="form-field">
              <span>APP ID</span>
              <input
                required
                value={botAppId}
                onChange={(e) => setBotAppId(e.target.value)}
                placeholder="QQ 开放平台 AppID"
              />
            </label>
            <label className="form-field">
              <span>{editingBot ? "APP SECRET（留空保持不变）" : "APP SECRET"}</span>
              <input
                type="password"
                required={!editingBot}
                value={botSecret}
                onChange={(e) => setBotSecret(e.target.value)}
                placeholder={editingBot ? "留空则不修改密钥" : "QQ 开放平台 AppSecret"}
              />
            </label>
            {botModalError ? <p className="login-error">{botModalError}</p> : null}
            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setBotModalOpen(false)}>取消</Button>
              <Button type="submit" disabled={botSaving}>
                {botSaving ? <Loader2 size={14} className="spin" /> : null}
                {botSaving ? "保存中…" : "保存 Bot"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={instModalOpen} onOpenChange={setInstModalOpen}>
        <DialogContent>
          <DialogTitle>{editingInst ? `编辑实例「${editingInst.id}」` : "添加 Workers 实例"}</DialogTitle>
          <DialogDescription>
            {editingInst
              ? "修改实例地址、出图模式、备注或轮换桥接密钥（留空则保持原密钥不变）。"
              : "保存时会自动请求实例 /api/bot/profile 获取 Arcaea User Code 作为实例标识。"}
          </DialogDescription>
          <form className="dialog-form" onSubmit={submitInstance}>
            <label className="form-field">
              <span>BASE URL</span>
              <input
                type="url"
                required
                value={instUrl}
                onChange={(e) => setInstUrl(e.target.value)}
                placeholder="https://arc.moeblue.top"
              />
            </label>
            <label className="form-field">
              <span>{editingInst ? "BOT_BRIDGE_SECRET（留空保持不变）" : "BOT_BRIDGE_SECRET"}</span>
              <input
                type="password"
                required={!editingInst}
                value={instSecret}
                onChange={(e) => setInstSecret(e.target.value)}
                placeholder={editingInst ? "留空则不修改密钥" : "对应 Worker 的 BOT_BRIDGE_SECRET"}
              />
            </label>
            <label className="form-field">
              <span>出图模式</span>
              <select value={instMode} onChange={(e) => setInstMode(e.target.value as ImageMode)}>
                <option value="official">official（官方 B50 图 + 摘要）</option>
                <option value="text">text（仅文本 B50）</option>
                <option value="custom">custom（预留自绘）</option>
              </select>
            </label>
            <label className="form-field">
              <span>备注名称（可选）</span>
              <input
                value={instLabel}
                onChange={(e) => setInstLabel(e.target.value)}
                placeholder="留空自动使用玩家昵称"
              />
            </label>
            {instModalError ? <p className="login-error">{instModalError}</p> : null}
            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setInstModalOpen(false)}>取消</Button>
              <Button type="submit" disabled={instSaving}>
                {instSaving ? <Loader2 size={14} className="spin" /> : null}
                {instSaving ? "保存中…" : "保存实例"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmState)} onOpenChange={(open) => { if (!open && !confirmPending) setConfirmState(null); }}>
        <DialogContent>
          <DialogTitle>{confirmState?.title}</DialogTitle>
          <DialogDescription>{confirmState?.description}</DialogDescription>
          <div className="dialog-actions" style={{ marginTop: "20px" }}>
            <Button type="button" variant="secondary" disabled={confirmPending} onClick={() => setConfirmState(null)}>
              取消
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={confirmPending}
              onClick={async () => {
                if (!confirmState) return;
                setConfirmPending(true);
                try {
                  await confirmState.onConfirm();
                  setConfirmState(null);
                } finally {
                  setConfirmPending(false);
                }
              }}
            >
              {confirmPending ? <Loader2 size={14} className="spin" /> : null}
              {confirmState?.actionLabel || "确认"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
