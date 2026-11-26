export function renderAdminHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ArcOnline QQ Bot Gateway 管理台</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7fb;
      --card: #ffffff;
      --ink: #1e202b;
      --muted: #666a7d;
      --line: #e2e4ee;
      --accent: #5e4bb6;
      --accent-soft: #efecfa;
      --ok: #0e7c5b;
      --ok-soft: #e6f6f0;
      --err: #b4234a;
      --err-soft: #fdecf1;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #13141b;
        --card: #1b1d27;
        --ink: #eceef7;
        --muted: #9aa0b8;
        --line: #2d3040;
        --accent: #8c7ae6;
        --accent-soft: rgba(140, 122, 230, 0.16);
        --ok: #3cd09d;
        --ok-soft: rgba(60, 208, 157, 0.14);
        --err: #ff6b8b;
        --err-soft: rgba(255, 107, 139, 0.15);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
      line-height: 1.5;
    }
    .wrap {
      max-width: 1080px;
      margin: 0 auto;
      padding: 28px 18px 56px;
      display: grid;
      gap: 20px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 20px;
    }
    .topbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    h1 { margin: 0; font-size: 20px; }
    h2 { margin: 0 0 14px; font-size: 16px; }
    .muted { color: var(--muted); font-size: 13px; }
    .hidden { display: none !important; }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    label {
      display: grid;
      gap: 5px;
      font-size: 12px;
      color: var(--muted);
    }
    input, select {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: transparent;
      color: var(--ink);
      font-size: 13px;
    }
    button {
      padding: 8px 14px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: var(--accent);
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    button.secondary {
      background: transparent;
      border-color: var(--line);
      color: var(--ink);
    }
    button.danger {
      background: transparent;
      border-color: var(--line);
      color: var(--err);
    }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .row-actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .notice {
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 13px;
      margin-top: 10px;
    }
    .notice.ok { background: var(--ok-soft); color: var(--ok); }
    .notice.err { background: var(--err-soft); color: var(--err); }
    .table-wrap { overflow-x: auto; margin-top: 14px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      padding: 10px 8px;
      border-top: 1px solid var(--line);
      vertical-align: middle;
    }
    th { color: var(--muted); font-size: 12px; font-weight: 600; border-top: 0; }
    code {
      background: var(--accent-soft);
      color: var(--accent);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
      word-break: break-all;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge.on { background: var(--ok-soft); color: var(--ok); }
    .badge.off { background: var(--err-soft); color: var(--err); }
    .login-box { max-width: 420px; margin: 60px auto; }
  </style>
</head>
<body>
  <main class="wrap">
    <section id="loginView" class="card login-box hidden">
      <h1>QQ Bot Gateway 管理台</h1>
      <p class="muted">请输入网关环境变量中的 <code>ADMIN_SECRET</code> 登录管理台。</p>
      <form id="loginForm">
        <div class="form-grid">
          <label>
            ADMIN_SECRET
            <input id="loginSecret" type="password" autocomplete="current-password" required placeholder="输入管理密钥" />
          </label>
        </div>
        <button type="submit" id="loginBtn">登录</button>
        <div id="loginMsg" class="notice err hidden"></div>
      </form>
    </section>

    <section id="appView" class="hidden" style="display:grid;gap:20px;">
      <header class="card topbar">
        <div>
          <h1>ArcOnline QQ Bot Gateway 管理台</h1>
          <div class="muted" id="gatewayMeta">加载中…</div>
        </div>
        <div class="row-actions">
          <button type="button" class="secondary" id="refreshBtn">刷新全部</button>
          <button type="button" class="secondary" id="logoutBtn">退出登录</button>
        </div>
      </header>

      <section class="card">
        <h2>1. QQ Bot 配置（多机器人）</h2>
        <p class="muted">先在此登记 Bot，再将生成的 Webhook 回调地址与服务器公网 IP 填入 QQ 开放平台保存校验。</p>
        <form id="botForm">
          <div class="form-grid">
            <label>Bot ID（用于回调路径）<input id="botId" required pattern="[A-Za-z0-9_-]{1,64}" placeholder="例如 main" /></label>
            <label>AppID<input id="botAppId" required placeholder="QQ 开放平台 AppID" /></label>
            <label>AppSecret (clientSecret)<input id="botSecret" type="password" required placeholder="QQ 开放平台 AppSecret" /></label>
          </div>
          <button type="submit">保存 Bot</button>
          <div id="botMsg" class="notice hidden"></div>
        </form>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Bot ID</th><th>AppID</th><th>状态</th><th>Webhook 回调地址</th><th>操作</th></tr>
            </thead>
            <tbody id="botsTable"></tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>2. Workers 实例配置（arconline-ext）</h2>
        <p class="muted">登记要接入的面板地址与对应 Worker 的 <code>BOT_BRIDGE_SECRET</code>，绑定时使用 <code>/bind &lt;实例ID&gt;:&lt;绑定码&gt;</code>。</p>
        <form id="instanceForm">
          <div class="form-grid">
            <label>实例 ID<input id="instId" required pattern="[A-Za-z0-9_-]{1,64}" placeholder="例如 alice" /></label>
            <label>Base URL<input id="instUrl" type="url" required placeholder="https://arc.moeblue.top" /></label>
            <label>BOT_BRIDGE_SECRET<input id="instSecret" type="password" required placeholder="对应 Worker Secret" /></label>
            <label>出图模式
              <select id="instMode">
                <option value="official">official（官方 B50 图 + 摘要）</option>
                <option value="text">text（仅文本 B50）</option>
                <option value="custom">custom（预留自绘）</option>
              </select>
            </label>
            <label>备注名称（可选）<input id="instLabel" placeholder="例如 主号" /></label>
          </div>
          <button type="submit">保存实例</button>
          <div id="instMsg" class="notice hidden"></div>
        </form>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>实例 ID</th><th>地址</th><th>模式</th><th>备注</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody id="instancesTable"></tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>3. QQ 用户绑定列表</h2>
        <div id="bindMsg" class="notice hidden"></div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Bot ID</th><th>场景</th><th>user_openid</th><th>绑定实例</th><th>更新时间</th><th>操作</th></tr>
            </thead>
            <tbody id="bindingsTable"></tbody>
          </table>
        </div>
      </section>
    </section>
  </main>

  <script>
    const $ = (id) => document.getElementById(id);

    function showNotice(el, text, ok) {
      el.textContent = text;
      el.className = "notice " + (ok ? "ok" : "err");
    }
    function clearNotice(el) {
      el.textContent = "";
      el.className = "notice hidden";
    }

    async function api(path, options = {}) {
      const res = await fetch(path, {
        credentials: "same-origin",
        headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : (options.headers || {}),
        ...options,
      });
      if (res.status === 401 && path !== "/admin/login") {
        showLogin();
        throw new Error("登录状态已失效，请重新登录");
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ("请求失败 (" + res.status + ")"));
      return data;
    }

    function showLogin() {
      $("loginView").classList.remove("hidden");
      $("appView").classList.add("hidden");
    }

    function showApp(session) {
      $("loginView").classList.add("hidden");
      $("appView").classList.remove("hidden");
      const base = session.publicBaseUrl || location.origin;
      $("gatewayMeta").textContent = "Webhook 基地址：" + base + (session.publicBaseUrl ? "" : "（未配置 PUBLIC_BASE_URL，图片将尝试 Base64 回退）");
    }

    function el(tag, props = {}, children = []) {
      const node = document.createElement(tag);
      for (const [k, v] of Object.entries(props)) {
        if (k === "text") node.textContent = v;
        else if (k === "className") node.className = v;
        else if (k === "onclick") node.addEventListener("click", v);
        else node.setAttribute(k, v);
      }
      for (const child of children) node.appendChild(child);
      return node;
    }

    function renderBots(bots, base) {
      const tbody = $("botsTable");
      tbody.replaceChildren();
      if (!bots.length) {
        tbody.appendChild(el("tr", {}, [el("td", { colspan: "5", className: "muted", text: "暂无 Bot，请先在上方添加。" })]));
        return;
      }
      for (const bot of bots) {
        const webhookUrl = base + "/qq/webhook/" + encodeURIComponent(bot.id);
        const copyBtn = el("button", {
          type: "button",
          className: "secondary",
          text: "复制回调",
          onclick: async () => {
            await navigator.clipboard.writeText(webhookUrl);
            showNotice($("botMsg"), "已复制回调地址：" + webhookUrl, true);
          },
        });
        const toggleBtn = el("button", {
          type: "button",
          className: "secondary",
          text: bot.enabled ? "禁用" : "启用",
          onclick: async () => {
            await api("/admin/bots/" + encodeURIComponent(bot.id), {
              method: "PATCH",
              body: JSON.stringify({ enabled: !bot.enabled }),
            });
            await loadAll();
          },
        });
        const delBtn = el("button", {
          type: "button",
          className: "danger",
          text: "删除",
          onclick: async () => {
            if (!confirm("确认删除 Bot「" + bot.id + "」？其关联绑定也会移除。")) return;
            await api("/admin/bots/" + encodeURIComponent(bot.id), { method: "DELETE" });
            await loadAll();
          },
        });
        tbody.appendChild(el("tr", {}, [
          el("td", {}, [el("code", { text: bot.id })]),
          el("td", { text: bot.appId }),
          el("td", {}, [el("span", { className: "badge " + (bot.enabled ? "on" : "off"), text: bot.enabled ? "启用" : "禁用" })]),
          el("td", {}, [el("code", { text: webhookUrl })]),
          el("td", {}, [el("div", { className: "row-actions" }, [copyBtn, toggleBtn, delBtn])]),
        ]));
      }
    }

    function renderInstances(instances) {
      const tbody = $("instancesTable");
      tbody.replaceChildren();
      if (!instances.length) {
        tbody.appendChild(el("tr", {}, [el("td", { colspan: "6", className: "muted", text: "暂无实例，请先在上方添加。" })]));
        return;
      }
      for (const inst of instances) {
        const testBtn = el("button", {
          type: "button",
          className: "secondary",
          text: "测试连接",
          onclick: async () => {
            testBtn.disabled = true;
            try {
              const res = await api("/admin/instances/" + encodeURIComponent(inst.id) + "/test", { method: "POST" });
              showNotice($("instMsg"), "实例「" + inst.id + "」：" + res.message, Boolean(res.ok));
            } catch (err) {
              showNotice($("instMsg"), "实例「" + inst.id + "」测试失败：" + err.message, false);
            } finally {
              testBtn.disabled = false;
            }
          },
        });
        const toggleBtn = el("button", {
          type: "button",
          className: "secondary",
          text: inst.enabled ? "禁用" : "启用",
          onclick: async () => {
            await api("/admin/instances/" + encodeURIComponent(inst.id), {
              method: "PATCH",
              body: JSON.stringify({ enabled: !inst.enabled }),
            });
            await loadAll();
          },
        });
        const delBtn = el("button", {
          type: "button",
          className: "danger",
          text: "删除",
          onclick: async () => {
            if (!confirm("确认删除实例「" + inst.id + "」？")) return;
            await api("/admin/instances/" + encodeURIComponent(inst.id), { method: "DELETE" });
            await loadAll();
          },
        });
        tbody.appendChild(el("tr", {}, [
          el("td", {}, [el("code", { text: inst.id })]),
          el("td", { text: inst.baseUrl }),
          el("td", { text: inst.imageMode }),
          el("td", { text: inst.label || "—" }),
          el("td", {}, [el("span", { className: "badge " + (inst.enabled ? "on" : "off"), text: inst.enabled ? "启用" : "禁用" })]),
          el("td", {}, [el("div", { className: "row-actions" }, [testBtn, toggleBtn, delBtn])]),
        ]));
      }
    }

    function renderBindings(bindings) {
      const tbody = $("bindingsTable");
      tbody.replaceChildren();
      if (!bindings.length) {
        tbody.appendChild(el("tr", {}, [el("td", { colspan: "6", className: "muted", text: "暂无绑定记录。" })]));
        return;
      }
      for (const b of bindings) {
        const unbindBtn = el("button", {
          type: "button",
          className: "danger",
          text: "解绑",
          onclick: async () => {
            await api("/admin/bindings/" + encodeURIComponent(b.botId) + "/" + encodeURIComponent(b.scene) + "/" + encodeURIComponent(b.openid), {
              method: "DELETE",
            });
            showNotice($("bindMsg"), "已解除绑定：" + b.openid, true);
            await loadAll();
          },
        });
        tbody.appendChild(el("tr", {}, [
          el("td", {}, [el("code", { text: b.botId })]),
          el("td", { text: b.scene }),
          el("td", {}, [el("code", { text: b.openid })]),
          el("td", {}, [el("code", { text: b.instanceId })]),
          el("td", { text: new Date(b.updatedAt).toLocaleString("zh-CN", { hour12: false }) }),
          el("td", {}, [unbindBtn]),
        ]));
      }
    }

    async function loadAll() {
      const [session, botsRes, instRes, bindRes] = await Promise.all([
        api("/admin/session"),
        api("/admin/bots"),
        api("/admin/instances"),
        api("/admin/bindings"),
      ]);
      showApp(session);
      const base = (session.publicBaseUrl || location.origin).replace(/\\/+$/, "");
      renderBots(botsRes.bots, base);
      renderInstances(instRes.instances);
      renderBindings(bindRes.bindings);
    }

    $("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      clearNotice($("loginMsg"));
      $("loginBtn").disabled = true;
      try {
        await api("/admin/login", {
          method: "POST",
          body: JSON.stringify({ secret: $("loginSecret").value }),
        });
        $("loginSecret").value = "";
        await loadAll();
      } catch (err) {
        showNotice($("loginMsg"), err.message, false);
      } finally {
        $("loginBtn").disabled = false;
      }
    });

    $("logoutBtn").addEventListener("click", async () => {
      await api("/admin/logout", { method: "POST" }).catch(() => {});
      showLogin();
    });

    $("refreshBtn").addEventListener("click", () => void loadAll());

    $("botForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      clearNotice($("botMsg"));
      try {
        await api("/admin/bots", {
          method: "POST",
          body: JSON.stringify({
            id: $("botId").value.trim(),
            appId: $("botAppId").value.trim(),
            clientSecret: $("botSecret").value.trim(),
          }),
        });
        $("botSecret").value = "";
        showNotice($("botMsg"), "Bot 已保存，可复制回调地址到 QQ 开放平台。", true);
        await loadAll();
      } catch (err) {
        showNotice($("botMsg"), err.message, false);
      }
    });

    $("instanceForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      clearNotice($("instMsg"));
      try {
        await api("/admin/instances", {
          method: "POST",
          body: JSON.stringify({
            id: $("instId").value.trim(),
            baseUrl: $("instUrl").value.trim(),
            bridgeSecret: $("instSecret").value.trim(),
            imageMode: $("instMode").value,
            label: $("instLabel").value.trim() || null,
          }),
        });
        $("instSecret").value = "";
        showNotice($("instMsg"), "实例已保存，可点击「测试连接」验证桥接密钥。", true);
        await loadAll();
      } catch (err) {
        showNotice($("instMsg"), err.message, false);
      }
    });

    void loadAll().catch(() => showLogin());
  </script>
</body>
</html>
`;
}
