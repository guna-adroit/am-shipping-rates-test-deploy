import db from "../db.server";

// ─────────────────────────────────────────────────────────────────────────────
// ID generation
// ─────────────────────────────────────────────────────────────────────────────

async function generateZoneId() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = String(Math.floor(100000 + Math.random() * 900000));
    const existing = await db.zone.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return id;
  }
  throw new Error("Could not generate a unique 6-digit zone ID. Try again.");
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function getZones(shopDomain) {
  return db.zone.findMany({
    where: { shopDomain },
    include: { rates: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getZone(id, shopDomain) {
  return db.zone.findFirst({
    where: { id, shopDomain },
    include: { rates: { orderBy: { createdAt: "asc" } } },
  });
}

export async function createZone(shopDomain, data) {
  const id = await generateZoneId();
  return db.zone.create({
    data: {
      id,
      shopDomain,
      name: data.name,
      zipCodes: "",                                // Scenarios no longer use zipCodes
      conditions: serializeConditions(data.conditions),
      isFallback: Boolean(data.isFallback),
      status: data.status || "enabled",
    },
  });
}

export async function updateZone(id, data) {
  return db.zone.update({
    where: { id },
    data: {
      name: data.name,
      conditions: serializeConditions(data.conditions),
      status: data.status,
      updatedAt: new Date(),
    },
  });
}

export async function deleteZone(id) {
  return db.zone.delete({ where: { id } });
}

export async function getFallbackZone(shopDomain) {
  return db.zone.findFirst({
    where: { shopDomain, isFallback: true },
    include: { rates: { orderBy: { minValue: "asc" } } },
  });
}

export async function createFallbackZone(shopDomain) {
  const id = await generateZoneId();
  return db.zone.create({
    data: {
      id,
      shopDomain,
      name: "Fallback Rates",
      zipCodes: "",
      isFallback: true,
      status: "enabled",
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Carrier service — scenario matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * cartData = {
 *   zip:                  string,          // destination postal code
 *   items:                ShopifyLineItem[],
 *   totalDollars:         number,          // sum(price * qty) / 100
 *   totalQuantity:        number,          // sum(qty)
 *   totalWeightKg:        number,          // sum(grams * qty) / 1000
 *   destination:          object,          // full destination object from Shopify
 * }
 *
 * Returns { zone, isFallback: boolean } or null.
 */
/**
 * Returns the FIRST matching scenario (backward-compat).
 * Prefer findAllMatchingScenarios for multi-scenario logic.
 */
export async function findMatchingScenario(shopDomain, cartData) {
  const result = await findAllMatchingScenarios(shopDomain, cartData);
  if (!result) return null;
  return { zone: result.zones[0], isFallback: result.isFallback };
}

/**
 * Returns ALL matching non-fallback scenarios (or the fallback if none match).
 * Used by the carrier service to apply "highest rate wins" logic across scenarios.
 *
 * Returns: { zones: Zone[], isFallback: boolean } | null
 */
export async function findAllMatchingScenarios(shopDomain, cartData) {
  const scenarios = await db.zone.findMany({
    where: { shopDomain, status: "enabled" },
    include: { rates: { orderBy: { minValue: "asc" } } },
  });

  // Collect ALL matching non-fallback scenarios
  const matches = scenarios.filter((zone) => {
    if (zone.isFallback) return false;
    const ok = matchesScenarioConditions(zone, cartData);
    console.log(`[scenario-match] "${zone.name}": conditions=${ok}`);
    return ok;
  });

  if (matches.length > 0) {
    console.log(`[scenario-match] ${matches.length} scenario(s) matched: ${matches.map(z => `"${z.name}"`).join(", ")}`);
    return { zones: matches, isFallback: false };
  }

  // Fallback scenario
  const fallback = scenarios.find((z) => z.isFallback);
  if (fallback) return { zones: [fallback], isFallback: true };

  return null;
}

// Backward-compat alias used by the old carrier-service
export const findZoneByZip = (shopDomain, zip, items = []) => {
  const totalDollars = items.reduce((s, i) => s + i.price * i.quantity, 0) / 100;
  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
  const totalWeightKg = items.reduce((s, i) => s + (i.grams ?? 0) * i.quantity, 0) / 1000;
  return findMatchingScenario(shopDomain, {
    zip,
    items,
    totalDollars,
    totalQuantity,
    totalWeightKg,
    destination: { postal_code: zip },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Condition evaluation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the scenario's conditions are satisfied by cartData.
 * No conditions → always matches.
 */
export function matchesScenarioConditions(zone, cartData) {
  const { rules, logic } = parseConditions(zone.conditions);
  if (!rules.length) {
    // Legacy: if no conditions but has zipCodes, use zip matching
    if (zone.zipCodes?.trim()) {
      return zipMatchesZone(cartData.zip?.trim() ?? "", zone.zipCodes);
    }
    return true;
  }

  if (!cartData.items?.length && !cartData.zip) {
    console.warn("[conditions] No cart data supplied — skipping, scenario will match.");
    return true;
  }

  if (logic === "none") {
    return !rules.some((rule) => evaluateRuleAgainstCart(rule, cartData));
  }

  const checkFn = logic === "any" ? "some" : "every";
  return rules[checkFn]((rule) => {
    const result = evaluateRuleAgainstCart(rule, cartData);
    console.log(`[conditions] ${rule.category ?? "product"}.${rule.attribute} ${rule.operator} "${rule.value}" → ${result}`);
    return result;
  });
}

// Backward-compat alias
export function matchesProductConditions(zone, items = []) {
  const totalDollars  = items.reduce((s, i) => s + i.price * i.quantity, 0) / 100;
  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
  const totalWeightKg = items.reduce((s, i) => s + (i.grams ?? 0) * i.quantity, 0) / 1000;
  return matchesScenarioConditions(zone, {
    zip: "", items, totalDollars, totalQuantity, totalWeightKg, destination: {}
  });
}

function evaluateRuleAgainstCart(rule, cartData) {
  const cat = rule.category || "product"; // legacy rules default to product

  if (cat === "cart") {
    return evaluateCartRule(rule, cartData);
  }
  if (cat === "product") {
    if (!cartData.items?.length) return true; // no items → skip
    return cartData.items.some((item) => evaluateProductRule(rule, item));
  }
  if (cat === "customer") {
    if (!cartData.customer) {
      // Guest checkout — no customer data available, treat as not matched
      console.warn(
        `[conditions] customer condition "${rule.attribute} ${rule.operator} \"${rule.value}\"" ` +
        `skipped — guest checkout (no customer). Treating as FALSE.`
      );
      return false;
    }
    return evaluateCustomerRule(rule, cartData.customer);
  }
  return false;
}

function evaluateCartRule({ attribute, operator, value, value2 }, cartData) {
  let cartVal;
  switch (attribute) {
    case "cart_total":             cartVal = cartData.totalDollars;  break;
    case "cart_quantity":          cartVal = cartData.totalQuantity; break;
    case "cart_weight":            cartVal = cartData.totalWeightKg; break;
    case "cart_zip_code":          return compareZipCode(cartData.zip ?? "", operator, value);
    case "cart_length":            cartVal = 0; break; // not provided by Shopify carrier API
    case "cart_width":             cartVal = 0; break;
    case "cart_height":            cartVal = 0; break;
    case "cart_volume":            cartVal = 0; break;
    case "cart_volumetric_weight": cartVal = 0; break;
    // Legacy (no category prefix)
    case "total":    cartVal = cartData.totalDollars;  break;
    case "quantity": cartVal = cartData.totalQuantity; break;
    case "weight":   cartVal = cartData.totalWeightKg; break;
    default: return false;
  }
  return compareNumericOrText(cartVal, operator, value, value2);
}

function evaluateProductRule({ attribute, operator, value, value2 }, item) {
  let itemVal;
  switch (attribute) {
    case "product_sku":               case "sku":        itemVal = String(item.sku ?? "");           break;
    case "product_vendor":            case "vendor":     itemVal = String(item.vendor ?? "");        break;
    case "product_name":              case "name":       itemVal = String(item.name ?? "");          break;
    case "product_barcode":           case "barcode":    itemVal = String(item.barcode ?? "");       break;
    case "product_type":              case "type":       itemVal = String(item.product_type ?? "");  break;
    case "product_price":             case "price":      itemVal = (item.price ?? 0) / 100;          break;
    case "product_quantity":          case "quantity":   itemVal = item.quantity ?? 0;               break;
    case "product_weight":            case "weight":     itemVal = (item.grams ?? 0) / 1000;         break;
    case "product_total":             case "total":      itemVal = ((item.price ?? 0) * (item.quantity ?? 1)) / 100; break;
    case "product_length":            case "length":     itemVal = item.length ?? 0;                 break;
    case "product_width":             case "width":      itemVal = item.width ?? 0;                  break;
    case "product_height":            case "height":     itemVal = item.height ?? 0;                 break;
    case "product_volume":            case "volume":     itemVal = item.volume ?? 0;                 break;
    case "product_volumetric_weight":  itemVal = (item.grams ?? 0) / 1000; break; // approx
    case "product_tag":               case "tag":
    case "product_collection":        case "collection":
      return false; // requires extra API call
    default: return false;
  }
  return compareNumericOrText(itemVal, operator, value, value2);
}

/**
 * Evaluates a customer-category rule against a customer object.
 *
 * customer object shape (from carrier request + Admin API merge):
 *   {
 *     id, email, phone, tags: string[],
 *     orders_count, total_spent,
 *     default_address: { city, province, country_code, company }
 *   }
 *
 * Note: carrier request provides tags as an array already — use that directly.
 */
function evaluateCustomerRule({ attribute, operator, value, value2 }, customer) {
  // customer_tag — compare against the tags array
  if (attribute === "customer_tag") {
    const tags         = Array.isArray(customer.tags)
      ? customer.tags
      : String(customer.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    const searchValues = splitValues(value).map((v) => v.toLowerCase());
    const tagsLower    = tags.map((t) => t.toLowerCase());
    const hasTag       = searchValues.some((v) => tagsLower.includes(v));
    const result       = operator === "not_equals" ? !hasTag : hasTag;
    console.log(
      `[conditions] customer.${attribute} ${operator} "${value}" | ` +
      `customer tags: [${tags.join(", ")}] → ${result}`
    );
    return result;
  }

  // All other customer fields
  let customerVal;
  switch (attribute) {
    case "customer_email":
      customerVal = String(customer.email ?? ""); break;
    case "customer_phone":
      customerVal = String(customer.phone ?? ""); break;
    case "customer_company":
      customerVal = String(customer.default_address?.company ?? ""); break;
    case "customer_city":
      customerVal = String(customer.default_address?.city ?? ""); break;
    case "customer_state":
      customerVal = String(customer.default_address?.province ?? ""); break;
    case "customer_country":
      customerVal = String(customer.default_address?.country_code ?? ""); break;
    case "customer_previous_orders_count":
      customerVal = Number(customer.orders_count ?? 0); break;
    case "customer_previous_orders_spent":
      customerVal = parseFloat(customer.total_spent ?? 0); break;
    default:
      console.warn(`[conditions] Unknown customer attribute: ${attribute}`);
      return false;
  }

  const result = compareNumericOrText(customerVal, operator, value, value2);
  console.log(`[conditions] customer.${attribute} ${operator} "${value}" | value="${customerVal}" → ${result}`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Value comparison helpers
// ─────────────────────────────────────────────────────────────────────────────

function splitValues(raw) {
  return String(raw ?? "").split(",").map((v) => v.trim()).filter(Boolean);
}

function compareNumericOrText(itemVal, operator, value, value2) {
  const isNum = typeof itemVal === "number";
  const numVal  = parseFloat(value);
  const numVal2 = parseFloat(value2 ?? "");
  const values = isNum ? [value] : splitValues(value);
  const lower  = isNum ? null : String(itemVal).toLowerCase();

  switch (operator) {
    case "equals":
      return isNum ? itemVal === numVal : values.some(v => lower === v.toLowerCase());
    case "not_equals":
      return isNum ? itemVal !== numVal : values.every(v => lower !== v.toLowerCase());
    case "contains":
      return !isNum && values.some(v => lower.includes(v.toLowerCase()));
    case "not_contains":
      return !isNum && values.every(v => !lower.includes(v.toLowerCase()));
    case "greater_than":
      return isNum && itemVal > numVal;
    case "less_than":
      return isNum && itemVal < numVal;
    case "greater_than_or_equals":
      return isNum && itemVal >= numVal;
    case "less_than_or_equals":
      return isNum && itemVal <= numVal;
    case "between":
      return isNum && !isNaN(numVal) && !isNaN(numVal2) && itemVal >= numVal && itemVal <= numVal2;
    default:
      return false;
  }
}

/**
 * Zip code comparison with ShipX-style matching:
 *   "1004*"         → prefix match
 *   "100400:100500" → numeric range
 *   "HB1_2BA"       → underscore = space
 *   "10041"         → exact match
 */
function compareZipCode(zip, operator, pattern) {
  const patterns = pattern.split(",").map((p) => p.trim()).filter(Boolean);

  const matches = patterns.some((p) => {
    // Range: 100400:100500
    if (p.includes(":")) {
      const [start, end] = p.split(":").map((v) => v.trim());
      const zipNum   = parseInt(zip, 10);
      const startNum = parseInt(start, 10);
      const endNum   = parseInt(end, 10);
      if (!isNaN(zipNum) && !isNaN(startNum) && !isNaN(endNum)) {
        return zipNum >= startNum && zipNum <= endNum;
      }
    }
    // Prefix: 1004*
    if (p.endsWith("*")) {
      return zip.toLowerCase().startsWith(p.slice(0, -1).toLowerCase());
    }
    // Underscore = space
    const normalizedZip = zip.replace(/\s+/g, "_");
    if (p.includes("_")) {
      return normalizedZip.toLowerCase() === p.toLowerCase();
    }
    // Exact
    return zip.toLowerCase() === p.toLowerCase();
  });

  if (operator === "not_equals") return !matches;
  return matches;
}

/**
 * Legacy zip-range matching (for backward-compat with old zones).
 */
function zipMatchesZone(zip, rawZipCodes) {
  const zipLower = zip.toLowerCase();
  const zipNum = parseInt(zip, 10);
  const zipIsNumeric = !isNaN(zipNum) && /^\d+$/.test(zip);

  return rawZipCodes
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .some((entry) => {
      const dashIdx = entry.indexOf("-");
      if (dashIdx > 0) {
        const start = entry.slice(0, dashIdx).trim();
        const end   = entry.slice(dashIdx + 1).trim();
        const startNum = parseInt(start, 10);
        const endNum   = parseInt(end, 10);
        if (zipIsNumeric && !isNaN(startNum) && !isNaN(endNum)) {
          return zipNum >= startNum && zipNum <= endNum;
        }
        return zipLower >= start.toLowerCase() && zipLower <= end.toLowerCase();
      }
      return zipLower === entry.toLowerCase();
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Conditions — serialization
// ─────────────────────────────────────────────────────────────────────────────

export function serializeConditions(conditionsInput) {
  if (!conditionsInput) return null;

  let parsed;
  if (typeof conditionsInput === "string") {
    try { parsed = JSON.parse(conditionsInput); } catch { return null; }
  } else {
    parsed = conditionsInput;
  }

  if (!parsed?.rules?.length) return null;

  const logic = ["any", "none"].includes(parsed.logic) ? parsed.logic : "all";
  return JSON.stringify({
    logic,
    rules: parsed.rules.map((r) => ({
      id:        r.id,
      category:  r.category || "product",
      attribute: r.attribute,
      operator:  r.operator,
      value:     String(r.value  ?? ""),
      value2:    String(r.value2 ?? ""),
    })),
  });
}

export function parseConditions(raw) {
  if (!raw) return { logic: "all", rules: [] };
  try {
    const parsed = JSON.parse(raw);
    const logic = ["any", "none"].includes(parsed.logic) ? parsed.logic : "all";
    return {
      logic,
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    };
  } catch {
    return { logic: "all", rules: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Conditions — validation
// ─────────────────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = new Set(["cart", "product", "customer"]);

const VALID_OPERATORS = new Set([
  "equals", "not_equals", "contains", "not_contains",
  "greater_than", "less_than",
  "greater_than_or_equals", "less_than_or_equals",
  "between",
]);

export function validateConditions(conditionsInput) {
  if (!conditionsInput) return null;

  let parsed;
  if (typeof conditionsInput === "string") {
    if (!conditionsInput.trim() || conditionsInput === "{}") return null;
    try { parsed = JSON.parse(conditionsInput); } catch { return "Conditions data is malformed."; }
  } else {
    parsed = conditionsInput;
  }

  if (!parsed?.rules?.length) return null;

  for (const rule of parsed.rules) {
    const cat = rule.category || "product";
    if (!VALID_CATEGORIES.has(cat)) {
      return `Unknown category "${cat}".`;
    }
    if (!VALID_OPERATORS.has(rule.operator)) {
      return `Unknown operator "${rule.operator}".`;
    }
    if (!rule.value && rule.value !== 0) {
      return "All conditions must have a value.";
    }
    if (rule.operator === "between" && !rule.value2 && rule.value2 !== 0) {
      return 'The "between" operator requires a second value.';
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zip code helpers (kept for backward compat)
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeZipCodes(raw) {
  if (!raw) return "";
  const seen = new Set();
  return raw.split(",").map((z) => z.trim()).filter((z) => {
    if (!z) return false;
    const key = z.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(", ");
}

export function validateZipCodes(input) {
  if (!input?.trim()) return null; // optional now
  const entries = input.split(",").map((e) => e.trim()).filter(Boolean);
  for (const entry of entries) {
    const dashIdx = entry.indexOf("-");
    if (dashIdx > 0) {
      const parts = entry.split("-");
      if (parts.length !== 2) return `"${entry}" is not a valid range.`;
      const [start, end] = parts.map((p) => p.trim());
      if (!start || !end) return `"${entry}" is missing start or end value.`;
      const startNum = parseInt(start, 10);
      const endNum   = parseInt(end, 10);
      if (!isNaN(startNum) && !isNaN(endNum) && startNum > endNum) {
        return `Range "${entry}" is invalid — start must be ≤ end.`;
      }
    }
  }
  return null;
}