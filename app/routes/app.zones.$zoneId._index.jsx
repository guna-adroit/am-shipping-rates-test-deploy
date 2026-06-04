import { redirect, data } from "react-router";
import { Form, useFetcher, useLoaderData, useActionData, useNavigation } from "react-router";
import { useRef, useEffect, useState, useCallback } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getZone, updateZone, deleteZone, validateConditions } from "../models/zone.server";
import { deleteRate } from "../models/rate.server";
import db from "../db.server";

// ─────────────────────────────────────────────────────────────────────────────
// parseConditions — inlined (pure JS, no server deps)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Condition builder config
// ─────────────────────────────────────────────────────────────────────────────

const CONDITION_CATEGORIES = [
  { value: "cart",     label: "Cart" },
  { value: "product",  label: "Product" },
  { value: "customer", label: "Customer" },
];

const ATTRIBUTES_BY_CATEGORY = {
  cart: [
    { value: "cart_total",              label: "Total",              numeric: true  },
    { value: "cart_quantity",           label: "Quantity",           numeric: true  },
    { value: "cart_weight",             label: "Weight",             numeric: true  },
    { value: "cart_zip_code",           label: "Zip code",           numeric: false, isZipcode: true },
    { value: "cart_length",             label: "Length",             numeric: true  },
    { value: "cart_width",              label: "Width",              numeric: true  },
    { value: "cart_height",             label: "Height",             numeric: true  },
    { value: "cart_volume",             label: "Volume",             numeric: true  },
    { value: "cart_volumetric_weight",  label: "Volumetric weight",  numeric: true  },
  ],
  product: [
    { value: "product_total",             label: "Total",             numeric: true  },
    { value: "product_price",             label: "Price",             numeric: true  },
    { value: "product_quantity",          label: "Quantity",          numeric: true  },
    { value: "product_weight",            label: "Weight",            numeric: true  },
    { value: "product_length",            label: "Length",            numeric: true  },
    { value: "product_width",             label: "Width",             numeric: true  },
    { value: "product_height",            label: "Height",            numeric: true  },
    { value: "product_volume",            label: "Volume",            numeric: true  },
    { value: "product_volumetric_weight", label: "Volumetric weight", numeric: true  },
    { value: "product_vendor",            label: "Vendor",            numeric: false },
    { value: "product_name",              label: "Name",              numeric: false },
    { value: "product_tag",               label: "Tag",               numeric: false },
    { value: "product_sku",               label: "SKU",               numeric: false },
    { value: "product_barcode",           label: "Barcode",           numeric: false },
    { value: "product_type",              label: "Type",              numeric: false },
    { value: "product_collection",        label: "Collection",        numeric: false },
  ],
  customer: [
    { value: "customer_name",                  label: "Name",                  numeric: false },
    { value: "customer_email",                 label: "Email",                 numeric: false },
    { value: "customer_phone",                 label: "Phone",                 numeric: false },
    { value: "customer_city",                  label: "City",                  numeric: false },
    { value: "customer_state",                 label: "State",                 numeric: false },
    { value: "customer_country",               label: "Country",               numeric: false },
    { value: "customer_tag",                   label: "Tag",                   numeric: false },
    { value: "customer_company",               label: "Company",               numeric: false },
    { value: "customer_previous_orders_count", label: "Previous orders count", numeric: true  },
    { value: "customer_previous_orders_spent", label: "Previous orders spent", numeric: true  },
  ],
};

const TEXT_OPERATORS    = [
  { value: "equals",       label: "Equals to" },
  { value: "not_equals",   label: "Does not equal" },
  { value: "contains",     label: "Contains" },
  { value: "not_contains", label: "Does not contain" },
];
const NUMERIC_OPERATORS = [
  { value: "equals",                 label: "Equals to" },
  { value: "not_equals",             label: "Does not equal" },
  { value: "greater_than",           label: "Greater than" },
  { value: "less_than",              label: "Less than" },
  { value: "greater_than_or_equals", label: "Greater than or equals to" },
  { value: "less_than_or_equals",    label: "Less than or equals to" },
  { value: "between",                label: "Between" },
];
const ZIPCODE_OPERATORS = [
  { value: "equals",     label: "Equals to" },
  { value: "not_equals", label: "Does not equal" },
];

