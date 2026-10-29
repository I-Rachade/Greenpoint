// The few MQTT 3.1.1 packets the Tutrack subscription needs (worker/tutrack-bridge.ts): CONNECT,
// SUBSCRIBE, PINGREQ, PUBACK out; CONNACK, SUBACK, PUBLISH, PINGRESP in. The broker only lets
// us subscribe (docs: "Subscribe only, Publish not supported").

export const MQTT = { CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4, SUBSCRIBE: 8, SUBACK: 9, PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14 } as const;

const enc = new TextEncoder();
const dec = new TextDecoder();

function str(s: string): Uint8Array {
  const b = enc.encode(s);
  return new Uint8Array([b.length >> 8, b.length & 0xff, ...b]);
}

function remainingLength(n: number): number[] {
  const out: number[] = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return out;
}

function packet(first: number, body: Uint8Array): Uint8Array {
  return new Uint8Array([first, ...remainingLength(body.length), ...body]);
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export function connectPacket(o: { clientId: string; username?: string; password?: string; keepAliveSeconds: number }): Uint8Array {
  // Clean session; user name and password flags when given.
  const flags = 0x02 | (o.username ? 0x80 : 0) | (o.password ? 0x40 : 0);
  const header = concat(str("MQTT"), new Uint8Array([4, flags, o.keepAliveSeconds >> 8, o.keepAliveSeconds & 0xff]));
  const payload = concat(str(o.clientId), o.username ? str(o.username) : new Uint8Array(), o.password ? str(o.password) : new Uint8Array());
  return packet(MQTT.CONNECT << 4, concat(header, payload));
}

export function subscribePacket(packetId: number, topic: string, qos: 0 | 1 = 1): Uint8Array {
  return packet((MQTT.SUBSCRIBE << 4) | 0x02, concat(new Uint8Array([packetId >> 8, packetId & 0xff]), str(topic), new Uint8Array([qos])));
}

export function pingPacket(): Uint8Array {
  return new Uint8Array([MQTT.PINGREQ << 4, 0]);
}

export function pubackPacket(packetId: number): Uint8Array {
  return new Uint8Array([MQTT.PUBACK << 4, 2, packetId >> 8, packetId & 0xff]);
}

export interface MqttPacket {
  type: number;
  flags: number;
  body: Uint8Array;
}

/** Collects bytes from the socket and hands out whole packets. */
export class MqttReader {
  private buffer = new Uint8Array();

  push(chunk: Uint8Array): MqttPacket[] {
    this.buffer = concat(this.buffer, chunk);
    const out: MqttPacket[] = [];
    for (;;) {
      if (this.buffer.length < 2) break;
      let length = 0;
      let multiplier = 1;
      let i = 1;
      let complete = false;
      for (; i < 5 && i < this.buffer.length; i++) {
        length += (this.buffer[i] & 0x7f) * multiplier;
        multiplier *= 128;
        if (!(this.buffer[i] & 0x80)) {
          complete = true;
          break;
        }
      }
      if (!complete) {
        if (i >= 5) throw new Error("mqtt: bad remaining length");
        break;
      }
      const start = i + 1;
      if (this.buffer.length < start + length) break;
      out.push({ type: this.buffer[0] >> 4, flags: this.buffer[0] & 0x0f, body: this.buffer.slice(start, start + length) });
      this.buffer = this.buffer.slice(start + length);
    }
    return out;
  }
}

export interface MqttPublish {
  topic: string;
  qos: number;
  packetId: number | null;
  payload: string;
}

export function readPublish(p: MqttPacket): MqttPublish {
  const topicLength = (p.body[0] << 8) | p.body[1];
  const topic = dec.decode(p.body.slice(2, 2 + topicLength));
  const qos = (p.flags >> 1) & 0x03;
  let at = 2 + topicLength;
  let packetId: number | null = null;
  if (qos > 0) {
    packetId = (p.body[at] << 8) | p.body[at + 1];
    at += 2;
  }
  return { topic, qos, packetId, payload: dec.decode(p.body.slice(at)) };
}

/** CONNACK return code: 0 = accepted. */
export function connackCode(p: MqttPacket): number {
  return p.body[1] ?? 255;
}
