"use client";

import { BleClient, type BleService, type ScanResult } from "@capacitor-community/bluetooth-le";
import { useEffect, useRef, useState } from "react";
import { downloadText } from "@/lib/csv";
import { format } from "@/lib/i18n/format";
import { isNativeApp } from "@/lib/native";
import {
  characteristicName,
  decodeStandard,
  parseHex,
  propertyList,
  reportFileName,
  serviceName,
  shortUuid,
  toAscii,
  toHex,
  type BleFrame,
  type BleReport,
  type BleServiceInfo,
} from "@shared/ble";
import { useI18n } from "../i18n-provider";
import { WorkShell } from "../station-work/work-shell";
import { Badge, Button, Card, EmptyState, Input, useToast } from "../ui";

/**
 * /operator/bluetooth (admins): scans for BLE devices, connects to one, lists its GATT services
 * and characteristics, reads them, listens to notifications and sends bytes, and exports what it
 * saw as a JSON report. Step 2 of the plan "Lire le SOC des batteries par Bluetooth": it maps a
 * battery's own service before a decoder is written. Nothing is sent to the server.
 */

interface Seen {
  id: string;
  name: string | null;
  rssi: number | null;
  uuids: string[];
  manufacturerData: Record<string, string>;
}

const FRAMES_MAX = 500;

function bytesOf(v: DataView): Uint8Array {
  return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function seenOf(r: ScanResult): Seen {
  const manufacturerData: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.manufacturerData ?? {})) manufacturerData[k] = toHex(bytesOf(v));
  return {
    id: r.device.deviceId,
    name: r.localName ?? r.device.name ?? null,
    rssi: r.rssi ?? null,
    uuids: (r.uuids ?? []).map(shortUuid),
    manufacturerData,
  };
}

export function BleDiagnosticPage() {
  const { t } = useI18n();
  const x = t.ble;
  return <WorkShell title={x.title}>{() => (isNativeApp() ? <Diagnostic x={x} /> : <EmptyState text={x.nativeOnly} />)}</WorkShell>;
}

