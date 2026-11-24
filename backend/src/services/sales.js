import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import { requireRoles } from "../auth.js";
import {
  integer,
  optionalDate,
  pagination,
  positiveId,
  saleStates,
} from "../validation.js";
import {
  mapSale,
  mapSaleItem,
  operation,
  notFound,
  soapArray,
} from "./common.js";

const READ_ROLES = ["administrador", "farmaceutico", "vendedor"];
const CREATE_ROLES = ["administrador", "vendedor"];
const MAX_MONEY_CENTS = 999_999_999_999;

function cents(value) {
  const [whole, fraction = ""] = String(value).split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

function decimal(centsValue) {
  return `${Math.floor(centsValue / 100)}.${String(centsValue % 100).padStart(2, "0")}`;
}

function normalizeSaleItems(args) {
  const raw = args.items?.item ?? args.items ?? args.item;
  const items = soapArray(raw);
  if (!items.length || items.length > 100) {
    throw new AppError("VALIDATION_ERROR", "La venta debe incluir entre 1 y 100 medicamentos.");
  }
  const seen = new Set();
  return items.map((item) => {
    const medicationId = positiveId(item?.medicamentoId, "medicamentoId");
    const quantity = integer(item?.cantidad, "cantidad", { min: 1, max: 2_147_483_647 });
    if (seen.has(medicationId)) {
      throw new AppError("DUPLICATE_MEDICATION", "No repitas medicamentos dentro de una venta.");
    }
    seen.add(medicationId);
    return { medicationId, quantity };
  }).sort((left, right) => {
    const leftId = BigInt(left.medicationId);
    const rightId = BigInt(right.medicationId);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
}

function expiryDateText(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

async function loadEligibleBatches(db, items, lockRows = false) {
  const result = await db.query(
    `SELECT l.id, l.medicamento_id, l.codigo_lote, l.fecha_vencimiento,
            l.stock, l.precio_venta,
            (l.fecha_vencimiento <= CURRENT_DATE + 30) AS vence_pronto,
            m.nombre AS medicamento_nombre
       FROM lotes l
       JOIN medicamentos m ON m.id = l.medicamento_id
      WHERE l.medicamento_id = ANY($1::BIGINT[])
        AND m.activo = TRUE
        AND l.fecha_vencimiento >= CURRENT_DATE
        AND l.stock > 0
      ORDER BY l.fecha_vencimiento, l.id
      ${lockRows ? "FOR UPDATE OF l FOR SHARE OF m" : ""}`,
    [items.map((item) => item.medicationId)],
  );
  const batchesByMedication = new Map(items.map((item) => [item.medicationId, []]));
  for (const batch of result.rows) {
    batchesByMedication.get(String(batch.medicamento_id))?.push(batch);
  }
  for (const batches of batchesByMedication.values()) {
    batches.sort((left, right) => {
      const expiryOrder = expiryDateText(left.fecha_vencimiento)
        .localeCompare(expiryDateText(right.fecha_vencimiento));
      if (expiryOrder !== 0) return expiryOrder;
      const leftId = BigInt(left.id);
      const rightId = BigInt(right.id);
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
  }
  return batchesByMedication;
}

function allocateSaleItems(items, batchesByMedication) {
  const allocations = [];
  let totalCents = 0;
  for (const requested of items) {
    const batches = batchesByMedication.get(requested.medicationId) || [];
    if (!batches.length) {
      throw new AppError("INSUFFICIENT_STOCK", "No hay lotes vigentes con stock para uno de los medicamentos.", 409);
    }

    let remaining = requested.quantity;
    for (const batch of batches) {
      if (remaining === 0) break;
      const available = Number(batch.stock);
      const quantity = Math.min(available, remaining);
      const unitCents = cents(batch.precio_venta);
      const subtotalCents = unitCents * quantity;
      if (!Number.isSafeInteger(subtotalCents) || subtotalCents > MAX_MONEY_CENTS
        || totalCents + subtotalCents > MAX_MONEY_CENTS) {
        throw new AppError("SALE_TOTAL_TOO_LARGE", "El total de la venta supera el límite monetario permitido.", 422);
      }
      allocations.push({ batch, quantity, unitCents, subtotalCents });
      totalCents += subtotalCents;
      remaining -= quantity;
    }
    if (remaining > 0) {
      throw new AppError("INSUFFICIENT_STOCK", "El stock vigente no alcanza para completar la venta.", 409);
    }
  }
  return { allocations, totalCents };
}

async function loadSale(db, saleId) {
  const saleResult = await db.query(
    `SELECT v.id, v.numero, v.usuario_id, v.fecha, v.total, v.estado,
            u.nombre AS usuario_nombre
       FROM ventas v
       JOIN usuarios u ON u.id = v.usuario_id
      WHERE v.id = $1`,
    [saleId],
  );
  if (!saleResult.rowCount) throw notFound("La venta");
  const detailResult = await db.query(
    `SELECT dv.lote_id, l.medicamento_id, m.nombre AS medicamento_nombre,
            l.codigo_lote, dv.cantidad, dv.precio_unitario, dv.subtotal
       FROM detalle_venta dv
       JOIN lotes l ON l.id = dv.lote_id
       JOIN medicamentos m ON m.id = l.medicamento_id
      WHERE dv.venta_id = $1
      ORDER BY dv.id`,
    [saleId],
  );
  return mapSale(saleResult.rows[0], detailResult.rows.map(mapSaleItem));
}

export function createSalesOperations({ pool, withTransaction }) {
  return {
    ListSales: operation("ListSales", async (args, headers) => {
      const user = await requireRoles(headers, pool, READ_ROLES);
      const { limit, offset } = pagination(args);
      const conditions = [];
      const values = [];
      if (user.rol === "vendedor") {
        values.push(user.id);
        conditions.push(`v.usuario_id = $${values.length}`);
      }
      if (args.estado !== undefined && args.estado !== "") {
        if (!saleStates.includes(args.estado)) {
          throw new AppError("VALIDATION_ERROR", "estado de venta no válido.");
        }
        values.push(args.estado);
        conditions.push(`v.estado = $${values.length}`);
      }
      const desde = optionalDate(args.fechaDesde, "fechaDesde");
      const hasta = optionalDate(args.fechaHasta, "fechaHasta");
      if (desde && hasta && hasta < desde) {
        throw new AppError("VALIDATION_ERROR", "La fecha Hasta no puede ser anterior a Desde.");
      }
      if (desde) {
        values.push(desde);
        conditions.push(`v.fecha >= $${values.length}::DATE`);
      }
      if (hasta) {
        values.push(hasta);
        conditions.push(`v.fecha < ($${values.length}::DATE + INTERVAL '1 day')`);
      }
      const search = String(args.busqueda || "").trim();
      if (search.length > 120) {
        throw new AppError("VALIDATION_ERROR", "La búsqueda no puede superar 120 caracteres.");
      }
      if (search) {
        values.push(`%${search}%`);
        const parameter = `$${values.length}`;
        conditions.push(`(
          v.numero ILIKE ${parameter}
          OR u.nombre ILIKE ${parameter}
          OR CAST(v.usuario_id AS TEXT) ILIKE ${parameter}
          OR EXISTS (
            SELECT 1
              FROM detalle_venta dv
              JOIN lotes sl ON sl.id = dv.lote_id
              JOIN medicamentos sm ON sm.id = sl.medicamento_id
             WHERE dv.venta_id = v.id
               AND (sm.nombre ILIKE ${parameter}
                 OR sm.codigo ILIKE ${parameter}
                 OR sm.principio_activo ILIKE ${parameter})
          )
        )`);
      }
      const from = "FROM ventas v JOIN usuarios u ON u.id = v.usuario_id";
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const count = await pool.query(
        `SELECT COUNT(*)::INTEGER AS total ${from} ${where}`,
        values,
      );
      const rows = await pool.query(
        `SELECT v.id, v.numero, v.usuario_id, v.fecha, v.total, v.estado,
                u.nombre AS usuario_nombre,
                COUNT(DISTINCT l.medicamento_id)::INTEGER AS cantidad_productos
           ${from}
           LEFT JOIN detalle_venta dv ON dv.venta_id = v.id
           LEFT JOIN lotes l ON l.id = dv.lote_id
           ${where}
          GROUP BY v.id, u.nombre
          ORDER BY v.fecha DESC, v.id DESC
          LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      );
      return {
        total: count.rows[0].total,
        limit,
        offset,
        sales: { sale: rows.rows.map((row) => mapSale(row)) },
      };
    }),

    GetSale: operation("GetSale", async (args, headers) => {
      const user = await requireRoles(headers, pool, READ_ROLES);
      const id = positiveId(args.id);
      const sale = await loadSale(pool, id);
      if (user.rol === "vendedor" && sale.usuarioId !== user.id) {
        throw new AppError("FORBIDDEN", "Solo puedes consultar tus propias ventas.", 403);
      }
      return { sale };
    }),

    PreviewSale: operation("PreviewSale", async (args, headers) => {
      await requireRoles(headers, pool, CREATE_ROLES);
      const items = normalizeSaleItems(args);
      const batchesByMedication = await loadEligibleBatches(pool, items);
      const { allocations, totalCents } = allocateSaleItems(items, batchesByMedication);
      return {
        total: decimal(totalCents),
        allocations: {
          allocation: allocations.map(({ batch, quantity, unitCents, subtotalCents }) => ({
            medicamentoId: String(batch.medicamento_id),
            medicamentoNombre: batch.medicamento_nombre,
            codigoLote: batch.codigo_lote,
            fechaVencimiento: expiryDateText(batch.fecha_vencimiento),
            cantidad: quantity,
            existenciasDisponibles: Number(batch.stock),
            precioUnitario: decimal(unitCents),
            subtotal: decimal(subtotalCents),
          })),
        },
      };
    }),

    CreateSale: operation("CreateSale", async (args, headers) => {
      const user = await requireRoles(headers, pool, CREATE_ROLES);
      const items = normalizeSaleItems(args);
      const outcome = await withTransaction(async (client) => {
        const numero = `V-${randomUUID()}`;
        const insertedSale = await client.query(
          `INSERT INTO ventas (numero, usuario_id, total, estado)
           VALUES ($1, $2, 0, 'confirmada')
           RETURNING id`,
          [numero, user.id],
        );
        const saleId = insertedSale.rows[0].id;
        const alerts = [];
        const batchesByMedication = await loadEligibleBatches(client, items, true);
        const { allocations, totalCents } = allocateSaleItems(items, batchesByMedication);
        for (const { batch, quantity, unitCents, subtotalCents } of allocations) {
          const available = Number(batch.stock);
          const newStock = available - quantity;
          const updatedBatch = await client.query(
            "UPDATE lotes SET stock = $1 WHERE id = $2 AND stock = $3 RETURNING id",
            [newStock, batch.id, available],
          );
          if (!updatedBatch.rowCount) {
            throw new AppError("INSUFFICIENT_STOCK", "El inventario cambió durante la venta; vuelve a intentarlo.", 409);
          }
          const unitPrice = decimal(unitCents);
          const subtotal = decimal(subtotalCents);
          await client.query(
            `INSERT INTO detalle_venta
              (venta_id, lote_id, cantidad, precio_unitario, subtotal)
             VALUES ($1, $2, $3, $4, $5)`,
            [saleId, batch.id, quantity, unitPrice, subtotal],
          );
          await client.query(
            `INSERT INTO inventario
              (lote_id, venta_id, usuario_id, tipo, cantidad,
               stock_antes, stock_despues, motivo)
             VALUES ($1, $2, $3, 'salida', $4, $5, $6, $7)`,
            [batch.id, saleId, user.id, quantity, available, newStock, `Venta ${numero}`],
          );
          if (batch.vence_pronto) {
            alerts.push({
              loteId: String(batch.id),
              medicamentoNombre: batch.medicamento_nombre,
              codigoLote: batch.codigo_lote,
              fechaVencimiento: expiryDateText(batch.fecha_vencimiento),
            });
          }
        }
        await client.query(
          "UPDATE ventas SET total = $1 WHERE id = $2",
          [decimal(totalCents), saleId],
        );
        return { saleId: String(saleId), alerts };
      });
      const sale = await loadSale(pool, outcome.saleId);
      return {
        sale,
        alerts: { alert: outcome.alerts },
      };
    }),

    ReverseSale: operation("ReverseSale", async (args, headers) => {
      const user = await requireRoles(headers, pool, ["administrador"]);
      const id = positiveId(args.id);
      await withTransaction(async (client) => {
        const saleResult = await client.query(
          "SELECT id, estado, numero FROM ventas WHERE id = $1 FOR UPDATE",
          [id],
        );
        if (!saleResult.rowCount) throw notFound("La venta");
        const sale = saleResult.rows[0];
        if (sale.estado !== "confirmada") {
          throw new AppError("SALE_NOT_REVERSIBLE", "Solo se pueden revertir ventas confirmadas.", 409);
        }
        const details = await client.query(
          `SELECT dv.lote_id, dv.cantidad, l.stock
             FROM detalle_venta dv
             JOIN lotes l ON l.id = dv.lote_id
            WHERE dv.venta_id = $1
            ORDER BY l.id
            FOR UPDATE OF l`,
          [id],
        );
        for (const detail of details.rows) {
          const before = Number(detail.stock);
          const quantity = Number(detail.cantidad);
          const after = before + quantity;
          if (!Number.isSafeInteger(after) || after > 2_147_483_647) {
            throw new AppError("STOCK_LIMIT", "La reversión supera el stock máximo permitido.", 409);
          }
          await client.query(
            "UPDATE lotes SET stock = $1 WHERE id = $2",
            [after, detail.lote_id],
          );
          await client.query(
            `INSERT INTO inventario
              (lote_id, venta_id, usuario_id, tipo, cantidad,
               stock_antes, stock_despues, motivo)
             VALUES ($1, $2, $3, 'reversión', $4, $5, $6, $7)`,
            [detail.lote_id, id, user.id, quantity, before, after, `Reversión de venta ${sale.numero}`],
          );
        }
        await client.query(
          "UPDATE ventas SET estado = 'revertida' WHERE id = $1",
          [id],
        );
      });
      return { sale: await loadSale(pool, id) };
    }),
  };
}
