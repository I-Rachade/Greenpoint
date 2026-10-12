import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CONTACT_EMAIL } from "@/lib/config";

// Documentation of the partner API (worker/partners.ts) for developers of other
// apps. French only: the partners are businesses in Togo. Reference: /partner-api/openapi.json.

export const metadata: Metadata = { title: "API partenaires · poinderecharge" };

const BASE = "https://app.poinderecharge.com/api/partner/v1";

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-3 text-xs leading-relaxed text-zinc-100">
      <code>{children}</code>
    </pre>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 space-y-3">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      {children}
    </section>
  );
}

const c = "rounded bg-zinc-100 px-1 font-mono text-[0.85em] dark:bg-zinc-800";

const ENDPOINTS: [string, string, string][] = [
  ["GET", "/stations", "Stations qui acceptent et remettent des colis"],
  ["GET", "/prices", "Tailles S à XL et tarifs"],
  ["POST", "/quote", "Prix d'un colis entre deux stations"],
  ["POST", "/bookings", "Réserver un transport"],
  ["GET", "/bookings", "Vos réservations (filtres status, reference)"],
  ["GET", "/bookings/{id}", "Une réservation et son historique (id ou n° GP-…)"],
  ["POST", "/bookings/{id}/cancel", "Annuler avant le dépôt"],
  ["GET", "/events", "Changements de statut, du plus ancien au plus récent"],
  ["GET / PUT", "/webhook", "Adresse du webhook et secret de signature"],
  ["POST", "/webhook/test", "Envoyer un événement ping"],
  ["POST", "/webhook/secret", "Nouveau secret de signature"],
];

const STATUSES: [string, string][] = [
  ["booked", "Réservé, en attente du dépôt à la station de départ (7 jours maximum)."],
  ["deposited", "Déposé : le personnel l'a mesuré, a vérifié le contenu et l'a réceptionné."],
  ["in_transit", "En route vers la station d'arrivée."],
  ["arrived", "Arrivé : le destinataire a reçu son code de retrait dans l'app (et par e-mail s'il en a un)."],
  ["picked_up", "Retiré par le destinataire."],
  ["stored", "Non retiré en 7 jours : placé en entrepôt."],
  ["released / auctioned", "Remis depuis l'entrepôt, ou vendu aux enchères."],
  ["cancelled", "Annulé (par vous avant le dépôt, ou par la station avant le départ)."],
  ["expired", "Pas déposé dans les 7 jours."],
];

const ERRORS: [string, string, string][] = [
  ["401", "missing_api_key, invalid_api_key", "Clé absente, inconnue ou révoquée"],
  ["403", "partner_inactive", "Compte partenaire désactivé"],
  ["404", "booking_not_found", "Réservation inconnue"],
  ["409", "booking_not_cancellable", "Déjà déposée, annulée ou expirée"],
  ["422", "invalid_request, phone_not_allowed, station_not_found, same_station, parcel_too_large", "Champ invalide, nommé dans field"],
  ["500", "unknown", "Erreur chez nous, réessayez"],
];

