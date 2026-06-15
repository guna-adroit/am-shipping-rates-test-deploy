import { redirect, data } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useRef, useEffect, useState, useCallback } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getZone } from "../models/zone.server";
import { getRate, createRate, updateRate, deleteRate } from "../models/rate.server";
import db from "../db.server";

// ─────────────────────────────────────────────────────────────────────────────
// Criteria config
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
function typeToSelectors(type) {
  for (const [cat, attrs] of Object.entries(RATE_ATTRIBUTES)) {
    const found = attrs.find((a) => a.type === type);
    if (found) return { cat, attr: found.value };
  }
  if (type === "price")  return { cat: "cart", attr: "price" };
  if (type === "weight") return { cat: "cart", attr: "weight" };
  return { cat: "cart", attr: "price" };
}
function generateId() { return String(Math.floor(100000 + Math.random() * 900000)); }

const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #c9cccf",
  borderRadius: "6px", fontSize: "14px", outline: "none", boxSizing: "border-box",
};

// ─────────────────────────────────────────────────────────────────────────────
// Loader — rate + all tiers in the group
// ─────────────────────────────────────────────────────────────────────────────

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const [zone, rate] = await Promise.all([
    getZone(params.zoneId, session.shop),
    getRate(params.rateId),
  ]);
  if (!zone || !rate) throw new Response("Not found", { status: 404 });

  const allTiers = await db.rate.findMany({
    where: { zoneId: params.zoneId, name: rate.name },
    orderBy: { minValue: "asc" },
  });

  return { zone, rate, allTiers };
};

// ─────────────────────────────────────────────────────────────────────────────
// Action
// ─────────────────────────────────────────────────────────────────────────────

