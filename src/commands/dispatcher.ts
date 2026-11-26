import type { GatewayConfig } from "../config.js";
import type { BotJobPayload, WorkersBridgeClient } from "../bridge/workers-client.js";
import { WorkersBridgeError } from "../bridge/workers-client.js";
import type { BotRecord, GatewayRepository, InstanceRecord } from "../db/repositories.js";
import type { QqApiClient } from "../qq/client.js";
import type { QqC2CMessageData } from "../qq/types.js";
import type { MediaProxySigner } from "../render/media-proxy.js";
import { deliverB50Reply, type CustomB50Renderer } from "../render/renderer.js";

const PROGRESS_NOTICE_DELAY_MS = 2500;

export interface DispatcherDeps {
  config: GatewayConfig;
  repo: GatewayRepository;
  bridge: WorkersBridgeClient;
  qq: QqApiClient;
  mediaSigner: MediaProxySigner;
  customRenderer?: CustomB50Renderer;
  sleep?: (ms: number) => Promise<void>;
}

function normalizeCommandText(raw: string): string {
  return raw.replace(/<@!?\w+>/g, "").trim();
}

export class CommandDispatcher {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: DispatcherDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async handleC2CMessage(bot: BotRecord, event: QqC2CMessageData): Promise<void> {
    const openid = event.author?.user_openid;
    const msgId = event.id;
    if (!openid || !msgId) return;

    let seq = 0;
    const nextSeq = () => ++seq;
    const replyText = async (content: string) => {
      await this.deps.qq.sendC2CMessage(bot, openid, {
        msgType: 0,
        content,
        msgId,
        msgSeq: nextSeq(),
      });
    };

    const text = normalizeCommandText(event.content || "");
    const [rawCmd, ...args] = text.split(/\s+/);
    const cmd = rawCmd.toLowerCase();

    if (cmd === "/help" || cmd === "help" || cmd === "/start") {
      await replyText([
        "ArcOnline QQ Bot 指令：",
        "/bind <UserCode>:<绑定码>  绑定你的面板实例",
        "/b50                      同步并发送最新 B50 图片与摘要",
        "/b50 text                 同步并发送纯文本 B50",
        "/unbind                   解除当前绑定",
      ].join("\n"));
      return;
    }

    if (cmd === "/bind") {
      await this.handleBind(bot, openid, args.join(" "), replyText);
      return;
    }

    if (cmd === "/unbind") {
      const removed = this.deps.repo.deleteBinding(bot.id, "c2c", openid);
      await replyText(removed ? "已解除当前 QQ 与 ArcOnline 实例的绑定。" : "当前尚未绑定任何实例。");
      return;
    }

    if (cmd === "/b50") {
      const forceText = args[0]?.toLowerCase() === "text";
      await this.handleB50(bot, openid, msgId, nextSeq, replyText, forceText);
      return;
    }

    await replyText("未识别的指令。发送 /help 查看可用命令。");
  }

  private async handleBind(
    bot: BotRecord,
    openid: string,
    rawArg: string,
    replyText: (content: string) => Promise<void>,
  ) {
    const trimmed = rawArg.trim();
    if (!trimmed) {
      await replyText("格式错误，请发送：/bind <UserCode>:<绑定码>");
      return;
    }

    let instance: InstanceRecord | null = null;
    let code = "";

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex !== -1) {
      const instanceId = trimmed.slice(0, colonIndex).trim();
      code = trimmed.slice(colonIndex + 1).trim();
      instance = instanceId ? this.deps.repo.getInstance(instanceId) : null;
    } else {
      code = trimmed;
      const enabled = this.deps.repo.listInstances().filter((item) => item.enabled);
      if (enabled.length === 1) {
        instance = this.deps.repo.getInstance(enabled[0].id);
      } else {
        await replyText("当前网关有多个实例，请使用完整格式：/bind <UserCode>:<绑定码>");
        return;
      }
    }

    if (!instance || !instance.enabled) {
      await replyText("未找到对应的可用实例，请检查 UserCode 后重试。");
      return;
    }
    if (!code) {
      await replyText("绑定码不能为空，请重新生成后发送 /bind <UserCode>:<绑定码>");
      return;
    }

