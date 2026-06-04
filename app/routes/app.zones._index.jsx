import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { useRef, useEffect, useState } from "react";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  registerCarrierService,
  reRegisterCarrierService,
  getCarrierServiceStatus,
} from "../carrier.server";
import { getZones } from "../models/zone.server";


// parseConditions — inlined (pure JS, no server deps) to avoid
// "server-only module referenced by client" error.
function parseConditions(raw) {
  if (!raw) return { logic: "all", rules: [] };
  try {
    const parsed = JSON.parse(raw);
    const logic = ["any", "none"].includes(parsed.logic) ? parsed.logic : "all";
    return { logic, rules: Array.isArray(parsed.rules) ? parsed.rules : [] };
  } catch {
    return { logic: "all", rules: [] };
  }
}

// ── Condition display helpers ───────────────────────────────────────────────

const CATEGORY_LABELS = { cart: "Cart", product: "Product", customer: "Customer" };

const ALL_ATTRIBUTES = {
  cart_total: "Total", cart_quantity: "Quantity", cart_weight: "Weight",
  cart_zip_code: "Zip code", cart_length: "Length", cart_width: "Width",
  cart_height: "Height", cart_volume: "Volume", cart_volumetric_weight: "Volumetric weight",
  product_total: "Total", product_price: "Price", product_quantity: "Quantity",
  product_weight: "Weight", product_length: "Length", product_width: "Width",
  product_height: "Height", product_volume: "Volume", product_volumetric_weight: "Volumetric weight",
  product_vendor: "Vendor", product_name: "Name", product_tag: "Tag",
  product_sku: "SKU", product_barcode: "Barcode", product_type: "Type",
  product_collection: "Collection",
  customer_name: "Name", customer_email: "Email", customer_phone: "Phone",
  customer_city: "City", customer_state: "State", customer_country: "Country",
  customer_tag: "Tag", customer_company: "Company",
  customer_previous_orders_count: "Previous orders count",
  customer_previous_orders_spent: "Previous orders spent",
  // legacy
  sku: "SKU", name: "Product name", vendor: "Vendor", type: "Product type",
  price: "Price", total: "Total", quantity: "Quantity", weight: "Weight",
};

const OP_LABELS = {
  equals: "equals", not_equals: "does not equal",
  contains: "contains", not_contains: "does not contain",
  greater_than: "greater than", less_than: "less than",
  greater_than_or_equals: "greater than or equals to",
  less_than_or_equals: "less than or equals to",
  between: "between",
};

function ruleToText(rule) {
  const cat   = CATEGORY_LABELS[rule.category] ?? rule.category ?? "";
  const attr  = ALL_ATTRIBUTES[rule.attribute] ?? rule.attribute ?? "";
  const op    = OP_LABELS[rule.operator]       ?? rule.operator ?? "";
  const val   = rule.operator === "between"
    ? `${rule.value} and ${rule.value2}`
    : rule.value?.split(",").map(v => v.trim()).filter(Boolean).join(", ");
  return [cat && `${cat} ›`, attr, op, val].filter(Boolean).join(" ");
}

const LOGIC_LABELS = {
  all:  "All conditions must match",
  any:  "Any condition must match",
  none: "None of the conditions match",
};

// ── Loader ──────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    await registerCarrierService(admin, session.shop);
  } catch (e) {
    console.error("Carrier service registration failed:", e.message);
  }

  const [zones, carrierStatus] = await Promise.all([
    getZones(session.shop),
    getCarrierServiceStatus(session.shop),
  ]);

  return { zones, carrierStatus };
};

// ── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "reregister") {
    try {
      await reRegisterCarrierService(admin, session.shop);
    } catch (e) {
      return { error: e.message };
    }
  }

  return redirect("/app/zones");
};

// ── Component ────────────────────────────────────────────────────────────────

