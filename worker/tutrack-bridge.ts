import { connect } from "cloudflare:sockets";
import type { Env } from "./env";
import { connackCode, connectPacket, MQTT, MqttReader, pingPacket, pubackPacket, readPublish, subscribePacket } from "./mqtt";
import { ingestTutrack } from "./share";

// Tutrack pushes positions, online changes and alarms only by MQTT (docs mqttPush.md), and a
// Worker request cannot hold a connection. This one Durable Object keeps the subscription:
// an alarm every 30 seconds pings the broker and reconnects when the socket dropped, and the
// minute cron (worker/index.ts) wakes it should it ever stop. Nothing runs while trackers are
// simulated (docs/SHARE.md). Each message goes to ingestTutrack (worker/share.ts).

const DEFAULT_HOST = "pub.ent.tqiot.com";
const DEFAULT_PORT = 2883;
const KEEP_ALIVE_SECONDS = 60;
const TICK_MS = 30_000;

/** The MQTT push is set up: Tutrack trackers, the enterprise id and the broker login. */
export function tutrackPushConfigured(env: Env): boolean {
  return env.SHARE_TRACKER_PROVIDER === "tutrack" && !!env.TUTRACK_ENT_ID && !!env.TUTRACK_MQTT_USER && !!env.TUTRACK_MQTT_PASSWORD;
}

/** Called by the minute cron: makes sure the bridge runs. */
export async function ensureTutrackBridge(env: Env) {
  if (!env.TUTRACK || !tutrackPushConfigured(env)) return;
  const stub = env.TUTRACK.get(env.TUTRACK.idFromName("tutrack"));
  await stub.fetch("https://tutrack-bridge/ensure", { method: "POST" });
}

export class TutrackBridge implements DurableObject {
  private socket: Socket | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private connected = false;
  private lastPacketAt = 0;

  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(): Promise<Response> {
    await this.tick();
    return Response.json({ connected: this.connected });
  }

  async alarm() {
    await this.tick();
  }

  private async tick() {
    if (!tutrackPushConfigured(this.env)) {
      this.close();
      return;
    }
    // A broker that has said nothing for two keep-alives is gone.
    if (this.socket && Date.now() - this.lastPacketAt > 2 * KEEP_ALIVE_SECONDS * 1000) this.close();
    try {
      if (!this.socket) await this.open();
      else if (this.connected) await this.send(pingPacket());
    } catch (err) {
      console.error("tutrack mqtt", err);
      this.close();
    }
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  private async open() {
    const env = this.env;
    const socket = connect(
      { hostname: env.TUTRACK_MQTT_HOST || DEFAULT_HOST, port: Number(env.TUTRACK_MQTT_PORT) || DEFAULT_PORT },
      { secureTransport: env.TUTRACK_MQTT_TLS === "1" ? "on" : "off", allowHalfOpen: false },
    );
    this.socket = socket;
    this.writer = socket.writable.getWriter();
    this.lastPacketAt = Date.now();
    await this.send(
      connectPacket({
        clientId: `poinderecharge-${env.TUTRACK_ENT_ID}-${crypto.randomUUID().slice(0, 8)}`,
        username: env.TUTRACK_MQTT_USER,
        password: env.TUTRACK_MQTT_PASSWORD,
        keepAliveSeconds: KEEP_ALIVE_SECONDS,
      }),
    );
    void this.read(socket);
  }

  private async read(socket: Socket) {
    const reader = socket.readable.getReader();
    const packets = new MqttReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || this.socket !== socket) break;
        this.lastPacketAt = Date.now();
        for (const p of packets.push(value)) {
          if (p.type === MQTT.CONNACK) {
            const code = connackCode(p);
            if (code !== 0) throw new Error(`connack ${code}`);
            this.connected = true;
            await this.send(subscribePacket(1, `server/ent/${this.env.TUTRACK_ENT_ID}`, 1));
          } else if (p.type === MQTT.PUBLISH) {
            const msg = readPublish(p);
            try {
              await ingestTutrack(this.env.DB, JSON.parse(msg.payload));
            } catch (err) {
              console.error("tutrack message", err);
            }
            // Acknowledged also when it could not be read: a broken message would only come back.
            if (msg.qos === 1 && msg.packetId !== null) await this.send(pubackPacket(msg.packetId));
          }
        }
      }
    } catch (err) {
      console.error("tutrack mqtt read", err);
    } finally {
      if (this.socket === socket) this.close();
    }
  }

  private async send(bytes: Uint8Array) {
    if (!this.writer) throw new Error("not connected");
    await this.writer.write(bytes);
  }

  private close() {
    const socket = this.socket;
    this.socket = null;
    this.writer = null;
    this.connected = false;
    if (socket) socket.close().catch(() => {});
  }
}
