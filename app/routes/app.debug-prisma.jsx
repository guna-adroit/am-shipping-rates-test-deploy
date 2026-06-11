// TEMPORARY DIAGNOSTIC ROUTE — delete after debugging
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { Prisma } from "@prisma/client";
import fs from "fs";
import path from "path";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const rateModel = Prisma.dmmf.datamodel.models.find((m) => m.name === "Rate");
  const fieldNames = rateModel?.fields.map((f) => f.name) ?? [];

  // Try to find schema.prisma files anywhere in the deployed bundle
  const searchPaths = [
    path.join(process.cwd(), "prisma", "schema.prisma"),
    path.join(process.cwd(), "schema.prisma"),
    "/var/task/prisma/schema.prisma",
    "/var/task/schema.prisma",
  ];

  const schemaFiles = {};
  for (const p of searchPaths) {
    try {
      const content = fs.readFileSync(p, "utf-8");
      // Extract just the Rate model block
      const match = content.match(/model Rate \{[\s\S]*?\n\}/);
      schemaFiles[p] = {
        exists: true,
        hasMinDeliveryDays: content.includes("minDeliveryDays"),
        rateModelSnippet: match ? match[0] : "Rate model not found in file",
      };
    } catch (e) {
      schemaFiles[p] = { exists: false, error: e.code };
    }
  }

  return {
    rateFields: fieldNames,
    hasMinDeliveryDays: fieldNames.includes("minDeliveryDays"),
    hasMaxDeliveryDays: fieldNames.includes("maxDeliveryDays"),
    cwd: process.cwd(),
    schemaFiles,
  };
};

export default function DebugPrisma() {
  const data = useLoaderData();

  return (
    <s-page heading="Prisma Debug">
      <s-section heading="Generated Client">
        <s-stack direction="block" gap="base">
          <s-text><strong>hasMinDeliveryDays:</strong> {String(data.hasMinDeliveryDays)}</s-text>
          <s-text><strong>hasMaxDeliveryDays:</strong> {String(data.hasMaxDeliveryDays)}</s-text>
          <s-text><strong>cwd:</strong> {data.cwd}</s-text>
        </s-stack>
      </s-section>

      <s-section heading="Schema files found on disk (production)">
        <pre style={{
          background: "#f6f6f7",
          padding: "12px",
          borderRadius: "8px",
          fontSize: "12px",
          whiteSpace: "pre-wrap",
          overflowX: "auto",
        }}>
          {JSON.stringify(data.schemaFiles, null, 2)}
        </pre>
      </s-section>
    </s-page>
  );
}