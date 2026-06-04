//app.test.jsx
import { Form } from "react-router"
import { useState } from "react";
 export async function loader() {
    const response = await fetch("https://dummyjson.com/products");
    return response.json();
  }
  
export default function AdditionalPage() {

  const saveBarId = 'settings-save-bar';
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const handleFieldInput = () => {
    if (!hasUnsavedChanges) {
      setHasUnsavedChanges(true);
      shopify.saveBar.show(saveBarId);
    }
  };

  const handleDiscard = () => {
    setHasUnsavedChanges(false);
    shopify.saveBar.hide(saveBarId);
  };

  const handleSave = async () => {
    // Save to your backend
    setHasUnsavedChanges(false);
    shopify.saveBar.hide(saveBarId);
  };
 
  return (
    <s-page heading="Test Page">
        <s-section slot="aside" heading="Testing">
            <Form method="post" data-save-bar
                onSubmit="console.log('submit');"
                onReset="console.log('reset');">
                <s-text-field label="Name" name="name"></s-text-field>
                <s-button type="submit">Submit</s-button>
                <s-button type="reset">Reset</s-button>
            </Form>
         
        </s-section>
      <s-section heading="Multiple pages">
        <s-paragraph>
          The app template comes with an additional page which demonstrates how
          to create multiple pages within app navigation using{" "}
          <s-link
            href="https://shopify.dev/docs/apps/tools/app-bridge"
            target="_blank"
          >
            App Bridge
          </s-link>
          .
        </s-paragraph>
        <s-paragraph>
          To create your own page and have it show up in the app navigation, add
          a page inside <code>app/routes</code>, and a link to it in the{" "}
          <code>&lt;ui-nav-menu&gt;</code> component found in{" "}
          <code>app/routes/app.jsx</code>.
        </s-paragraph>
      </s-section>
      <s-section slot="aside" heading="Resources">
        <s-unordered-list>
          <s-list-item>
            <s-link
              href="https://shopify.dev/docs/apps/design-guidelines/navigation#app-nav"
              target="_blank"
            >
              App nav best practices
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section padding="none" accessibilityLabel="Puzzles table section">
  <s-table>
    <s-grid slot="filters" gap="small-200" gridTemplateColumns="1fr auto">
      <s-text-field
        label="Search puzzles"
        labelAccessibilityVisibility="exclusive"
        icon="search"
        placeholder="Searching all puzzles"
       />
      <s-button
        icon="sort"
        variant="secondary"
        accessibilityLabel="Sort"
        interestFor="sort-tooltip"
        commandFor="sort-actions"
       />
      <s-tooltip id="sort-tooltip">
        <s-text>Sort</s-text>
      </s-tooltip>
      <s-popover id="sort-actions">
        <s-stack gap="none">
          <s-box padding="small">
            <s-choice-list label="Sort by" name="Sort by">
              <s-choice value="puzzle-name" selected>
                Puzzle name
              </s-choice>
              <s-choice value="pieces">Pieces</s-choice>
              <s-choice value="created">Created</s-choice>
              <s-choice value="status">Status</s-choice>
            </s-choice-list>
          </s-box>
          <s-divider />
          <s-box padding="small">
            <s-choice-list label="Order by" name="Order by">
              <s-choice value="product-title" selected>
                A-Z
              </s-choice>
              <s-choice value="created">Z-A</s-choice>
            </s-choice-list>
          </s-box>
        </s-stack>
      </s-popover>
    </s-grid>
    <s-table-header-row>
      <s-table-header listSlot="primary">Puzzle</s-table-header>
      <s-table-header format="numeric">Pieces</s-table-header>
      <s-table-header>Created</s-table-header>
      <s-table-header listSlot="secondary">Status</s-table-header>
    </s-table-header-row>
    <s-table-body>
      <s-table-row clickDelegate="mountain-view-checkbox">
        <s-table-cell>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-checkbox id="mountain-view-checkbox" />
            <s-clickable
              href=""
              accessibilityLabel="Mountain View puzzle thumbnail"
              border="base"
              borderRadius="base"
              overflow="hidden"
              inlineSize="40px"
              blockSize="40px"
            >
              <s-image
                objectFit="cover"
                src="https://picsum.photos/id/29/80/80"
               />
            </s-clickable>
            <s-link href="">Mountain View</s-link>
          </s-stack>
        </s-table-cell>
        <s-table-cell>16</s-table-cell>
        <s-table-cell>Today</s-table-cell>
        <s-table-cell>
          <s-badge color="base" tone="success">
            Active
          </s-badge>
        </s-table-cell>
      </s-table-row>
      <s-table-row clickDelegate="ocean-sunset-checkbox">
        <s-table-cell>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-checkbox id="ocean-sunset-checkbox" />
            <s-clickable
              href=""
              accessibilityLabel="Ocean Sunset puzzle thumbnail"
              border="base"
              borderRadius="base"
              overflow="hidden"
              inlineSize="40px"
              blockSize="40px"
            >
              <s-image
                objectFit="cover"
                src="https://picsum.photos/id/12/80/80"
               />
            </s-clickable>
            <s-link href="">Ocean Sunset</s-link>
          </s-stack>
        </s-table-cell>
        <s-table-cell>9</s-table-cell>
        <s-table-cell>Yesterday</s-table-cell>
        <s-table-cell>
          <s-badge color="base" tone="success">
            Active
          </s-badge>
        </s-table-cell>
      </s-table-row>
      <s-table-row clickDelegate="forest-animals-checkbox">
        <s-table-cell>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-checkbox id="forest-animals-checkbox" />
            <s-clickable
              href=""
              accessibilityLabel="Forest Animals puzzle thumbnail"
              border="base"
              borderRadius="base"
              overflow="hidden"
              inlineSize="40px"
              blockSize="40px"
            >
              <s-image
                objectFit="cover"
                src="https://picsum.photos/id/324/80/80"
               />
            </s-clickable>
            <s-link href="">Forest Animals</s-link>
          </s-stack>
        </s-table-cell>
        <s-table-cell>25</s-table-cell>
        <s-table-cell>Last week</s-table-cell>
        <s-table-cell>
          <s-badge color="base" tone="neutral">
            Draft
          </s-badge>
        </s-table-cell>
      </s-table-row>
    </s-table-body>
  </s-table>
</s-section>

<s-section padding="none">
  <s-stack gap="small-200">
    <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center" paddingInline="base" paddingBlockStart="base">
      <s-text-field icon="search" placeholder="Filter products"></s-text-field>
      <s-button
        onClick={async () => {
          const selected = await shopify.resourcePicker({
            type: 'product',
            multiple: true,
          });
          if (selected) {
            console.log('Selected products:', selected);
          }
        }}
      >
        Add products
      </s-button>
    </s-grid>
    
    <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center" paddingInline="base">
      <s-text>Showing 2 products</s-text>
      <s-select>
        <s-option value="newest">Newest</s-option>
        <s-option value="oldest">Oldest</s-option>
      </s-select>
    </s-grid>
    
    <s-stack>
      <s-clickable borderStyle="solid none none none" border="base" paddingInline="base" paddingBlock="small">
        <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
          <s-thumbnail
            size="small"
            src="https://picsum.photos/id/29/80/80"
            alt="Mountain View puzzle"
          />
          <s-stack>
            <s-heading>Mountain View</s-heading>
            <s-text>16 pieces</s-text>
          </s-stack>
          <s-button icon="menu-horizontal" variant="tertiary" accessibilityLabel="Actions for Mountain View" />
        </s-grid>
      </s-clickable>
      <s-clickable borderStyle="solid none none none" border="base" paddingInline="base" paddingBlock="small">
        <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
          <s-thumbnail
            size="small"
            src="https://picsum.photos/id/12/80/80"
            alt="Ocean Sunset puzzle"
          />
          <s-stack>
            <s-heading>Ocean Sunset</s-heading>
            <s-text>9 pieces</s-text>
          </s-stack>
          <s-button icon="menu-horizontal" variant="tertiary" accessibilityLabel="Actions for Ocean Sunset" />
        </s-grid>
      </s-clickable>
    </s-stack>
  </s-stack>
</s-section>


        <ui-save-bar id={saveBarId}>
            <button variant="primary" onClick={handleSave}>Save</button>
            <button onClick={handleDiscard}>Discard</button>
          </ui-save-bar>
          <s-section heading="Configuration">
            <s-text-field
              label="Store name"
              onInput={handleFieldInput}
            />
          </s-section>

          <s-modal id="my-modal">
  <s-text>Hello, World!</s-text>
</s-modal>

<s-button onClick="shopify.modal.toggle('my-modal')">
  Toggle Modal
</s-button>
    </s-page>
  );
}
