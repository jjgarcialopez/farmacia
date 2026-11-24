import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import soap from "soap";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wsdlPath = path.join(backendDir, "wsdl", "farmacia.wsdl");
process.env.JWT_SECRET = "unit-test-only-secret-with-at-least-32-bytes";
const { createSoapServices } = await import("../src/services/index.js");

test("WSDL exposes explicit pharmacy SOAP operations, not the legacy generic action", async () => {
  const client = await soap.createClientAsync(wsdlPath);
  const operations = Object.keys(client.describe().FarmaciaService.FarmaciaPort);
  const handlers = Object.keys(createSoapServices({
    pool: {},
    withTransaction: async () => {},
  }).FarmaciaService.FarmaciaPort);

  for (const name of [
    "Login",
    "ValidateSession",
    "ListUsers",
    "CreateUser",
    "DeactivateUser",
    "ActivateUser",
    "ListMedications",
    "CreateMedication",
    "DeactivateMedication",
    "ActivateMedication",
    "ListBatches",
    "CreateBatch",
    "ListExpirationAlerts",
    "ListInventoryMovements",
    "ListSales",
    "GetSale",
    "PreviewSale",
    "CreateSale",
    "ReverseSale",
  ]) {
    assert.ok(operations.includes(name), `missing WSDL operation ${name}`);
  }
  assert.deepEqual(operations.sort(), handlers.sort());
  assert.ok(!operations.includes("execute"));
  assert.ok(!operations.some((name) => name.toLowerCase().includes("audit")));
});
