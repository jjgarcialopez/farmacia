import assert from "node:assert/strict";
import test from "node:test";
import { listPublicMedications } from "../src/medications-http.js";

test("lists public medications as JSON data with filters and pagination", async () => {
  const queries = [];
  const medication = {
    id: "12",
    codigo: "MED-12",
    nombre: "AcetaminofÃ©n",
    principio_activo: "AcetaminofÃ©n",
    presentacion: "Tableta",
    requiere_formula: false,
    precio_referencia: "1500.00",
    activo: true,
    creado_en: "2026-11-24T12:00:00.000Z",
  };
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.startsWith("SELECT COUNT")) return { rows: [{ total: 1 }] };
      return { rows: [medication] };
    },
  };

  const result = await listPublicMedications(
    new URLSearchParams("q=Acetaminofen&principioActivo=acetaminofen&activo=true&limit=5&offset=10"),
    pool,
  );

  assert.deepEqual(result, {
    total: 1,
    limit: 5,
    offset: 10,
    medicamentos: [{
      id: "12",
      codigo: "MED-12",
      nombre: "AcetaminofÃ©n",
      principioActivo: "AcetaminofÃ©n",
      concentracion: "",
      presentacion: "Tableta",
      requiereFormula: false,
      precioReferencia: "1500.00",
      precioVenta: "1500.00",
      activo: true,
      creadoEn: "2026-11-24T12:00:00.000Z",
    }],
  });
  assert.deepEqual(queries[0].values, ["%Acetaminofen%", "%acetaminofen%", true]);
  assert.deepEqual(queries[1].values, ["%Acetaminofen%", "%acetaminofen%", true, 5, 10]);
});

test("rejects invalid public medication filters before querying the database", async () => {
  let queried = false;
  const pool = { async query() { queried = true; } };

  await assert.rejects(
    listPublicMedications(new URLSearchParams("activo=yes"), pool),
    /activo debe ser true o false/,
  );
  await assert.rejects(
    listPublicMedications(new URLSearchParams("limit=101"), pool),
    /limit debe ser un entero entre 1 y 100/,
  );
  assert.equal(queried, false);
});