function getAttrList(category) {
  return ATTRIBUTES_BY_CATEGORY[category] ?? ATTRIBUTES_BY_CATEGORY.cart;
}
function getAttrMeta(category, attribute) {
  return getAttrList(category).find((a) => a.value === attribute) ?? null;
}
function getOperators(category, attribute) {
  const meta = getAttrMeta(category, attribute);
  if (!meta) return TEXT_OPERATORS;
  if (meta.isZipcode) return ZIPCODE_OPERATORS;
  return meta.numeric ? NUMERIC_OPERATORS : TEXT_OPERATORS;
}
function firstAttr(category) { return getAttrList(category)[0]?.value ?? ""; }
function firstOp(category, attribute) { return getOperators(category, attribute)[0]?.value ?? "equals"; }
function condLabel(rule) {
  const cat  = CONDITION_CATEGORIES.find(c => c.value === (rule.category || "product"))?.label ?? rule.category ?? "";
  const attr = getAttrList(rule.category || "product").find(a => a.value === rule.attribute)?.label ?? rule.attribute ?? "";
  const ops  = getOperators(rule.category || "product", rule.attribute);
  const op   = ops.find(o => o.value === rule.operator)?.label ?? rule.operator ?? "";
  const val  = rule.operator === "between"
    ? `${rule.value} and ${rule.value2}`
    : rule.value?.split(",").map(v => v.trim()).filter(Boolean).join(", ");
  return `${cat} › ${attr} ${op} ${val}`;
}
function generateId() { return String(Math.floor(100000 + Math.random() * 900000)); }

const TYPE_LABELS = {
  price:            "Cart Total",
  weight:           "Cart Weight",
  cart_quantity:    "Cart Quantity",
  product_price:    "Product Price",
  product_weight:   "Product Weight",
  product_quantity: "Product Quantity",
};

// Group rates by {name + profileId} — each group = one tiered rate set
function groupRates(rates) {
  const map = {};
  rates.forEach((rate) => {
    const key = `${rate.name}||${rate.profileId ?? ""}`;
    if (!map[key]) {
      map[key] = {
        firstId:     rate.id,               // used for Edit link
        name:        rate.name,
        type:        rate.type,
        valueType:   rate.valueType ?? "fixed",
        status:      rate.status    ?? "enabled",  // all tiers share same status
        profileId:   rate.profileId,
        profileName: rate.profileName,
        tiers: [],
      };
    }
    map[key].tiers.push(rate);
  });
  return Object.values(map);
}

// ─────────────────────────────────────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────────────────────────────────────

export const loader = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const zone = await getZone(params.zoneId, session.shop);
  if (!zone) throw new Response("Scenario not found", { status: 404 });

  let shippingProfiles = [];
  try {
    const res  = await admin.graphql(`
      query GetDeliveryProfiles { deliveryProfiles(first: 30) { nodes { id name } } }
    `);
    const json = await res.json();
    shippingProfiles = json.data?.deliveryProfiles?.nodes ?? [];
  } catch (e) {
    console.error("Could not fetch delivery profiles:", e.message);
  }

  return { zone, shippingProfiles };
};

