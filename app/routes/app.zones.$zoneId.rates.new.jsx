import { redirect, data } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams, useFetcher } from "react-router";
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getZone } from "../models/zone.server";
import { createRate } from "../models/rate.server";
import { createLiveCarrierRate } from "../models/liveCarrierRate.server";
import { CARRIERS, getCarrier } from "../carriers/definitions";

// ─────────────────────────────────────────────────────────────────────────────
// Criteria config (Fixed rate)
// ─────────────────────────────────────────────────────────────────────────────

const RATE_CATEGORIES = [
  { value: "cart",    label: "Cart" },
  { value: "product", label: "Product" },
];
const RATE_ATTRIBUTES = {
  cart: [
    { value: "price",    label: "Total",    suffix: "USD",   type: "price"         },
    { value: "weight",   label: "Weight",   suffix: "kg",    type: "weight"        },
    { value: "quantity", label: "Quantity", suffix: "Items", type: "cart_quantity" },
  ],
  product: [
    { value: "price",    label: "Price",    suffix: "USD",   type: "product_price"    },
    { value: "weight",   label: "Weight",   suffix: "kg",    type: "product_weight"   },
    { value: "quantity", label: "Quantity", suffix: "Items", type: "product_quantity" },
  ],
};

function getAttrList(cat) { return RATE_ATTRIBUTES[cat] ?? RATE_ATTRIBUTES.cart; }
function getAttrMeta(cat, val) { return getAttrList(cat).find((a) => a.value === val); }
function generateId() { return String(Math.floor(100000 + Math.random() * 900000)); }

const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #c9cccf",
  borderRadius: "6px", fontSize: "14px", outline: "none", boxSizing: "border-box",
};

// ─────────────────────────────────────────────────────────────────────────────
// Loader / Action
// ─────────────────────────────────────────────────────────────────────────────

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const zone = await getZone(params.zoneId, session.shop);
  if (!zone) throw new Response("Not found", { status: 404 });
  return { zone };
};

