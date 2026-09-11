import { redirect, data } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useFetcher } from "react-router";
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getZone } from "../models/zone.server";
import {
  getLiveCarrierRate, updateLiveCarrierRate, deleteLiveCarrierRate,
} from "../models/liveCarrierRate.server";
import { CARRIERS, getCarrier } from "../carriers/definitions";

function generateId() { return String(Math.floor(100000 + Math.random() * 900000)); }

// ─────────────────────────────────────────────────────────────────────────────
// Loader / Action
// ─────────────────────────────────────────────────────────────────────────────

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const zone = await getZone(params.zoneId, session.shop);
  if (!zone) throw new Response("Not found", { status: 404 });
  const liveRate = await getLiveCarrierRate(params.liveRateId);
  if (!liveRate || liveRate.zoneId !== zone.id) throw new Response("Not found", { status: 404 });
  return { zone, liveRate };
};

export const action = async ({ request, params }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "delete") {
    await deleteLiveCarrierRate(params.liveRateId);
    return redirect(`/app/zones/${params.zoneId}`);
  }

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
  const rateStatus = formData.get("rateStatus")?.toString() ?? "enabled";

  const errors = {};
  if (!name) errors.name = "Shipping rate name is required";
  if (!carrierKey || !getCarrier(carrierKey)) errors.carrierKey = "Select a carrier";

  let services = [];
  try { services = JSON.parse(servicesJson); } catch { /* ignore */ }
  let packages = [];
  try { packages = JSON.parse(packagesJson); } catch { /* ignore */ }

  if (Object.keys(errors).length) {
    return data({ errors }, { status: 400 });
  }

  await updateLiveCarrierRate(params.liveRateId, {
    name, notes, status: rateStatus, carrierKey, shippingLocation,
    services, packagingMethod, packageSplittingRule, productFilter, packages,
    fallbackName, fallbackDescription, fallbackType: "fixed", fallbackRate,
  });
  return redirect(`/app/zones/${params.zoneId}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function EditLiveCarrierRatePage() {
  const { zone, liveRate } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting" && navigation.formData?.get("intent") !== "delete";
  const FORM_ID = "edit-live-rate-form";
  const DEL_FORM_ID = "delete-live-rate-form";
  const CRED_MODAL_ID = "carrier-credentials-modal";
  const PKG_MODAL_ID = "package-modal";
  const DEL_MODAL_ID = "delete-live-rate-modal";

  const [carrierKey, setCarrierKey] = useState(liveRate.carrierKey);
  const [selectedServices, setSelectedServices] = useState(() => {
    try { return JSON.parse(liveRate.services || "[]"); } catch { return []; }
  });
  const [packagingMethod, setPackagingMethod] = useState(liveRate.packagingMethod);
  const [packages, setPackages] = useState(() => {
    try { return JSON.parse(liveRate.packages || "[]"); } catch { return []; }
  });
  const [pkgDraft, setPkgDraft] = useState({ length: "", width: "", height: "", maxWeight: "" });
  const [credFields, setCredFields] = useState({});
  const [syncState, setSyncState] = useState({});

  const credFetcher = useFetcher();

  const nameRef = useRef(null);
  const notesRef = useRef(null);
  const fbNameRef = useRef(null);
  const fbDescRef = useRef(null);
  const fbRateRef = useRef(null);

  const carrier = useMemo(() => getCarrier(carrierKey), [carrierKey]);

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

  const addPackage = useCallback(() => {
    if (!pkgDraft.length && !pkgDraft.width && !pkgDraft.height && !pkgDraft.maxWeight) return;
    setPackages((p) => [...p, { id: generateId(), ...pkgDraft }]);
    setPkgDraft({ length: "", width: "", height: "", maxWeight: "" });
  }, [pkgDraft]);
  const removePackage = useCallback((id) => {
    setPackages((p) => p.filter((pkg) => pkg.id !== id));
  }, []);

  const currentCredValues = credFields[carrierKey] || {};
  const currentSync = syncState[carrierKey];

  return (
    <s-page heading={`${zone.name} — ${liveRate.name}`}>
      <s-link slot="breadcrumb-actions" href={`/app/zones/${zone.id}`}>{zone.name}</s-link>
      <s-button slot="primary-action" {...(isSaving ? { loading: true } : {})}
        onClick={() => document.getElementById(FORM_ID)?.requestSubmit()}>Save</s-button>
      <s-link slot="secondary-actions" href={`/app/zones/${zone.id}`}>Cancel</s-link>
      <s-button slot="secondary-actions" variant="tertiary" tone="critical"
        commandFor={DEL_MODAL_ID} command="--show">Delete</s-button>

      <Form method="post" id={FORM_ID} data-save-bar>
        <input type="hidden" name="carrierKey" value={carrierKey} />
        <input type="hidden" name="shippingLocation" value="shopify_location" />
        <input type="hidden" name="servicesJson" value={JSON.stringify(selectedServices)} />
        <input type="hidden" name="packagingMethod" value={packagingMethod} />
        <input type="hidden" name="packageSplittingRule" value="cart_quantity" />
        <input type="hidden" name="productFilter" value="all_products" />
        <input type="hidden" name="packagesJson" value={JSON.stringify(packages)} />

        <s-stack gap="base">
          <s-section heading="General information">
            <s-stack direction="block" gap="base">
              {actionData?.errors?.name && (
                <s-banner tone="critical"><s-text>{actionData.errors.name}</s-text></s-banner>
              )}
              {actionData?.errors?.carrierKey && (
                <s-banner tone="critical"><s-text>{actionData.errors.carrierKey}</s-text></s-banner>
              )}
              <s-text-field ref={nameRef} label="Shipping rate name (internal reference)" name="name"
                defaultValue={liveRate.name}
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

          <s-section heading="Fallback rate">
            <s-stack direction="block" gap="base">
              <s-text tone="subdued">The rate applied if there is no response from the carrier during a rate query.</s-text>
              <s-text-field ref={fbNameRef} label="Rate name" name="fallbackName"
                defaultValue={liveRate.fallbackName}
                help-text="Displayed to customers at checkout."></s-text-field>
              <s-text-area ref={fbDescRef} label="Rate description" name="fallbackDescription"
                rows="2" defaultValue={liveRate.fallbackDescription ?? ""}
                placeholder="Appears below the shipping rate name at checkout."></s-text-area>
              <s-stack direction="inline" gap="small">
                <s-select label="Type" style={{ flex: 1 }}>
                  <s-option value="fixed" selected={true}>Fixed</s-option>
                </s-select>
                <s-number-field ref={fbRateRef} label="Rate" name="fallbackRate" min="0" step="0.01"
                  defaultValue={liveRate.fallbackRate} suffix="USD" style={{ flex: 1 }}></s-number-field>
              </s-stack>
            </s-stack>
          </s-section>
        </s-stack>
      </Form>

      <s-section slot="aside" heading="Status">
        <s-select label="Rate status" name="rateStatus" form={FORM_ID}>
          <s-option value="enabled" selected={liveRate.status === "enabled"}>Active</s-option>
          <s-option value="disabled" selected={liveRate.status === "disabled"}>Inactive</s-option>
        </s-select>
      </s-section>

      <s-section slot="aside" heading="Notes (optional)">
        <s-text-area ref={notesRef} label="Notes" name="notes" form={FORM_ID} rows="4"
          defaultValue={liveRate.notes ?? ""}
          placeholder="Internal notes, not visible to customers."></s-text-area>
      </s-section>

      {/* ── Carrier credentials modal ── */}
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

      {/* ── Add package modal ── */}
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

      {/* ── Delete confirmation modal ── */}
      <s-modal id={DEL_MODAL_ID} heading="Delete live carrier rate?">
        <s-text>This will permanently delete "{liveRate.name}". This can't be undone.</s-text>
        <Form method="post" id={DEL_FORM_ID}>
          <input type="hidden" name="intent" value="delete" />
        </Form>
        <s-button slot="secondary-actions" commandFor={DEL_MODAL_ID} command="--hide">Cancel</s-button>
        <s-button slot="primary-actions" variant="primary" tone="critical"
          onClick={() => document.getElementById(DEL_FORM_ID)?.requestSubmit()}>Delete</s-button>
      </s-modal>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
