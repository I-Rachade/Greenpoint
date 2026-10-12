(function () {
  "use strict";

  // English texts. French is written directly in index.html and read from there,
  // so both languages stay in one place each.
  var en = {
    "nav.how": "How it works",
    "nav.who": "Who it's for",
    "nav.operators": "Stations",
    "cta.openShort": "Open the app",
    "cta.open": "Open the web app",
    "cta.mobile": "Mobile apps",
    "hero.eyebrow": "Lomé, Togo",
    "hero.title": "The nearest charging station, live.",
    "hero.lead": "poinderecharge shows you on the map where to charge or swap the battery of your electric moped, tricycle, bike or scooter, with free spots and full batteries in real time.",
    "hero.p1": "Free app",
    "hero.p2": "No install needed",
    "hero.p3": "French and English",
    "mock.near": "Nearby",
    "mock.dist": "650 m · 3 min",
    "mock.avail": "Available",
    "mock.slots": "free spots",
    "mock.batteries": "full batteries",
    "mock.go": "Go there",
    "how.title": "How it works",
    "how.lead": "Three steps, and you're back on the road with a full battery.",
    "how.s1t": "Open the map",
    "how.s1": "poinderecharge finds your location and shows the stations around you, nearest first.",
    "how.s2t": "See availability live",
    "how.s2": "Free charging spots, full batteries for swapping and opening hours, updated in real time.",
    "how.s3t": "Book and ride",
    "how.s3": "Reserve a spot or a battery and get directions to the station.",
    "svc.chargeT": "Charging",
    "svc.charge": "Plug your vehicle into a socket and charge during a break.",
    "svc.swapT": "Battery swap",
    "svc.swap": "Drop off the empty battery, take a full one and ride on in two minutes.",
    "veh.moped": "Electric moped",
    "veh.tricycle": "Electric tricycle",
    "veh.ebike": "E-bike",
    "veh.scooter": "E-scooter",
    "who.title": "Who is it for?",
    "who.privateT": "Private riders",
    "who.private": "Never run flat again: the next station and its available batteries, always at hand.",
    "who.sharingT": "Sharing riders",
    "who.sharing": "Moto-taxi or rental: find a full battery fast and lose fewer rides.",
    "who.deliveryT": "Delivery riders and fleets",
    "who.delivery": "Keep your riders on the road and track charging across your whole fleet.",
    "who.operatorT": "Station operators",
    "who.operator": "Make your station visible and manage batteries and bookings from your phone.",
    "gp.eyebrow": "Loyalty programme · coming soon",
    "gp.lead": "Soon, your charges and battery swaps will earn you points to redeem for free charges and discounts with our partners.",
    "gp.p1": "Points for your charges and swaps",
    "gp.p2": "Free charges with your points",
    "gp.p3": "Bonuses for regular riders",
    "op.title": "Do you run a station?",
    "op.lead": "List your charging or swap station on poinderecharge. Riders find you on the map, and you update your available batteries in one tap.",
    "op.cta": "Contact us",
    "dl.title": "poinderecharge on your phone",
    "dl.lead": "The Android and iPhone apps are coming soon. Meanwhile the web app already works in your browser and can be added to your home screen.",
    "dl.soon": "Coming soon on",
    "dl.get": "Get it on",
    "dl.getIos": "Download on the",
    "aria.lang": "Language",
    "aria.vehicles": "Vehicles",
    "footer.text": "Charging and battery swapping for electric mobility in Lomé."
  };
  var frExtra = { "dl.get": "Disponible sur", "dl.getIos": "Télécharger dans l'" };

  var meta = {
    fr: {
      title: "poinderecharge – Recharge et échange de batterie à Lomé",
      desc: document.querySelector('meta[name="description"]').getAttribute("content")
    },
    en: {
      title: "poinderecharge – Charging and battery swap in Lomé",
      desc: "poinderecharge shows the nearest charging or battery swap station for your electric moped, tricycle, bike or scooter in Lomé, live."
    }
  };

  var links = window.POINDERECHARGE_LINKS || {};
  var nodes = document.querySelectorAll("[data-i18n]");
  var ariaNodes = document.querySelectorAll("[data-i18n-aria]");
  var fr = {};
  nodes.forEach(function (el) { fr[el.getAttribute("data-i18n")] = el.textContent; });
  ariaNodes.forEach(function (el) { fr[el.getAttribute("data-i18n-aria")] = el.getAttribute("aria-label"); });
  Object.keys(frExtra).forEach(function (k) { fr[k] = frExtra[k]; });
  var dict = { fr: fr, en: en };

  function t(lang, key) { return dict[lang][key] || fr[key]; }

  function setupLinks(lang) {
    document.querySelectorAll(".js-webapp").forEach(function (a) {
      a.setAttribute("href", links.webapp || "/");
    });
    document.querySelectorAll(".js-store").forEach(function (a) {
      var url = links[a.getAttribute("data-store")];
      var label = a.querySelector(".js-store-label");
      if (url) {
        a.setAttribute("href", url);
        a.removeAttribute("aria-disabled");
        a.setAttribute("rel", "noopener");
        label.textContent = t(lang, a.getAttribute("data-store") === "ios" ? "dl.getIos" : "dl.get");
      } else {
        a.removeAttribute("href");
        a.setAttribute("aria-disabled", "true");
        label.textContent = t(lang, "dl.soon");
      }
    });
    var op = document.getElementById("operator-cta");
    if (links.contactEmail) {
      op.setAttribute("href", "mailto:" + links.contactEmail);
      op.hidden = false;
    }
  }

  function apply(lang) {
    if (!dict[lang]) lang = "fr";
    nodes.forEach(function (el) { el.textContent = t(lang, el.getAttribute("data-i18n")); });
    ariaNodes.forEach(function (el) { el.setAttribute("aria-label", t(lang, el.getAttribute("data-i18n-aria"))); });
    document.documentElement.lang = lang;
    document.title = meta[lang].title;
    document.querySelector('meta[name="description"]').setAttribute("content", meta[lang].desc);
    document.querySelectorAll("[data-lang]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === lang));
    });
    setupLinks(lang);
    try { localStorage.setItem("gp-lang", lang); } catch (e) { /* storage blocked */ }
  }

  function initialLang() {
    var param = new URLSearchParams(location.search).get("lang");
    if (param) return param;
    try {
      var saved = localStorage.getItem("gp-lang");
      if (saved) return saved;
    } catch (e) { /* storage blocked */ }
    return (navigator.language || "fr").slice(0, 2) === "en" ? "en" : "fr";
  }

  document.querySelectorAll("[data-lang]").forEach(function (b) {
    b.addEventListener("click", function () { apply(b.getAttribute("data-lang")); });
  });
  document.getElementById("year").textContent = new Date().getFullYear();
  apply(initialLang());
})();
