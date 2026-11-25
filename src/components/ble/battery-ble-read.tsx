"use client";

import { useEffect, useRef, useState } from "react";
import { sameSerial } from "@shared/ble-oves";
import { bleReady, readBattery, scanBatteries, stopScan, type BatteryReading, type FoundBattery } from "@/lib/ble/oves-reader";
import { format } from "@/lib/i18n/format";
import { isNativeApp } from "@/lib/native";
import { useI18n } from "../i18n-provider";
import { Button, Card, useToast } from "../ui";

const SCAN_MS = 15_000;

/**
 * "Read by Bluetooth" in the swap form (in the app only): finds the Omnivoltaic batteries
 * around, the closest first, reads the one the staff pick and hands its charge, voltage,
 * capacity and serial number to the form (shared/ble-oves.ts). The form takes the serial
 * number read in place of the one there (`serial`); the card says when it replaced one, or
 * when the battery did not give it.
 */
export function BatteryBleRead({ serial, onRead }: { serial: string; onRead: (r: BatteryReading) => void }) {
  const { t } = useI18n();
  const x = t.bleRead;
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<Record<string, FoundBattery>>({});
  const [reading, setReading] = useState<string | null>(null);
  const [last, setLast] = useState<BatteryReading | null>(null);
  const [replaced, setReplaced] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      stopScan();
    },
    [],
  );

  if (!isNativeApp()) return null;

  async function stop() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    await stopScan();
    setScanning(false);
  }

  async function start() {
    try {
      if (!(await bleReady())) {
        toast(x.off, { tone: "error" });
        return;
      }
      setFound({});
      setLast(null);
      setReplaced(null);
      await scanBatteries((b) => setFound((f) => ({ ...f, [b.id]: b })));
      setScanning(true);
      timer.current = setTimeout(stop, SCAN_MS);
    } catch (e) {
      toast(format(x.failed, { error: e instanceof Error ? e.message : String(e) }), { tone: "error" });
    }
  }

  async function read(b: FoundBattery) {
    await stop();
    setReading(b.id);
    try {
      const r = await readBattery(b.id, b.name);
      setLast(r);
      setReplaced(r.serial && serial.trim() && !sameSerial(r.serial, serial) ? serial.trim() : null);
      setFound({});
      onRead(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(msg === "no_soc" ? x.noSoc : format(x.failed, { error: msg }), { tone: "error" });
    } finally {
      setReading(null);
    }
  }

  const list = Object.values(found).sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));

  return (
    <Card className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {scanning ? (
          <Button size="sm" variant="secondary" onClick={stop}>
            {x.stop}
          </Button>
        ) : (
          <Button size="sm" onClick={start} busy={reading !== null}>
            {x.read}
          </Button>
        )}
        {scanning && <span className="text-sm text-gp-muted">{list.length ? x.pick : x.searching}</span>}
      </div>
      {list.length > 0 && (
        <ul className="divide-y divide-gp-border">
          {list.map((b, i) => (
            <li key={b.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{b.name}</span>
                {i === 0 && <span className="block text-xs text-gp-muted">{x.closest}</span>}
              </span>
              <Button size="sm" variant="secondary" disabled={reading !== null} busy={reading === b.id} onClick={() => read(b)}>
                {x.choose}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {scanning && list.length === 0 && <p className="text-xs text-gp-muted">{x.hint}</p>}
      {last && (
        <div className="space-y-0.5 text-sm">
          <p className="text-2xl font-semibold tabular-nums text-gp-green-dark dark:text-gp-green">{last.socPct} %</p>
          <p className="text-gp-muted">
            {[
              last.voltageMv !== null ? `${(last.voltageMv / 1000).toFixed(1)} V` : null,
              last.fullMah !== null ? format(x.capacity, { ah: Math.round(last.fullMah / 1000) }) : null,
              last.serial,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {last.serial && replaced && (
            <p role="alert" className="font-medium text-amber-700 dark:text-amber-300">
              {format(x.replaced, { read: last.serial, typed: replaced })}
            </p>
          )}
          {!last.serial && (
            <p role="alert" className="font-medium text-amber-700 dark:text-amber-300">
              {last.nameSuffix ? format(x.noSerialSuffix, { end: last.nameSuffix }) : x.noSerial}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
