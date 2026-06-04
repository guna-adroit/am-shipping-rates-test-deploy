import { redirect, data } from "react-router";
import { Form, useActionData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createZone } from "../models/zone.server";

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const name = formData.get("name")?.toString().trim() ?? "";
  const zipCodes = formData.get("zipCodes")?.toString().trim() ?? "";
  const status = formData.get("status")?.toString() ?? "enabled";

  const errors = {};
  if (!name) errors.name = "Zone name is required";
  if (!zipCodes) errors.zipCodes = "At least one zip code is required";

  if (Object.keys(errors).length) {
    // Pass submitted values back so fields stay filled on error
    return data({ errors, values: { name, zipCodes, status } }, { status: 400 });
  }

  const zone = await createZone(session.shop, { name, zipCodes, status });
  return redirect(`/app/zones/${zone.id}`);
};

export default function NewZonePage() {
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const FORM_ID = "create-zone-form";

  return (
    <s-page heading="Create a zone">
      {/* Page-level actions rendered in Shopify admin header */}
      <s-button
        slot="primary-action"
        variant="primary"
        {...(isSaving ? { loading: true } : {})}
        onClick={() => document.getElementById(FORM_ID)?.requestSubmit()}
      >
        Save
      </s-button>
      <s-link slot="secondary-actions" href="/app/zones">Cancel</s-link>

      {/* Form — web components with name="" participate in native form submission */}
      <Form method="post" id={FORM_ID}>
        {/* Zone details section */}
        <s-section heading="Zone details">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Give your zone a name and specify which zip codes are included.
              Once you've created your zone you will be able to add rates.
            </s-paragraph>

            <s-text-field
              label="Zone name"
              name="name"
              value={actionData?.values?.name ?? ""}
              help-text="This is for internal use only and will not be visible to your customers."
              error-message={actionData?.errors?.name ?? ""}
              required
            ></s-text-field>

            <s-text-area
              label="Zip codes"
              name="zipCodes"
              value={actionData?.values?.zipCodes ?? ""}
              rows="4"
              help-text="Separate eligible postal codes with a comma. Overlapping postal codes are not supported—each location needs a unique set."
              error-message={actionData?.errors?.zipCodes ?? ""}
              required
              placeholder="e.g. 10001, 10002, 90210"
            ></s-text-area>

            <s-select
              label="Zone status"
              name="status"
              value={actionData?.values?.status ?? "enabled"}
            >
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </s-select>
                        <s-select
            label="Product category"
            placeholder="Choose category for better organization"
            >
            <s-option value="clothing">Clothing & apparel</s-option>
            <s-option value="accessories">Accessories & jewelry</s-option>
            <s-option value="home-garden">Home & garden</s-option>
            <s-option value="electronics">Electronics & tech</s-option>
            <s-option value="books">Books & media</s-option>
            </s-select>
          </s-stack>
        </s-section>
        <br /><br />

        {/* Rates aside — shown after zone is saved */}
        <s-section slot="aside" heading="Rates">
          <s-paragraph>
            Choose between price and weight-based rates. You'll be able to add
            rates as soon as you create this zone.
          </s-paragraph>
        </s-section>
      </Form>
      
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
