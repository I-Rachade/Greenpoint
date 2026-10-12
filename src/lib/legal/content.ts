// Legal pages of the app: legal notice, terms of use and privacy policy.
// French is the binding version; English is a translation.
// "[À COMPLÉTER : …]" / "[TO BE COMPLETED: …]" marks data only the company can
// provide (see LEGAL_PLACEHOLDER); the page highlights it until it is filled in.
// "{email}" is replaced with CONTACT_EMAIL. Keep both languages in step.

export type LegalDocId = "notice" | "terms" | "privacy";

/** A paragraph, or a bulleted list when it is an array. */
export type LegalBlock = string | string[];

export interface LegalSection {
  heading: string;
  body: LegalBlock[];
}

export interface LegalDoc {
  title: string;
  /** Date shown as "last updated". */
  updated: string;
  sections: LegalSection[];
}

/** Paths of the legal pages; also the public URLs (e.g. the privacy URL for the app stores). */
export const LEGAL_PATHS: Record<LegalDocId, string> = {
  notice: "/mentions-legales",
  terms: "/cgu",
  privacy: "/confidentialite",
};

/** Matches a placeholder that still has to be filled in. */
export const LEGAL_PLACEHOLDER = /(\[(?:À COMPLÉTER|TO BE COMPLETED)[^\]]*\])/;

const UPDATED = "12/10/2026";

