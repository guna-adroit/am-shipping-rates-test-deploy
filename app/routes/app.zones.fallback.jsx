/**
 * app/routes/app.zones.fallback.jsx
 *
 * Manages the single fallback zone for this shop.
 * The fallback zone is shown to customers whose zip code doesn't match
 * any regular zone. It reuses the full rates infrastructure (price + weight).
 *
 * Access this page from your zones list with a "Configure fallback rates" link.
 */

import { redirect, data } from "react-router";
import { Form, useFetcher, useLoaderData, useActionData, useNavigation } from "react-router";
import { useRef, useEffect, useState, useCallback } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getFallbackZone,
  createFallbackZone,
  updateZone,
  validateConditions,
} from "../models/zone.server";
import { deleteRate } from "../models/rate.server";

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
// Condition builder helpers
// ─────────────────────────────────────────────────────────────────────────────

const ATTRIBUTE_OPTIONS = [
  { value: "sku",        label: "SKU",            numeric: false },
  { value: "name",       label: "Product name",   numeric: false },
  { value: "vendor",     label: "Vendor",         numeric: false },
  { value: "type",       label: "Product type",   numeric: false },
  { value: "tag",        label: "Tag",            numeric: false },
  { value: "collection", label: "Collection",     numeric: false },
  { value: "barcode",    label: "Barcode",        numeric: false },
  { value: "price",      label: "Price ($)",      numeric: true  },
  { value: "total",      label: "Line total ($)", numeric: true  },
  { value: "quantity",   label: "Quantity",       numeric: true  },
  { value: "weight",     label: "Weight (kg)",    numeric: true  },
  { value: "length",     label: "Length (cm)",    numeric: true  },
  { value: "width",      label: "Width (cm)",     numeric: true  },
  { value: "height",     label: "Height (cm)",    numeric: true  },
  { value: "volume",     label: "Volume (cm³)",   numeric: true  },
];

const TEXT_OPERATORS    = [
  { value: "equals",       label: "equals" },
  { value: "not_equals",   label: "does not equal" },
  { value: "contains",     label: "contains" },
  { value: "not_contains", label: "does not contain" },
];
const NUMERIC_OPERATORS = [
  { value: "equals",       label: "equals" },
  { value: "not_equals",   label: "does not equal" },
  { value: "greater_than", label: "is greater than" },
  { value: "less_than",    label: "is less than" },
  { value: "between",      label: "is between" },
];