export default function DeveloperDocsPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <article className="mx-auto w-full max-w-3xl space-y-8 p-6 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">API partenaires</h1>
          <p>
            Votre app (boutique en ligne, service de livraison…) réserve des transports de colis entre les stations poinderecharge de Lomé et
            reçoit chaque changement de statut, comme l&apos;app poinderecharge elle-même. Les colis sont facturés à votre compte partenaire.
          </p>
          <p>
            Référence complète :{" "}
            <a className="text-gp-green-dark underline dark:text-gp-green" href="/partner-api/openapi.json">
              openapi.json
            </a>{" "}
            (OpenAPI 3.1, à importer dans Postman, Insomnia ou un générateur de client).
          </p>
        </header>

        <Section id="demarrer" title="1. Obtenir une clé">
          <p>
            Écrivez-nous à{" "}
            <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            . Nous créons votre compte partenaire et vous envoyons une clé <code className={c}>pdr_live_…</code>. Gardez-la sur votre serveur,
            jamais dans une app mobile ou une page web : elle permet de réserver à vos frais. Si elle fuite, nous la révoquons et vous en donnons
            une nouvelle.
          </p>
          <p>Chaque appel l&apos;envoie dans l&apos;en-tête :</p>
          <Code>{`Authorization: Bearer pdr_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</Code>
        </Section>

        <Section id="parcours" title="2. Le parcours d'un colis">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Votre serveur réserve avec <code className={c}>POST /bookings</code> : station de départ, station d&apos;arrivée, destinataire,
              contenu et mesures. Vous recevez un numéro de suivi <code className={c}>GP-…</code> et le prix.
            </li>
            <li>
              L&apos;expéditeur apporte le colis à la station de départ dans les 7 jours et donne le numéro. Le personnel mesure, pèse et vérifie
              le contenu. Rien n&apos;est payé au comptoir. Si le colis est plus grand que réservé, la taille et le prix mesurés s&apos;appliquent.
            </li>
            <li>Le colis part vers la station d&apos;arrivée. Le destinataire reçoit son code de retrait dans l&apos;app poinderecharge.</li>
            <li>Il retire le colis avec ce code. Chaque étape vous est envoyée par webhook.</li>
          </ol>
          <p className="text-xs text-zinc-500">
            La livraison à domicile et l&apos;enlèvement chez le client par nos chauffeurs arrivent bientôt dans l&apos;API, avec de nouveaux
            statuts.
          </p>
        </Section>

        <Section id="reserver" title="3. Réserver">
          <Code>{`curl ${BASE}/stations \\
  -H "Authorization: Bearer $POINDERECHARGE_KEY"`}</Code>
          <Code>{`curl ${BASE}/bookings \\
  -H "Authorization: Bearer $POINDERECHARGE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "reference": "CMD-1042",
    "fromStationId": "<id de la station de départ>",
    "toStationId": "<id de la station d'arrivée>",
    "recipient": { "name": "Afi Mensah", "phone": "91 23 45 67" },
    "parcel": { "content": "Chaussures", "declaredValue": 15000,
                "lengthCm": 35, "widthCm": 25, "heightCm": 15, "weightKg": 1.5 }
  }'`}</Code>
          <p>Réponse (201) :</p>
          <Code>{`{
  "id": "6f1c…", "reference": "CMD-1042", "trackingNo": "GP-7K3M9Q",
  "status": "booked", "priceFcfa": 500, "expiresAt": "2026-10-19T09:00:00.000Z",
  "parcel": { "size": "M", "content": "Chaussures", … },
  "sender": { "name": "Votre boutique", "phone": "+22890112233" }, …
}`}</Code>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <code className={c}>reference</code> est votre numéro de commande, unique chez vous. Renvoyer la même réservation (après un
              délai d&apos;attente par exemple) renvoie la première, sans doublon.
            </li>
            <li>
              <code className={c}>sender</code> est facultatif : par défaut, le nom et le téléphone de votre compte.
            </li>
            <li>Téléphones du Togo uniquement (+228). Un compte poinderecharge est créé pour un numéro inconnu.</li>
            <li>
              <code className={c}>declaredValue</code> en FCFA limite notre responsabilité : la valeur déclarée, au plus 10 fois le prix et au
              plus 50 000 FCFA.
            </li>
            <li>50 kg au maximum. Objets interdits : voir les conditions générales.</li>
          </ul>
        </Section>

        <Section id="statuts" title="4. Statuts">
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-black/10 dark:divide-white/10">
              {STATUSES.map(([s, text]) => (
                <tr key={s}>
                  <td className="py-1.5 pr-3 align-top font-mono">{s}</td>
                  <td className="py-1.5">{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <code className={c}>GET /bookings/GP-7K3M9Q</code> renvoie l&apos;état actuel et l&apos;historique. De nouveaux statuts peuvent
            s&apos;ajouter : ignorez ceux que vous ne connaissez pas.
          </p>
        </Section>

        <Section id="webhooks" title="5. Webhooks">
          <p>
            Indiquez une adresse https qui reçoit nos messages, puis testez-la :
          </p>
          <Code>{`curl -X PUT ${BASE}/webhook \\
  -H "Authorization: Bearer $POINDERECHARGE_KEY" -H "Content-Type: application/json" \\
  -d '{ "url": "https://votre-boutique.tg/poinderecharge/webhook" }'

curl -X POST ${BASE}/webhook/test -H "Authorization: Bearer $POINDERECHARGE_KEY"`}</Code>
          <p>
            Chaque changement de statut arrive en <code className={c}>POST</code> JSON. Types : <code className={c}>booking.created</code>,{" "}
            <code className={c}>booking.cancelled</code>, <code className={c}>booking.expired</code>, <code className={c}>parcel.deposited</code>,{" "}
            <code className={c}>parcel.in_transit</code>, <code className={c}>parcel.arrived</code>, <code className={c}>parcel.picked_up</code>,{" "}
            <code className={c}>parcel.stored</code>, <code className={c}>parcel.released</code>, <code className={c}>parcel.auctioned</code>,{" "}
            <code className={c}>parcel.cancelled</code>.
          </p>
          <Code>{`POST /poinderecharge/webhook
Poinderecharge-Event: parcel.arrived
Poinderecharge-Event-Id: evt_3f2a…
Poinderecharge-Signature: t=1792000000,v1=5d41402abc4b2a76b9719d911017c592…

{
  "id": "evt_3f2a…",
  "type": "parcel.arrived",
  "createdAt": "2026-10-13T10:12:00.000Z",
  "data": {
    "status": "arrived",
    "stationId": "<station d'arrivée>",
    "booking": { "id": "6f1c…", "reference": "CMD-1042", "trackingNo": "GP-7K3M9Q", "status": "arrived", … }
  }
}`}</Code>
          <ul className="list-disc space-y-1 pl-5">
            <li>Répondez avec un code 2xx en moins de 10 secondes, puis traitez le message.</li>
            <li>Sinon nous réessayons après 1, 5 et 30 minutes, puis 2, 6, 12 et 24 heures.</li>
            <li>
              Un message peut arriver deux fois ou dans le désordre : ignorez un <code className={c}>id</code> déjà traité, et fiez-vous à{" "}
              <code className={c}>data.booking.status</code> pour l&apos;état actuel.
            </li>
            <li>
              Sans webhook, ou pour rattraper une panne : <code className={c}>GET /events?after=&lt;dernier id traité&gt;</code> renvoie les
              mêmes messages.
            </li>
          </ul>
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Vérifier la signature</h3>
          <p>
            Le secret <code className={c}>whsec_…</code> est dans <code className={c}>GET /webhook</code>. La signature est un HMAC-SHA256 en
            hexadécimal de <code className={c}>t + &quot;.&quot; + corps brut</code>. Refusez un message dont le <code className={c}>t</code> a
            plus de 5 minutes.
          </p>
          <Code>{`// Node.js (Express : app.use(express.raw({ type: "application/json" })))
const crypto = require("crypto");

function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}`}</Code>
          <Code>{`<?php
function verify(string $rawBody, string $header, string $secret): bool {
  parse_str(str_replace(',', '&', $header), $p);
  if (abs(time() - (int) $p['t']) > 300) return false;
  $expected = hash_hmac('sha256', $p['t'] . '.' . $rawBody, $secret);
  return hash_equals($expected, $p['v1']);
}
$ok = verify(file_get_contents('php://input'), $_SERVER['HTTP_POINDERECHARGE_SIGNATURE'], getenv('POINDERECHARGE_WEBHOOK_SECRET'));`}</Code>
        </Section>

        <Section id="erreurs" title="6. Erreurs">
          <p>
            Une erreur renvoie <code className={c}>{`{ "error": "code", "message": "…", "field": "recipient.phone" }`}</code>.
          </p>
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-black/10 dark:divide-white/10">
              {ERRORS.map(([status, codes, text]) => (
                <tr key={status}>
                  <td className="py-1.5 pr-3 align-top font-mono">{status}</td>
                  <td className="py-1.5 pr-3 align-top font-mono">{codes}</td>
                  <td className="py-1.5 align-top">{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section id="reference" title="7. Toutes les adresses">
          <p>
            Base : <code className={c}>{BASE}</code>
          </p>
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-black/10 dark:divide-white/10">
              {ENDPOINTS.map(([method, path, text]) => (
                <tr key={method + path}>
                  <td className="py-1.5 pr-3 align-top font-mono">{method}</td>
                  <td className="py-1.5 pr-3 align-top font-mono">{path}</td>
                  <td className="py-1.5 align-top">{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Montants en FCFA (XOF), dates en ISO 8601 (UTC, l&apos;heure de Lomé).</p>
        </Section>
      </article>
    </div>
  );
}
