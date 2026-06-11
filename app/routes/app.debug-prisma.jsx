// TEMPORARY DIAGNOSTIC ROUTE — delete after debugging
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { Prisma } from "@prisma/client";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const rateModel = Prisma.dmmf.datamodel.models.find((m) => m.name === "Rate");
  const fieldNames = rateModel?.fields.map((f) => f.name) ?? [];

  return {
    rateFields: fieldNames,
    hasMinDeliveryDays: fieldNames.includes("minDeliveryDays"),
    hasMaxDeliveryDays: fieldNames.includes("maxDeliveryDays"),
    prismaClientVersion: Prisma.prismaVersion,
  };
};

export default function DebugPrisma() {
  const data = useLoaderData();

  return (
    <s-page heading="Prisma Debug">
      <s-section heading="Rate model fields (deployed client)">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="extra-small">
            <s-text><strong>hasMinDeliveryDays:</strong> {String(data.hasMinDeliveryDays)}</s-text>
            <s-text><strong>hasMaxDeliveryDays:</strong> {String(data.hasMaxDeliveryDays)}</s-text>
          </s-stack>

          <s-stack direction="block" gap="extra-small">
            <s-text><strong>All Rate fields:</strong></s-text>
            <pre style={{
              background: "#f6f6f7",
              padding: "12px",
              borderRadius: "8px",
              fontSize: "13px",
              whiteSpace: "pre-wrap",
            }}>
              {JSON.stringify(data.rateFields, null, 2)}
            </pre>
          </s-stack>

          <s-stack direction="block" gap="extra-small">
            <s-text><strong>Prisma version:</strong></s-text>
            <pre style={{
              background: "#f6f6f7",
              padding: "12px",
              borderRadius: "8px",
              fontSize: "13px",
              whiteSpace: "pre-wrap",
            }}>
              {JSON.stringify(data.prismaClientVersion, null, 2)}
            </pre>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}