function Diagnostic({ x }: { x: ReturnType<typeof useI18n>["t"]["ble"] }) {
  const toast = useToast();
  const [ready, setReady] = useState<"init" | "ok" | "off" | string>("init");
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<Record<string, Seen>>({});
  const [filter, setFilter] = useState("");
  const [namedOnly, setNamedOnly] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [device, setDevice] = useState<Seen | null>(null);
  const [services, setServices] = useState<BleService[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [listening, setListening] = useState<Record<string, boolean>>({});
  const [frames, setFrames] = useState<BleFrame[]>([]);
  const [marker, setMarker] = useState("");
  const [note, setNote] = useState("");
  const markerRef = useRef("");
  const deviceRef = useRef<string | null>(null);

  useEffect(() => {
    markerRef.current = marker.trim();
  }, [marker]);

  async function checkEnabled() {
    try {
      await BleClient.initialize();
      setReady((await BleClient.isEnabled()) ? "ok" : "off");
    } catch (e) {
      setReady(errorText(e));
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await BleClient.initialize();
        const on = await BleClient.isEnabled();
        if (alive) setReady(on ? "ok" : "off");
      } catch (e) {
        if (alive) setReady(errorText(e));
      }
    })();
    return () => {
      alive = false;
      BleClient.stopLEScan().catch(() => {});
      if (deviceRef.current) BleClient.disconnect(deviceRef.current).catch(() => {});
    };
  }, []);

  function record(kind: BleFrame["kind"], service: string, characteristic: string, bytes: Uint8Array) {
    const frame: BleFrame = { at: new Date().toISOString(), kind, service: shortUuid(service), characteristic: shortUuid(characteristic), hex: toHex(bytes) };
    if (markerRef.current) frame.note = markerRef.current;
    setFrames((f) => [frame, ...f].slice(0, FRAMES_MAX));
  }

  async function startScan() {
    setDevices({});
    try {
      await BleClient.requestLEScan({ allowDuplicates: true }, (r) => {
        const s = seenOf(r);
        setDevices((d) => ({ ...d, [s.id]: { ...d[s.id], ...s, name: s.name ?? d[s.id]?.name ?? null } }));
      });
      setScanning(true);
    } catch (e) {
      toast(format(x.failed, { error: errorText(e) }), { tone: "error" });
    }
  }

  async function stopScan() {
    await BleClient.stopLEScan().catch(() => {});
    setScanning(false);
  }

  async function connect(s: Seen) {
    await stopScan();
    setConnecting(s.id);
    try {
      await BleClient.connect(s.id, () => {
        deviceRef.current = null;
        setDevice(null);
        setServices([]);
        setListening({});
        toast(x.disconnected);
      });
      deviceRef.current = s.id;
      setDevice(s);
      setValues({});
      setServices(await BleClient.getServices(s.id));
    } catch (e) {
      toast(format(x.connectFailed, { error: errorText(e) }), { tone: "error" });
    } finally {
      setConnecting(null);
    }
  }

  async function disconnect() {
    if (deviceRef.current) await BleClient.disconnect(deviceRef.current).catch(() => {});
    deviceRef.current = null;
    setDevice(null);
    setServices([]);
    setListening({});
  }

  async function read(service: string, characteristic: string) {
    if (!deviceRef.current) return;
    try {
      const bytes = bytesOf(await BleClient.read(deviceRef.current, service, characteristic));
      setValues((v) => ({ ...v, [`${service}/${characteristic}`]: toHex(bytes) }));
      record("read", service, characteristic, bytes);
    } catch (e) {
      toast(format(x.failed, { error: errorText(e) }), { tone: "error" });
    }
  }

  async function readAll() {
    for (const s of services) for (const c of s.characteristics) if (c.properties.read) await read(s.uuid, c.uuid);
  }

  async function toggleNotify(service: string, characteristic: string) {
    const id = deviceRef.current;
    if (!id) return;
    const key = `${service}/${characteristic}`;
    try {
      if (listening[key]) {
        await BleClient.stopNotifications(id, service, characteristic);
        setListening((l) => ({ ...l, [key]: false }));
      } else {
        await BleClient.startNotifications(id, service, characteristic, (v) => {
          const bytes = bytesOf(v);
          setValues((vals) => ({ ...vals, [key]: toHex(bytes) }));
          record("notify", service, characteristic, bytes);
        });
        setListening((l) => ({ ...l, [key]: true }));
      }
    } catch (e) {
      toast(format(x.failed, { error: errorText(e) }), { tone: "error" });
    }
  }

  async function write(service: string, characteristic: string, withResponse: boolean, hex: string) {
    const id = deviceRef.current;
    const bytes = parseHex(hex);
    if (!id) return;
    if (!bytes) {
      toast(x.badHex, { tone: "error" });
      return;
    }
    try {
      const view = new DataView(bytes.buffer);
      if (withResponse) await BleClient.write(id, service, characteristic, view);
      else await BleClient.writeWithoutResponse(id, service, characteristic, view);
      record("write", service, characteristic, bytes);
    } catch (e) {
      toast(format(x.failed, { error: errorText(e) }), { tone: "error" });
    }
  }

  function report(): BleReport {
    const info: BleServiceInfo[] = services.map((s) => ({
      uuid: shortUuid(s.uuid),
      name: serviceName(s.uuid),
      characteristics: s.characteristics.map((c) => ({ uuid: shortUuid(c.uuid), name: characteristicName(c.uuid), properties: propertyList({ ...c.properties }) })),
    }));
    const d = device ?? { id: "", name: null, rssi: null, uuids: [], manufacturerData: {} };
    return {
      app: "poinderecharge",
      kind: "ble-diagnostic",
      createdAt: new Date().toISOString(),
      device: { id: d.id, name: d.name, rssi: d.rssi, advertisedServices: d.uuids, manufacturerData: d.manufacturerData },
      services: info,
      frames: [...frames].reverse(),
      note: note.trim(),
    };
  }

  async function exportReport() {
    await downloadText(reportFileName(device?.name ?? null, new Date()), JSON.stringify(report(), null, 2), "application/json");
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report(), null, 2));
      toast(x.copied, { tone: "success" });
    } catch (e) {
      toast(format(x.failed, { error: errorText(e) }), { tone: "error" });
    }
  }

  if (ready === "init") return null;
  if (ready === "off") {
    return (
      <Card className="space-y-3 p-4">
        <p>{x.off}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => BleClient.requestEnable().then(checkEnabled, checkEnabled)}>{x.turnOn}</Button>
          <Button variant="secondary" onClick={() => BleClient.openBluetoothSettings().catch(() => {})}>
            {x.settings}
          </Button>
        </div>
      </Card>
    );
  }
  if (ready !== "ok") return <EmptyState text={format(x.initFailed, { error: ready })} />;

  const q = filter.trim().toLowerCase();
  const list = Object.values(devices)
    .filter((d) => (!namedOnly || d.name) && (!q || (d.name ?? "").toLowerCase().includes(q) || d.id.toLowerCase().includes(q)))
    .sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));

  return (
    <div className="space-y-4">
      <p className="text-sm text-gp-muted">{x.intro}</p>

      {!device && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {scanning ? (
              <Button variant="secondary" onClick={stopScan}>
                {x.stop}
              </Button>
            ) : (
              <Button onClick={startScan}>{x.scan}</Button>
            )}
            {scanning && <span className="text-sm text-gp-muted">{format(x.scanning, { n: Object.keys(devices).length })}</span>}
          </div>
          <Input placeholder={x.filter} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={namedOnly} onChange={(e) => setNamedOnly(e.target.checked)} />
            {x.namedOnly}
          </label>
          {list.length === 0 ? (
            <p className="text-sm text-gp-muted">{x.noDevices}</p>
          ) : (
            <ul className="divide-y divide-gp-border">
              {list.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{d.name ?? x.noName}</span>
                    <span className="block truncate font-mono text-xs text-gp-muted">{d.id}</span>
                    {(d.uuids.length > 0 || Object.keys(d.manufacturerData).length > 0) && (
                      <span className="block truncate font-mono text-xs text-gp-muted">
                        {x.advertised}: {[...d.uuids, ...Object.entries(d.manufacturerData).map(([k, v]) => `${k}=${v}`)].join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-sm text-gp-muted">{d.rssi ?? "–"} dBm</span>
                  <Button size="sm" busy={connecting === d.id} disabled={connecting !== null} onClick={() => connect(d)}>
                    {connecting === d.id ? x.connecting : x.connect}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {device && (
        <>
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{device.name ?? x.noName}</span>
                <span className="block font-mono text-xs text-gp-muted">{device.id}</span>
              </span>
              <Button size="sm" variant="secondary" onClick={readAll}>
                {x.readAll}
              </Button>
              <Button size="sm" variant="secondary" onClick={disconnect}>
                {x.disconnect}
              </Button>
            </div>
            <label className="block space-y-1">
              <span className="text-sm font-medium">{x.marker}</span>
              <Input value={marker} onChange={(e) => setMarker(e.target.value)} maxLength={80} />
              <span className="block text-xs text-gp-muted">{x.markerHint}</span>
            </label>
          </Card>

          <h2 className="font-heading text-lg font-semibold">{format(x.services, { n: services.length })}</h2>
          {services.map((s) => (
            <Card key={s.uuid} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{serviceName(s.uuid) ?? x.vendor}</span>
                <span className="break-all font-mono text-xs text-gp-muted">{shortUuid(s.uuid)}</span>
              </div>
              <ul className="space-y-3">
                {s.characteristics.map((c) => (
                  <Characteristic
                    key={c.uuid}
                    x={x}
                    service={s.uuid}
                    uuid={c.uuid}
                    properties={propertyList({ ...c.properties })}
                    value={values[`${s.uuid}/${c.uuid}`]}
                    listening={!!listening[`${s.uuid}/${c.uuid}`]}
                    onRead={() => read(s.uuid, c.uuid)}
                    onNotify={() => toggleNotify(s.uuid, c.uuid)}
                    onWrite={(hex, withResponse) => write(s.uuid, c.uuid, withResponse, hex)}
                  />
                ))}
              </ul>
            </Card>
          ))}
        </>
      )}

      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 font-heading text-lg font-semibold">{format(x.frames, { n: frames.length })}</h2>
          {frames.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setFrames([])}>
              {x.clear}
            </Button>
          )}
        </div>
        {frames.length === 0 ? (
          <p className="text-sm text-gp-muted">{x.noFrames}</p>
        ) : (
          <ul className="max-h-96 space-y-1 overflow-y-auto font-mono text-xs">
            {frames.map((f, i) => (
              <li key={`${f.at}-${i}`} className="break-all">
                <span className="text-gp-muted">{f.at.slice(11, 19)}</span> <Badge tone={f.kind === "notify" ? "blue" : f.kind === "write" ? "amber" : "neutral"}>{f.kind}</Badge>{" "}
                <span className="text-gp-muted">{f.characteristic.length > 4 ? f.characteristic.slice(0, 8) : f.characteristic}</span> {f.hex}
                {f.note && <span className="text-gp-muted"> · {f.note}</span>}
              </li>
            ))}
          </ul>
        )}
        <label className="block space-y-1">
          <span className="text-sm font-medium">{x.note}</span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportReport} disabled={!device && frames.length === 0}>
            {x.export}
          </Button>
          <Button variant="secondary" onClick={copyReport} disabled={!device && frames.length === 0}>
            {x.copy}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Characteristic({
  x,
  service,
  uuid,
  properties,
  value,
  listening,
  onRead,
  onNotify,
  onWrite,
}: {
  x: ReturnType<typeof useI18n>["t"]["ble"];
  service: string;
  uuid: string;
  properties: string[];
  value: string | undefined;
  listening: boolean;
  onRead: () => void;
  onNotify: () => void;
  onWrite: (hex: string, withResponse: boolean) => void;
}) {
  const [hex, setHex] = useState("");
  const bytes = value ? parseHex(value) : null;
  const decoded = bytes ? decodeStandard(uuid, bytes) : null;
  const canWrite = properties.includes("write") || properties.includes("writeWithoutResponse");
  return (
    <li className="space-y-1 rounded-xl border border-gp-border p-3" data-service={shortUuid(service)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{characteristicName(uuid) ?? "–"}</span>
        <span className="break-all font-mono text-xs text-gp-muted">{shortUuid(uuid)}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {properties.map((p) => (
          <Badge key={p}>{p}</Badge>
        ))}
      </div>
      {value !== undefined && (
        <div className="space-y-0.5 font-mono text-xs">
          <p className="break-all">{value || "–"}</p>
          {bytes && <p className="break-all text-gp-muted">{toAscii(bytes)}</p>}
          {decoded && (
            <p className="font-sans text-base font-semibold text-gp-green-dark dark:text-gp-green">
              {decoded.label} : {decoded.text}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {properties.includes("read") && (
          <Button size="sm" variant="secondary" onClick={onRead}>
            {x.read}
          </Button>
        )}
        {(properties.includes("notify") || properties.includes("indicate")) && (
          <Button size="sm" variant={listening ? "primary" : "secondary"} onClick={onNotify}>
            {listening ? x.stopNotify : x.notify}
          </Button>
        )}
      </div>
      {canWrite && (
        <div className="flex gap-2">
          <Input className="font-mono text-sm" placeholder={x.writeHint} value={hex} onChange={(e) => setHex(e.target.value)} />
          <Button size="sm" variant="secondary" onClick={() => onWrite(hex, properties.includes("write"))}>
            {x.write}
          </Button>
        </div>
      )}
    </li>
  );
}