    try {
      const result = await this.deps.bridge.verifyBindCode(instance, code);
      this.deps.repo.setBinding(bot.id, "c2c", openid, instance.id);
      const playerLabel = result.user?.name
        ? `${result.user.name} (PTT ${result.user.rating.toFixed(3)})`
        : instance.label || instance.id;
      await replyText(`绑定成功！已关联实例「${instance.id}」（${playerLabel}），发送 /b50 即可获取成绩。`);
    } catch (error) {
      const message = error instanceof WorkersBridgeError ? error.message : "核销绑定码失败，请稍后重试。";
      await replyText(`绑定失败：${message}`);
    }
  }

  private async handleB50(
    bot: BotRecord,
    openid: string,
    msgId: string,
    nextSeq: () => number,
    replyText: (content: string) => Promise<void>,
    forceText: boolean,
  ) {
    const binding = this.deps.repo.getBinding(bot.id, "c2c", openid);
    if (!binding) {
      await replyText("你还没有绑定 ArcOnline 实例。请先在面板生成绑定码，并发送 /bind <UserCode>:<绑定码>。");
      return;
    }
    const instance = this.deps.repo.getInstance(binding.instanceId);
    if (!instance || !instance.enabled) {
      await replyText("你绑定的实例当前不可用，请联系管理员或重新绑定。");
      return;
    }

    const syncOutcome = await this.syncBeforeB50(instance, async () => {
      await replyText("正在同步最新 B50，请稍候…");
    });

    try {
      const b50 = await this.deps.bridge.getB50(instance);
      await deliverB50Reply({
        bot,
        openid,
        msgId,
        nextSeq,
        instance,
        b50,
        syncNote: syncOutcome.note,
        forceText,
        config: this.deps.config,
        bridge: this.deps.bridge,
        qq: this.deps.qq,
        mediaSigner: this.deps.mediaSigner,
        customRenderer: this.deps.customRenderer,
      });
    } catch (error) {
      if (error instanceof WorkersBridgeError && error.status === 404) {
        await replyText(
          syncOutcome.failedReason
            ? `同步失败（${syncOutcome.failedReason}），且实例尚无缓存 B50 快照。`
            : "实例尚无 B50 快照，请先确认账号配置正常。",
        );
        return;
      }
      const message = error instanceof Error ? error.message : "未知错误";
      await replyText(`获取 B50 失败：${message}`);
    }
  }

  private async syncBeforeB50(
    instance: InstanceRecord,
    notifyPending: () => Promise<void>,
  ): Promise<{ note?: string; failedReason?: string }> {
    const startedAt = Date.now();
    let notified = false;
    let consecutivePollErrors = 0;

    try {
      const started = await this.deps.bridge.triggerSync(instance);
      let job: BotJobPayload = started.job;

      while (job.status === "queued" || job.status === "running") {
        const elapsed = Date.now() - startedAt;
        if (!notified && elapsed >= PROGRESS_NOTICE_DELAY_MS) {
          notified = true;
          await notifyPending().catch((err) => console.warn("[gateway] progress notice failed:", err));
        }
        if (elapsed >= this.deps.config.syncPollTimeoutMs) {
          const reason = "同步等待超时";
          return {
            note: `同步超时，已回退发送最近一次缓存 B50。`,
            failedReason: reason,
          };
        }
        await this.sleep(this.deps.config.syncPollIntervalMs);
        try {
          job = await this.deps.bridge.getJob(instance, started.jobId);
          consecutivePollErrors = 0;
        } catch (pollError) {
          consecutivePollErrors++;
          if (consecutivePollErrors >= 3) throw pollError;
        }
      }

      if (job.status === "failed") {
        const reason = job.error || "同步任务失败";
        return {
          note: `同步失败（${reason}），已回退发送最近一次缓存 B50。`,
          failedReason: reason,
        };
      }

      if (job.result?.recorded === false) {
        return { note: "B50 无变化，已沿用当前快照并刷新档案。" };
      }
      return { note: "已同步最新 B50。" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "同步请求异常";
      return {
        note: `同步失败（${reason}），已回退发送最近一次缓存 B50。`,
        failedReason: reason,
      };
    }
  }
}
