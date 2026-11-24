import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "unit-test-only-secret-with-at-least-32-bytes";
const { config } = await import("../src/config.js");
const { createMedicationOperations } = await import("../src/services/medications.js");

function authHeaders(id) {
  return {
    AuthHeader: {
      token: jwt.sign({}, config.jwtSecret, {
        algorithm: "HS256",
        subject: id,
        issuer: config.jwtIssuer,
      }),
    },
  };
}

const administrator = {
  id: "1",
  nombre: "Administrador",
  correo: "admin@farmacia.com",
  rol: "administrador",
  activo: true,
};

test("reactivates an inactive medication for administrators", async () => {
  let activated = false;
  const medication = {
    id: "21",
    codigo: "MED-21",
    nombre: "AcetaminofÃ©n",
    principio_activo: "AcetaminofÃ©n",
    presentacion: "Tableta",
    requiere_formula: false,
    precio_referencia: "1.50",
    activo: true,
    creado_en: new Date("2026-01-01T00:00:00.000Z"),
  };
  const pool = {
    async query(sql) {
      if (sql.includes("FROM usuarios") && sql.includes("WHERE id = $1")) {
        return { rows: [administrator], rowCount: 1 };
      }
      if (sql.includes("UPDATE medicamentos SET activo = TRUE")) {
        activated = true;
        return { rows: [medication], rowCount: 1 };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  };
  const result = await createMedicationOperations({ pool })
    .ActivateMedication({ id: "21" }, null, authHeaders("1"));

  assert.equal(activated, true);
  assert.equal(result.success, true);
  assert.equal(result.medication.activo, true);
  assert.equal(result.medication.id, "21");
});

test("restricts medication reactivation to administrators", async () => {
  const operator = { ...administrator, id: "7", rol: "vendedor" };
  const pool = {
    async query(sql) {
      if (sql.includes("FROM usuarios") && sql.includes("WHERE id = $1")) {
        return { rows: [operator], rowCount: 1 };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  };

  await assert.rejects(
    createMedicationOperations({ pool })
      .ActivateMedication({ id: "21" }, null, authHeaders("7")),
    (error) => {
      assert.match(error.Fault.Reason.Text, /FORBIDDEN/);
      return true;
    },
  );
});
