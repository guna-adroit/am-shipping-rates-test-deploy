import { data, redirect } from "react-router";
import { Form, useLoaderData, useNavigation, useActionData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getCarrierServiceStatusFull,
  reRegisterCarrierService,
} from "../carrier.server";

// ─────────────────────────────────────────────────────────────────────────────
// Loader — live check against Shopify
// ─────────────────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const status = await getCarrierServiceStatusFull(admin, session.shop);
  // Pass appUrl from server-side env — process.env is undefined in client-side JSX
  const appUrl = process.env.SHOPIFY_APP_URL ?? null;
  return { status, shop: session.shop, appUrl };
};

// ─────────────────────────────────────────────────────────────────────────────
// Action
// ─────────────────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent   = formData.get("intent");

  if (intent === "register" || intent === "reregister") {
    try {
      await reRegisterCarrierService(admin, session.shop);
      return data({ success: true, message: "Carrier service registered successfully." });
    } catch (e) {
      return data({ success: false, message: e.message }, { status: 400 });
    }
  }

  return redirect("/app/settings");
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { status, shop, appUrl } = useLoaderData();
  const actionData       = useActionData();
  const navigation       = useNavigation();
  const isSubmitting     = navigation.state === "submitting";

  const isActive        = status.status === "active";
  const needsRegister   = status.status === "not_registered" || status.status === "deleted_in_shopify";
  const needsReregister = status.status === "url_mismatch";

  // Derive badge tone + label
  const badgeTone = isActive ? "success" : needsRegister ? "critical" : "warning";
  const badgeLabel = {
    active:            "Active",
    not_registered:    "Not registered",
    deleted_in_shopify:"Deleted in Shopify",
    url_mismatch:      "URL mismatch",
  }[status.status] ?? status.status;

  return (
    <s-page heading="Settings">
      <s-link slot="breadcrumb-actions" href="/app/zones">Scenarios</s-link>

      {/* ── Action result banner ── */}
      {actionData?.success === true && (
        <s-banner tone="success" heading="Carrier service registered">
          <s-text>The carrier service is now active and will provide rates at checkout.</s-text>
        </s-banner>
      )}
      {actionData?.success === false && (
        <s-banner tone="critical" heading="Registration failed">
          <s-text>{actionData.message}</s-text>
        </s-banner>
      )}

      {/* ── Carrier Service Registration ── */}
      <s-section heading="Carrier Service Registration">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            The carrier service connects your app to Shopify's checkout. When
            a customer checks out, Shopify calls this service to retrieve
            shipping rates based on your scenarios.
          </s-paragraph>

          {/* Status row */}
          <div style={{
            border: "1px solid #e1e3e5",
            borderRadius: "8px",
            padding: "16px",
          }}>
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base" style={{ alignItems: "center", justifyContent: "space-between" }}>
                <s-stack direction="block" gap="extra-small">
                  <s-text><strong>Registration status</strong></s-text>
                  <s-text tone="subdued" style={{ fontSize: "13px" }}>
                    Shop: {shop}
                  </s-text>
                </s-stack>
                <s-badge tone={badgeTone}>{badgeLabel}</s-badge>
              </s-stack>

              {/* Description */}
              <s-text tone={isActive ? "subdued" : "caution"} style={{ fontSize: "13px" }}>
                {status.description}
              </s-text>

              {/* Callback URL */}
              <s-stack direction="block" gap="extra-small">
                <s-text tone="subdued" style={{ fontSize: "12px" }}>
                  <strong>Callback URL</strong>
                </s-text>
                <div style={{
                  background: "#f6f6f7",
                  borderRadius: "6px",
                  padding: "8px 12px",
                  fontFamily: "monospace",
                  fontSize: "13px",
                  wordBreak: "break-all",
                }}>
                  {status.callbackUrl}
                </div>
              </s-stack>

              {/* Service ID */}
              {status.serviceId && (
                <s-stack direction="block" gap="extra-small">
                  <s-text tone="subdued" style={{ fontSize: "12px" }}>
                    <strong>Shopify Service ID</strong>
                  </s-text>
                  <div style={{
                    background: "#f6f6f7",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    fontFamily: "monospace",
                    fontSize: "13px",
                  }}>
                    {status.serviceId}
                  </div>
                </s-stack>
              )}
            </s-stack>
          </div>

          {/* Register / Re-register button */}
          <Form method="post">
            {needsRegister && (
              <>
                <input type="hidden" name="intent" value="register" />
                <s-button
                  type="submit"
                  variant="primary"
                  icon="plus-circle"
                  {...(isSubmitting ? { loading: true } : {})}
                >
                  Register carrier service
                </s-button>
              </>
            )}

            {(needsReregister || isActive) && (
              <>
                <input type="hidden" name="intent" value="reregister" />
                <s-stack direction="inline" gap="small">
                  {isActive && (
                    <s-text tone="subdued" style={{ fontSize: "13px", paddingTop: "6px" }}>
                      ✓ Carrier service is working correctly.
                    </s-text>
                  )}
                  <s-button
                    type="submit"
                    variant={needsReregister ? "primary" : "secondary"}
                    {...(isSubmitting ? { loading: true } : {})}
                  >
                    Re-register carrier service
                  </s-button>
                </s-stack>
              </>
            )}
          </Form>

          {/* Help text */}
          <s-text tone="subdued" style={{ fontSize: "13px" }}>
            If you manually deleted the carrier service from Shopify's Shipping
            Settings, click <strong>Register carrier service</strong> to restore it.
            In development, if your tunnel URL changed, use{" "}
            <strong>Re-register</strong> to update the callback URL.
          </s-text>
        </s-stack>
      </s-section>

      {/* ── App Info ── */}
      <s-section heading="App information" slot="aside">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="extra-small">
            <s-text tone="subdued" style={{ fontSize: "12px" }}>App</s-text>
            <s-text><strong>AM Shipping Rates</strong></s-text>
          </s-stack>
          <s-stack direction="block" gap="extra-small">
            <s-text tone="subdued" style={{ fontSize: "12px" }}>Shop</s-text>
            <s-text>{shop}</s-text>
          </s-stack>
          <s-stack direction="block" gap="extra-small">
            <s-text tone="subdued" style={{ fontSize: "12px" }}>App URL</s-text>
            <s-text style={{ fontSize: "12px", wordBreak: "break-all" }}>
              {appUrl ?? "Not set"}
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);