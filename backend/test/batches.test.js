import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "unit-test-only-secret-with-at-least-32-bytes";
const { config } = await import("../src/config.js");
const { createBatchOperations } = await import("../src/services/batches.js");

const pharmacist = {
  id: "7",
  nombre: "Farmacéutico",
  correo: "farmaceutico@farmacia.com",
  rol: "farmaceutico",
  activo: true,
};
const headers = {
  AuthHeader: {
    token: jwt.sign({}, config.jwtSecret, {
      algorithm: "HS256",
      subject: pharmacist.id,
      issuer: config.jwtIssuer,
    }),
  },
};

test("a pharmacist can update batch quantities and records the inventory movement", async () => {
  let stockUpdated = false;
  let movementRecorded = false;
  const client = {
    async query(sql, values) {
      if (sql.includes("SELECT * FROM lotes") && sql.includes("FOR UPDATE")) {
        return {
          rows: [{ id: "11", medicamento_id: "21", stock: 5 }],
          rowCount: 1,
        };
      }
      if (sql.includes("UPDATE lotes SET stock =")) {
        stockUpdated = values[0] === 8;
        return { rows: [{ id: "11" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO inventario")) {
        movementRecorded = values[1] === pharmacist.id && values[3] === 5 && values[4] === 8;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("SELECT l.id, l.medicamento_id")) {
        return {
          rows: [{
            id: "11",
            medicamento_id: "21",
            medicamento_nombre: "Medicamento",
            codigo_lote: "LOT-11",
            fecha_vencimiento: "2027-12-31",
            stock: 8,
            costo_unitario: "1.00",
            precio_venta: "2.00",
          }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected transaction query: ${sql}`);
    },
  };
  const pool = {
    async query(sql) {
      if (sql.includes("FROM usuarios") && sql.includes("WHERE id = $1")) {
        return { rows: [pharmacist], rowCount: 1 };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  };

  const result = await createBatchOperations({
    pool,
    withTransaction: (work) => work(client),
  }).UpdateBatch({ id: "11", stock: "8", motivo: "Ajuste de inventario" }, null, headers);

  assert.equal(stockUpdated, true);
  assert.equal(movementRecorded, true);
  assert.equal(result.batch.stock, 8);
});
