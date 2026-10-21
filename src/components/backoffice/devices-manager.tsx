"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { boxQrUrl, socketQrUrl } from "@/lib/charging";
import { displayStatus } from "@/lib/iot/charging-points";
import { canSwitch, DEVICE_LINKS, MAX_OUTLETS, type Device, type DeviceInput } from "@/lib/iot/devices";
import { useErrorMessage, useLiveQuery, useNow, useRelativeTime } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { QrImage } from "../parcels/qr-image";
import { card, field, indexSnapshot, Loading, Pill, StaleNotice, useAdminSnapshot } from "./shared";

const EMPTY: DeviceInput = { externalId: "", stationId: "", outlets: 2, link: "lorawan", vendor: "", model: "", protocol: null };

const TONE = { free: "green", reserved: "blue", charging: "blue", done: "gray", fault: "red", offline: "red" } as const;

/** Backoffice page to register connected sockets and switch their outlets. */
export function DevicesManager() {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const relativeTime = useRelativeTime();
  const now = useNow(30_000);
  const { data: devices, error, reload } = useLiveQuery(() => backend.listDevices());
  // Who owns each socket (src/lib/point-partners.ts): poinderecharge unless a partner is chosen.
  const { data: partners } = useLiveQuery(() => backend.adminPointPartners());
  const { data: snap, error: snapError, reload: reloadSnap } = useAdminSnapshot();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [qrShown, setQrShown] = useState<string | null>(null);
  const retry = () => {
    reload();
    reloadSnap();
  };
  if (!devices || !snap) return <Loading error={error ?? snapError} onRetry={retry} />;

  const b = t.backoffice.devices;
  const idx = indexSnapshot(snap);

  async function run(action: () => Promise<void>, success: string | (() => string)) {
    try {
      await action();
      setMessage({ ok: true, text: typeof success === "string" ? success : success() });
      reload();
      return true;
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
      return false;
    }
  }

  return (
    <div className="space-y-4">
      <StaleNotice error={error ?? snapError} onRetry={retry} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{b.title}</h1>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setAdding(true);
            }}
            className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm font-medium text-white"
          >
            {b.add}
          </button>
        )}
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{b.intro}</p>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm break-words ${message.ok ? "text-gp-green-dark" : "text-red-600"}`}>
          {message.text}
        </p>
      )}

      {adding && (
        <DeviceForm
          stations={snap.stations.map((s) => ({ id: s.id, name: s.name }))}
          onCancel={() => setAdding(false)}
          onSave={async (input) => {
            const id = input.externalId.trim().toUpperCase();
            let text = format(b.added, { id });
            const ok = await run(async () => {
              const { ocppKey } = await backend.createDevice(input);
              // The charge point's password exists only in this answer.
              const url = `wss://${window.location.host}/api/devices/ocpp`;
              if (ocppKey) text = format(b.ocppAdded, { id, key: ocppKey, url, keyUrl: `${url}/k/${ocppKey}` });
              else if (input.protocol === "ocpp1.6") text = format(b.ocppAddedOpen, { id, url });
            }, () => text);
            if (ok) setAdding(false);
          }}
        />
      )}

      {devices.length === 0 ? (
        <p className={`${card} text-sm text-zinc-500`}>{b.empty}</p>
      ) : (
        <ul className="space-y-2">
          {devices.map((d) => {
            const switchable = canSwitch(d);
            return (
              <li key={d.externalId} className={`${card} space-y-3`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-medium">{d.externalId}</div>
                    <div className="text-xs text-zinc-500">
                      {idx.stationName(d.stationId)} · {[d.vendor, d.model].filter(Boolean).join(" ") || b.links[d.link]}
                      {d.protocol === "ocpp1.6" && ` · OCPP 1.6J ${d.ocppOpen ? b.ocppOpen : b.ocppKeyed}`} ·{" "}
                      {b.lastSeen}: {d.lastSeenAt ? relativeTime(d.lastSeenAt, now) : b.never}
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-xs">
                      <span className="text-zinc-500">{t.pointPartners.owner}</span>
                      <select
                        value={d.partnerId ?? ""}
                        disabled={!partners}
                        onChange={(e) =>
                          run(() => backend.setDevicePartner(d.externalId, e.target.value || null), format(t.pointPartners.ownerSaved, { id: d.externalId }))
                        }
                        className={`${field} py-1 text-xs`}
                      >
                        <option value="">{t.pointPartners.ours}</option>
                        {(partners ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(format(b.confirmRemove, { id: d.externalId, n: d.points.length }))) {
                        run(() => backend.deleteDevice(d.externalId), format(b.removed, { id: d.externalId }));
                      }
                    }}
                    className="text-sm text-red-600 hover:underline"
                  >
                    {b.remove}
                  </button>
                </div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {d.points.map((p) => {
                    const status = displayStatus(p, now);
                    return (
                      <li key={p.id} className="space-y-2 rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">
                            {b.outlet} {p.outlet} · {p.label}
                          </span>
                          <span className="flex items-center gap-2">
                            <Pill tone={TONE[status]}>{b.status[status]}</Pill>
                            {switchable && p.outlet !== null && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => run(() => backend.switchOutlet(d.externalId, p.outlet!, true), format(b.sent, { label: p.label }))}
                                  className="text-gp-green-dark hover:underline"
                                >
                                  {b.on}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => run(() => backend.switchOutlet(d.externalId, p.outlet!, false), format(b.sent, { label: p.label }))}
                                  className="text-zinc-600 hover:underline dark:text-zinc-300"
                                >
                                  {b.off}
                                </button>
                              </>
                            )}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-2" title={b.qrStartHint}>
                            <input
                              type="checkbox"
                              checked={!!p.qrStart}
                              // A socket we cannot switch on never starts by QR; switching it off stays possible.
                              disabled={!switchable && !p.qrStart}
                              onChange={(e) => {
                                const on = e.target.checked;
                                run(() => backend.setQrStart(p.id, on), format(on ? b.qrOn : b.qrOff, { label: p.label }));
                              }}
                              className="h-4 w-4 accent-gp-green-dark"
                            />
                            {b.qrStart}
                          </label>
                          {p.qrStart && qrCode(d) && p.outlet !== null && (
                            <button
                              type="button"
                              onClick={() => setQrShown(qrShown === p.id ? null : p.id)}
                              aria-expanded={qrShown === p.id}
                              className="text-gp-green-dark hover:underline"
                            >
                              {qrShown === p.id ? b.qrHide : b.qrShow}
                            </button>
                          )}
                        </div>
                        {!switchable && <p className="text-xs text-zinc-500">{b.qrNotSwitchable}</p>}
                        {p.qrStart && qrCode(d) && p.outlet !== null && qrShown === p.id && (
                          <div className="flex flex-col items-center gap-1 pt-1">
                            <QrImage text={socketQrUrl(qrOrigin(), qrCode(d)!, p.outlet)} label={`${b.qrStart} ${p.label}`} size={200} />
                            <div className="font-mono font-semibold">
                              {b.outlet} {p.outlet} · {p.label}
                            </div>
                            <p className="text-center text-xs text-zinc-500">{format(b.qrSocketPrint, { n: p.outlet })}</p>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {/* One sticker for the whole box: the customer picks the outlet in the app. */}
                {qrCode(d) && d.points.some((p) => p.qrStart) && (
                  <div className="space-y-2 border-t border-black/10 pt-2 text-sm dark:border-white/10">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{b.qrBox}</span>
                      <span className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setQrShown(qrShown === d.externalId ? null : d.externalId)}
                          aria-expanded={qrShown === d.externalId}
                          className="text-gp-green-dark hover:underline"
                        >
                          {qrShown === d.externalId ? b.qrHide : b.qrShow}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(format(b.qrRenewConfirm, { id: d.externalId }))) {
                              run(() => backend.renewBoxQr(d.externalId).then(() => undefined), format(b.qrRenewed, { id: d.externalId }));
                            }
                          }}
                          className="text-zinc-600 hover:underline dark:text-zinc-300"
                        >
                          {b.qrRenew}
                        </button>
                      </span>
                    </div>
                    {qrShown === d.externalId && (
                      <div className="flex flex-col items-center gap-1 pt-1">
                        <QrImage text={boxQrUrl(qrOrigin(), qrCode(d)!)} label={`${b.qrBox} ${d.externalId}`} size={200} />
                        <div className="text-xs text-zinc-500">{idx.stationName(d.stationId)}</div>
                        <div className="font-mono font-semibold">{format(t.charging.qr.box, { label: d.externalId.slice(-4) })}</div>
                        <p className="text-center text-xs text-zinc-500">{format(b.qrBoxPrint, { n: d.points.length })}</p>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The site the box's QR code opens: this one in a browser, the public app inside the native app. */
/** The box's short code; a box the Worker has not given one yet prints its long token. */
function qrCode(d: Device): string | null {
  return d.qrCode ?? d.qrToken;
}

function qrOrigin(): string {
  return window.location.protocol.startsWith("http") ? window.location.origin : "https://app.poinderecharge.com";
}

function DeviceForm({
  stations,
  onSave,
  onCancel,
}: {
  stations: { id: string; name: string }[];
  onSave: (input: DeviceInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const f = t.backoffice.devices.form;
  const links = t.backoffice.devices.links;
  const [input, setInput] = useState<DeviceInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<DeviceInput>) => setInput((prev) => ({ ...prev, ...patch }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(input);
    } finally {
      setBusy(false);
    }
  }

  const label = "flex flex-col gap-1 text-sm";
  return (
    <form onSubmit={submit} className={`${card} grid gap-3 sm:grid-cols-2`}>
      <label className={`${label} sm:col-span-2`}>
        {f.externalId}
        <input
          required
          value={input.externalId}
          onChange={(e) => set({ externalId: e.target.value })}
          pattern="[0-9A-Za-z:_\-]{4,64}"
          autoComplete="off"
          className={`${field} font-mono`}
        />
        <span className="text-xs text-zinc-500">{f.externalIdHint}</span>
      </label>
      <label className={label}>
        {f.station}
        <select required value={input.stationId} onChange={(e) => set({ stationId: e.target.value })} className={field}>
          <option value="">{f.chooseStation}</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        {f.outlets}
        <input
          type="number"
          required
          min={1}
          max={MAX_OUTLETS}
          value={input.outlets}
          onChange={(e) => set({ outlets: Number(e.target.value) })}
          className={field}
        />
      </label>
      <label className={label}>
        {f.link}
        <select
          value={input.link}
          onChange={(e) => {
            const link = e.target.value as DeviceInput["link"];
            // Sockets on a vendor cloud are Xingke ones so far; the name enables switching.
            const protocol = link === "own_server" ? input.protocol : null;
            set(link === "vendor_cloud" && !input.vendor ? { link, protocol, vendor: "Xingke" } : { link, protocol });
          }}
          className={field}
        >
          {DEVICE_LINKS.map((l) => (
            <option key={l} value={l}>
              {links[l]}
            </option>
          ))}
        </select>
      </label>
      {input.link === "own_server" && (
        <label className={label}>
          {f.protocol}
          <select
            value={input.protocol !== "ocpp1.6" ? "" : input.ocppNoPassword ? "ocpp-open" : "ocpp-key"}
            onChange={(e) =>
              set(e.target.value === "" ? { protocol: null, ocppNoPassword: false } : { protocol: "ocpp1.6", ocppNoPassword: e.target.value === "ocpp-open" })
            }
            className={field}
          >
            <option value="">{f.protocolNone}</option>
            <option value="ocpp-key">{f.ocppKey}</option>
            <option value="ocpp-open">{f.ocppOpen}</option>
          </select>
        </label>
      )}
      <label className={label}>
        {f.vendor}
        <input value={input.vendor} onChange={(e) => set({ vendor: e.target.value })} maxLength={80} className={field} />
      </label>
      <label className={label}>
        {f.model}
        <input value={input.model} onChange={(e) => set({ model: e.target.value })} maxLength={80} className={field} />
      </label>
      <div className="flex items-end justify-end gap-2 sm:col-span-2">
        <button type="button" onClick={onCancel} className="rounded-full px-4 py-1.5 text-sm text-zinc-700 dark:text-zinc-300">
          {f.cancel}
        </button>
        <button type="submit" disabled={busy} className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {f.save}
        </button>
      </div>
    </form>
  );
}