function getOperators(attribute) {
  const meta = ATTRIBUTE_OPTIONS.find((a) => a.value === attribute);
  return meta?.numeric ? NUMERIC_OPERATORS : TEXT_OPERATORS;
}
function attributeLabel(v) {
  return ATTRIBUTE_OPTIONS.find((a) => a.value === v)?.label ?? v;
}
function operatorLabel(attribute, op) {
  return getOperators(attribute).find((o) => o.value === op)?.label ?? op;
}
function generateId() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
function displayValue(rule) {
  if (rule.operator === "between") return `${rule.value} and ${rule.value2}`;
  return rule.value.split(",").map((v) => v.trim()).filter(Boolean).join(", ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const zone = await getFallbackZone(session.shop);
  // zone may be null if not yet created — the UI handles this
  return { zone };
};

// ─────────────────────────────────────────────────────────────────────────────
// Action
// ─────────────────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent   = formData.get("intent");

  // ── Create the fallback zone for the first time ──
  if (intent === "create-fallback") {
    const existing = await getFallbackZone(session.shop);
    if (!existing) await createFallbackZone(session.shop);
    return redirect("/app/zones/fallback");
  }

  // ── Delete a rate ──
  if (intent === "delete-rate") {
    const rateId = formData.get("rateId")?.toString();
    if (rateId) await deleteRate(rateId);
    return { ok: true };
  }

  // ── Update fallback zone ──
  const zone = await getFallbackZone(session.shop);
  if (!zone) return redirect("/app/zones/fallback");

  const name       = formData.get("name")?.toString().trim() ?? "";
  const status     = formData.get("status")?.toString() ?? "enabled";
  const conditions = formData.get("conditions")?.toString() ?? "";

  const errors = {};
  if (!name) errors.name = "Zone name is required";

  const condError = validateConditions(conditions);
  if (condError) errors.conditions = condError;

  if (Object.keys(errors).length) {
    return data({ errors, values: { name, status, conditions } }, { status: 400 });
  }

  await updateZone(zone.id, { name, zipCodes: "", status, conditions, isFallback: true });
  return { ok: true, saved: true };
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function FallbackZonePage() {
  const { zone }    = useLoaderData();
  const actionData  = useActionData();
  const navigation  = useNavigation();
  const rateFetcher = useFetcher();

  const isSaving = navigation.state === "submitting" &&
    navigation.formData?.get("intent") !== "create-fallback";

  const FORM_ID = "fallback-zone-form";

  // Zone field refs
  const nameRef   = useRef(null);
  const statusRef = useRef(null);

  // Store originals for Discard
  const originalConditions = useRef(parseConditions(zone?.conditions));
  const originalZone       = useRef(zone);

  // Condition builder state
  const [conditions, setConditions] = useState(() => parseConditions(zone?.conditions));

  // Condition modal state
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [hasChanges, setHasChanges]         = useState(false);
  const markChanged = useCallback(() => setHasChanges(true), []);
  const [modalAttr, setModalAttr] = useState("sku");
  const [modalOp,   setModalOp]   = useState("equals");

  // s-choice-list ref — native addEventListener needed (React onChange unreliable on web components)
  const choiceListRef = useRef(null);

  // Condition modal refs
  const condAttrRef   = useRef(null);
  const condOpRef     = useRef(null);
  const condValueRef  = useRef(null);
  const condValue2Ref = useRef(null);

  const CONDITIONS_SAVE_BAR_ID = "fallback-conditions-save-bar";
  const showConditionsSaveBar = () => { setHasChanges(true); shopify.saveBar.show("fallback-conditions-save-bar"); };

  const COND_MODAL_ID = "cond-modal-fallback";

  // ── Set field values from loader data (refreshes originals after each save) ──
  useEffect(() => {
    if (!zone) return;
    if (nameRef.current)   nameRef.current.value   = zone.name;
    if (statusRef.current) statusRef.current.value = zone.status;
    const parsed = parseConditions(zone.conditions);
    setConditions(parsed);
    originalZone.current       = zone;
    originalConditions.current = parsed;
    shopify.saveBar.hide("fallback-conditions-save-bar");
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

  // ── Sync operator select when attribute changes ──
  useEffect(() => {
    const ops = getOperators(modalAttr);
    const defaultOp = ops[0].value;
    setModalOp(defaultOp);
    if (condOpRef.current) condOpRef.current.value = defaultOp;
  }, [modalAttr]);

  const populateModal = useCallback((attr, op, value, value2) => {
    setTimeout(() => {
      if (condAttrRef.current)   condAttrRef.current.value   = attr;
      if (condOpRef.current)     condOpRef.current.value     = op;
      if (condValueRef.current)  condValueRef.current.value  = value;
      if (condValue2Ref.current) condValue2Ref.current.value = value2 ?? "";
    }, 30);
  }, []);

  const openAddModal = useCallback(() => {
    setEditingRuleId(null);
    setModalAttr("sku");
    setModalOp("equals");
    populateModal("sku", "equals", "", "");
  }, [populateModal]);

  const openEditModal = useCallback((rule) => {
    setEditingRuleId(rule.id);
    setModalAttr(rule.attribute);
    setModalOp(rule.operator);
    populateModal(rule.attribute, rule.operator, rule.value, rule.value2 ?? "");
  }, [populateModal]);

  const handleModalAttrChange = useCallback((e) => setModalAttr(e.target.value), []);
  const handleModalOpChange   = useCallback((e) => setModalOp(e.target.value), []);

  // ── Discard — restore all fields to last saved state ──
  const handleDiscard = useCallback(() => {
    if (!originalZone.current) return;
    const orig = originalZone.current;
    if (nameRef.current)   nameRef.current.value   = orig.name;
    if (statusRef.current) statusRef.current.value = orig.status;
    setConditions(originalConditions.current);
    shopify.saveBar.hide("fallback-conditions-save-bar");
    setHasChanges(false);
  }, []);

  // ── s-choice-list: use native addEventListener (React onChange unreliable on web components) ──
  const handleLogicChange = useCallback((value) => {
    if (value) {
      setConditions((prev) => ({ ...prev, logic: value }));
      showConditionsSaveBar();
    }
  }, []);

  useEffect(() => {
    const el = choiceListRef.current;
    if (!el) return;
    const listener = (e) => {
      const val = e.target?.value ?? e.detail?.value ?? e.detail?.selectedValues?.[0];
      handleLogicChange(val);
    };
    el.addEventListener('change', listener);
    return () => el.removeEventListener('change', listener);
  }, [handleLogicChange]);


  const handleSaveCondition = useCallback(() => {
    const attribute = condAttrRef.current?.value  || "sku";
    const operator  = condOpRef.current?.value    || "equals";
    const value     = condValueRef.current?.value?.trim()  || "";
    const value2    = condValue2Ref.current?.value?.trim() || "";
    if (!value) return;

    if (editingRuleId) {
      setConditions((prev) => ({
        ...prev,
        rules: prev.rules.map((r) =>
          r.id === editingRuleId ? { ...r, attribute, operator, value, value2 } : r
        ),
      }));
    } else {
      setConditions((prev) => ({
        ...prev,
        rules: [...prev.rules, { id: generateId(), attribute, operator, value, value2 }],
      }));
    }
    showConditionsSaveBar();
  }, [editingRuleId]);

  const removeRule = useCallback((id) => {
    setConditions((prev) => ({ ...prev, rules: prev.rules.filter((r) => r.id !== id) }));
    showConditionsSaveBar();
  }, []);

  const isBetween = modalOp === "between";
  const isNumeric = ATTRIBUTE_OPTIONS.find((a) => a.value === modalAttr)?.numeric ?? false;
  const priceRates  = zone?.rates.filter((r) => r.type === "price")  ?? [];
  const weightRates = zone?.rates.filter((r) => r.type === "weight") ?? [];

  // ── Not yet configured ──
  if (!zone) {
    return (
      <s-page heading="Fallback Rates">
      {/* ── Conditions save bar — shown when conditions are modified ── */}
      <ui-save-bar id={CONDITIONS_SAVE_BAR_ID}>
        <button variant="primary" onClick={() => document.getElementById("fallback-zone-form")?.requestSubmit()}>Save</button>
        <button onClick={handleDiscard}>Discard</button>
      </ui-save-bar>
      
        <s-link slot="secondary-actions" href="/app/zones">Back to zones</s-link>
        <s-section heading="No fallback rates configured">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Fallback rates are shown to customers whose zip code doesn't match any
              of your regular shipping zones. This ensures every customer sees a
              shipping option at checkout.
            </s-paragraph>
            <s-paragraph>
              Once enabled, you can add price-based and weight-based rates to the
              fallback zone, just like any regular zone.
            </s-paragraph>
            <Form method="post">
              <input type="hidden" name="intent" value="create-fallback" />
              <s-button type="submit" variant="primary">Enable fallback rates</s-button>
            </Form>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Fallback Rates">
      
      <s-button
        slot="primary-action"
        {...(isSaving ? { loading: true } : {})}
        {...(!hasChanges ? { disabled: true } : {})}
        onClick={() => document.getElementById(FORM_ID)?.requestSubmit()}
      >
        Save
      </s-button>
      <s-link slot="secondary-actions" href="/app/zones">Back to zones</s-link>

      <Form
        method="post"
        id={FORM_ID}
        data-save-bar
        data-discard-confirmation
        onReset={handleDiscard}
      >
        <input type="hidden" name="conditions" value={JSON.stringify(conditions)} />

        {/* ── Settings ── */}
        <s-section heading="Fallback settings">
          <s-stack direction="block" gap="base">
            <s-banner tone="info">
              <s-text>
                These rates are shown when no zone matches the customer's zip code.
                They act as a safety net so no customer is ever blocked at checkout.
              </s-text>
            </s-banner>

            <s-text-field
              ref={nameRef}
              label="Zone name"
              name="name"
              help-text="For internal use only — not visible to customers."
              error-message={actionData?.errors?.name ?? ""}
              onInput={markChanged}
              required
            ></s-text-field>

            <s-select ref={statusRef} label="Fallback status" name="status" onChange={markChanged}>
              <s-option value="enabled">Enabled — show fallback rates when no zone matches</s-option>
              <s-option value="disabled">Disabled — hide shipping options when no zone matches</s-option>
            </s-select>
          </s-stack>
        </s-section>

        {/* ── Product conditions (optional) ── */}
        <s-section heading="Product conditions (optional)">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Optionally restrict the fallback to specific products. Leave empty to
              apply to all products that don't match a regular zone.
            </s-paragraph>

            {actionData?.errors?.conditions && (
              <s-banner tone="critical">
                <s-text>{actionData.errors.conditions}</s-text>
              </s-banner>
            )}

            {/* Logic choice list */}
            <s-choice-list
              ref={choiceListRef}
              label="Conditions"
              name="conditionLogic"
            >
              <s-choice value="all" {...(conditions.logic === "all" ? { selected: true } : {})}>All conditions must match</s-choice>
              <s-choice value="any" {...(conditions.logic === "any" ? { selected: true } : {})}>Any condition must match</s-choice>
              <s-choice value="none" {...(conditions.logic === "none" ? { selected: true } : {})}>None of the conditions match</s-choice>
            </s-choice-list>

            {/* Rules list */}
            {conditions.rules.length > 0 ? (
              <s-stack direction="block" gap="small">
                {conditions.rules.map((rule) => (
                  <s-stack key={rule.id} direction="inline" gap="base" style={{ alignItems: "center" }}>
                    <s-stack direction="block" gap="none" style={{ flex: 1 }}>
                      <s-text>
                        <strong>{attributeLabel(rule.attribute)}</strong>
                        {" "}{operatorLabel(rule.attribute, rule.operator)}{" "}
                        <strong>{displayValue(rule)}</strong>
                      </s-text>
                    </s-stack>
                    <s-button type="button" variant="tertiary" commandFor="cond-modal-fallback" command="--show" onClick={() => openEditModal(rule)}>Edit</s-button>
                    <s-button type="button" tone="critical" variant="tertiary" onClick={() => removeRule(rule.id)}>Remove</s-button>
                  </s-stack>
                ))}
              </s-stack>
            ) : (
              <s-paragraph>No conditions added. Fallback applies to all unmatched carts.</s-paragraph>
            )}

            <s-button type="button" variant="primary" commandFor="cond-modal-fallback" command="--show" onClick={openAddModal}>
              + Add condition
            </s-button>
          </s-stack>
        </s-section>
      </Form>

      {/* ── Rates (aside) ── */}
      <s-section slot="aside" heading="Fallback rates">
        <s-stack direction="block" gap="base">
          {/* Price-based */}
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="base">
              <s-text><strong>Price-based rates</strong></s-text>
              <s-link href={`/app/zones/${zone.id}/rates/new?type=price`}>
                Add price-based rate
              </s-link>
            </s-stack>
            <s-paragraph>Rates based on the order price.</s-paragraph>
            {priceRates.length === 0 && (
              <s-paragraph style={{ color: "#888" }}>No rates yet.</s-paragraph>
            )}
            {priceRates.map((rate) => (
              <s-stack key={rate.id} direction="inline" gap="base">
                <s-stack direction="block" gap="none">
                  <s-text>{rate.name}</s-text>
                  <s-text>
                    ${rate.minValue.toFixed(2)} – {rate.maxValue != null ? `$${rate.maxValue.toFixed(2)}` : "No max"} → {rate.price === 0 ? "Free" : `$${rate.price.toFixed(2)}`}
                  </s-text>
                </s-stack>
                <s-stack direction="inline" gap="small">
                  <s-link href={`/app/zones/${zone.id}/rates/${rate.id}`}>Edit</s-link>
                  <rateFetcher.Form method="post">
                    <input type="hidden" name="intent" value="delete-rate" />
                    <input type="hidden" name="rateId" value={rate.id} />
                    <s-button tone="critical" variant="tertiary" type="submit">Delete</s-button>
                  </rateFetcher.Form>
                </s-stack>
              </s-stack>
            ))}
          </s-stack>

          <s-divider></s-divider>

          {/* Weight-based */}
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="base">
              <s-text><strong>Weight-based rates</strong></s-text>
              <s-link href={`/app/zones/${zone.id}/rates/new?type=weight`}>
                Add weight-based rate
              </s-link>
            </s-stack>
            <s-paragraph>Rates based on the order weight.</s-paragraph>
            {weightRates.length === 0 && (
              <s-paragraph style={{ color: "#888" }}>No rates yet.</s-paragraph>
            )}
            {weightRates.map((rate) => (
              <s-stack key={rate.id} direction="inline" gap="base">
                <s-stack direction="block" gap="none">
                  <s-text>{rate.name}</s-text>
                  <s-text>
                    {rate.minValue.toFixed(2)}kg – {rate.maxValue != null ? `${rate.maxValue.toFixed(2)}kg` : "No max"} → {rate.price === 0 ? "Free" : `$${rate.price.toFixed(2)}`}
                  </s-text>
                </s-stack>
                <s-stack direction="inline" gap="small">
                  <s-link href={`/app/zones/${zone.id}/rates/${rate.id}`}>Edit</s-link>
                  <rateFetcher.Form method="post">
                    <input type="hidden" name="intent" value="delete-rate" />
                    <input type="hidden" name="rateId" value={rate.id} />
                    <s-button tone="critical" variant="tertiary" type="submit">Delete</s-button>
                  </rateFetcher.Form>
                </s-stack>
              </s-stack>
            ))}
          </s-stack>
        </s-stack>
      </s-section>

      {/* ── Add / Edit condition modal ── */}
      <s-modal id="cond-modal-fallback" heading={editingRuleId ? "Edit condition" : "Add condition"}>
        <s-stack direction="block" gap="base">
          <s-select ref={condAttrRef} label="Product attribute" onChange={handleModalAttrChange}>
            {ATTRIBUTE_OPTIONS.map((opt) => (
              <s-option key={opt.value} value={opt.value}>{opt.label}</s-option>
            ))}
          </s-select>

          <s-select ref={condOpRef} label="Condition" onChange={handleModalOpChange}>
            {getOperators(modalAttr).map((opt) => (
              <s-option key={opt.value} value={opt.value}>{opt.label}</s-option>
            ))}
          </s-select>

          <s-text-field
            ref={condValueRef}
            label={isBetween ? "From value" : "Value"}
            placeholder={isNumeric ? "e.g. 50" : "e.g. ABC123, DEF456"}
            help-text={!isNumeric && !isBetween ? "Separate multiple values with commas" : undefined}
          ></s-text-field>

          {isBetween && (
            <s-text-field ref={condValue2Ref} label="To value" placeholder="e.g. 150"></s-text-field>
          )}
        </s-stack>

        <s-button
          slot="secondary-actions"
          commandFor="cond-modal-fallback"
          command="--hide"
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-actions"
          variant="primary"
          commandFor="cond-modal-fallback"
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