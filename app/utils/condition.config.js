// ─────────────────────────────────────────────────────────────────────────────
// CONDITION BUILDER CONFIG
// Shared between app.zones.new.jsx and app.zones.$zoneId._index.jsx
// ─────────────────────────────────────────────────────────────────────────────
//
// Import like:  import { CONDITION_CATEGORIES, ATTRIBUTES_BY_CATEGORY, ... }

export const CONDITION_CATEGORIES = [
  { value: "cart",     label: "Cart" },
  { value: "product",  label: "Product" },
  { value: "customer", label: "Customer" },
];

export const ATTRIBUTES_BY_CATEGORY = {
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

export const TEXT_OPERATORS = [
  { value: "equals",       label: "Equals to" },
  { value: "not_equals",   label: "Does not equal" },
  { value: "contains",     label: "Contains" },
  { value: "not_contains", label: "Does not contain" },
];

export const NUMERIC_OPERATORS = [
  { value: "equals",                 label: "Equals to" },
  { value: "not_equals",             label: "Does not equal" },
  { value: "greater_than",           label: "Greater than" },
  { value: "less_than",              label: "Less than" },
  { value: "greater_than_or_equals", label: "Greater than or equals to" },
  { value: "less_than_or_equals",    label: "Less than or equals to" },
  { value: "between",                label: "Between" },
];

// Zip code operators
export const ZIPCODE_OPERATORS = [
  { value: "equals",     label: "Equals to" },
  { value: "not_equals", label: "Does not equal" },
];

export function getAttributesByCategory(category) {
  return ATTRIBUTES_BY_CATEGORY[category] ?? ATTRIBUTES_BY_CATEGORY.cart;
}

export function getAttrMeta(category, attribute) {
  return getAttributesByCategory(category).find((a) => a.value === attribute) ?? null;
}

export function getOperatorsForAttr(category, attribute) {
  const meta = getAttrMeta(category, attribute);
  if (!meta) return TEXT_OPERATORS;
  if (meta.isZipcode) return ZIPCODE_OPERATORS;
  return meta.numeric ? NUMERIC_OPERATORS : TEXT_OPERATORS;
}

export function defaultAttr(category) {
  return getAttributesByCategory(category)[0]?.value ?? "";
}

export function defaultOperator(category, attribute) {
  return getOperatorsForAttr(category, attribute)[0]?.value ?? "equals";
}

export function conditionLabel(rule) {
  const catLabel  = CONDITION_CATEGORIES.find(c => c.value === (rule.category || "product"))?.label ?? "";
  const attrs     = getAttributesByCategory(rule.category || "product");
  const attrLabel = attrs.find(a => a.value === rule.attribute)?.label ?? rule.attribute ?? "";
  const ops       = getOperatorsForAttr(rule.category || "product", rule.attribute);
  const opLabel   = ops.find(o => o.value === rule.operator)?.label ?? rule.operator ?? "";
  const val       = rule.operator === "between"
    ? `${rule.value} and ${rule.value2}`
    : rule.value?.split(",").map(v => v.trim()).filter(Boolean).join(", ");
  return `${catLabel} › ${attrLabel} ${opLabel} ${val}`;
}