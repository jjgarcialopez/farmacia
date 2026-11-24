import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "unit-test-only-secret-with-at-least-32-bytes";
const { config } = await import("../src/config.js");
const { createSalesOperations } = await import("../src/services/sales.js");

const operator = {
  id: "7",
  nombre: "Vendedor",
  correo: "vendedor@farmacia.com",
  rol: "vendedor",
  activo: true,
};
const headers = {
  AuthHeader: {
    token: jwt.sign({}, config.jwtSecret, {
      algorithm: "HS256",
      subject: operator.id,
      issuer: config.jwtIssuer,
    }),
  },
};

function authQuery(sql) {
  if (sql.includes("FROM usuarios") && sql.includes("WHERE id = $1")) {
    return { rows: [operator], rowCount: 1 };
  }
  throw new Error(`Unexpected pool query: ${sql}`);
}

const batches = [
  {
    id: "12",
    medicamento_id: "21",
    medicamento_nombre: "AcetaminofÃ©n",
    codigo_lote: "LOT-B",
    fecha_vencimiento: "2027-06-30",
    stock: 5,
    precio_venta: "1.50",
    vence_pronto: false,
  },
  {
    id: "11",
    medicamento_id: "21",
    medicamento_nombre: "AcetaminofÃ©n",
    codigo_lote: "LOT-A",
    fecha_vencimiento: "2027-03-31",
    stock: 2,
    precio_venta: "1.00",
    vence_pronto: false,
  },
];

test("previews a sale using FEFO lots and exact cent totals", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("FROM usuarios")) return authQuery(sql);
      if (sql.includes("FROM lotes l")) return { rows: batches, rowCount: batches.length };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  };
  const previewSale = createSalesOperations({ pool }).PreviewSale;
  const result = await previewSale({
    items: { item: [{ medicamentoId: "21", cantidad: 4 }] },
  }, null, headers);

  assert.equal(result.total, "5.00");
  assert.deepEqual(result.allocations.allocation.map((item) => [
    item.codigoLote,
    item.cantidad,
    item.precioUnitario,
    item.subtotal,
  ]), [
    ["LOT-A", 2, "1.00", "2.00"],
    ["LOT-B", 2, "1.50", "3.00"],
  ]);
});