// ─────────────────────────────────────────────────────────────────────────────
// Action
// ─────────────────────────────────────────────────────────────────────────────

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const formData    = await request.formData();
  const intent      = formData.get("intent");

  if (intent === "delete-zone") {
    await deleteZone(params.zoneId);
    return redirect("/app/zones");
  }
  if (intent === "delete-rate") {
    const rateId = formData.get("rateId")?.toString();
    if (rateId) await deleteRate(rateId);
    return { ok: true };
  }

  if (intent === "toggle-rate-status") {
    // Toggle all tiers in the group (same name) simultaneously
    const groupName   = formData.get("groupName")?.toString();
    const newStatus   = formData.get("newStatus")?.toString() ?? "enabled";
    if (groupName) {
      await db.rate.updateMany({
        where: { zoneId: params.zoneId, name: groupName },
        data:  { status: newStatus },
      });
    }
    return { ok: true };
  }

  const name       = formData.get("name")?.toString().trim() ?? "";
  const status     = formData.get("status")?.toString() ?? "enabled";
  const conditions = formData.get("conditions")?.toString() ?? "";

  const errors = {};
  if (!name) errors.name = "Scenario name is required";
  const condError = validateConditions(conditions);
  if (condError) errors.conditions = condError;

  if (Object.keys(errors).length) {
    return data({ errors, values: { name, status, conditions } }, { status: 400 });
  }

  await updateZone(params.zoneId, { name, status, conditions, isFallback: false });
  return { ok: true, saved: true };
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function EditScenarioPage() {
  const { zone, shippingProfiles } = useLoaderData();
  const actionData  = useActionData();
  const navigation  = useNavigation();
  const rateFetcher = useFetcher();
  const FORM_ID      = "edit-scenario-form";
  const DEL_FORM_ID  = "delete-scenario-form";

  const isSaving = navigation.state === "submitting" &&
    navigation.formData?.get("intent") !== "delete-zone";

  // Form refs
  const nameRef   = useRef(null);
  const statusRef = useRef(null);

  // Originals for discard
  const origConditions = useRef(parseConditions(zone.conditions));
  const origZone       = useRef(zone);

  // Condition state
  const [conditions, setConditions]     = useState(() => parseConditions(zone.conditions));
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [hasChanges, setHasChanges]     = useState(false);
  const markChanged = useCallback(() => setHasChanges(true), []);

  // Logic choice list ref
  const choiceListRef = useRef(null);

  // Modal state
  const [modalCat,  setModalCat]  = useState("cart");
  const [modalAttr, setModalAttr] = useState("cart_total");
  const [modalOp,   setModalOp]   = useState("equals");

  // Modal field refs
  const condCatRef    = useRef(null);
  const condAttrRef   = useRef(null);
  const condOpRef     = useRef(null);
  const condValueRef  = useRef(null);
  const condValue2Ref = useRef(null);

  const CONDITIONS_SAVE_BAR_ID = "edit-scenario-conditions-save-bar";
  const COND_MODAL_ID = "edit-cond-modal";

  const showConditionsSaveBar = useCallback(() => {
    setHasChanges(true);
    shopify.saveBar.show(CONDITIONS_SAVE_BAR_ID);
  }, []);

  // ── Populate from loader ──
  useEffect(() => {
    if (nameRef.current)   nameRef.current.value   = zone.name;
    if (statusRef.current) statusRef.current.value = zone.status;
    const parsed = parseConditions(zone.conditions);
    setConditions(parsed);
    origZone.current       = zone;
    origConditions.current = parsed;
    shopify.saveBar.hide(CONDITIONS_SAVE_BAR_ID);
    setHasChanges(false);
  }, [zone]);

  // ── Repopulate on validation error ──
  useEffect(() => {
    if (!actionData?.values) return;
    if (nameRef.current)   nameRef.current.value   = actionData.values.name   ?? "";
    if (statusRef.current) statusRef.current.value = actionData.values.status ?? "enabled";
    if (actionData.values.conditions) {
      try { setConditions(JSON.parse(actionData.values.conditions)); } catch {}
    }
  }, [actionData]);

  // ── Category change → reset attr + op ──
  useEffect(() => {
    const newAttr = firstAttr(modalCat);
    const newOp   = firstOp(modalCat, newAttr);
    setModalAttr(newAttr);
    setModalOp(newOp);
    setTimeout(() => {
      if (condAttrRef.current) condAttrRef.current.value = newAttr;
      if (condOpRef.current)   condOpRef.current.value   = newOp;
    }, 30);
  }, [modalCat]);

  // ── Attr change → reset op ──
  useEffect(() => {
    const newOp = firstOp(modalCat, modalAttr);
    setModalOp(newOp);
    setTimeout(() => { if (condOpRef.current) condOpRef.current.value = newOp; }, 30);
  }, [modalAttr]);

  // ── Logic change ──
  const handleLogicChange = useCallback((value) => {
    if (value) { setConditions((prev) => ({ ...prev, logic: value })); showConditionsSaveBar(); }
  }, [showConditionsSaveBar]);

  useEffect(() => {
    const el = choiceListRef.current;
    if (!el) return;
    const listener = (e) => {
      const val = e.target?.value ?? e.detail?.value ?? e.detail?.selectedValues?.[0];
      handleLogicChange(val);
    };
    el.addEventListener("change", listener);
    return () => el.removeEventListener("change", listener);
  }, [handleLogicChange]);

  // ── Discard ──
  const handleDiscard = useCallback(() => {
    if (nameRef.current)   nameRef.current.value   = origZone.current.name;
    if (statusRef.current) statusRef.current.value = origZone.current.status;
    setConditions(origConditions.current);
    shopify.saveBar.hide(CONDITIONS_SAVE_BAR_ID);
    setHasChanges(false);
  }, []);

  // ── Populate modal ──
  const populateModal = useCallback((cat, attr, op, value, value2) => {
    setTimeout(() => {
      if (condCatRef.current)    condCatRef.current.value    = cat;
      if (condAttrRef.current)   condAttrRef.current.value   = attr;
      if (condOpRef.current)     condOpRef.current.value     = op;
      if (condValueRef.current)  condValueRef.current.value  = value;
      if (condValue2Ref.current) condValue2Ref.current.value = value2 ?? "";
    }, 30);
  }, []);

  const openAddModal = useCallback(() => {
    setEditingRuleId(null);
    setModalCat("cart"); setModalAttr("cart_total"); setModalOp("equals");
    populateModal("cart", "cart_total", "equals", "", "");
  }, [populateModal]);

  const openEditModal = useCallback((rule) => {
    const cat = rule.category || "product";
    setEditingRuleId(rule.id); setModalCat(cat);
    setModalAttr(rule.attribute); setModalOp(rule.operator);
    populateModal(cat, rule.attribute, rule.operator, rule.value, rule.value2 ?? "");
  }, [populateModal]);

  const handleSaveCondition = useCallback(() => {
    const category  = condCatRef.current?.value   || "cart";
    const attribute = condAttrRef.current?.value  || "cart_total";
    const operator  = condOpRef.current?.value    || "equals";
    const value     = condValueRef.current?.value?.trim()  || "";
    const value2    = condValue2Ref.current?.value?.trim() || "";
    if (!value) return;

    if (editingRuleId) {
      setConditions((prev) => ({
        ...prev,
        rules: prev.rules.map((r) =>
          r.id === editingRuleId ? { ...r, category, attribute, operator, value, value2 } : r
        ),
      }));
    } else {
      setConditions((prev) => ({
        ...prev,
        rules: [...prev.rules, { id: generateId(), category, attribute, operator, value, value2 }],
      }));
    }
    showConditionsSaveBar();
  }, [editingRuleId, showConditionsSaveBar]);

  const removeRule = useCallback((id) => {
    setConditions((prev) => ({ ...prev, rules: prev.rules.filter((r) => r.id !== id) }));
    showConditionsSaveBar();
  }, [showConditionsSaveBar]);

  const isBetween = modalOp === "between";
  const attrMeta  = getAttrMeta(modalCat, modalAttr);
  const isZipcode = attrMeta?.isZipcode === true;
  const isNumeric = attrMeta?.numeric === true && !isZipcode;

  // Group rates by profileId (or "unassigned")
  const ratesByProfile = {};
  zone.rates.forEach((rate) => {
    const key = rate.profileId ?? "__unassigned__";
    if (!ratesByProfile[key]) {
      ratesByProfile[key] = { profileName: rate.profileName ?? "General", rates: [] };
    }
    ratesByProfile[key].rates.push(rate);
  });

  return (
    <s-page heading={zone.name}>
      <ui-save-bar id={CONDITIONS_SAVE_BAR_ID}>
        <button variant="primary" onClick={() => document.getElementById(FORM_ID)?.requestSubmit()}>Save</button>
        <button onClick={handleDiscard}>Discard</button>
      </ui-save-bar>

      <s-link slot="breadcrumb-actions" href="/app/zones">Scenarios</s-link>

      <s-button
        slot="primary-action"
        {...(isSaving ? { loading: true } : {})}
        {...(!hasChanges ? { disabled: true } : {})}
        onClick={() => document.getElementById(FORM_ID)?.requestSubmit()}
      >
        Save
      </s-button>
      <s-link slot="secondary-actions" href="/app/zones">Cancel</s-link>
      <s-button slot="secondary-actions" tone="critical" variant="primary" commandFor="delete-scenario-modal">
        Delete scenario
      </s-button>

      <Form
        method="post"
        id={FORM_ID}
        data-save-bar
        data-discard-confirmation
        onReset={handleDiscard}
      >
        <input type="hidden" name="conditions" value={JSON.stringify(conditions)} />

        <s-stack gap="base">
          {/* ── Scenario name ── */}
          <s-section>
            <s-text-field
              ref={nameRef}
              label="Scenario name"
              name="name"
              error-message={actionData?.errors?.name ?? ""}
              onInput={markChanged}
              required
            ></s-text-field>
          </s-section>

          {/* ── Conditions ── */}
          <s-section heading="Conditions">
            <s-stack direction="block" gap="base">
              {actionData?.errors?.conditions && (
                <s-banner tone="critical"><s-text>{actionData.errors.conditions}</s-text></s-banner>
              )}

              <s-choice-list ref={choiceListRef} label="Match type" name="conditionLogic">
                <s-choice value="all"  {...(conditions.logic === "all"  ? { selected: true } : {})}>All condition must match</s-choice>
                <s-choice value="any"  {...(conditions.logic === "any"  ? { selected: true } : {})}>Any condition must match</s-choice>
                <s-choice value="none" {...(conditions.logic === "none" ? { selected: true } : {})}>None of the conditions match</s-choice>
              </s-choice-list>

              {/* ── Condition rules list ── */}
              {conditions.rules.length > 0 && (
                <s-stack direction="block" gap="small">
                  {conditions.rules.map((rule) => (
                    <div
                      key={rule.id}
                      style={{
                        background: "#f6f6f7", borderRadius: "8px",
                        padding: "10px 14px", display: "flex",
                        alignItems: "center", justifyContent: "space-between", gap: "12px",
                      }}
                    >
                      <s-stack direction="block" gap="none" style={{ flex: 1 }}>
                        <s-text>{condLabel(rule)}</s-text>
                        {(rule.category || "product") === "customer" && (
                          <s-text tone="subdued" style={{ fontSize: "12px" }}>
                            Requires customer login to evaluate
                          </s-text>
                        )}
                      </s-stack>
                      <s-stack direction="inline" gap="small">
                        <s-button
                          type="button" variant="tertiary"
                          commandFor={COND_MODAL_ID} command="--show"
                          onClick={() => openEditModal(rule)}
                        >Edit</s-button>
                        <s-button type="button" variant="tertiary" tone="critical"
                          onClick={() => removeRule(rule.id)}>
                          Remove
                        </s-button>
                      </s-stack>
                    </div>
                  ))}
                </s-stack>
              )}

              <s-button type="button" commandFor={COND_MODAL_ID} command="--show"
                icon="plus-circle" onClick={openAddModal}>
                Add condition
              </s-button>
            </s-stack>
          </s-section>

          {/* ── Shipping rates by profile ── */}
          <s-section heading="Shipping rates">
            <s-stack direction="block" gap="base">
              {shippingProfiles.map((profile) => {
                const profileData  = ratesByProfile[profile.id];
                const profileRates = profileData?.rates ?? [];
                return (
                  <div
                    key={profile.id}
                    style={{ border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden" }}
                  >
                    <div style={{
                      padding: "12px 16px", display: "flex",
                      alignItems: "center", justifyContent: "space-between",
                      background: profileRates.length > 0 ? "#fff" : "#fafafa",
                    }}>
                      <s-text><strong>{profile.name}</strong></s-text>
                      <s-link href={`/app/zones/${zone.id}/rates/new?type=price&profileId=${encodeURIComponent(profile.id)}&profileName=${encodeURIComponent(profile.name)}`}>
                        Add shipping rate
                      </s-link>
                    </div>

                    {profileRates.length > 0 && (
                      <div style={{ borderTop: "1px solid #e1e3e5" }}>
                        {groupRates(profileRates).map((group) => (
                          <div
                            key={group.firstId}
                            style={{
                              padding: "12px 16px", display: "flex",
                              alignItems: "center", justifyContent: "space-between",
                              borderBottom: "1px solid #f1f1f1",
                            }}
                          >
                            <s-stack direction="block" gap="extra-small">
                              <s-text>
                                <strong>{group.name}</strong>
                                {" "}<span style={{ color: "#6d7175" }}>| {TYPE_LABELS[group.type] ?? group.type}</span>
                              </s-text>
                              <s-text tone="subdued" style={{ fontSize: "12px" }}>
                                {group.tiers.length} tier{group.tiers.length !== 1 ? "s" : ""}
                                {group.valueType === "percentage" ? " · Percentage" : " · Fixed"}
                              </s-text>
                            </s-stack>
                            <s-stack direction="inline" gap="small">
                              <rateFetcher.Form method="post" style={{ display: "inline" }}>
                                <input type="hidden" name="intent"    value="toggle-rate-status" />
                                <input type="hidden" name="groupName" value={group.name} />
                                <input type="hidden" name="newStatus" value={group.status === "enabled" ? "disabled" : "enabled"} />
                                <button type="submit" style={{ background:"none", border:"none", cursor:"pointer", padding:0 }}>
                                  <s-badge tone={group.status === "enabled" ? "success" : "neutral"}>
                                    {group.status === "enabled" ? "Active" : "Inactive"}
                                  </s-badge>
                                </button>
                              </rateFetcher.Form>
                              <s-link href={`/app/zones/${zone.id}/rates/${group.firstId}`}>Edit</s-link>
                            </s-stack>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Unassigned rates (no profileId) */}
              {ratesByProfile["__unassigned__"] && (
                <s-stack direction="block" gap="small">
                  <s-text tone="subdued"><strong>Other rates</strong></s-text>
                  {groupRates(ratesByProfile["__unassigned__"].rates).map((group) => (
                    <div
                      key={group.firstId}
                      style={{
                        border: "1px solid #e1e3e5", borderRadius: "8px",
                        padding: "12px 16px", display: "flex",
                        alignItems: "center", justifyContent: "space-between",
                      }}
                    >
                      <s-stack direction="block" gap="extra-small">
                        <s-text>
                          <strong>{group.name}</strong>
                          {" "}<span style={{ color: "#6d7175" }}>| {TYPE_LABELS[group.type] ?? group.type}</span>
                        </s-text>
                        <s-text tone="subdued" style={{ fontSize: "12px" }}>
                          {group.tiers.length} tier{group.tiers.length !== 1 ? "s" : ""}
                        </s-text>
                      </s-stack>
                      <s-stack direction="inline" gap="small">
                        <rateFetcher.Form method="post" style={{ display: "inline" }}>
                          <input type="hidden" name="intent"    value="toggle-rate-status" />
                          <input type="hidden" name="groupName" value={group.name} />
                          <input type="hidden" name="newStatus" value={group.status === "enabled" ? "disabled" : "enabled"} />
                          <button type="submit" style={{ background:"none", border:"none", cursor:"pointer", padding:0 }}>
                            <s-badge tone={group.status === "enabled" ? "success" : "neutral"}>
                              {group.status === "enabled" ? "Active" : "Inactive"}
                            </s-badge>
                          </button>
                        </rateFetcher.Form>
                        <s-link href={`/app/zones/${zone.id}/rates/${group.firstId}`}>Edit</s-link>
                      </s-stack>
                    </div>
                  ))}
                </s-stack>
              )}

              {shippingProfiles.length === 0 && zone.rates.length === 0 && (
                <s-paragraph>No shipping profiles or rates found.</s-paragraph>
              )}
            </s-stack>
          </s-section>
        </s-stack>
      </Form>

      {/* ── Aside — status ── */}
      <s-section slot="aside" heading="Status">
        <s-select ref={statusRef} label="Scenario status" name="status" form={FORM_ID} onChange={markChanged}>
          <s-option value="enabled">Active</s-option>
          <s-option value="disabled">Inactive</s-option>
        </s-select>
      </s-section>

      {/* ── Delete scenario modal ── */}
      <s-modal id="delete-scenario-modal" heading={`Delete "${zone.name}"?`}>
        <s-paragraph>
          This will permanently delete the scenario and all its rates. This cannot be undone.
        </s-paragraph>
        <s-button slot="primary-action" tone="critical"
          onClick={() => document.getElementById(DEL_FORM_ID)?.requestSubmit()}>
          Delete
        </s-button>
        <s-button slot="secondary-actions" commandFor="delete-scenario-modal">Cancel</s-button>
      </s-modal>
      <Form method="post" id={DEL_FORM_ID}>
        <input type="hidden" name="intent" value="delete-zone" />
      </Form>

      {/* ── Add / Edit condition modal ── */}
      <s-modal id={COND_MODAL_ID} heading={editingRuleId ? "Edit condition" : "Add condition"}>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small">
            <s-select ref={condCatRef} label="Category" style={{ flex: 1 }}
              onChange={(e) => setModalCat(e.target.value)}>
              {CONDITION_CATEGORIES.map((c) => (
                <s-option key={c.value} value={c.value}>{c.label}</s-option>
              ))}
            </s-select>
            <s-select ref={condAttrRef} label="Attribute" style={{ flex: 1 }}
              onChange={(e) => setModalAttr(e.target.value)}>
              {getAttrList(modalCat).map((a) => (
                <s-option key={a.value} value={a.value}>{a.label}</s-option>
              ))}
            </s-select>
            <s-select ref={condOpRef} label="Condition" style={{ flex: 1 }}
              onChange={(e) => setModalOp(e.target.value)}>
              {getOperators(modalCat, modalAttr).map((o) => (
                <s-option key={o.value} value={o.value}>{o.label}</s-option>
              ))}
            </s-select>
          </s-stack>

          {isZipcode ? (
            <s-stack direction="block" gap="small">
              <s-text-area ref={condValueRef} label="Zip codes" rows="4"
                placeholder="Ex: 10041*,10051*"></s-text-area>
              <s-stack direction="block" gap="extra-small">
                <s-text>Enter zip codes separated by commas.</s-text>
                <s-text>For a partial match, add an asterisk (*) after the starting characters (e.g., 1004*)</s-text>
                <s-text>To specify a range, use a colon (:) between start and end zip codes — numbers only (e.g., 100400:100500)</s-text>
                <s-text>Use an underscore (_) to denote a space. For example, HB1_ matches HB1 2BA but not HB12 C2.</s-text>
              </s-stack>
            </s-stack>
          ) : (
            <s-stack direction="inline" gap="small">
              <s-text-field ref={condValueRef}
                label={isBetween ? "From value" : "Value"}
                placeholder={isNumeric ? "e.g. 50" : "e.g. value1, value2"}
                style={{ flex: 1 }}></s-text-field>
              {isBetween && (
                <s-text-field ref={condValue2Ref} label="To value"
                  placeholder="e.g. 150" style={{ flex: 1 }}></s-text-field>
              )}
            </s-stack>
          )}

          {!isNumeric && !isZipcode && !isBetween && (
            <s-text tone="subdued" style={{ fontSize: "13px" }}>
              Separate multiple values with commas
            </s-text>
          )}
        </s-stack>

        <s-button slot="secondary-actions" commandFor={COND_MODAL_ID} command="--hide">Cancel</s-button>
        <s-button slot="primary-actions" variant="primary"
          commandFor={COND_MODAL_ID} command="--hide" onClick={handleSaveCondition}>
          {editingRuleId ? "Update" : "Add"}
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);