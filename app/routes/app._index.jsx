import { useEffect, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const color = ["Red", "Orange", "Yellow", "Green"][
    Math.floor(Math.random() * 4)
  ];

  const response = await admin.graphql(
    `#graphql
      mutation populateProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            handle
            status
            variants(first: 10) {
              edges {
                node {
                  id
                  price
                  barcode
                  createdAt
                }
              }
            }
          }
        }
      }`,
    {
      variables: {
        product: {
          title: `${color} Snowboard`,
        },
      },
    }
  );

  const responseJson = await response.json();

  const product = responseJson.data.productCreate.product;
  const variantId = product.variants.edges[0].node.id;

  const variantResponse = await admin.graphql(
    `#graphql
    mutation shopifyReactRouterTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
          barcode
          createdAt
        }
      }
    }`,
    {
      variables: {
        productId: product.id,
        variants: [{ id: variantId, price: "100.00" }],
      },
    }
  );

  const variantResponseJson = await variantResponse.json();

  return {
    product: responseJson.data.productCreate.product,
    variant:
      variantResponseJson.data.productVariantsBulkUpdate.productVariants,
  };
};

export default function Index() {
  const fetcher = useFetcher();
  const navigate = useNavigate();

  const shopify = useAppBridge();

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.product?.id) {
      shopify.toast.show("Product created");
    }
  }, [fetcher.data?.product?.id, shopify]);

  const generateProduct = () => {
    fetcher.submit({}, { method: "POST" });
  };

  const [expanded, setExpanded] = useState({
  guide: true,
  step1: true,
  step2: false,
  step3: false,
});

  return (
    <s-page heading="AM Shipping Rates">
      <s-button slot="primary-action" onClick={() => navigate("/app/zones/new")}>
        Create a zone
      </s-button>

      <s-section>
        <s-grid gap="base">
          <s-grid gap="small-200">
            <s-grid
              gridTemplateColumns="1fr auto auto"
              gap="small-300"
              alignItems="center"
            >
              <s-heading>Setup Guide</s-heading>
              <s-button
                accessibilityLabel="Dismiss Guide"
                variant="tertiary"
                tone="neutral"
                icon="x"
              />
              <s-button
                accessibilityLabel="Toggle setup guide"
                variant="tertiary"
                tone="neutral"
                onClick={() => setExpanded({ ...expanded, guide: !expanded.guide })}
                icon={expanded.guide ? "chevron-up" : "chevron-down"}
              />
            </s-grid>
            <s-paragraph>
              Use this personalized guide to get your store ready for sales.
            </s-paragraph>
            <s-paragraph color="subdued">0 out of 3 steps completed</s-paragraph>
          </s-grid>
          <s-box
            borderRadius="base"
            border="base"
            background="base"
            display={expanded.guide ? "auto" : "none"}
          >
            <s-box>
              <s-grid gridTemplateColumns="1fr auto" gap="base" padding="small">
                <s-checkbox label="Upload an image for your puzzle" />
                <s-button
                  accessibilityLabel="Toggle step 1 details"
                  variant="tertiary"
                  onClick={() => setExpanded({ ...expanded, step1: !expanded.step1 })}
                  icon={expanded.step1 ? "chevron-up" : "chevron-down"}
                />
              </s-grid>
              <s-box
                padding="small"
                paddingBlockStart="none"
                display={expanded.step1 ? "auto" : "none"}
              >
                <s-box padding="base" background="subdued" borderRadius="base">
                  <s-grid
                    gridTemplateColumns="1fr auto"
                    gap="base"
                    alignItems="center"
                  >
                    <s-grid gap="small-200">
                      <s-paragraph>
                        Start by uploading a high-quality image that will be used to
                        create your puzzle. For best results, use images that are at
                        least 1200x1200 pixels.
                      </s-paragraph>
                      <s-stack direction="inline" gap="small-200">
                        <s-button variant="primary">Upload image</s-button>
                        <s-button variant="tertiary" tone="neutral">
                          {" "}
                          Image requirements{" "}
                        </s-button>
                      </s-stack>
                    </s-grid>
                    <s-box maxBlockSize="80px" maxInlineSize="80px">
                      <s-image
                        src="https://cdn.shopify.com/s/assets/admin/checkout/settings-customizecart-705f57c725ac05be5a34ec20c05b94298cb8afd10aac7bd9c7ad02030f48cfa0.svg"
                        alt="Customize checkout illustration"
                      />
                    </s-box>
                  </s-grid>
                </s-box>
              </s-box>
            </s-box>
            <s-divider />
            <s-box>
              <s-grid gridTemplateColumns="1fr auto" gap="base" padding="small">
                <s-checkbox label="Choose a puzzle template" />
                <s-button
                  accessibilityLabel="Toggle step 2 details"
                  variant="tertiary"
                  onClick={() => setExpanded({ ...expanded, step2: !expanded.step2 })}
                  icon={expanded.step2 ? "chevron-up" : "chevron-down"}
                />
              </s-grid>
              <s-box
                padding="small"
                paddingBlockStart="none"
                display={expanded.step2 ? "auto" : "none"}
              >
                <s-box padding="base" background="subdued" borderRadius="base">
                  <s-grid
                    gridTemplateColumns="1fr auto"
                    gap="base"
                    alignItems="center"
                  >
                    <s-grid gap="small-200">
                      <s-paragraph>
                        Choose from our library of puzzle templates including classic
                        jigsaw, hexagonal, and irregular shapes.
                      </s-paragraph>
                      <s-stack direction="inline" gap="small-200">
                        <s-button variant="primary">Browse templates</s-button>
                      </s-stack>
                    </s-grid>
                    <s-box maxBlockSize="80px" maxInlineSize="80px">
                      <s-image
                        src="https://cdn.shopify.com/s/assets/admin/checkout/settings-customizecart-705f57c725ac05be5a34ec20c05b94298cb8afd10aac7bd9c7ad02030f48cfa0.svg"
                        alt="Template selection illustration"
                      />
                    </s-box>
                  </s-grid>
                </s-box>
              </s-box>
            </s-box>
            <s-divider />
            <s-box>
              <s-grid gridTemplateColumns="1fr auto" gap="base" padding="small">
                <s-checkbox label="Customize puzzle piece shapes" />
                <s-button
                  accessibilityLabel="Toggle step 3 details"
                  variant="tertiary"
                  onClick={() => setExpanded({ ...expanded, step3: !expanded.step3 })}
                  icon={expanded.step3 ? "chevron-up" : "chevron-down"}
                />
              </s-grid>
              <s-box
                padding="small"
                paddingBlockStart="none"
                display={expanded.step3 ? "auto" : "none"}
              >
                <s-box padding="base" background="subdued" borderRadius="base">
                  <s-grid
                    gridTemplateColumns="1fr auto"
                    gap="base"
                    alignItems="center"
                  >
                    <s-grid gap="small-200">
                      <s-paragraph>
                        Fine-tune the shape and interlocking style of your puzzle
                        pieces for a unique experience.
                      </s-paragraph>
                      <s-stack direction="inline" gap="small-200">
                        <s-button variant="primary">Customize shapes</s-button>
                      </s-stack>
                    </s-grid>
                    <s-box maxBlockSize="80px" maxInlineSize="80px">
                      <s-image
                        src="https://cdn.shopify.com/s/assets/admin/checkout/settings-customizecart-705f57c725ac05be5a34ec20c05b94298cb8afd10aac7bd9c7ad02030f48cfa0.svg"
                        alt="Customization illustration"
                      />
                    </s-box>
                  </s-grid>
                </s-box>
              </s-box>
            </s-box>
          </s-box>
        </s-grid>
      </s-section>

      <s-section padding="base">
        <s-grid
          gridTemplateColumns="@container (inline-size <= 400px) 1fr, 1fr auto 1fr"
          gap="small"
        >
          <s-clickable
            href=""
            paddingBlock="small-400"
            paddingInline="small-100"
            borderRadius="base"
          >
            <s-grid gap="small-300">
              <s-heading>Rate calculations</s-heading>
              <s-text>The total number of rates calculated in checkout</s-text>
              <s-stack direction="inline" gap="small-200" paddingBlock="large">
                <s-text>156 
                </s-text>
                <s-badge tone="success" icon="arrow-up">
                  {" "}
                  12%{" "}
                </s-badge>
              </s-stack>
            </s-grid>
          </s-clickable>
          <s-divider direction="block" />
          <s-clickable
            href=""
            paddingBlock="small-400"
            paddingInline="small-100"
            borderRadius="base"
          >
            <s-grid gap="small-300">
              <s-heading>Response time</s-heading>
              <s-text>The average time it takes to calculate rates in checkout</s-text>
              <s-stack direction="inline" gap="small-200" paddingBlock="large">
                <s-text>2,847 
                </s-text>
                <s-badge tone="critical" icon="arrow-down">
                  {" "}
                  0.8%{" "}
                </s-badge>
              </s-stack>
            </s-grid>
          </s-clickable>
        </s-grid>
      </s-section>

      <s-section heading="Congrats on creating a new Shopify app 🎉">
        <s-paragraph>
          This embedded app template uses{" "}
          <s-link
            href="https://shopify.dev/docs/apps/tools/app-bridge"
            target="_blank"
          >
            App Bridge
          </s-link>{" "}
          interface examples like an{" "}
          <s-link href="/app/additional">additional page in the app nav</s-link>
          , as well as an{" "}
          <s-link
            href="https://shopify.dev/docs/api/admin-graphql"
            target="_blank"
          >
            Admin GraphQL
          </s-link>{" "}
          mutation demo, to provide a starting point for app development.
        </s-paragraph>
      </s-section>

      <s-section heading="Get started with products">
        <s-paragraph>
          Generate a product with GraphQL and get the JSON output for that
          product. Learn more about the{" "}
          <s-link
            href="https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate"
            target="_blank"
          >
            productCreate
          </s-link>{" "}
          mutation in our API references.
        </s-paragraph>

        <s-stack direction="inline" gap="base">
          <s-button
            onClick={generateProduct}
            {...(isLoading ? { loading: true } : {})}
          >
            Generate a product
          </s-button>

          {fetcher.data?.product && (
            <s-button
              onClick={() => {
                shopify.intents.invoke?.("edit:shopify/Product", {
                  value: fetcher.data?.product?.id,
                });
              }}
              target="_blank"
              variant="tertiary"
            >
              Edit product
            </s-button>
          )}
        </s-stack>

        {fetcher.data?.product && (
          <s-section heading="productCreate mutation">
            <s-stack direction="block" gap="base">
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <pre style={{ margin: 0 }}>
                  <code>
                    {JSON.stringify(fetcher.data.product, null, 2)}
                  </code>
                </pre>
              </s-box>

              <s-heading>productVariantsBulkUpdate mutation</s-heading>

              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <pre style={{ margin: 0 }}>
                  <code>
                    {JSON.stringify(fetcher.data.variant, null, 2)}
                  </code>
                </pre>
              </s-box>
            </s-stack>
          </s-section>
        )}
      </s-section>

      {/* <s-section slot="aside" heading="App template specs">
        <s-paragraph>
          <s-text>Framework: </s-text>

          <s-link href="https://reactrouter.com/" target="_blank">
            React Router
          </s-link>
        </s-paragraph>

        <s-paragraph>
          <s-text>Interface: </s-text>

          <s-link
            href="https://shopify.dev/docs/api/app-home/using-polaris-components"
            target="_blank"
          >
            Polaris web components
          </s-link>
        </s-paragraph>

        <s-paragraph>
          <s-text>API: </s-text>

          <s-link
            href="https://shopify.dev/docs/api/admin-graphql"
            target="_blank"
          >
            GraphQL
          </s-link>
        </s-paragraph>

        <s-paragraph>
          <s-text>Database: </s-text>

          <s-link href="https://www.prisma.io/" target="_blank">
            Prisma
          </s-link>
        </s-paragraph>
      </s-section> */}

      {/* <s-section slot="aside" heading="Next steps">
        <s-unordered-list>
          <s-list-item>
            Build an{" "}
            <s-link
              href="https://shopify.dev/docs/apps/getting-started/build-app-example"
              target="_blank"
            >
              example app
            </s-link>
          </s-list-item>

          <s-list-item>
            Explore Shopify&apos;s API with{" "}
            <s-link
              href="https://shopify.dev/docs/apps/tools/graphiql-admin-api"
              target="_blank"
            >
              GraphiQL
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section> */}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};