test("creates a sale from the same FEFO preview allocations", async () => {
  const updatedStocks = [];
  const details = [];
  const client = {
    async query(sql, values = []) {
      if (sql.includes("INSERT INTO ventas")) return { rows: [{ id: "101" }], rowCount: 1 };
      if (sql.includes("FROM lotes l")) return { rows: batches, rowCount: batches.length };
      if (sql.includes("UPDATE lotes SET stock")) {
        updatedStocks.push({ id: values[1], stock: values[0] });
        return { rows: [{ id: values[1] }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO detalle_venta")) {
        details.push(values);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO inventario")) return { rows: [], rowCount: 1 };
      if (sql.includes("UPDATE ventas SET total")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected transaction query: ${sql}`);
    },
  };
  const saleRow = {
    id: "101",
    numero: "V-2026-101",
    usuario_id: "7",
    usuario_nombre: "Vendedor",
    fecha: new Date("2026-11-23T12:00:00.000Z"),
    total: "5.00",
    estado: "confirmada",
  };
  const pool = {
    async query(sql) {
      if (sql.includes("FROM usuarios") && sql.includes("WHERE id = $1")) return authQuery(sql);
      if (sql.includes("FROM ventas v")) return { rows: [saleRow], rowCount: 1 };
      if (sql.includes("FROM detalle_venta dv")) {
        return {
          rows: details.map(([, lotId, quantity, unitPrice, subtotal]) => {
            const batch = batches.find((item) => item.id === lotId);
            return {
              lote_id: lotId,
              medicamento_id: batch.medicamento_id,
              medicamento_nombre: batch.medicamento_nombre,
              codigo_lote: batch.codigo_lote,
              cantidad: quantity,
              precio_unitario: unitPrice,
              subtotal,
            };
          }),
          rowCount: details.length,
        };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  };
  const createSale = createSalesOperations({
    pool,
    withTransaction: (work) => work(client),
  }).CreateSale;
  const result = await createSale({
    items: { item: [{ medicamentoId: "21", cantidad: 4 }] },
  }, null, headers);

  assert.deepEqual(updatedStocks, [{ id: "11", stock: 0 }, { id: "12", stock: 3 }]);
  assert.equal(result.sale.total, "5.00");
  assert.deepEqual(result.sale.items.item.map((item) => [item.codigoLote, item.cantidad]), [
    ["LOT-A", 2],
    ["LOT-B", 2],
  ]);
});

test("rejects a sale preview when eligible stock cannot cover the requested quantity", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("FROM usuarios")) return authQuery(sql);
      if (sql.includes("FROM lotes l")) return { rows: batches, rowCount: batches.length };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  };
  const previewSale = createSalesOperations({ pool }).PreviewSale;

  await assert.rejects(
    previewSale({ items: { item: [{ medicamentoId: "21", cantidad: 8 }] } }, null, headers),
    (error) => {
      assert.match(error.Fault.Reason.Text, /stock vigente no alcanza/);
      return true;
    },
  );
});

test("gets sale detail with medication names", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("FROM usuarios") && sql.includes("WHERE id = $1")) return authQuery(sql);
      if (sql.includes("FROM ventas v")) {
        return {
          rows: [{
            id: "101",
            numero: "V-2026-101",
            usuario_id: "7",
            usuario_nombre: "Vendedor",
            fecha: new Date("2026-11-23T12:00:00.000Z"),
            total: "5.00",
            estado: "confirmada",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM detalle_venta dv")) {
        return {
          rows: [{
            lote_id: "11",
            medicamento_id: "21",
            medicamento_nombre: "AcetaminofÃ©n",
            codigo_lote: "LOT-A",
            cantidad: 2,
            precio_unitario: "1.00",
            subtotal: "2.00",
          }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  };
  const getSale = createSalesOperations({ pool }).GetSale;
  const result = await getSale({ id: "101" }, null, headers);

  assert.equal(result.sale.items.item[0].medicamentoNombre, "AcetaminofÃ©n");
  assert.equal(result.sale.items.item[0].codigoLote, "LOT-A");
});

test("searches sales by number, cashier, and product while returning summary fields", async () => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      if (sql.includes("FROM usuarios") && sql.includes("WHERE id = $1")) {
        return authQuery(sql);
      }
      queries.push({ sql, values });
      if (sql.includes("COUNT(*)::INTEGER")) return { rows: [{ total: 1 }], rowCount: 1 };
      if (sql.includes("COUNT(DISTINCT l.medicamento_id)")) {
        return {
          rows: [{
            id: "101",
            numero: "V-2026-101",
            usuario_id: "7",
            usuario_nombre: "Vendedor",
            cantidad_productos: 2,
            fecha: new Date("2026-11-23T12:00:00.000Z"),
            total: "25.00",
            estado: "confirmada",
          }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  };
  const listSales = createSalesOperations({ pool }).ListSales;
  const result = await listSales({
    busqueda: "AcetaminofÃ©n",
    fechaDesde: "2026-11-01",
    fechaHasta: "2026-11-30",
    limit: 20,
    offset: 0,
  }, null, headers);

  assert.equal(result.total, 1);
  assert.equal(result.sales.sale[0].usuarioNombre, "Vendedor");
  assert.equal(result.sales.sale[0].cantidadProductos, 2);
  assert.ok(queries.every(({ sql }) => sql.includes("ILIKE")));
  assert.ok(queries.some(({ sql }) => sql.includes("sm.principio_activo ILIKE")));
  assert.ok(queries.every(({ values }) => values.includes("%AcetaminofÃ©n%")));
});