export const action = async ({ request, params }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const rateType = formData.get("rateType")?.toString() ?? "fixed";
  const rateStatus = formData.get("rateStatus")?.toString() ?? "enabled";

  // ── Live carrier rate ──
  if (rateType === "live_carrier") {
    const name = formData.get("name")?.toString().trim() ?? "";
    const notes = formData.get("notes")?.toString().trim() ?? "";
    const carrierKey = formData.get("carrierKey")?.toString() ?? "";
    const shippingLocation = formData.get("shippingLocation")?.toString() ?? "shopify_location";
    const servicesJson = formData.get("servicesJson")?.toString() ?? "[]";
    const packagingMethod = formData.get("packagingMethod")?.toString() ?? "cart_attributes";
    const packageSplittingRule = formData.get("packageSplittingRule")?.toString() ?? "cart_quantity";
    const productFilter = formData.get("productFilter")?.toString() ?? "all_products";
    const packagesJson = formData.get("packagesJson")?.toString() ?? "[]";
    const fallbackName = formData.get("fallbackName")?.toString().trim() || "Flat rate";
    const fallbackDescription = formData.get("fallbackDescription")?.toString().trim() ?? "";
    const fallbackRate = formData.get("fallbackRate")?.toString() ?? "0";

    const errors = {};
    if (!name) errors.name = "Shipping rate name is required";
    if (!carrierKey || !getCarrier(carrierKey)) errors.carrierKey = "Select a carrier";

    let services = [];
    try { services = JSON.parse(servicesJson); } catch { /* ignore */ }

    let packages = [];
    try { packages = JSON.parse(packagesJson); } catch { /* ignore */ }

    if (Object.keys(errors).length) {
      return data({ errors, rateType: "live_carrier" }, { status: 400 });
    }

    await createLiveCarrierRate(params.zoneId, {
      name, notes, status: rateStatus, carrierKey, shippingLocation,
      services, packagingMethod, packageSplittingRule, productFilter, packages,
      fallbackName, fallbackDescription, fallbackType: "fixed", fallbackRate,
    });
    return redirect(`/app/zones/${params.zoneId}`);
  }

  // ── Fixed (tiered) rate ──
  const name        = formData.get("name")?.toString().trim() ?? "";
  const description = formData.get("description")?.toString().trim() ?? "";
  const type        = formData.get("type")?.toString() ?? "price";
  const valueType   = formData.get("valueType")?.toString() ?? "fixed";
  const profileId   = formData.get("profileId")?.toString()   || null;
  const profileName = formData.get("profileName")?.toString() || null;
  const minDeliveryDays = formData.get("minDeliveryDays")?.toString() || null;
  const maxDeliveryDays = formData.get("maxDeliveryDays")?.toString() || null;
  const tiersJson   = formData.get("tiersJson")?.toString()   ?? "[]";

  const errors = {};
  if (!name) errors.name = "Rate name is required";
  let tiers = [];
  try { tiers = JSON.parse(tiersJson); } catch { errors.tiers = "Invalid tiers data."; }
  if (!errors.tiers && tiers.length === 0) errors.tiers = "Add at least one tiered rate.";
  if (!errors.tiers) {
    for (const t of tiers) {
      if (isNaN(parseFloat(t.price)) || parseFloat(t.price) < 0) {
        errors.tiers = "All tiers must have a valid rate price."; break;
      }
    }
  }
  if (Object.keys(errors).length) {
    return data({ errors, values: { name, description }, rateType: "fixed" }, { status: 400 });
  }
  for (const tier of tiers) {
    await createRate(params.zoneId, {
      name, description, type, valueType, profileId, profileName,
      status: rateStatus,
      minDeliveryDays, maxDeliveryDays,
      minValue: parseFloat(tier.min) || 0,
      maxValue: !tier.max || tier.max === "~" ? null : parseFloat(tier.max),
      price: parseFloat(tier.price) || 0,
    });
  }
  return redirect(`/app/zones/${params.zoneId}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function NewRatePage() {
  const { zone }       = useLoaderData();
  const actionData     = useActionData();
  const navigation     = useNavigation();
  const [searchParams] = useSearchParams();
  const isSaving = navigation.state === "submitting";
  const FORM_ID       = "create-rate-form";
  const TIER_MODAL_ID = "tiered-rates-modal";
  const CRED_MODAL_ID = "carrier-credentials-modal";
  const PKG_MODAL_ID  = "package-modal";

  const profileId   = searchParams.get("profileId")   ?? "";
  const profileName = searchParams.get("profileName") ?? "";

  const [rateKind, setRateKind] = useState(
    actionData?.rateType === "live_carrier" || searchParams.get("rateType") === "live_carrier"
      ? "live_carrier"
      : "fixed"
  );

  // ── Fixed rate state ──
  const [rateCat,  setRateCat]  = useState("cart");
  const [rateAttr, setRateAttr] = useState("price");
  const [shippingRateType, setShippingRateType] = useState("fixed");
  const [savedTiers, setSavedTiers] = useState([]);
  const [modalTiers, setModalTiers] = useState([]);

  // ── Live carrier state ──
  const [carrierKey, setCarrierKey] = useState("fedex");
  const [selectedServices, setSelectedServices] = useState([]);
  const [packagingMethod, setPackagingMethod] = useState("cart_attributes");
  const [packages, setPackages] = useState([]);
  const [pkgDraft, setPkgDraft] = useState({ length: "", width: "", height: "", maxWeight: "" });
  const [credFields, setCredFields] = useState({});
  const [syncState, setSyncState] = useState({}); // { [carrierKey]: { status, message, tone } }

  const credFetcher = useFetcher();

  const nameRef    = useRef(null);
  const descRef    = useRef(null);
  const notesRef   = useRef(null);
  const minDaysRef = useRef(null);
  const maxDaysRef = useRef(null);
  const catRef     = useRef(null);
  const attrRef    = useRef(null);
  const fbNameRef  = useRef(null);
  const fbDescRef  = useRef(null);
  const fbRateRef  = useRef(null);

  const rateType    = getAttrMeta(rateCat, rateAttr)?.type   ?? "price";
  const unitSuffix  = getAttrMeta(rateCat, rateAttr)?.suffix ?? "";
  const priceSuffix = shippingRateType === "percentage" ? "%" : "USD";

  const carrier = useMemo(() => getCarrier(carrierKey), [carrierKey]);

  useEffect(() => {
    if (!actionData?.values) return;
    if (nameRef.current) nameRef.current.value = actionData.values.name ?? "";
    if (descRef.current) descRef.current.value = actionData.values.description ?? "";
  }, [actionData]);

  useEffect(() => {
    const first = getAttrList(rateCat)[0]?.value ?? "price";
    setRateAttr(first);
    setTimeout(() => { if (attrRef.current) attrRef.current.value = first; }, 30);
  }, [rateCat]);

  // Reset service selection + credential fields when switching carrier
  useEffect(() => {
    setSelectedServices([]);
    setCredFields({});
  }, [carrierKey]);

  useEffect(() => {
    if (!credFetcher.data) return;
    setSyncState((prev) => ({
      ...prev,
      [carrierKey]: {
        tone: credFetcher.data.ok ? (credFetcher.data.verified ? "success" : "warning") : "critical",
        message: credFetcher.data.ok ? credFetcher.data.message : credFetcher.data.error,
      },
    }));
  }, [credFetcher.data, carrierKey]);

  // ── Tiered rate modal handlers ──
  const openModal = useCallback(() => {
    if (savedTiers.length > 0) setModalTiers(savedTiers.map(t => ({ ...t })));
    else setModalTiers([{ id: generateId(), min: "", max: "", price: "" }]);
  }, [savedTiers]);
  const addModalRow    = useCallback(() => {
    setModalTiers(p => [...p, { id: generateId(), min: "", max: "", price: "" }]);
  }, []);
  const removeModalRow = useCallback((id) => {
    setModalTiers(p => p.filter(t => t.id !== id));
  }, []);
  const updateModalRow = useCallback((id, field, val) => {
    setModalTiers(p => p.map(t => t.id === id ? { ...t, [field]: val } : t));
  }, []);
  const handleModalAdd = useCallback(() => {
    const valid = modalTiers.filter(t => t.price !== "" || t.min !== "");
    if (valid.length > 0) setSavedTiers(valid);
  }, [modalTiers]);
  const removeSavedTier = useCallback((id) => {
    setSavedTiers(p => p.filter(t => t.id !== id));
  }, []);

  // ── Live carrier: services ──
  const toggleService = useCallback((serviceName) => {
    setSelectedServices((prev) =>
      prev.includes(serviceName) ? prev.filter((s) => s !== serviceName) : [...prev, serviceName]
    );
  }, []);
  const toggleAllInGroup = useCallback((group) => {
    setSelectedServices((prev) => {
      const allSelected = group.every((s) => prev.includes(s));
      if (allSelected) return prev.filter((s) => !group.includes(s));
      return [...new Set([...prev, ...group])];
    });
  }, []);

  // ── Live carrier: credentials modal ──
  const openCredModal = useCallback(() => {
    setCredFields((prev) => (prev[carrierKey] ? prev : { ...prev, [carrierKey]: {} }));
  }, [carrierKey]);
  const updateCredField = useCallback((field, val) => {
    setCredFields((prev) => ({ ...prev, [carrierKey]: { ...(prev[carrierKey] || {}), [field]: val } }));
  }, [carrierKey]);
  const handleSync = useCallback(() => {
    if (!carrier) return;
    const fd = new FormData();
    fd.set("carrierKey", carrierKey);
    const values = credFields[carrierKey] || {};
    for (const f of carrier.credentialFields) fd.set(f.name, values[f.name] ?? "");
    for (const t of carrier.extraToggles || []) fd.set(t.name, values[t.name] ? "true" : "false");
    credFetcher.submit(fd, { method: "post", action: "/app/api/carrier-credentials" });
  }, [carrier, carrierKey, credFields, credFetcher]);

  // ── Live carrier: packages ──
  const addPackage = useCallback(() => {
    if (!pkgDraft.length && !pkgDraft.width && !pkgDraft.height && !pkgDraft.maxWeight) return;
    setPackages((p) => [...p, { id: generateId(), ...pkgDraft }]);
    setPkgDraft({ length: "", width: "", height: "", maxWeight: "" });
  }, [pkgDraft]);
  const removePackage = useCallback((id) => {
    setPackages((p) => p.filter((pkg) => pkg.id !== id));
  }, []);

  const heading = profileName ? `${zone.name} — ${profileName}` : `Add rate — ${zone.name}`;
  const currentCredValues = credFields[carrierKey] || {};
  const currentSync = syncState[carrierKey];

  return (
    <s-page heading={heading}>
      <s-link slot="breadcrumb-actions" href={`/app/zones/${zone.id}`}>{zone.name}</s-link>
      <s-button slot="primary-action" {...(isSaving ? { loading: true } : {})}
        onClick={() => document.getElementById(FORM_ID)?.requestSubmit()}>Save</s-button>
      <s-link slot="secondary-actions" href={`/app/zones/${zone.id}`}>Cancel</s-link>

      <Form method="post" id={FORM_ID} data-save-bar>
        <input type="hidden" name="rateType" value={rateKind} />

        {rateKind === "fixed" && (
          <>
            <input type="hidden" name="type"        value={rateType} />
            <input type="hidden" name="valueType"   value={shippingRateType} />
            <input type="hidden" name="profileId"   value={profileId} />
            <input type="hidden" name="profileName" value={profileName} />
            <input type="hidden" name="tiersJson"   value={JSON.stringify(savedTiers)} />
          </>
        )}

        {rateKind === "live_carrier" && (
          <>
            <input type="hidden" name="carrierKey"    value={carrierKey} />
            <input type="hidden" name="shippingLocation" value="shopify_location" />
            <input type="hidden" name="servicesJson"  value={JSON.stringify(selectedServices)} />
            <input type="hidden" name="packagingMethod" value={packagingMethod} />
            <input type="hidden" name="packageSplittingRule" value="cart_quantity" />
            <input type="hidden" name="productFilter" value="all_products" />
            <input type="hidden" name="packagesJson"  value={JSON.stringify(packages)} />
          </>
        )}

        <s-stack gap="base">
          {/* ── Rate type ── */}
          <s-section heading="Select rate type">
            <s-choice-list label="Rate type" name="rateTypeChoice">
              <s-choice value="fixed" selected={rateKind === "fixed"}
                onChange={() => setRateKind("fixed")}>Fixed rate</s-choice>
              <s-choice value="live_carrier" selected={rateKind === "live_carrier"}
                onChange={() => setRateKind("live_carrier")}>Live carriers</s-choice>
            </s-choice-list>
          </s-section>

          {/* ══════════════════════════ FIXED RATE ══════════════════════════ */}
          {rateKind === "fixed" && (
            <>
              <s-section heading="General information">
                <s-stack direction="block" gap="base">
                  {actionData?.errors?.name && (
                    <s-banner tone="critical"><s-text>{actionData.errors.name}</s-text></s-banner>
                  )}
                  <s-text-field ref={nameRef} label="Shipping rate name" name="name"
                    placeholder="Ex: Standard shipping rate"
                    help-text="Displayed to customers at checkout." required></s-text-field>
                  <s-text-area ref={descRef} label="Description (optional)" name="description"
                    rows="2" placeholder="Appears below the shipping rate name at checkout."></s-text-area>

                  <s-stack direction="block" gap="extra-small">
                    <s-text><strong>Delivery time range (optional)</strong></s-text>
                    <s-stack direction="inline" gap="small">
                      <s-number-field ref={minDaysRef} label="Min" name="minDeliveryDays"
                        min="0" step="1" placeholder="e.g. 1" suffix="days" style={{ flex: 1 }}></s-number-field>
                      <s-number-field ref={maxDaysRef} label="Max" name="maxDeliveryDays"
                        min="0" step="1" placeholder="e.g. 3" suffix="days" style={{ flex: 1 }}></s-number-field>
                    </s-stack>
                    <s-text tone="subdued">Delivery time shown to customers at checkout.</s-text>
                  </s-stack>
                </s-stack>
              </s-section>

              <s-section heading="Shipping rates">
                <s-stack direction="block" gap="base">
                  {actionData?.errors?.tiers && (
                    <s-banner tone="critical"><s-text>{actionData.errors.tiers}</s-text></s-banner>
                  )}

                  <s-paragraph><strong>Select criteria</strong></s-paragraph>
                  <s-stack direction="inline" gap="small">
                    <s-select ref={catRef} label="Category" style={{ flex: 1 }}
                      onChange={(e) => setRateCat(e.target.value)}>
                      {RATE_CATEGORIES.map((c) => (
                        <s-option key={c.value} value={c.value}>{c.label}</s-option>
                      ))}
                    </s-select>
                    <s-select ref={attrRef} label="Attribute" style={{ flex: 1 }}
                      onChange={(e) => setRateAttr(e.target.value)}>
                      {getAttrList(rateCat).map((a) => (
                        <s-option key={a.value} value={a.value}>{a.label}</s-option>
                      ))}
                    </s-select>
                  </s-stack>

                  <s-paragraph><strong>Set rates for above criteria</strong></s-paragraph>
                  <s-choice-list label="Rate structure" name="rateStructure">
                    <s-choice value="tiered" selected={true}>Tiered rates</s-choice>
                    <s-choice value="base_increment">Base value with Increment</s-choice>
                  </s-choice-list>

                  <s-select label="Shipping rate type" style={{ maxWidth: "300px" }}
                    onChange={(e) => setShippingRateType(e.target.value)}>
                    <s-option value="fixed">Fixed amount</s-option>
                    <s-option value="percentage">Percentage</s-option>
                  </s-select>

                  {savedTiers.length > 0 && (
                    <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                        <s-text><strong>Tiered rates</strong></s-text>
                        <s-button type="button" variant="tertiary" commandFor={TIER_MODAL_ID} command="--show"
                          onClick={openModal} icon="edit">Edit</s-button>
                      </div>
                      <s-stack direction="block" gap="small">
                        {savedTiers.map((tier) => {
                          const maxDisplay = !tier.max || tier.max === "~" ? `~ ${unitSuffix}`.trim() : `${tier.max} ${unitSuffix}`.trim();
                          const priceDisplay = shippingRateType === "percentage" ? `${tier.price}%` : `${tier.price} ${priceSuffix}`;
                          return (
                            <s-text key={tier.id}>
                              When cart have <strong>Min {tier.min || "0"} {unitSuffix} &amp; Max {maxDisplay}</strong> then rates will be <strong>{priceDisplay}</strong>
                            </s-text>
                          );
                        })}
                      </s-stack>
                    </div>
                  )}

                  <s-button type="button" commandFor={TIER_MODAL_ID} command="--show" onClick={openModal} icon="plus-circle">
                    Add tiered rate
                  </s-button>
                </s-stack>
              </s-section>
            </>
          )}

          {/* ══════════════════════════ LIVE CARRIER ══════════════════════════ */}
          {rateKind === "live_carrier" && (
            <>
              <s-section heading="General information">
                <s-stack direction="block" gap="base">
                  {actionData?.errors?.name && (
                    <s-banner tone="critical"><s-text>{actionData.errors.name}</s-text></s-banner>
                  )}
                  {actionData?.errors?.carrierKey && (
                    <s-banner tone="critical"><s-text>{actionData.errors.carrierKey}</s-text></s-banner>
                  )}
                  <s-text-field ref={nameRef} label="Shipping rate name (internal reference)" name="name"
                    placeholder="Ex: Standard shipping rate"
                    help-text="Customers will see the shipping method name returned from the live carrier." required></s-text-field>
                </s-stack>
              </s-section>

              <s-section heading="Shipping rates">
                <s-stack direction="block" gap="base">
                  {carrier?.guideUrl && (
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <s-link href={carrier.guideUrl} target="_blank">View guide {carrier.label}</s-link>
                    </div>
                  )}
                  <s-select label="Select the carrier for calculating the shipping rate"
                    onChange={(e) => setCarrierKey(e.target.value)}>
                    {CARRIERS.map((c) => (
                      <s-option key={c.key} value={c.key} selected={c.key === carrierKey}>{c.label}</s-option>
                    ))}
                  </s-select>

                  <div style={{
                    border: "1px solid #e1e3e5", borderRadius: "8px", padding: "12px 16px",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                  }}>
                    <s-text>Sync AM Shipping Rates with your {carrier?.label} account</s-text>
                    <s-button type="button" icon="refresh" commandFor={CRED_MODAL_ID} command="--show" onClick={openCredModal}>
                      Sync
                    </s-button>
                  </div>

                  {currentSync && (
                    <s-banner tone={currentSync.tone}><s-text>{currentSync.message}</s-text></s-banner>
                  )}

                  <s-select label="Shipping location">
                    <s-option value="shopify_location" selected={true}>Use Shopify location</s-option>
                  </s-select>

                  <div style={{ border: "1px solid #e1e3e5", borderRadius: "8px", padding: "14px 16px" }}>
                    <s-stack direction="block" gap="base">
                      <s-text><strong>Services by carrier</strong></s-text>
                      <s-select label="Filter">
                        <s-option value="all" selected={true}>Show all services</s-option>
                        <s-option value="selected">Show selected only</s-option>
                      </s-select>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                            <s-text><strong>Domestic services</strong></s-text>
                            <s-button type="button" variant="tertiary" icon="select"
                              accessibilityLabel="Select all domestic services"
                              onClick={() => toggleAllInGroup(carrier?.services.domestic ?? [])}></s-button>
                          </div>
                          <s-stack direction="block" gap="small-300">
                            {carrier?.services.domestic.map((svc) => (
                              <s-checkbox key={svc} label={svc} checked={selectedServices.includes(svc)}
                                onChange={() => toggleService(svc)}></s-checkbox>
                            ))}
                          </s-stack>
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                            <s-text><strong>International services</strong></s-text>
                            <s-button type="button" variant="tertiary" icon="select"
                              accessibilityLabel="Select all international services"
                              onClick={() => toggleAllInGroup(carrier?.services.international ?? [])}></s-button>
                          </div>
                          <s-stack direction="block" gap="small-300">
                            {carrier?.services.international.map((svc) => (
                              <s-checkbox key={svc} label={svc} checked={selectedServices.includes(svc)}
                                onChange={() => toggleService(svc)}></s-checkbox>
                            ))}
                          </s-stack>
                        </div>
                      </div>
                    </s-stack>
                  </div>

                  {/* ── Packaging method ── */}
                  <s-stack direction="block" gap="small-300">
                    <s-text><strong>Packaging method</strong></s-text>
                    {[
                      { value: "cart_attributes", label: "Pack by cart attributes",
                        help: "Does not consider product dimensions when selecting the package." },
                      { value: "per_product", label: "Pack each product separately",
                        help: "Packs each product individually. Dimensions and weight are required for each product. If either is missing, the product will not be sent to the carrier for rate calculation." },
                      { value: "ai", label: "AI based packaging algorithm",
                        help: "Optimized for generic cases. Test the algorithm in the test mode. If results are not as expected, contact us." },
                    ].map((opt) => (
                      <label key={opt.value} style={{ display: "flex", gap: "8px", alignItems: "flex-start", cursor: "pointer" }}>
                        <input type="radio" name="packagingMethodRadio" value={opt.value}
                          checked={packagingMethod === opt.value}
                          onChange={() => setPackagingMethod(opt.value)}
                          style={{ marginTop: "3px" }} />
                        <span>
                          <s-text>{opt.label}</s-text><br />
                          <s-text tone="subdued" style={{ fontSize: "12px" }}>{opt.help}</s-text>
                        </span>
                      </label>
                    ))}
                  </s-stack>

                  <s-select label="Package splitting rule">
                    <s-option value="cart_quantity" selected={true}>Cart quantity</s-option>
                    <s-option value="cart_weight">Cart weight</s-option>
                  </s-select>

                  <s-select label="Product filter (optional)">
                    <s-option value="all_products" selected={true}>All products</s-option>
                  </s-select>

                  <s-stack direction="block" gap="small">
                    <s-text><strong>Packing measurements</strong></s-text>
                    <s-text tone="subdued">
                      Start from the lowest max value to the highest when adding packages. Packages should be ordered from smallest to largest.
                    </s-text>

                    {packages.length > 0 && (
                      <s-stack direction="block" gap="small-300">
                        {packages.map((pkg) => (
                          <div key={pkg.id} style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            border: "1px solid #e1e3e5", borderRadius: "6px", padding: "8px 12px",
                          }}>
                            <s-text>
                              {pkg.length || "0"} × {pkg.width || "0"} × {pkg.height || "0"} cm · max {pkg.maxWeight || "0"} kg
                            </s-text>
                            <s-button type="button" variant="tertiary" tone="critical" icon="delete"
                              accessibilityLabel="Remove package" onClick={() => removePackage(pkg.id)}></s-button>
                          </div>
                        ))}
                      </s-stack>
                    )}

                    <s-button type="button" icon="plus-circle" commandFor={PKG_MODAL_ID} command="--show">
                      Add package
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-section>

              {/* ── Fallback rate ── */}
              <s-section heading="Fallback rate">
                <s-stack direction="block" gap="base">
                  <s-text tone="subdued">The rate applied if there is no response from the carrier during a rate query.</s-text>
                  <s-text-field ref={fbNameRef} label="Rate name" name="fallbackName"
                    placeholder="Ex: Flat rate" help-text="Displayed to customers at checkout."></s-text-field>
                  <s-text-area ref={fbDescRef} label="Rate description" name="fallbackDescription"
                    rows="2" placeholder="Appears below the shipping rate name at checkout."></s-text-area>
                  <s-stack direction="inline" gap="small">
                    <s-select label="Type" style={{ flex: 1 }}>
                      <s-option value="fixed" selected={true}>Fixed</s-option>
                    </s-select>
                    <s-number-field ref={fbRateRef} label="Rate" name="fallbackRate" min="0" step="0.01"
                      suffix="USD" placeholder="0.00" style={{ flex: 1 }}></s-number-field>
                  </s-stack>
                </s-stack>
              </s-section>
            </>
          )}
        </s-stack>
      </Form>

      <s-section slot="aside" heading="Status">
        <s-select label="Rate status" name="rateStatus" form={FORM_ID}>
          <s-option value="enabled">Active</s-option>
          <s-option value="disabled">Inactive</s-option>
        </s-select>
      </s-section>

      {rateKind === "live_carrier" && (
        <s-section slot="aside" heading="Notes (optional)">
          <s-text-area ref={notesRef} label="Notes" name="notes" form={FORM_ID} rows="4"
            placeholder="Internal notes, not visible to customers."></s-text-area>
        </s-section>
      )}

      {/* ── Tiered rates modal (Fixed rate) ── */}
      <s-modal id={TIER_MODAL_ID} heading="Tiered rates">
        <s-stack direction="block" gap="base">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 36px", gap: "8px", paddingBottom: "8px", borderBottom: "1px solid #e1e3e5" }}>
            <s-text><strong>Min</strong></s-text>
            <s-text><strong>Max (~ for unlimited)</strong></s-text>
            <s-text><strong>Shipping rate</strong></s-text>
            <span />
          </div>

          {modalTiers.map((tier) => (
            <div key={tier.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 36px", gap: "8px", alignItems: "center" }}>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input type="number" min="0" step="0.01" value={tier.min} placeholder="0"
                  onChange={(e) => updateModalRow(tier.id, "min", e.target.value)}
                  style={{ ...inputStyle, paddingRight: unitSuffix ? `${unitSuffix.length * 9 + 12}px` : "10px" }} />
                {unitSuffix && <span style={{ position:"absolute", right:"10px", fontSize:"13px", color:"#6d7175", pointerEvents:"none" }}>{unitSuffix}</span>}
              </div>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input type="text" value={tier.max} placeholder="~"
                  onChange={(e) => updateModalRow(tier.id, "max", e.target.value)}
                  style={{ ...inputStyle, paddingRight: unitSuffix ? `${unitSuffix.length * 9 + 12}px` : "10px" }} />
                {unitSuffix && <span style={{ position:"absolute", right:"10px", fontSize:"13px", color:"#6d7175", pointerEvents:"none" }}>{unitSuffix}</span>}
              </div>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input type="number" min="0" step={shippingRateType === "percentage" ? "0.1" : "0.01"} value={tier.price} placeholder="0"
                  onChange={(e) => updateModalRow(tier.id, "price", e.target.value)}
                  style={{ ...inputStyle, paddingRight: `${priceSuffix.length * 9 + 12}px` }} />
                <span style={{ position:"absolute", right:"10px", fontSize:"13px", color:"#6d7175", pointerEvents:"none" }}>{priceSuffix}</span>
              </div>
              <s-button type="button" variant="tertiary" tone="critical" icon="delete" accessibilityLabel="Remove tier"
                {...(modalTiers.length === 1 ? { disabled: true } : {})} onClick={() => removeModalRow(tier.id)}></s-button>
            </div>
          ))}

          <button type="button" onClick={addModalRow} style={{
            display:"inline-flex", alignItems:"center", gap:"6px", background:"none", border:"1px solid #c9cccf",
            borderRadius:"6px", padding:"7px 14px", cursor:"pointer", fontSize:"14px", color:"#202223",
          }}>Add tier</button>

          <s-text tone="subdued" style={{ fontSize: "13px" }}>
            Start from the lowest rate to the highest while adding shipping rates. Use (~) only on the highest shipping rate (last row).
          </s-text>
        </s-stack>

        <s-button slot="secondary-actions" commandFor={TIER_MODAL_ID} command="--hide">Cancel</s-button>
        <s-button slot="primary-actions" variant="primary" commandFor={TIER_MODAL_ID} command="--hide" onClick={handleModalAdd}>Add</s-button>
      </s-modal>

      {/* ── Carrier credentials modal (Live carrier) ── */}
      <s-modal id={CRED_MODAL_ID} heading={`${carrier?.label ?? ""} credentials`}>
        <s-stack direction="block" gap="base">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            {carrier?.credentialFields.map((field) => (
              <s-text-field
                key={field.name}
                label={field.label}
                type={field.type === "password" ? "password" : "text"}
                value={currentCredValues[field.name] ?? ""}
                help-text={field.helpText}
                onChange={(e) => updateCredField(field.name, e.target.value)}
              ></s-text-field>
            ))}
          </div>
          {carrier?.extraToggles?.map((toggle) => (
            <s-checkbox key={toggle.name} label={toggle.label}
              checked={currentCredValues[toggle.name] ?? toggle.defaultOn ?? false}
              onChange={(e) => updateCredField(toggle.name, e.target.checked)}
            ></s-checkbox>
          ))}
        </s-stack>
        <s-button slot="secondary-actions" commandFor={CRED_MODAL_ID} command="--hide">Cancel</s-button>
        <s-button slot="primary-actions" variant="primary" {...(credFetcher.state !== "idle" ? { loading: true } : {})}
          onClick={handleSync}>Save</s-button>
      </s-modal>

      {/* ── Add package modal (Live carrier) ── */}
      <s-modal id={PKG_MODAL_ID} heading="Add package">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small">
            <s-number-field label="Length (cm)" min="0" value={pkgDraft.length}
              onChange={(e) => setPkgDraft((p) => ({ ...p, length: e.target.value }))} style={{ flex: 1 }}></s-number-field>
            <s-number-field label="Width (cm)" min="0" value={pkgDraft.width}
              onChange={(e) => setPkgDraft((p) => ({ ...p, width: e.target.value }))} style={{ flex: 1 }}></s-number-field>
            <s-number-field label="Height (cm)" min="0" value={pkgDraft.height}
              onChange={(e) => setPkgDraft((p) => ({ ...p, height: e.target.value }))} style={{ flex: 1 }}></s-number-field>
          </s-stack>
          <s-number-field label="Max weight (kg)" min="0" value={pkgDraft.maxWeight}
            onChange={(e) => setPkgDraft((p) => ({ ...p, maxWeight: e.target.value }))}></s-number-field>
        </s-stack>
        <s-button slot="secondary-actions" commandFor={PKG_MODAL_ID} command="--hide">Cancel</s-button>
        <s-button slot="primary-actions" variant="primary" commandFor={PKG_MODAL_ID} command="--hide" onClick={addPackage}>Add</s-button>
      </s-modal>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
