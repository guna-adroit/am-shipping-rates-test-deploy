import { useState, useRef } from "react";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getProducts, saveProducts } from "../db.server";

// ── Loader ─────────────────────────────────────────────────────────────────
export async function loader({ request }) {
  await authenticate.admin(request);

  const products = getProducts();
  return { products };
}

// ── Action ─────────────────────────────────────────────────────────────────
export async function action({ request }) {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save") {
    const products = JSON.parse(formData.get("products"));
    const saved = saveProducts(products);
    return { success: true, message: `${saved.length} product(s) saved.`, products: saved };
  }

  if (intent === "remove") {
    const id = formData.get("productId");
    const updated = saveProducts(getProducts().filter((p) => p.id !== id));
    return { success: true, message: "Product removed.", products: updated };
  }

  if (intent === "clear") {
    saveProducts([]);
    return { success: true, message: "All products cleared.", products: [] };
  }

  return { success: false, message: "Unknown action." };
}

// ── Helpers ────────────────────────────────────────────────────────────────
function statusTone(status) {
  switch (status) {
    case "ACTIVE":   return "success";
    case "DRAFT":    return "info";
    case "ARCHIVED": return "default";
    default:         return "default";
  }
}

function inventoryTone(qty) {
  if (qty === 0)   return "critical";
  if (qty <= 10)   return "warning";
  return "success";
}

// ── Page Component ─────────────────────────────────────────────────────────
export default function ProductsPage() {
  const { products: loaderProducts } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();

  const isSubmitting = navigation.state === "submitting";

  // Merge: action result wins over loader data
  const savedProducts = actionData?.products ?? loaderProducts;

  // pendingProducts = picked but not yet saved
  const [pendingProducts, setPendingProducts] = useState(null);
  const displayProducts = pendingProducts ?? savedProducts;

  const hasUnsaved = pendingProducts !== null;

  // Ref to the hidden save form
  const saveFormRef = useRef(null);

  // ── Resource Picker ──────────────────────────────────────────────────────
  async function openPicker() {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      action: "select",
      filter: { draft: false, archived: false, variants: false },
      selectionIds: displayProducts.map((p) => ({ id: p.id })),
    });

    if (selected) {
      setPendingProducts(selected);
    }
  }

  function handleSave() {
    saveFormRef.current.elements["products"].value =
      JSON.stringify(pendingProducts);
    saveFormRef.current.requestSubmit();
    setPendingProducts(null);
  }

  return (
    <>
      {/* ── Toast ── */}
      {actionData?.success && (
        <s-toast>{actionData.message}</s-toast>
      )}

      {/* ── Title bar ── */}
      <TitleBar title="Products">
        {hasUnsaved && (
          <button onClick={handleSave} loading={isSubmitting}>
            Save
          </button>
        )}
        <button onClick={openPicker} variant="primary">
          {displayProducts.length > 0 ? "Edit Selection" : "Select Products"}
        </button>
      </TitleBar>

      {/* ── Hidden save form ── */}
      <Form method="post" ref={saveFormRef} style={{ display: "none" }}>
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="products" value="" />
      </Form>

      <s-page heading="Products">

        {/* ── Unsaved banner ── */}
        {hasUnsaved && (
          <s-section>
            <s-banner tone="warning">
              You have unsaved changes.
              <s-button slot="action" onClick={handleSave} loading={isSubmitting}>
                Save now
              </s-button>
            </s-banner>
          </s-section>
        )}

        {displayProducts.length === 0 ? (

          /* ── Empty state ── */
          <s-section>
            <s-empty-state
              heading="No products selected"
              description="Select products from your store catalog to get started."
            >
              <s-button
                slot="primary-action"
                variant="primary"
                onClick={openPicker}
              >
                Select Products
              </s-button>
            </s-empty-state>
          </s-section>

        ) : (

          /* ── Table ── */
          <s-section
            heading={`${displayProducts.length} product${displayProducts.length !== 1 ? "s" : ""}`}
            padding="none"
          >
            {/* Toolbar above table */}
            <s-box padding="base" padding-block-end="none">
              <s-inline gap="base" align-items="center">
                <s-button variant="primary" onClick={openPicker}>
                  Edit Selection
                </s-button>

                {hasUnsaved && (
                  <s-button onClick={handleSave} loading={isSubmitting}>
                    Save Changes
                  </s-button>
                )}

                <Form method="post">
                  <input type="hidden" name="intent" value="clear" />
                  <s-button
                    tone="critical"
                    variant="plain"
                    loading={isSubmitting}
                    onClick={(e) => {
                      setPendingProducts(null);
                      e.currentTarget.closest("form").requestSubmit();
                    }}
                  >
                    Clear All
                  </s-button>
                </Form>
              </s-inline>
            </s-box>

            <s-table loading={isSubmitting}>
                    
              {/* ── Column headers ── */}
              <s-table-header-row>
                <s-table-header listSlot="primary">
                  Product
                </s-table-header>
                <s-table-header listSlot="inline">
                  Status
                </s-table-header>
                <s-table-header listSlot="labeled">
                  Vendor
                </s-table-header>
                <s-table-header listSlot="labeled" format="numeric">
                  Variants
                </s-table-header>
                <s-table-header listSlot="labeled" format="numeric">
                  Inventory
                </s-table-header>
                <s-table-header listSlot="labeled">
                  Actions
                </s-table-header>
              </s-table-header-row>

              {/* ── Rows ── */}
              <s-table-body>
                {displayProducts.map((product) => (
                  <s-table-row key={product.id}>

                    {/* Product name + thumbnail */}
                    <s-table-cell>
                      <s-inline gap="base" align-items="center">
                        <s-thumbnail
                          src={product.images?.[0]?.src ?? ""}
                          alt={product.title}
                          size="small"
                        />
                        <s-text font-weight="semibold">
                          {product.title}
                        </s-text>
                      </s-inline>
                    </s-table-cell>

                    {/* Status badge */}
                    <s-table-cell>
                      <s-badge tone={statusTone(product.status)}>
                        {product.status}
                      </s-badge>
                    </s-table-cell>

                    {/* Vendor */}
                    <s-table-cell>
                      <s-text tone="subdued">{product.vendor}</s-text>
                    </s-table-cell>

                    {/* Variants count */}
                    <s-table-cell>
                      {product.totalVariants}
                    </s-table-cell>

                    {/* Inventory with tone */}
                    <s-table-cell>
                      <s-badge tone={inventoryTone(product.totalInventory)}>
                        {product.totalInventory ?? "—"}
                      </s-badge>
                    </s-table-cell>

                    {/* Remove action */}
                    <s-table-cell>
                      <Form method="post">
                        <input type="hidden" name="intent" value="remove" />
                        <input type="hidden" name="productId" value={product.id} />
                        <s-button
                          tone="critical"
                          variant="plain"
                          loading={isSubmitting}
                          onClick={(e) => {
                            if (pendingProducts) {
                              // Remove from local pending without a round-trip
                              setPendingProducts((prev) =>
                                prev.filter((p) => p.id !== product.id)
                              );
                            } else {
                              e.currentTarget.closest("form").requestSubmit();
                            }
                          }}
                        >
                          Remove
                        </s-button>
                      </Form>
                    </s-table-cell>

                  </s-table-row>
                ))}
              </s-table-body>

            </s-table>
          </s-section>
        )}
      </s-page>
    </>
  );
}