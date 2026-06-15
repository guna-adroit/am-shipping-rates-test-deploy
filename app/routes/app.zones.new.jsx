import { redirect, data } from "react-router";
import { Form, useActionData, useLoaderData, useNavigate, useNavigation } from "react-router";
import { useRef, useEffect, useState, useCallback } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createZone, validateConditions } from "../models/zone.server";

// ─────────────────────────────────────────────────────────────────────────────
// Condition builder config (inlined — no server imports in non-loader exports)
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
    { value: "cart_volume",             label: "Volume",             numeric: true  },
  ],
  product: [
    { value: "product_total",             label: "Total",             numeric: true  },
    { value: "product_price",             label: "Price",             numeric: true  },
    { value: "product_quantity",          label: "Quantity",          numeric: true  },
    { value: "product_weight",            label: "Weight",            numeric: true  },
    { value: "product_vendor",            label: "Vendor",            numeric: false },
    { value: "product_name",              label: "Name",              numeric: false },
    { value: "product_tag",               label: "Tag",               numeric: false },
    { value: "product_sku",               label: "SKU",               numeric: false },
    { value: "product_type",              label: "Type",              numeric: false },
    { value: "product_collection",        label: "Collection",        numeric: false },
  ],
  customer: [
    { value: "customer_name",                  label: "Name",                  numeric: false },
    { value: "customer_email",                 label: "Email",                 numeric: false },
    { value: "customer_phone",                 label: "Phone",                 numeric: false },
    { value: "customer_tag",                   label: "Tag",                   numeric: false },
    { value: "customer_company",               label: "Company",               numeric: false },
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
function firstAttr(category) {
  return getAttrList(category)[0]?.value ?? "";
}
function firstOp(category, attribute) {
  return getOperators(category, attribute)[0]?.value ?? "equals";
}
function condLabel(rule) {
  const cat   = CONDITION_CATEGORIES.find(c => c.value === rule.category)?.label ?? rule.category;
  const attr  = getAttrList(rule.category).find(a => a.value === rule.attribute)?.label ?? rule.attribute;
  const ops   = getOperators(rule.category, rule.attribute);
  const op    = ops.find(o => o.value === rule.operator)?.label ?? rule.operator;
  const val   = rule.operator === "between"
    ? `${rule.value} and ${rule.value2}`
    : rule.value?.split(",").map(v => v.trim()).filter(Boolean).join(", ");
  return `${cat} › ${attr} ${op} ${val}`;
}
function generateId() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
const EMPTY_CONDITIONS = { logic: "all", rules: [] };

// ─────────────────────────────────────────────────────────────────────────────
// Loader — fetch shipping profiles from Shopify
// ─────────────────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  let shippingProfiles = [];
  try {
    const res  = await admin.graphql(`
      query GetDeliveryProfiles {
        deliveryProfiles(first: 30) {
          nodes { id name }
        }
      }
    `);
    const json = await res.json();
    shippingProfiles = json.data?.deliveryProfiles?.nodes ?? [];
  } catch (e) {
    console.error("Could not fetch delivery profiles:", e.message);
  }

  return { shippingProfiles };
};

