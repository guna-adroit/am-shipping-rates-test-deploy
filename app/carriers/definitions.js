// ─────────────────────────────────────────────────────────────────────────────
// Live carrier definitions
// ─────────────────────────────────────────────────────────────────────────────
// Each carrier entry describes:
//   - key / label      → identifiers used everywhere else in the app
//   - guideUrl          → "View guide" link shown next to "Shipping rates"
//   - credentialFields   → shown inside the Sync modal
//   - services.domestic / services.international → checkbox lists
//
// Only FedEx and Canada Post currently have working live-rate implementations
// (see app/carriers/fedex.server.js and app/carriers/canadapost.server.js).
// The others are wired up end-to-end for credential storage, syncing, and
// service selection, but `fetchRates()` for them returns `null` so checkout
// falls back to the merchant's configured flat fallback rate until their
// real rate APIs are implemented — see app/carriers/index.server.js.
// ─────────────────────────────────────────────────────────────────────────────

export const CARRIERS = [
  {
    key: "canada_post",
    label: "Canada Post",
    guideUrl: "https://www.canadapost-postescanada.ca/cpc/en/business/developers.page",
    credentialFields: [
      { name: "clientId",     label: "Client Id (X-IBM-Client-Id)",     type: "text" },
      { name: "clientSecret", label: "Client Secret (X-IBM-Client-Secret)", type: "password" },
      { name: "customerNumber", label: "Customer Number",               type: "text" },
      { name: "contractId",  label: "Contract Id (Optional)",           type: "text", optional: true,
        helpText: "Only for commercial customers of Canada Post." },
    ],
    services: {
      domestic: [
        "Regular Parcel", "Expedited Parcel", "Xpresspost", "Xpresspost Certified",
        "Priority", "Library Materials",
      ],
      international: [
        "Expedited Parcel USA", "Priority Worldwide Envelope USA", "Priority Worldwide pak USA",
        "Priority Worldwide Parcel USA", "Small Packet USA Air", "Tracked Packet USA",
        "Tracked Packet – USA (LVM)", "Xpresspost USA", "Xpresspost International",
        "International Parcel Air", "International Parcel Surface",
        "Priority Worldwide Envelope Int'l", "Priority Worldwide pak Int'l",
        "Priority Worldwide parcel Int'l", "Small Packet International Air",
        "Small Packet International Surface", "Tracked Packet – International",
      ],
    },
    // Maps our generic service labels to real Canada Post Rating API service
    // codes (see app/carriers/canadapost.server.js). Codes are Canada Post's
    // published domestic service codes — double check against your contract,
    // since not every code is enabled on every account.
    serviceCodeMap: {
      "Regular Parcel":        "DOM.RP",
      "Expedited Parcel":      "DOM.EP",
      "Xpresspost":            "DOM.XP",
      "Xpresspost Certified":  "DOM.XP.CERT",
      "Priority":              "DOM.PC",
      "Library Materials":     "DOM.LIB",
    },
  },
  {
    key: "usps",
    label: "USPS",
    guideUrl: "https://developer.usps.com",
    credentialFields: [
      { name: "clientId",     label: "Client Id",         type: "text" },
      { name: "clientSecret", label: "Client Secret Key", type: "password" },
    ],
    extraToggles: [
      { name: "commercialRates", label: "Enable commercial rates", helpText: "Request commercial services and rates from USPS." },
    ],
    services: {
      domestic: [
        "Priority Mail", "Priority Mail Express", "Media Mail Parcel",
        "Priority Mail Express - Flat Rate Envelope", "Priority Mail - Flat Rate Envelope",
        "Priority Mail - Medium Flat Rate Box", "Priority Mail - Large Flat Rate Box",
        "Priority Mail - Small Flat Rate Box", "Priority Mail - Padded Flat Rate Envelope",
        "Priority Mail Express - Padded Flat Rate Envelope", "Ground Advantage",
      ],
      international: [
        "Priority Mail Express International", "Priority Mail International", "Global Express Guaranteed",
        "Priority Mail International - Flat Rate Envelope", "Priority Mail International - Medium Flat Rate Box",
        "Priority Mail International - Large Flat Rate Box", "First-Class Package International",
        "Priority Mail International - Small Flat Rate Box",
      ],
    },
  },
  {
    key: "fedex",
    label: "Fedex",
    guideUrl: "https://developer.fedex.com",
    credentialFields: [
      { name: "apiKey",        label: "API Key",        type: "text" },
      { name: "secretKey",     label: "Secret Key",     type: "password" },
      { name: "accountNumber", label: "Account Number", type: "text" },
    ],
    extraToggles: [
      { name: "enableOneRate", label: "Enable FedEx One Rate", helpText: "Displays the FedEx One Rates from FedEx to customers." },
      { name: "residentialIndicator", label: "Enable residential address indicator",
        helpText: "Indicate to Fedex if the shipping address is a residential location, as rates may differ for residential addresses. Need to enable this to get 'Home Delivery' rates." },
      { name: "publishedListRates", label: "Get FedEx published list rates",
        helpText: "Enable to get FedEx published list rates, instead of account specific rates." },
    ],
    services: {
      domestic: [
        "Ground", "Economy (Smart Post)", "Express Saver / Economy", "2 Day", "2 Day AM",
        "Standard Overnight", "Standard Overnight Extra Hours", "Priority Overnight",
        "Priority Overnight Extra Hours", "First Overnight", "First Overnight Extra Hours",
        "First Freight", "1 Day Freight", "2 Day Freight", "3 Day Freight", "FedEx First",
        "Priority", "Priority Express", "Priority Express Freight", "Priority Freight",
        "Next Day Freight (Only U.K.)", "Next Day by 9 AM (Only U.K.)", "Next Day by 10 AM (Only U.K.)",
        "Next Day by 12 Noon (Only U.K.)", "Next Day End of Day (Only U.K.)",
        "Economy - Distance Deferred (Only U.K)", "Home Delivery (Only U.S)",
      ],
      international: [
        "International Connect Plus", "International Economy", "International First",
        "International Priority", "International Priority Plus", "Europe First International Priority",
        "International Priority Freight", "International Economy Freight", "Regional Economy (Only EU)",
        "Regional Economy Freight (Only EU)", "International Priority Express (Only EU)",
      ],
    },
    // Maps our generic service labels to real FedEx serviceType codes for the ones
    // we can actually request rates for via the sandbox Rate v1 API.
    // Codes below are taken from actual FedEx sandbox Rate v1 responses.
    serviceCodeMap: {
      "Ground": "FEDEX_GROUND",
      "Express Saver / Economy": "FEDEX_EXPRESS_SAVER",
      "2 Day": "FEDEX_2_DAY",
      "2 Day AM": "FEDEX_2_DAY_AM",
      "Standard Overnight": "STANDARD_OVERNIGHT",
      "Priority Overnight": "PRIORITY_OVERNIGHT",
      "First Overnight": "FIRST_OVERNIGHT",
      "International Priority": "INTERNATIONAL_PRIORITY",
      "International Economy": "INTERNATIONAL_ECONOMY",
      "International First": "INTERNATIONAL_FIRST",
    },
  },
  {
    key: "ups",
    label: "UPS",
    guideUrl: "https://developer.ups.com",
    credentialFields: [
      { name: "clientId",      label: "Client Id",         type: "text" },
      { name: "clientSecret",  label: "Client Secret Key", type: "password" },
      { name: "accountNumber", label: "Account Number",    type: "text" },
    ],
    extraToggles: [
      { name: "negotiatedRates", label: "Enable Negotiated Rates Indicator",
        helpText: "The option is to display the negotiated rates from UPS to the customer.", defaultOn: true },
      { name: "residentialIndicator", label: "Enable residential address indicator",
        helpText: "Indicate to UPS if the shipping address is a residential location, as rates may differ for residential addresses." },
    ],
    services: {
      domestic: [
        "Next Day Air / Express", "2nd Day Air / Expedited", "Ground", "Standard", "Ground Saver",
        "3 Day Select", "Next Day Air Saver / Express Saver", "Next Day Air Early", "2nd Day Air A.M.",
        "Access Point Economy", "Express 12:00", "Today Standard", "Today Dedicated Courrier",
        "Today Express", "Today Express Saver",
      ],
      international: [
        "Worldwide Express", "Worldwide Expedited", "Standard", "Worldwide Express Plus",
        "Worldwide Saver / Express Saver", "Worldwide Express Freight", "Worldwide Express Freight Midday",
        "Worldwide Economy DDU", "Worldwide Economy DDP",
      ],
    },
  },
  {
    key: "dhl_express",
    label: "DHL Express - MyDHL",
    guideUrl: "https://developer.dhl.com",
    credentialFields: [
      { name: "apiKey",        label: "API Key",        type: "text" },
      { name: "secretKey",     label: "Secret Key",     type: "password" },
      { name: "accountNumber", label: "Account Number", type: "text" },
    ],
    extraToggles: [
      { name: "nonDutiable", label: "Customs declarable - non dutiable",
        helpText: "Set the DHL indicator if your shipment is non-dutiable." },
    ],
    services: {
      domestic: [
        "EXPRESS DOMESTIC", "EXPRESS DOMESTIC 9:00", "EXPRESS DOMESTIC 12:00",
        "EXPRESS EASY DOC", "MEDICAL EXPRESS",
      ],
      international: [
        "EXPRESS WORLDWIDE NONDOC", "EXPRESS EASY NONDOC", "MEDICAL EXPRESS",
        "EXPRESS WORLDWIDE", "ECONOMY SELECT",
      ],
    },
  },
  {
    key: "sendle",
    label: "Sendle",
    guideUrl: "https://developers.sendle.com",
    credentialFields: [
      { name: "apiKey",   label: "API Key",   type: "password" },
      { name: "sendleId", label: "Sendle ID", type: "text" },
    ],
    services: {
      domestic: ["Sendle Standard", "Sendle Express"],
      international: ["Sendle International"],
    },
  },
  {
    key: "auspost_calc",
    label: "Australia POST Postage Assessment Calculator",
    guideUrl: "https://developers.auspost.com.au",
    credentialFields: [
      { name: "apiKey", label: "Australia POST Postage Assessment Calculator API Key", type: "password" },
    ],
    services: {
      domestic: ["Parcel Post", "Express Post"],
      international: ["International Standard", "International Express"],
    },
  },
  {
    key: "auspost_eparcel",
    label: "Australia POST - eParcel",
    guideUrl: "https://developers.auspost.com.au",
    credentialFields: [
      { name: "username",      label: "User name",      type: "text" },
      { name: "secretKey",     label: "Secret Key",     type: "password" },
      { name: "accountNumber", label: "Account Number", type: "text" },
    ],
    services: {
      domestic: [
        "EXPRESS POST + SIGNATURE", "PARCEL POST + SIGNATURE", "PARCEL POST XL 1",
        "EXPRESS EPARCEL ID&V 1", "EXPRESS EPARCEL ID&V 2", "WINE + SIGNATURE",
      ],
      international: [
        "INTL EXPRESS DOCS", "INTL STANDARD/PACK & TRACK", "INTL STANDARD WITH SIGNATURE",
        "INTL EXPRESS MERCH", "INTL ECONOMY/AIRMAIL PARCELS", "INTL ECONOMY W SOD/ REGD POST",
        "INTL APGL WW",
      ],
    },
  },
];

export function getCarrier(key) {
  return CARRIERS.find((c) => c.key === key) ?? null;
}

export function getAllServicesFor(key) {
  const c = getCarrier(key);
  if (!c) return [];
  return [...c.services.domestic, ...c.services.international];
}