export default function ScenariosIndexPage() {
  const { zones, carrierStatus } = useLoaderData();
  const navigate  = useNavigate();
  const fetcher   = useFetcher();
  const [search, setSearch] = useState("");
  const searchRef = useRef(null);
  const isReregistering = fetcher.state !== "idle";

  useEffect(() => {
    const el = searchRef.current;
    if (!el) return;
    const handler = (e) => setSearch(e.target.value ?? "");
    el.addEventListener("input", handler);
    return () => el.removeEventListener("input", handler);
  }, []);

  const regularZones = zones.filter((z) => !z.isFallback);
  const filtered = regularZones.filter((z) =>
    z.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <s-page heading="Scenarios">
      <s-button slot="primary-action" onClick={() => navigate("/app/zones/new")}>
        Create new scenario
      </s-button>

      {/* ── Carrier status banners ───────────────────────────────────────── */}
      {!carrierStatus.registered && (
        <s-banner tone="warning" heading="Carrier service not registered">
          <s-paragraph>
            The shipping rate carrier service is not registered. Rates will not
            appear at checkout.
          </s-paragraph>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="reregister" />
            <s-button type="submit" {...(isReregistering ? { loading: true } : {})}>
              Register carrier service
            </s-button>
          </fetcher.Form>
        </s-banner>
      )}

      {carrierStatus.urlMismatch && (
        <s-banner tone="warning" heading="Callback URL mismatch">
          <s-paragraph>
            Your app URL has changed. Current:{" "}
            <strong>{carrierStatus.currentCallbackUrl}</strong>
          </s-paragraph>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="reregister" />
            <s-button type="submit" {...(isReregistering ? { loading: true } : {})}>
              Re-register with current URL
            </s-button>
          </fetcher.Form>
        </s-banner>
      )}

      {/* ── Scenarios table ──────────────────────────────────────────────── */}
      <s-section>
        <s-stack direction="block" gap="base">
          <s-search-field
            ref={searchRef}
            placeholder="Search scenario by name"
          ></s-search-field>

          {regularZones.length === 0 && (
            <s-paragraph>
              No scenarios yet. Create a scenario to start defining shipping
              rates with conditions.
            </s-paragraph>
          )}

          {regularZones.length > 0 && filtered.length === 0 && (
            <s-paragraph>No scenarios match your search.</s-paragraph>
          )}

          {filtered.length > 0 && (
            <s-table>
              <s-table-header-row>
                <s-table-header>Scenario name</s-table-header>
                <s-table-header>Conditions</s-table-header>
                <s-table-header>Shipping rates</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {filtered.map((zone) => {
                  const conds = parseConditions(zone.conditions);
                  const logicLabel = LOGIC_LABELS[conds.logic] ?? conds.logic;
                  return (
                    <s-table-row key={zone.id}>
                      <s-table-cell>
                        <s-link href={`/app/zones/${zone.id}`}>{zone.name}</s-link>
                      </s-table-cell>

                      <s-table-cell>
                        {conds.rules.length > 0 ? (
                          <s-stack direction="block" gap="small">
                            <s-text><strong>{logicLabel}</strong></s-text>
                            <s-unordered-list>
                              {conds.rules.map((rule) => (
                                <s-list-item key={rule.id}>
                                  {ruleToText(rule)}
                                </s-list-item>
                              ))}
                            </s-unordered-list>
                          </s-stack>
                        ) : (
                          <s-text>—</s-text>
                        )}
                      </s-table-cell>

                      <s-table-cell>
                        {zone.rates.length > 0
                          ? `${zone.rates.length} rate${zone.rates.length === 1 ? "" : "s"}`
                          : "—"}
                      </s-table-cell>

                      <s-table-cell>
                        <s-badge tone={zone.status === "enabled" ? "success" : "neutral"}>
                          {zone.status === "enabled" ? "Active" : "Inactive"}
                        </s-badge>
                      </s-table-cell>

                      <s-table-cell>
                        <s-link href={`/app/zones/${zone.id}`}>Edit</s-link>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>

      <div style={{ display: "flex", justifyContent: "center", padding: "16px" }}>
        <s-link href="/app/zones/fallback">Configure fallback rates</s-link>
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);