export const action = async ({ request, params }) => {
  await authenticate.admin(request);
  const formData  = await request.formData();
  const intent    = formData.get("intent");

  if (intent === "delete-group") {
    const groupName = formData.get("groupName")?.toString();
    if (groupName) await db.rate.deleteMany({ where: { zoneId: params.zoneId, name: groupName } });
    return redirect(`/app/zones/${params.zoneId}`);
  }

  const name        = formData.get("name")?.toString().trim() ?? "";
  const description = formData.get("description")?.toString().trim() ?? "";
  const type        = formData.get("type")?.toString() ?? "price";
  const valueType   = formData.get("valueType")?.toString() ?? "fixed";
  const rateStatus      = formData.get("rateStatus")?.toString() ?? "enabled";
  const minDeliveryDays = formData.get("minDeliveryDays")?.toString() || null;
  const maxDeliveryDays = formData.get("maxDeliveryDays")?.toString() || null;
  const origName    = formData.get("origName")?.toString() ?? name;
  const tiersJson   = formData.get("tiersJson")?.toString() ?? "[]";

  const errors = {};
  if (!name) errors.name = "Rate name is required";
  let tiers = [];
  try { tiers = JSON.parse(tiersJson); } catch { errors.tiers = "Invalid tiers data."; }
  if (!errors.tiers && tiers.length === 0) errors.tiers = "At least one tier is required.";

  if (Object.keys(errors).length) {
    return data({ errors, values: { name, description } }, { status: 400 });
  }

  const existingTiers = await db.rate.findMany({
    where: { zoneId: params.zoneId, name: origName },
    select: { id: true },
  });
  const existingIds  = new Set(existingTiers.map((t) => t.id));
  const submittedIds = new Set(tiers.filter((t) => t.rateId).map((t) => t.rateId));

  // Delete removed tiers
  for (const id of [...existingIds].filter((id) => !submittedIds.has(id))) {
    await deleteRate(id);
  }
  // Update or create
  for (const tier of tiers) {
    const payload = {
      name, description, type, valueType, minDeliveryDays, maxDeliveryDays,
      minValue: parseFloat(tier.min) || 0,
      maxValue: !tier.max || tier.max === "~" ? null : parseFloat(tier.max),
      price: parseFloat(tier.price) || 0,
    };
    if (tier.rateId && existingIds.has(tier.rateId)) {
      await updateRate(tier.rateId, payload);
    } else {
      await createRate(params.zoneId, { ...payload, status: rateStatus });
    }
  }

  return redirect(`/app/zones/${params.zoneId}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function EditRatePage() {
  const { zone, rate, allTiers } = useLoaderData();
  const actionData  = useActionData();
  const navigation  = useNavigation();
  const isSaving    = navigation.state === "submitting";
  const FORM_ID       = "edit-rate-form";
  const DEL_FORM_ID   = "delete-group-form";
  const TIER_MODAL_ID = "edit-tiered-modal";

  const initial = typeToSelectors(rate.type);
  const [rateCat,  setRateCat]  = useState(initial.cat);
  const [rateAttr, setRateAttr] = useState(initial.attr);
  const [shippingRateType, setShippingRateType] = useState(rate.valueType ?? "fixed");
  const [hasChanges, setHasChanges] = useState(false);
  const markChanged = useCallback(() => setHasChanges(true), []);

  // savedTiers = committed tiers shown in summary card
  const [savedTiers, setSavedTiers] = useState(() =>
    allTiers.map((t) => ({
      id:     generateId(),
      rateId: t.id,
      min:    String(t.minValue ?? ""),
      max:    t.maxValue != null ? String(t.maxValue) : "",
      price:  String(t.price ?? ""),
    }))
  );

  // modalTiers = working copy inside the modal
  const [modalTiers, setModalTiers] = useState([]);

  const nameRef    = useRef(null);
  const descRef    = useRef(null);
  const minDaysRef = useRef(null);
  const maxDaysRef = useRef(null);
  const catRef     = useRef(null);
  const attrRef    = useRef(null);

  const rateType    = getAttrMeta(rateCat, rateAttr)?.type   ?? "price";
  const unitSuffix  = getAttrMeta(rateCat, rateAttr)?.suffix ?? "";
  const priceSuffix = shippingRateType === "percentage" ? "%" : "USD";

  useEffect(() => {
    if (nameRef.current) nameRef.current.value = rate.name;
    if (descRef.current) descRef.current.value = rate.description ?? "";
    if (minDaysRef.current) minDaysRef.current.value = rate.minDeliveryDays != null ? String(rate.minDeliveryDays) : "";
    if (maxDaysRef.current) maxDaysRef.current.value = rate.maxDeliveryDays != null ? String(rate.maxDeliveryDays) : "";
    const sel = typeToSelectors(rate.type);
    setTimeout(() => {
      if (catRef.current)  catRef.current.value  = sel.cat;
      if (attrRef.current) attrRef.current.value = sel.attr;
    }, 30);
  }, [rate]);

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

  const handleDiscard = useCallback(() => {
    if (nameRef.current) nameRef.current.value = rate.name;
    if (descRef.current) descRef.current.value = rate.description ?? "";
    if (minDaysRef.current) minDaysRef.current.value = rate.minDeliveryDays != null ? String(rate.minDeliveryDays) : "";
    if (maxDaysRef.current) maxDaysRef.current.value = rate.maxDeliveryDays != null ? String(rate.maxDeliveryDays) : "";
    setSavedTiers(allTiers.map((t) => ({
      id: generateId(), rateId: t.id,
      min: String(t.minValue ?? ""), max: t.maxValue != null ? String(t.maxValue) : "",
      price: String(t.price ?? ""),
    })));
    setHasChanges(false);
  }, [rate, allTiers]);

  // ── Open modal — pre-load with savedTiers ──
  const openModal = useCallback(() => {
    if (savedTiers.length > 0) {
      setModalTiers(savedTiers.map(t => ({ ...t })));
    } else {
      setModalTiers([{ id: generateId(), min: "", max: "", price: "" }]);
    }
  }, [savedTiers]);

  // ── Modal row management ──
  const addModalRow    = useCallback(() => {
    setModalTiers(p => [...p, { id: generateId(), min: "", max: "", price: "" }]);
  }, []);
  const removeModalRow = useCallback((id) => {
    setModalTiers(p => p.filter(t => t.id !== id));
  }, []);
  const updateModalRow = useCallback((id, field, val) => {
    setModalTiers(p => p.map(t => t.id === id ? { ...t, [field]: val } : t));
  }, []);

  // ── Confirm modal — replace savedTiers ──
  const handleModalAdd = useCallback(() => {
    const valid = modalTiers.filter(t => t.price !== "" || t.min !== "");
    if (valid.length > 0) {
      setSavedTiers(valid);
      markChanged();
    }
  }, [modalTiers, markChanged]);

  const heading = rate.profileName
    ? `${zone.name} — ${rate.profileName}`
    : "Edit rate";

  return (
    <s-page heading={heading}>
      <s-link slot="breadcrumb-actions" href={`/app/zones/${zone.id}`}>{zone.name}</s-link>
      <s-button slot="primary-action"
        {...(isSaving ? { loading: true } : {})}
        {...(!hasChanges ? { disabled: true } : {})}
        onClick={() => document.getElementById(FORM_ID)?.requestSubmit()}>
        Save
      </s-button>
      <s-link slot="secondary-actions" href={`/app/zones/${zone.id}`}>Cancel</s-link>
      <s-button slot="secondary-actions" tone="critical" commandFor="delete-group-modal">
        Delete rate
      </s-button>

      <Form method="post" id={FORM_ID} data-save-bar data-discard-confirmation onReset={handleDiscard}>
        <input type="hidden" name="type"      value={rateType} />
        <input type="hidden" name="valueType" value={shippingRateType} />
        <input type="hidden" name="origName"  value={rate.name} />
        <input type="hidden" name="tiersJson" value={JSON.stringify(savedTiers)} />

        <s-stack gap="base">
          {/* ── General ── */}
          <s-section heading="General">
            <s-stack direction="block" gap="base">
              <s-paragraph>Choose how you want to charge this rate.</s-paragraph>
              {actionData?.errors?.name && (
                <s-banner tone="critical"><s-text>{actionData.errors.name}</s-text></s-banner>
              )}
              <s-text-field ref={nameRef} label="Rate name" name="name"
                onInput={markChanged} required></s-text-field>
              <s-text-area ref={descRef} label="Rate description" name="description"
                rows="2" onInput={markChanged}></s-text-area>

              {/* ── Delivery time range ── */}
              <s-stack direction="block" gap="extra-small">
                <s-text><strong>Delivery time range (optional)</strong></s-text>
                <s-stack direction="inline" gap="small">
                  <s-number-field
                    ref={minDaysRef}
                    label="Min"
                    name="minDeliveryDays"
                    min="0"
                    step="1"
                    placeholder="e.g. 1"
                    suffix="days"
                    onInput={markChanged}
                    style={{ flex: 1 }}
                  ></s-number-field>
                  <s-number-field
                    ref={maxDaysRef}
                    label="Max"
                    name="maxDeliveryDays"
                    min="0"
                    step="1"
                    placeholder="e.g. 3"
                    suffix="days"
                    onInput={markChanged}
                    style={{ flex: 1 }}
                  ></s-number-field>
                </s-stack>
                <s-text tone="subdued">Delivery time shown to customers at checkout.</s-text>
              </s-stack>
            </s-stack>
          </s-section>

          {/* ── Shipping rates ── */}
          <s-section heading="Shipping rates">
            <s-stack direction="block" gap="base">
              {actionData?.errors?.tiers && (
                <s-banner tone="critical"><s-text>{actionData.errors.tiers}</s-text></s-banner>
              )}

              <s-paragraph><strong>Select criteria</strong></s-paragraph>
              <s-stack direction="inline" gap="small">
                <s-select ref={catRef} label="Category" style={{ flex: 1 }}
                  onChange={(e) => { setRateCat(e.target.value); markChanged(); }}>
                  {RATE_CATEGORIES.map((c) => (
                    <s-option key={c.value} value={c.value}>{c.label}</s-option>
                  ))}
                </s-select>
                <s-select ref={attrRef} label="Attribute" style={{ flex: 1 }}
                  onChange={(e) => { setRateAttr(e.target.value); markChanged(); }}>
                  {getAttrList(rateCat).map((a) => (
                    <s-option key={a.value} value={a.value}>{a.label}</s-option>
                  ))}
                </s-select>
              </s-stack>

              <s-select label="Shipping rate type" style={{ maxWidth: "300px" }}
                onChange={(e) => { setShippingRateType(e.target.value); markChanged(); }}>
                <s-option value="fixed"
                  {...(shippingRateType === "fixed" ? { selected: true } : {})}>
                  Fixed amount
                </s-option>
                <s-option value="percentage"
                  {...(shippingRateType === "percentage" ? { selected: true } : {})}>
                  Percentage
                </s-option>
              </s-select>

              {/* ── Tiered rates summary card ── */}
              {savedTiers.length > 0 && (
                <div style={{
                  border: "1px solid #e1e3e5", borderRadius: "8px", padding: "14px 16px",
                }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between",
                    alignItems: "center", marginBottom: "12px",
                  }}>
                    <s-text><strong>Tiered rates</strong></s-text>
                    <s-button
                      type="button" variant="tertiary"
                      commandFor={TIER_MODAL_ID} command="--show"
                      onClick={openModal}
                     icon="edit">
                      Edit
                    </s-button>
                  </div>
                  <s-stack direction="block" gap="small">
                    {savedTiers.map((tier) => {
                      const maxDisplay = !tier.max || tier.max === "~"
                        ? `~ ${unitSuffix}`.trim()
                        : `${tier.max} ${unitSuffix}`.trim();
                      const priceDisplay = shippingRateType === "percentage"
                        ? `${tier.price}%`
                        : `${tier.price} ${priceSuffix}`;
                      return (
                        <s-text key={tier.id}>
                          When cart have{" "}
                          <strong>Min {tier.min || "0"} {unitSuffix} &amp; Max {maxDisplay}</strong>
                          {" "}then rates will be{" "}
                          <strong>{priceDisplay}</strong>
                        </s-text>
                      );
                    })}
                  </s-stack>
                </div>
              )}

              {/* ── Add tiered rate button ── */}
              <s-button
                type="button"
                commandFor={TIER_MODAL_ID}
                command="--show"
                onClick={openModal}
               icon="plus-circle">
                Add tiered rate
              </s-button>
            </s-stack>
          </s-section>
        </s-stack>
      </Form>

      {/* ── Aside ── */}
      <s-section slot="aside" heading="Rate info">
        {rate.profileName && (
          <s-stack direction="block" gap="small">
            <s-text tone="subdued">Shipping profile</s-text>
            <s-text><strong>{rate.profileName}</strong></s-text>
          </s-stack>
        )}
        <s-select
          label="Rate status"
          name="rateStatus"
          form={FORM_ID}
          onChange={markChanged}
        >
          <s-option value="enabled" {...(rate.status !== "disabled" ? { selected: true } : {})}>Active</s-option>
          <s-option value="disabled" {...(rate.status === "disabled" ? { selected: true } : {})}>Inactive</s-option>
        </s-select>
      </s-section>

      {/* ── Delete group modal ── */}
      <s-modal id="delete-group-modal" heading={`Delete "${rate.name}"?`}>
        <s-paragraph>
          This will delete all {allTiers.length} tier{allTiers.length !== 1 ? "s" : ""} for this rate. This cannot be undone.
        </s-paragraph>
        <s-button slot="primary-action" variant="primary" tone="critical"
          onClick={() => document.getElementById(DEL_FORM_ID)?.requestSubmit()}>
          Delete all tiers
        </s-button>
        <s-button slot="secondary-actions" commandFor="delete-group-modal">Cancel</s-button>
      </s-modal>
      <Form method="post" id={DEL_FORM_ID}>
        <input type="hidden" name="intent"    value="delete-group" />
        <input type="hidden" name="groupName" value={rate.name} />
      </Form>

      {/* ── Tiered rates modal ── */}
      <s-modal id={TIER_MODAL_ID} heading="Tiered rates">
        <s-stack direction="block" gap="base">
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr 36px",
            gap: "8px", paddingBottom: "8px", borderBottom: "1px solid #e1e3e5",
          }}>
            <s-text><strong>Min</strong></s-text>
            <s-text><strong>Max (~ for unlimited)</strong></s-text>
            <s-text><strong>Shipping rate</strong></s-text>
            <span />
          </div>

          {modalTiers.map((tier) => (
            <div key={tier.id} style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr 36px",
              gap: "8px", alignItems: "center",
            }}>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input type="number" min="0" step="0.01"
                  value={tier.min} placeholder="0"
                  onChange={(e) => updateModalRow(tier.id, "min", e.target.value)}
                  style={{ ...inputStyle, paddingRight: unitSuffix ? `${unitSuffix.length * 9 + 12}px` : "10px" }}
                />
                {unitSuffix && (
                  <span style={{ position:"absolute",right:"10px",fontSize:"13px",color:"#6d7175",pointerEvents:"none" }}>
                    {unitSuffix}
                  </span>
                )}
              </div>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input type="text"
                  value={tier.max} placeholder="~"
                  onChange={(e) => updateModalRow(tier.id, "max", e.target.value)}
                  style={{ ...inputStyle, paddingRight: unitSuffix ? `${unitSuffix.length * 9 + 12}px` : "10px" }}
                />
                {unitSuffix && (
                  <span style={{ position:"absolute",right:"10px",fontSize:"13px",color:"#6d7175",pointerEvents:"none" }}>
                    {unitSuffix}
                  </span>
                )}
              </div>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input type="number" min="0"
                  step={shippingRateType === "percentage" ? "0.1" : "0.01"}
                  value={tier.price} placeholder="0"
                  onChange={(e) => updateModalRow(tier.id, "price", e.target.value)}
                  style={{ ...inputStyle, paddingRight: `${priceSuffix.length * 9 + 12}px` }}
                />
                <span style={{ position:"absolute",right:"10px",fontSize:"13px",color:"#6d7175",pointerEvents:"none" }}>
                  {priceSuffix}
                </span>
              </div>
              <s-button type="button" variant="tertiary" tone="critical" icon="delete" accessibilityLabel="Remove tier" {...(modalTiers.length === 1 ? { disabled: true } : {})} onClick={() => removeModalRow(tier.id)}></s-button>
            </div>
          ))}

          <s-button type="button" variant="secondary" icon="plus-circle" onClick={addModalRow}>Add tier</s-button>

          <s-text tone="subdued" style={{ fontSize: "13px" }}>
            Start from the lowest rate to the highest.
            Use (~) only on the highest shipping rate (last row).
          </s-text>
        </s-stack>

        <s-button slot="secondary-actions" commandFor={TIER_MODAL_ID} command="--hide">
          Cancel
        </s-button>
        <s-button slot="primary-actions" variant="primary"
          commandFor={TIER_MODAL_ID} command="--hide" onClick={handleModalAdd}>
          Add
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);