const fr: Record<LegalDocId, LegalDoc> = {
  notice: {
    title: "Mentions légales",
    updated: UPDATED,
    sections: [
      {
        heading: "Éditeur",
        body: [
          "Le site app.poinderecharge.com, le site poinderecharge.com et l'application mobile poinderecharge sont édités par :",
          [
            "[À COMPLÉTER : dénomination sociale], [À COMPLÉTER : forme juridique, ex. SARL] au capital de [À COMPLÉTER : montant] FCFA",
            "Siège social : [À COMPLÉTER : adresse complète], Lomé, Togo",
            "RCCM : [À COMPLÉTER : numéro RCCM]",
            "NIF : [À COMPLÉTER : numéro d'identification fiscale]",
            "Téléphone : [À COMPLÉTER : numéro de téléphone]",
            "E-mail : {email}",
          ],
          "Directeur de la publication : [À COMPLÉTER : nom et fonction].",
        ],
      },
      {
        heading: "Hébergement",
        body: [
          "Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis (www.cloudflare.com). Les données de l'application sont stockées dans un centre de données situé en Europe de l'Ouest.",
        ],
      },
      {
        heading: "Cartes",
        body: [
          "Fonds de carte : OpenFreeMap, données © les contributeurs d'OpenStreetMap (www.openstreetmap.org/copyright).",
        ],
      },
      {
        heading: "Propriété intellectuelle",
        body: [
          "Le nom poinderecharge, les logos, les textes et la conception du site et de l'application sont protégés. Toute reproduction sans autorisation écrite de l'éditeur est interdite. Les informations sur les stations de partenaires restent la propriété de leurs exploitants.",
        ],
      },
      {
        heading: "Données personnelles",
        body: [
          "Le traitement des données personnelles est décrit dans la politique de confidentialité. Il a fait l'objet d'une déclaration auprès de l'Instance de Protection des Données à Caractère Personnel (IPDCP), récépissé n° [À COMPLÉTER : numéro du récépissé IPDCP].",
        ],
      },
      {
        heading: "Droit applicable",
        body: ["Les présentes mentions sont régies par le droit togolais."],
      },
    ],
  },

  terms: {
    title: "Conditions générales d'utilisation",
    updated: UPDATED,
    sections: [
      {
        heading: "1. Objet",
        body: [
          "Les présentes conditions générales d'utilisation (CGU) régissent l'utilisation du service poinderecharge, accessible sur app.poinderecharge.com et dans l'application mobile poinderecharge. Le service permet de trouver des stations de recharge et d'échange de batteries pour véhicules électriques à deux et trois roues au Togo, de voir leur disponibilité et de réserver une batterie ou une place de recharge.",
          "L'éditeur du service est indiqué dans les mentions légales.",
        ],
      },
      {
        heading: "2. Acceptation",
        body: [
          "La création d'un compte suppose l'acceptation des présentes CGU et de la politique de confidentialité. La carte des stations peut être consultée sans compte ; elle est alors soumise aux présentes CGU dans la mesure où elles s'appliquent.",
        ],
      },
      {
        heading: "3. Compte",
        body: [
          [
            "Le compte est créé avec un numéro de téléphone togolais (+228), confirmé par un code reçu par SMS.",
            "L'utilisateur choisit un code PIN personnel à 4 chiffres. Il le garde secret et ne le communique à personne, y compris au personnel des stations.",
            "L'utilisateur est responsable de l'utilisation de son compte. En cas de perte du téléphone ou de doute, il choisit un nouveau code PIN via « Code PIN oublié ? » ou contacte {email}.",
            "Un compte est strictement personnel. Un seul compte par numéro de téléphone.",
          ],
        ],
      },
      {
        heading: "4. Informations sur les stations",
        body: [
          "La disponibilité affichée (places libres, batteries pleines, ouverture) est mise à jour par le personnel des stations ou par des prises connectées. Elle est donnée à titre indicatif et peut différer de la situation réelle, notamment lorsque la dernière mise à jour est ancienne ; l'application l'indique dans ce cas.",
          "Les stations de partenaires sont exploitées sous leur propre responsabilité. Les informations qui les concernent sont fournies par leurs exploitants, sans garantie de l'éditeur.",
        ],
      },
      {
        heading: "5. Réservations",
        body: [
          [
            "Un utilisateur connecté peut réserver une batterie ou une place de recharge dans une station qui propose ce service.",
            "Une réservation est valable 20 minutes. Passé ce délai, elle expire automatiquement et la batterie ou la place est libérée.",
            "Un code de retrait à 4 chiffres est attribué à chaque réservation. L'utilisateur le présente au personnel de la station.",
            "Un utilisateur ne peut avoir qu'une réservation active à la fois. Des limites s'appliquent en cas de réservations répétées non utilisées.",
            "L'utilisateur peut annuler sa réservation à tout moment dans « Mes réservations ». La réservation peut être annulée par la station, notamment en cas de fermeture.",
          ],
          "La réservation est actuellement gratuite et n'engage pas l'utilisateur à acheter la prestation.",
        ],
      },
      {
        heading: "6. Prix et paiement",
        body: [
          "L'utilisation de l'application est gratuite. La recharge et l'échange de batterie sont payés à la station selon les tarifs affichés par celle-ci.",
          "Si un paiement dans l'application (Flooz, T-Money) est proposé, le prix total en FCFA, toutes taxes et frais compris, sera affiché avant la confirmation, ainsi que les conditions de remboursement. Ces conditions complèteront alors les présentes CGU.",
        ],
      },
      {
        heading: "7. Obligations de l'utilisateur",
        body: [
          [
            "Utiliser le service de manière loyale, sans réserver sans intention de se présenter.",
            "Ne pas tenter d'accéder aux comptes d'autres utilisateurs ni de perturber le fonctionnement du service.",
            "Respecter les règles de sécurité et les consignes du personnel dans les stations.",
          ],
          "En cas de manquement, l'éditeur peut suspendre ou fermer le compte, après avoir informé l'utilisateur sauf urgence.",
        ],
      },
      {
        heading: "8. Responsabilité",
        body: [
          "L'éditeur met tout en œuvre pour assurer l'accès au service, sans pouvoir garantir une disponibilité permanente. Il n'est pas responsable des prestations fournies dans les stations de partenaires, ni des dommages résultant d'une information de disponibilité inexacte transmise par un exploitant, ni d'une utilisation du compte avec le code PIN de l'utilisateur.",
          "Rien dans les présentes CGU ne limite les droits que la loi accorde à l'utilisateur.",
        ],
      },
      {
        heading: "9. Publicité",
        body: [
          "L'application peut afficher des messages publicitaires sur la carte, identifiés par la mention « Publicité ». Ils peuvent être fermés à tout moment.",
        ],
      },
      {
        heading: "10. Données personnelles",
        body: ["Les données personnelles sont traitées conformément à la politique de confidentialité."],
      },
      {
        heading: "11. Fermeture du compte",
        body: [
          "L'utilisateur peut supprimer son compte à tout moment dans « Mon compte » (app.poinderecharge.com/compte), après confirmation avec son code PIN ; la suppression est immédiate. Il peut aussi la demander en écrivant à {email} avec son numéro de téléphone ; elle est alors effectuée dans un délai de 30 jours. Les données que la loi oblige à conserver sont gardées pour la durée requise (voir la politique de confidentialité).",
        ],
      },
      {
        heading: "12. Modification des CGU",
        body: [
          "L'éditeur peut modifier les présentes CGU. Les utilisateurs sont informés des modifications importantes dans l'application avant leur entrée en vigueur. La version applicable est celle en ligne à la date d'utilisation.",
        ],
      },
      {
        heading: "13. Droit applicable et litiges",
        body: [
          "Les présentes CGU sont régies par le droit togolais. En cas de réclamation, l'utilisateur écrit d'abord à {email} afin de rechercher une solution amiable. À défaut, les tribunaux compétents de Lomé sont seuls compétents.",
          "En cas de différence entre la version française et une traduction, la version française fait foi.",
        ],
      },
    ],
  },

  privacy: {
    title: "Politique de confidentialité",
    updated: UPDATED,
    sections: [
      {
        heading: "1. Responsable du traitement",
        body: [
          "Le responsable du traitement est l'éditeur indiqué dans les mentions légales : [À COMPLÉTER : dénomination sociale], [À COMPLÉTER : adresse], Lomé, Togo. Contact : {email}.",
          "Ce traitement a été déclaré à l'Instance de Protection des Données à Caractère Personnel (IPDCP) conformément à la loi n° 2019-014 du 29 octobre 2019 relative à la protection des données à caractère personnel ; récépissé n° [À COMPLÉTER : numéro du récépissé IPDCP].",
        ],
      },
      {
        heading: "2. Données collectées",
        body: [
          [
            "Numéro de téléphone : création du compte et connexion.",
            "Code PIN : enregistré uniquement sous forme chiffrée irréversible ; personne ne peut le lire.",
            "Nom, si vous le communiquez.",
            "Réservations : station, type (batterie ou place), dates, statut, code de retrait.",
            "Données techniques : date de création du compte, dernière connexion, sessions de connexion, journal des actions (création du compte, réservations, modifications par le personnel), journaux techniques du serveur (adresse IP, erreurs).",
          ],
          "Votre position n'est ni envoyée à nos serveurs ni enregistrée. Si vous l'autorisez, elle est utilisée uniquement sur votre téléphone, pendant que l'application est ouverte, pour afficher les stations les plus proches. Vous pouvez refuser : les distances sont alors calculées depuis le centre de Lomé.",
        ],
      },
      {
        heading: "3. Finalités",
        body: [
          [
            "Créer et sécuriser votre compte (code SMS, code PIN, protection contre les abus).",
            "Afficher les stations et leur disponibilité.",
            "Gérer vos réservations et permettre au personnel de la station de les valider avec le code de retrait.",
            "Répondre à vos demandes et assurer le support.",
            "Respecter nos obligations légales.",
          ],
          "Vos données sont traitées sur la base de votre consentement, donné lors de la création du compte, et pour exécuter le service que vous demandez. Elles ne sont ni vendues ni utilisées pour de la publicité ciblée. Nous ne vous enverrons pas de SMS publicitaires sans votre accord préalable et distinct.",
        ],
      },
      {
        heading: "4. Destinataires",
        body: [
          [
            "Le personnel des stations voit vos réservations dans sa station, sans votre numéro de téléphone ni votre code de retrait.",
            "Les administrateurs de poinderecharge, tenus à la confidentialité, ont accès aux comptes pour le support et la sécurité.",
            "Nos prestataires techniques, uniquement pour les besoins du service et selon nos instructions :",
          ],
          [
            "Cloudflare, Inc. (États-Unis) : hébergement du site, de l'application et de la base de données ; les données sont stockées dans un centre de données en Europe de l'Ouest.",
            "Didit (Union européenne, Espagne) : envoi et vérification du code SMS ; reçoit votre numéro de téléphone.",
            "OpenFreeMap : affichage des fonds de carte ; reçoit l'adresse IP de votre appareil, pas votre position.",
          ],
          "Si le paiement dans l'application est proposé, le prestataire de paiement (PayGate Global, Togo) et votre opérateur (Moov Africa ou Togocom) recevront les données nécessaires au paiement. Cette politique sera mise à jour avant.",
        ],
      },
      {
        heading: "5. Transferts hors du Togo",
        body: [
          "Certains prestataires sont établis ou stockent les données hors du Togo (Union européenne, États-Unis). Ces transferts ont été portés à la connaissance de l'IPDCP et sont encadrés par des engagements contractuels de protection des données de ces prestataires.",
        ],
      },
      {
        heading: "6. Durées de conservation",
        body: [
          [
            "Codes SMS : 24 heures au plus.",
            "Sessions de connexion : 60 jours, ou jusqu'à la déconnexion.",
            "Compte : tant que le compte existe. À la suppression du compte, le compte, les sessions et les réservations sont effacés et le numéro de téléphone est retiré du journal des actions.",
            "Réservations et journal des actions : [À COMPLÉTER : durée, proposition 12 mois].",
            "Journaux techniques du serveur : quelques jours, selon notre hébergeur.",
            "Paiements, le cas échéant : 5 ans, durée imposée par la réglementation des transactions électroniques.",
          ],
        ],
      },
      {
        heading: "7. Sécurité",
        body: [
          "Connexions chiffrées (HTTPS), code PIN et codes SMS enregistrés uniquement sous forme chiffrée irréversible, blocage après plusieurs codes PIN erronés, accès limité selon le rôle (conducteur, personnel, administrateur) et journal des modifications.",
        ],
      },
      {
        heading: "8. Vos droits",
        body: [
          "Vous disposez d'un droit d'accès, de rectification, d'opposition et de suppression de vos données. Pour les exercer gratuitement, écrivez à {email} en indiquant votre numéro de téléphone. Nous répondons dans un délai d'un mois au plus. Nous pourrons vous demander de confirmer votre identité, par exemple par un code SMS.",
          "Vous pouvez à tout moment retirer votre consentement en supprimant votre compte dans « Mon compte » ou en le demandant par e-mail.",
          "Vous pouvez aussi adresser une réclamation à l'IPDCP (Instance de Protection des Données à Caractère Personnel), Lomé, Togo.",
        ],
      },
      {
        heading: "9. Stockage sur votre appareil",
        body: [
          "L'application enregistre sur votre appareil votre jeton de connexion, la langue choisie et la date du dernier message publicitaire affiché. Elle n'utilise ni cookies publicitaires ni outils de mesure d'audience.",
        ],
      },
      {
        heading: "10. Modification",
        body: [
          "Cette politique peut évoluer, par exemple lors de l'ajout du paiement. La date de mise à jour figure en haut de la page ; les changements importants vous seront signalés dans l'application.",
        ],
      },
    ],
  },
};

