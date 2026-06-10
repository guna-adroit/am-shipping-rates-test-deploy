import { redirect, data } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { useRef, useEffect, useState, useCallback } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getZone } from "../models/zone.server";
import { createRate } from "../models/rate.server";

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
function generateId() { return String(Math.floor(100000 + Math.random() * 900000)); }

const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1px solid #c9cccf",
  borderRadius: "6px", fontSize: "14px", outline: "none", boxSizing: "border-box",
};

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const zone = await getZone(params.zoneId, session.shop);
  if (!zone) throw new Response("Not found", { status: 404 });
  return { zone };
};

export const action = async ({ request, params }) => {
  await authenticate.admin(request);
  const formData    = await request.formData();
  const name        = formData.get("name")?.toString().trim() ?? "";
  const description = formData.get("description")?.toString().trim() ?? "";
  const type        = formData.get("type")?.toString() ?? "price";
  const valueType   = formData.get("valueType")?.toString() ?? "fixed";
  const profileId   = formData.get("profileId")?.toString()   || null;
  const profileName = formData.get("profileName")?.toString() || null;
  const rateStatus      = formData.get("rateStatus")?.toString() ?? "enabled";
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
    return data({ errors, values: { name, description } }, { status: 400 });
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

export default function NewRatePage() {
  const { zone }       = useLoaderData();
  const actionData     = useActionData();
  const navigation     = useNavigation();
  const [searchParams] = useSearchParams();
  const isSaving = navigation.state === "submitting";
  const FORM_ID       = "create-rate-form";
  const TIER_MODAL_ID = "tiered-rates-modal";

  const profileId   = searchParams.get("profileId")   ?? "";
  const profileName = searchParams.get("profileName") ?? "";

  const [rateCat,  setRateCat]  = useState("cart");
  const [rateAttr, setRateAttr] = useState("price");
  const [shippingRateType, setShippingRateType] = useState("fixed");

  // savedTiers = the committed tiers shown on the page
  const [savedTiers, setSavedTiers] = useState([]);
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
    if (!actionData?.values) return;
    if (nameRef.current) nameRef.current.value = actionData.values.name ?? "";
    if (descRef.current) descRef.current.value = actionData.values.description ?? "";
  }, [actionData]);

  useEffect(() => {
    const first = getAttrList(rateCat)[0]?.value ?? "price";
    setRateAttr(first);
    setTimeout(() => { if (attrRef.current) attrRef.current.value = first; }, 30);
  }, [rateCat]);

  // ── Open modal — always pre-load with existing savedTiers (or one blank row) ──
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

  // ── Confirm modal — replace savedTiers with modalTiers ──
  const handleModalAdd = useCallback(() => {
    const valid = modalTiers.filter(t => t.price !== "" || t.min !== "");
    if (valid.length > 0) setSavedTiers(valid);
  }, [modalTiers]);

  const removeSavedTier = useCallback((id) => {
    setSavedTiers(p => p.filter(t => t.id !== id));
  }, []);

  const heading = profileName ? `${zone.name} — ${profileName}` : `Add rate — ${zone.name}`;

  return (
    <s-page heading={heading}>
      <s-link slot="breadcrumb-actions" href={`/app/zones/${zone.id}`}>{zone.name}</s-link>
      <s-button slot="primary-action" {...(isSaving ? { loading: true } : {})}
        onClick={() => document.getElementById(FORM_ID)?.requestSubmit()}>Save</s-button>
      <s-link slot="secondary-actions" href={`/app/zones/${zone.id}`}>Cancel</s-link>

      <Form method="post" id={FORM_ID} data-save-bar>
        <input type="hidden" name="type"        value={rateType} />
        <input type="hidden" name="valueType"   value={shippingRateType} />
        <input type="hidden" name="profileId"   value={profileId} />
        <input type="hidden" name="profileName" value={profileName} />
        <input type="hidden" name="tiersJson"   value={JSON.stringify(savedTiers)} />

        <s-stack gap="base">
          {/* ── Rate type ── */}
          <s-section heading="Select rate type">
            <s-choice-list label="Rate type" name="rateType">
              <s-choice value="fixed" selected={true}>Fixed rate</s-choice>
            </s-choice-list>
          </s-section>

          {/* ── General info ── */}
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

              {/* ── Tiered rates summary card ── */}
              {savedTiers.length > 0 && (
                <div style={{
                  border: "1px solid #e1e3e5", borderRadius: "8px",
                  padding: "14px 16px",
                }}>
                  {/* Card header */}
                  <div style={{
                    display: "flex", justifyContent: "space-between",
                    alignItems: "center", marginBottom: "12px",
                  }}>
                    <s-text><strong>Tiered rates</strong></s-text>
                    <s-button
                      type="button"
                      variant="tertiary"
                      commandFor={TIER_MODAL_ID}
                      command="--show"
                      onClick={openModal}
                     icon="edit">
                      Edit
                    </s-button>
                  </div>
                  {/* Tier descriptions */}
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

      <s-section slot="aside" heading="Status">
        <s-select label="Rate status" name="rateStatus" form={FORM_ID}>
          <s-option value="enabled">Active</s-option>
          <s-option value="disabled">Inactive</s-option>
        </s-select>
      </s-section>

      {/* ── Tiered rates modal ── */}
      <s-modal id={TIER_MODAL_ID} heading="Tiered rates">
        <s-stack direction="block" gap="base">
          {/* Column headers */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr 36px",
            gap: "8px", paddingBottom: "8px", borderBottom: "1px solid #e1e3e5",
          }}>
            <s-text><strong>Min</strong></s-text>
            <s-text><strong>Max (~ for unlimited)</strong></s-text>
            <s-text><strong>Shipping rate</strong></s-text>
            <span />
          </div>

          {/* Tier rows */}
          {modalTiers.map((tier) => (
            <div key={tier.id} style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr 36px",
              gap: "8px", alignItems: "center",
            }}>
              {/* Min */}
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input type="number" min="0" step="0.01"
                  value={tier.min} placeholder="0"
                  onChange={(e) => updateModalRow(tier.id, "min", e.target.value)}
                  style={{ ...inputStyle, paddingRight: unitSuffix ? `${unitSuffix.length * 9 + 12}px` : "10px" }}
                />
                {unitSuffix && (
                  <span style={{ position:"absolute", right:"10px", fontSize:"13px", color:"#6d7175", pointerEvents:"none" }}>
                    {unitSuffix}
                  </span>
                )}
              </div>
              {/* Max */}
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input type="text"
                  value={tier.max} placeholder="~"
                  onChange={(e) => updateModalRow(tier.id, "max", e.target.value)}
                  style={{ ...inputStyle, paddingRight: unitSuffix ? `${unitSuffix.length * 9 + 12}px` : "10px" }}
                />
                {unitSuffix && (
                  <span style={{ position:"absolute", right:"10px", fontSize:"13px", color:"#6d7175", pointerEvents:"none" }}>
                    {unitSuffix}
                  </span>
                )}
              </div>
              {/* Price */}
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input type="number" min="0"
                  step={shippingRateType === "percentage" ? "0.1" : "0.01"}
                  value={tier.price} placeholder="0"
                  onChange={(e) => updateModalRow(tier.id, "price", e.target.value)}
                  style={{ ...inputStyle, paddingRight: `${priceSuffix.length * 9 + 12}px` }}
                />
                <span style={{ position:"absolute", right:"10px", fontSize:"13px", color:"#6d7175", pointerEvents:"none" }}>
                  {priceSuffix}
                </span>
              </div>
              {/* Delete row */}
              <s-button
                type="button"
                variant="tertiary"
                tone="critical"
                icon="delete"
                accessibilityLabel="Remove tier"
                {...(modalTiers.length === 1 ? { disabled: true } : {})}
                onClick={() => removeModalRow(tier.id)}
              ></s-button>
            </div>
          ))}

          {/* Add tier row */}
          <button type="button" onClick={addModalRow} style={{
            display:"inline-flex", alignItems:"center", gap:"6px",
            background:"none", border:"1px solid #c9cccf", borderRadius:"6px",
            padding:"7px 14px", cursor:"pointer", fontSize:"14px", color:"#202223",
          }} icon="plus-circle">Add tier
          </button>

          <s-text tone="subdued" style={{ fontSize: "13px" }}>
            Start from the lowest rate to the highest while adding shipping rates.
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