// ─────────────────────────────────────────────────────────────────────────────
// Action
// ─────────────────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData    = await request.formData();

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

  const zone = await createZone(session.shop, { name, status, conditions });
  return redirect(`/app/zones/${zone.id}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function NewScenarioPage() {
  const { shippingProfiles } = useLoaderData();
  const actionData  = useActionData();
  const navigation  = useNavigation();
  const isSaving    = navigation.state === "submitting";
  const FORM_ID     = "create-scenario-form";

  // Form refs
  const nameRef   = useRef(null);
  const statusRef = useRef(null);

  // Condition state
  const [conditions, setConditions]   = useState(EMPTY_CONDITIONS);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [hasChanges, setHasChanges]   = useState(false);
  const markChanged = useCallback(() => setHasChanges(true), []);

  // Logic choice list ref
  const choiceListRef = useRef(null);

  // Condition modal state
  const [modalCat,  setModalCat]  = useState("cart");
  const [modalAttr, setModalAttr] = useState("cart_total");
  const [modalOp,   setModalOp]   = useState("equals");

  // Condition modal field refs
  const condCatRef    = useRef(null);
  const condAttrRef   = useRef(null);
  const condOpRef     = useRef(null);
  const condValueRef  = useRef(null);
  const condValue2Ref = useRef(null);

  const CONDITIONS_SAVE_BAR_ID = "new-scenario-conditions-save-bar";
  const COND_MODAL_ID = "new-cond-modal";

  // Save bar
  const showConditionsSaveBar = useCallback(() => {
    setHasChanges(true);
    shopify.saveBar.show(CONDITIONS_SAVE_BAR_ID);
  }, []);

  // ── Repopulate on validation error ──
  useEffect(() => {
    if (!actionData?.values) return;
    if (nameRef.current)   nameRef.current.value   = actionData.values.name   ?? "";
    if (statusRef.current) statusRef.current.value = actionData.values.status ?? "enabled";
    if (actionData.values.conditions) {
      try { setConditions(JSON.parse(actionData.values.conditions)); } catch {}
    }
  }, [actionData]);

  // ── Discard ──
  const handleDiscard = useCallback(() => {
    if (nameRef.current)   nameRef.current.value   = "";
    if (statusRef.current) statusRef.current.value = "enabled";
    setConditions(EMPTY_CONDITIONS);
    shopify.saveBar.hide(CONDITIONS_SAVE_BAR_ID);
    setHasChanges(false);
  }, []);

  // ── Logic change via native event ──
  const handleLogicChange = useCallback((value) => {
    if (value) {
      setConditions((prev) => ({ ...prev, logic: value }));
      showConditionsSaveBar();
    }
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

  // ── When category changes, reset attr + operator ──
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

  // ── When attr changes, reset operator ──
  useEffect(() => {
    const newOp = firstOp(modalCat, modalAttr);
    setModalOp(newOp);
    setTimeout(() => {
      if (condOpRef.current) condOpRef.current.value = newOp;
    }, 30);
  }, [modalAttr]);

  // ── Populate modal fields ──
  const populateModal = useCallback((cat, attr, op, value, value2) => {
    setTimeout(() => {
      if (condCatRef.current)   condCatRef.current.value   = cat;
      if (condAttrRef.current)  condAttrRef.current.value  = attr;
      if (condOpRef.current)    condOpRef.current.value    = op;
      if (condValueRef.current) condValueRef.current.value = value;
      if (condValue2Ref.current) condValue2Ref.current.value = value2 ?? "";
    }, 30);
  }, []);

  // ── Add condition ──
  const openAddModal = useCallback(() => {
    setEditingRuleId(null);
    setModalCat("cart");
    setModalAttr("cart_total");
    setModalOp("equals");
    populateModal("cart", "cart_total", "equals", "", "");
  }, [populateModal]);

  // ── Edit condition ──
  const openEditModal = useCallback((rule) => {
    setEditingRuleId(rule.id);
    setModalCat(rule.category || "product");
    setModalAttr(rule.attribute);
    setModalOp(rule.operator);
    populateModal(rule.category || "product", rule.attribute, rule.operator, rule.value, rule.value2 ?? "");
  }, [populateModal]);

  // ── Save condition ──
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

  return (
    <s-page heading="New scenario">
      <ui-save-bar id={CONDITIONS_SAVE_BAR_ID}>
        <button variant="primary" onClick={() => document.getElementById(FORM_ID)?.requestSubmit()}>Save</button>
        <button onClick={handleDiscard}>Discard</button>
      </ui-save-bar>

      <s-button
        slot="primary-action"
        {...(isSaving ? { loading: true } : {})}
        {...(!hasChanges ? { disabled: true } : {})}
        onClick={() => document.getElementById(FORM_ID)?.requestSubmit()}
      >
        Save
      </s-button>
      <s-link slot="secondary-actions" href="/app/zones">Cancel</s-link>

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
            <s-stack direction="block" gap="base">
              <s-text-field
                ref={nameRef}
                label="Scenario name"
                name="name"
                placeholder="Ex: Standard shipping scenario"
                error-message={actionData?.errors?.name ?? ""}
                onInput={markChanged}
                required
              ></s-text-field>
            </s-stack>
          </s-section>

          {/* ── Conditions ── */}
          <s-section heading="Conditions">
            <s-stack direction="block" gap="base">
              {actionData?.errors?.conditions && (
                <s-banner tone="critical">
                  <s-text>{actionData.errors.conditions}</s-text>
                </s-banner>
              )}

              <s-choice-list
                ref={choiceListRef}
                label="Match type"
                name="conditionLogic"
              >
                <s-choice value="all"  {...(conditions.logic === "all"  ? { selected: true } : {})}>All condition must match</s-choice>
                <s-choice value="any"  {...(conditions.logic === "any"  ? { selected: true } : {})}>Any condition must match</s-choice>
                <s-choice value="none" {...(conditions.logic === "none" ? { selected: true } : {})}>None of the conditions match</s-choice>
              </s-choice-list>

              
              {/* ── Customer condition warning ── */}
              {conditions.rules.some((r) => (r.category || "product") === "customer") && (
                <s-banner tone="warning">
                  <s-text>
                    <strong>Customer conditions are not evaluated at checkout.</strong>
                    {" "}Shopify's carrier service callback does not include customer data,
                    so customer conditions (tag, email, city, etc.) always evaluate to{" "}
                    <strong>false</strong> and will prevent this scenario from matching.
                    Remove customer conditions or use Shopify Functions instead.
                  </s-text>
                </s-banner>
              )}

            {conditions.rules.length > 0 && (
                <s-stack direction="block" gap="small">
                  {conditions.rules.map((rule) => (
                    <div
                      key={rule.id}
                      style={{
                        background: "#f6f6f7",
                        borderRadius: "8px",
                        padding: "10px 14px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
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
                          type="button"
                          variant="tertiary"
                          commandFor={COND_MODAL_ID}
                          command="--show"
                          onClick={() => openEditModal(rule)}
                        >
                          Edit
                        </s-button>
                        <s-button
                          type="button"
                          variant="tertiary"
                          tone="critical"
                          onClick={() => removeRule(rule.id)}
                        >
                          Remove
                        </s-button>
                      </s-stack>
                    </div>
                  ))}
                </s-stack>
              )}

              <s-button
                type="button"
                commandFor={COND_MODAL_ID}
                command="--show"
                onClick={openAddModal}
               icon="plus-circle">Add condition
              </s-button>
            </s-stack>
          </s-section>

          {/* ── Shipping rates / profiles ── */}
          <s-section heading="Shipping rates">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Once you save this scenario, you can add shipping rates for each
                shipping profile below.
              </s-paragraph>

              {shippingProfiles.length === 0 && (
                <s-paragraph>
                  No shipping profiles found. Save the scenario first, then add
                  rates from the Edit view.
                </s-paragraph>
              )}

              {shippingProfiles.map((profile) => (
                <div
                  key={profile.id}
                  style={{
                    border: "1px solid #e1e3e5",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <s-text><strong>{profile.name}</strong></s-text>
                  <s-text tone="subdued" style={{ fontSize: "13px" }}>
                    Save scenario to add rates
                  </s-text>
                </div>
              ))}
            </s-stack>
          </s-section>
        </s-stack>
      </Form>

      {/* Aside — status */}
      <s-section slot="aside" heading="Status">
        <s-select ref={statusRef} label="Scenario status" name="status" form={FORM_ID} onChange={markChanged}>
          <s-option value="enabled">Active</s-option>
          <s-option value="disabled">Inactive</s-option>
        </s-select>
      </s-section>

      {/* ── Condition modal ── */}
      <s-modal id={COND_MODAL_ID} heading={editingRuleId ? "Edit condition" : "Add condition"}>
        <s-stack direction="block" gap="base">
          {/* 3 dropdowns in a row */}
          <s-stack direction="inline" gap="small">
            <s-select
              ref={condCatRef}
              label="Category"
              style={{ flex: 1 }}
              onChange={(e) => setModalCat(e.target.value)}
            >
              {CONDITION_CATEGORIES.map((c) => (
                <s-option key={c.value} value={c.value}>{c.label}</s-option>
              ))}
            </s-select>

            <s-select
              ref={condAttrRef}
              label="Attribute"
              style={{ flex: 1 }}
              onChange={(e) => setModalAttr(e.target.value)}
            >
              {getAttrList(modalCat).map((a) => (
                <s-option key={a.value} value={a.value}>{a.label}</s-option>
              ))}
            </s-select>

            <s-select
              ref={condOpRef}
              label="Condition"
              style={{ flex: 1 }}
              onChange={(e) => setModalOp(e.target.value)}
            >
              {getOperators(modalCat, modalAttr).map((o) => (
                <s-option key={o.value} value={o.value}>{o.label}</s-option>
              ))}
            </s-select>
          </s-stack>

          {/* Value input — zipcode gets textarea + instructions */}
          {isZipcode ? (
            <s-stack direction="block" gap="small">
              <s-text-area
                ref={condValueRef}
                label="Zip codes"
                rows="4"
                placeholder="Ex: 10041*,10051*"
              ></s-text-area>
              <s-stack direction="block" gap="extra-small">
                <s-text>Enter zip codes separated by commas.</s-text>
                <s-text>For a partial match, add an asterisk (*) after the starting characters (e.g., 1004*)</s-text>
                <s-text>To specify a range, use a colon (:) between start and end zip codes — numbers only (e.g., 100400:100500)</s-text>
                <s-text>Use an underscore (_) to denote a space. For example, HB1_ matches HB1 2BA but not HB12 C2.</s-text>
              </s-stack>
            </s-stack>
          ) : (
            <s-stack direction="inline" gap="small">
              <s-text-field
                ref={condValueRef}
                label={isBetween ? "From value" : "Value"}
                placeholder={isNumeric ? "e.g. 50" : "e.g. value1, value2"}
                style={{ flex: 1 }}
              ></s-text-field>
              {isBetween && (
                <s-text-field
                  ref={condValue2Ref}
                  label="To value"
                  placeholder="e.g. 150"
                  style={{ flex: 1 }}
                ></s-text-field>
              )}
            </s-stack>
          )}

          {!isNumeric && !isZipcode && !isBetween && (
            <s-text tone="subdued" style={{ fontSize: "13px" }}>
              Separate multiple values with commas
            </s-text>
          )}
        </s-stack>

        <s-button slot="secondary-actions" commandFor={COND_MODAL_ID} command="--hide">
          Cancel
        </s-button>
        <s-button
          slot="primary-actions"
          variant="primary"
          commandFor={COND_MODAL_ID}
          command="--hide"
          onClick={handleSaveCondition}
        >
          {editingRuleId ? "Update" : "Add"}
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);