const en: Record<LegalDocId, LegalDoc> = {
  notice: {
    title: "Legal notice",
    updated: UPDATED,
    sections: [
      {
        heading: "Publisher",
        body: [
          "The websites app.poinderecharge.com and poinderecharge.com and the poinderecharge mobile app are published by:",
          [
            "[TO BE COMPLETED: company name], [TO BE COMPLETED: legal form, e.g. SARL] with a share capital of [TO BE COMPLETED: amount] FCFA",
            "Registered office: [TO BE COMPLETED: full address], Lomé, Togo",
            "RCCM: [TO BE COMPLETED: RCCM number]",
            "Tax ID (NIF): [TO BE COMPLETED: NIF number]",
            "Phone: [TO BE COMPLETED: phone number]",
            "Email: {email}",
          ],
          "Publication director: [TO BE COMPLETED: name and position].",
        ],
      },
      {
        heading: "Hosting",
        body: [
          "Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, United States (www.cloudflare.com). The app's data is stored in a data centre in Western Europe.",
        ],
      },
      {
        heading: "Maps",
        body: ["Base maps: OpenFreeMap, data © OpenStreetMap contributors (www.openstreetmap.org/copyright)."],
      },
      {
        heading: "Intellectual property",
        body: [
          "The poinderecharge name, logos, texts and design of the websites and the app are protected. Any reproduction without the publisher's written consent is prohibited. Information about partner stations remains the property of their operators.",
        ],
      },
      {
        heading: "Personal data",
        body: [
          "The processing of personal data is described in the privacy policy. It has been declared to the Togolese data protection authority (IPDCP), receipt no. [TO BE COMPLETED: IPDCP receipt number].",
        ],
      },
      {
        heading: "Governing law",
        body: ["This notice is governed by Togolese law."],
      },
    ],
  },

  terms: {
    title: "Terms of use",
    updated: UPDATED,
    sections: [
      {
        heading: "1. Purpose",
        body: [
          "These terms of use govern the poinderecharge service, available at app.poinderecharge.com and in the poinderecharge mobile app. The service lets you find charging and battery swap stations for electric two- and three-wheelers in Togo, see their availability and reserve a battery or a charging spot.",
          "The publisher of the service is named in the legal notice.",
        ],
      },
      {
        heading: "2. Acceptance",
        body: [
          "Creating an account requires accepting these terms and the privacy policy. The station map can be viewed without an account; these terms then apply as far as relevant.",
        ],
      },
      {
        heading: "3. Account",
        body: [
          [
            "An account is created with a Togolese phone number (+228), confirmed by a code sent by SMS.",
            "You choose a personal 4-digit PIN. Keep it secret and never share it, including with station staff.",
            "You are responsible for the use of your account. If you lose your phone or have doubts, choose a new PIN via \"Forgot your PIN?\" or contact {email}.",
            "An account is strictly personal. One account per phone number.",
          ],
        ],
      },
      {
        heading: "4. Station information",
        body: [
          "Displayed availability (free spots, full batteries, opening) is updated by station staff or by connected sockets. It is indicative and may differ from the actual situation, especially when the last update is old; the app shows this.",
          "Partner stations are run under their operators' own responsibility. Information about them is provided by their operators, without warranty from the publisher.",
        ],
      },
      {
        heading: "5. Reservations",
        body: [
          [
            "A logged-in user can reserve a battery or a charging spot at a station offering that service.",
            "A reservation is valid for 20 minutes. After that it expires automatically and the battery or spot is released.",
            "Each reservation has a 4-digit pickup code. Show it to the station staff.",
            "You can only have one active reservation at a time. Limits apply to repeated unused reservations.",
            "You can cancel a reservation at any time in \"My reservations\". The station may cancel it, in particular if it closes.",
          ],
          "Reserving is currently free and does not oblige you to buy the service.",
        ],
      },
      {
        heading: "6. Prices and payment",
        body: [
          "Using the app is free. Charging and battery swaps are paid at the station at the prices it displays.",
          "If in-app payment (Flooz, T-Money) is offered, the total price in FCFA including all taxes and fees will be shown before you confirm, together with the refund conditions, which will then supplement these terms.",
        ],
      },
      {
        heading: "7. Your obligations",
        body: [
          [
            "Use the service fairly; do not reserve without intending to show up.",
            "Do not try to access other users' accounts or disrupt the service.",
            "Follow safety rules and staff instructions at stations.",
          ],
          "In case of a breach, the publisher may suspend or close the account, after informing you except in an emergency.",
        ],
      },
      {
        heading: "8. Liability",
        body: [
          "The publisher does its best to keep the service available but cannot guarantee permanent availability. It is not liable for services provided at partner stations, for damage caused by inaccurate availability information from an operator, or for use of the account with your PIN.",
          "Nothing in these terms limits the rights the law grants you.",
        ],
      },
      {
        heading: "9. Advertising",
        body: [
          "The app may show advertising messages on the map, labelled \"Ad\". You can close them at any time.",
        ],
      },
      {
        heading: "10. Personal data",
        body: ["Personal data is processed as described in the privacy policy."],
      },
      {
        heading: "11. Closing your account",
        body: [
          "You can delete your account at any time in “My account” (app.poinderecharge.com/compte) after confirming with your PIN; deletion is immediate. You can also ask for it by writing to {email} with your phone number; it is then done within 30 days. Data the law requires us to keep is kept for the required period (see the privacy policy).",
        ],
      },
      {
        heading: "12. Changes",
        body: [
          "The publisher may change these terms. Users are informed of important changes in the app before they take effect. The applicable version is the one online on the date of use.",
        ],
      },
      {
        heading: "13. Governing law and disputes",
        body: [
          "These terms are governed by Togolese law. For any complaint, first write to {email} to seek an amicable solution. Failing that, the competent courts of Lomé have sole jurisdiction.",
          "If the French version and a translation differ, the French version prevails.",
        ],
      },
    ],
  },

  privacy: {
    title: "Privacy policy",
    updated: UPDATED,
    sections: [
      {
        heading: "1. Data controller",
        body: [
          "The data controller is the publisher named in the legal notice: [TO BE COMPLETED: company name], [TO BE COMPLETED: address], Lomé, Togo. Contact: {email}.",
          "This processing has been declared to the Togolese data protection authority (IPDCP) under Law no. 2019-014 of 29 October 2019 on the protection of personal data; receipt no. [TO BE COMPLETED: IPDCP receipt number].",
        ],
      },
      {
        heading: "2. Data we collect",
        body: [
          [
            "Phone number: to create your account and log in.",
            "PIN: stored only in irreversibly encrypted form; nobody can read it.",
            "Name, if you provide it.",
            "Reservations: station, type (battery or spot), dates, status, pickup code.",
            "Technical data: account creation date, last login, login sessions, activity log (account creation, reservations, changes by staff), server logs (IP address, errors).",
          ],
          "Your location is never sent to our servers or stored. If you allow it, it is used only on your phone, while the app is open, to show the nearest stations. You can refuse: distances are then measured from the centre of Lomé.",
        ],
      },
      {
        heading: "3. Purposes",
        body: [
          [
            "Create and secure your account (SMS code, PIN, abuse protection).",
            "Show stations and their availability.",
            "Manage your reservations and let station staff confirm them with the pickup code.",
            "Answer your requests and provide support.",
            "Comply with our legal obligations.",
          ],
          "Your data is processed on the basis of the consent you give when creating the account and to provide the service you ask for. It is not sold or used for targeted advertising. We will not send you advertising SMS without your separate prior consent.",
        ],
      },
      {
        heading: "4. Recipients",
        body: [
          [
            "Station staff see reservations at their station, without your phone number or pickup code.",
            "poinderecharge administrators, bound to confidentiality, can access accounts for support and security.",
            "Our technical providers, only for the service and on our instructions:",
          ],
          [
            "Cloudflare, Inc. (United States): hosting of the websites, the app and the database; data is stored in a data centre in Western Europe.",
            "Didit (European Union, Spain): sending and checking the SMS code; receives your phone number.",
            "OpenFreeMap: map tiles; receives your device's IP address, not your location.",
          ],
          "If in-app payment is offered, the payment provider (PayGate Global, Togo) and your mobile operator (Moov Africa or Togocom) will receive the data needed for the payment. This policy will be updated beforehand.",
        ],
      },
      {
        heading: "5. Transfers outside Togo",
        body: [
          "Some providers are established or store data outside Togo (European Union, United States). The IPDCP has been informed of these transfers, which are covered by the providers' contractual data protection commitments.",
        ],
      },
      {
        heading: "6. Retention",
        body: [
          [
            "SMS codes: 24 hours at most.",
            "Login sessions: 60 days, or until you log out.",
            "Account: as long as it exists. When the account is deleted, the account, sessions and reservations are erased and the phone number is removed from the activity log.",
            "Reservations and activity log: [TO BE COMPLETED: period, suggested 12 months].",
            "Server logs: a few days, per our host.",
            "Payments, if any: 5 years, as required by the rules on electronic transactions.",
          ],
        ],
      },
      {
        heading: "7. Security",
        body: [
          "Encrypted connections (HTTPS), PIN and SMS codes stored only in irreversibly encrypted form, lock after several wrong PINs, role-based access (rider, staff, administrator) and a log of changes.",
        ],
      },
      {
        heading: "8. Your rights",
        body: [
          "You have the right to access, correct, object to and delete your data. To exercise these rights free of charge, write to {email} stating your phone number. We reply within one month at most and may ask you to confirm your identity, for example with an SMS code.",
          "You can withdraw your consent at any time by deleting your account in “My account” or asking for it by email.",
          "You can also complain to the IPDCP (Instance de Protection des Données à Caractère Personnel), Lomé, Togo.",
        ],
      },
      {
        heading: "9. Storage on your device",
        body: [
          "The app stores your login token, your chosen language and the date of the last advertising message shown on your device. It uses no advertising cookies and no audience measurement tools.",
        ],
      },
      {
        heading: "10. Changes",
        body: [
          "This policy may change, for example when payment is added. The update date is shown at the top of the page; important changes will be announced in the app.",
        ],
      },
    ],
  },
};

export const LEGAL_DOCS: Record<"fr" | "en", Record<LegalDocId, LegalDoc>> = { fr, en };
