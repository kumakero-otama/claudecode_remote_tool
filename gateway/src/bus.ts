import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// チャネル: "exec"=Claude通信(実行可) / "task"=タスク編集(制限ワーカー)
export type Channel = "exec" | "task";

// Webアプリ → Claude へ渡す指示
export type Instruction = { id: string; text: string; from?: string; channel: Channel; ts: number };

// Claude / gateway → Webアプリ へ流すイベント
export type BusEvent =
  | { type: "instruction"; id: string; text: string; from?: string; channel: Channel; ts: number }
  | { type: "received"; instructionId: string; ts: number }
  | { type: "progress"; instructionId: string | null; text: string; ts: number }
  | { type: "response"; instructionId: string | null; text: string; done: boolean; ts: number }
  | { type: "worker_status"; channel: Channel; online: boolean; ts: number };

const WORKER_TTL_MS = 60_000;

/**
 * Webアプリ と 各チャネルのワーカーの間を仲介するインメモリ・メッセージバス。
 * チャネルごとに独立した待ち行列・待機ワーカーを持つ。
 */
class Bus extends EventEmitter {
  private queues = new Map<Channel, Instruction[]>();
  private waiters = new Map<Channel, Array<(i: Instruction | null) => void>>();
  private lastSeen = new Map<Channel, number>();
  private _busy = false;

  private q(ch: Channel): Instruction[] {
    let a = this.queues.get(ch);
    if (!a) { a = []; this.queues.set(ch, a); }
    return a;
  }
  private w(ch: Channel): Array<(i: Instruction | null) => void> {
    let a = this.waiters.get(ch);
    if (!a) { a = []; this.waiters.set(ch, a); }
    return a;
  }

  submitInstruction(text: string, from: string | undefined, channel: Channel): Instruction {
    const inst: Instruction = { id: randomUUID(), text, from, channel, ts: Date.now() };
    this.emit("event", { type: "instruction", ...inst } as BusEvent);
    const waiter = this.w(channel).shift();
    if (waiter) {
      this.deliver(inst);
      waiter(inst);
    } else {
      this.q(channel).push(inst);
    }
    return inst;
  }

  private deliver(inst: Instruction): void {
    this._busy = true;
    this.emit("event", { type: "received", instructionId: inst.id, ts: Date.now() } as BusEvent);
  }

  waitForInstruction(channel: Channel, timeoutMs: number): Promise<Instruction | null> {
    this.markWorker(channel);
    const queued = this.q(channel).shift();
    if (queued) {
      this.deliver(queued);
      return Promise.resolve(queued);
    }
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout;
      const wrapped = (i: Instruction | null) => { clearTimeout(timer); resolve(i); };
      timer = setTimeout(() => {
        const arr = this.w(channel);
        const idx = arr.indexOf(wrapped);
        if (idx >= 0) arr.splice(idx, 1);
        resolve(null);
      }, timeoutMs);
      this.w(channel).push(wrapped);
    });
  }

  sendResponse(instructionId: string | null, text: string, done: boolean): void {
    if (done) this._busy = false;
    this.emit("event", { type: "response", instructionId, text, done, ts: Date.now() } as BusEvent);
  }

  pushProgress(instructionId: string | null, text: string): void {
    this.emit("event", { type: "progress", instructionId, text, ts: Date.now() } as BusEvent);
  }

  markWorker(channel: Channel): void {
    const was = this.workerOnline(channel);
    this.lastSeen.set(channel, Date.now());
    if (!was) this.emit("event", { type: "worker_status", channel, online: true, ts: Date.now() } as BusEvent);
  }

  workerOnline(channel: Channel): boolean {
    return Date.now() - (this.lastSeen.get(channel) ?? 0) < WORKER_TTL_MS;
  }

  get busy(): boolean {
    return this._busy;
  }

  status() {
    return {
      workerOnline: this.workerOnline("exec"), // チャットの接続表示用
      taskWorkerOnline: this.workerOnline("task"),
      busy: this._busy,
    };
  }
}

export const bus = new Bus();
