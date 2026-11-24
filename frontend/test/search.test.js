import assert from "node:assert/strict";
import test from "node:test";
import { matchingMedicationsWithoutBatches, normalizeSearchText } from "../search.js";

test("normalizes medication names without case or accent sensitivity", () => {
  const name = normalizeSearchText("Acetaminofén 500 mg");
  assert.ok(name.includes(normalizeSearchText("acetaminofen")));
  assert.ok(name.includes(normalizeSearchText("ACETAMINOFÉN")));
});

test("normalizes Spanish diacritics in active ingredients", () => {
  assert.equal(normalizeSearchText("Ácido acetilsalicílico"), "acido acetilsalicilico");
});

test("finds matching catalog medications that have no inventory batches", () => {
  const medications = [
    { id: "1", nombre: "Aspirina", codigo: "MED-1", principioActivo: "Ácido acetilsalicílico" },
    { id: "2", nombre: "Acetaminofén", codigo: "MED-2", principioActivo: "Acetaminofén" },
  ];
  const batches = [{ medicamentoId: "2" }];

  assert.deepEqual(
    matchingMedicationsWithoutBatches(medications, batches, "ASPIRINA"),
    [medications[0]],
  );
  assert.deepEqual(
    matchingMedicationsWithoutBatches(medications, batches, "acetaminofen"),
    [],
  );
});
