import { AppError } from "../errors.js";
import { requireRoles } from "../auth.js";
import {
  integer,
  isoDate,
  money,
  optionalDate,
  pagination,
  positiveId,
  text,
} from "../validation.js";
import {
  mapBatch,
  operation,
  pageQuery,
  notFound,
} from "./common.js";

const READ_ROLES = ["administrador", "operador", "consulta", "auditor"];
const WRITE_ROLES = ["administrador", "operador"];
const BATCH_FROM = "lotes l JOIN medicamentos m ON m.id = l.medicamento_id";
const BATCH_SELECT = `l.id, l.medicamento_id, m.nombre AS medicamento_nombre,
  l.codigo_lote, l.fecha_vencimiento, l.stock, l.costo_unitario, l.precio_venta`;

async function ensureActiveMedication(db, medicationId) {
  const result = await db.query(
    "SELECT id FROM medicamentos WHERE id = $1 AND activo = TRUE",
    [medicationId],
  );
  if (!result.rowCount) throw new AppError("INVALID_MEDICATION", "El medicamento no existe o está inactivo.", 409);
}

export function createBatchOperations({ pool, withTransaction }) {
  return {
    ListBatches: operation("ListBatches", async (args, headers) => {
      await requireRoles(headers, pool, READ_ROLES);
      const { limit, offset } = pagination(args);
      const values = [];
      const conditions = [];
      if (args.medicamentoId !== undefined && args.medicamentoId !== "") {
        values.push(positiveId(args.medicamentoId, "medicamentoId"));
        conditions.push(`l.medicamento_id = $${values.length}`);
      }
      if (args.codigoLote !== undefined && args.codigoLote !== "") {
        values.push(`%${text(args.codigoLote, "codigoLote", 80)}%`);
        conditions.push(`l.codigo_lote ILIKE $${values.length}`);
      }
      const desde = optionalDate(args.fechaVencimientoDesde, "fechaVencimientoDesde");
      if (desde) {
        values.push(desde);
        conditions.push(`l.fecha_vencimiento >= $${values.length}`);
      }
      const hasta = optionalDate(args.fechaVencimientoHasta, "fechaVencimientoHasta");
      if (hasta) {
        values.push(hasta);
        conditions.push(`l.fecha_vencimiento <= $${values.length}`);
      }
      const result = await pageQuery(pool, {
        select: BATCH_SELECT,
        from: BATCH_FROM,
        conditions,
        values,
        orderBy: "l.fecha_vencimiento, l.id",
        limit,
        offset,
      });
      return {
        total: result.total,
        limit,
        offset,
        batches: { batch: result.items.map(mapBatch) },
      };
    }),

    GetBatch: operation("GetBatch", async (args, headers) => {
      await requireRoles(headers, pool, READ_ROLES);
      const id = positiveId(args.id);
      const result = await pool.query(
        `SELECT ${BATCH_SELECT} FROM ${BATCH_FROM} WHERE l.id = $1`,
        [id],
      );
      if (!result.rowCount) throw notFound("El lote");
      return { batch: mapBatch(result.rows[0]) };
    }),

    CreateBatch: operation("CreateBatch", async (args, headers) => {
      const user = await requireRoles(headers, pool, WRITE_ROLES);
      const medicamentoId = positiveId(args.medicamentoId, "medicamentoId");
      const codigoLote = text(args.codigoLote, "codigoLote", 80);
      const fechaVencimiento = isoDate(args.fechaVencimiento, "fechaVencimiento");
      const stock = args.stock === undefined ? 0 : integer(args.stock, "stock");
      const costoUnitario = money(args.costoUnitario, "costoUnitario");
      const precioVenta = money(args.precioVenta, "precioVenta");

      const batch = await withTransaction(async (client) => {
        await ensureActiveMedication(client, medicamentoId);
        const inserted = await client.query(
          `INSERT INTO lotes
            (medicamento_id, codigo_lote, fecha_vencimiento, stock, costo_unitario, precio_venta)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [medicamentoId, codigoLote, fechaVencimiento, stock, costoUnitario, precioVenta],
        );
        const id = inserted.rows[0].id;
        if (stock > 0) {
          await client.query(
            `INSERT INTO inventario
              (lote_id, usuario_id, tipo, cantidad, stock_antes, stock_despues, motivo)
             VALUES ($1, $2, 'entrada', $3, 0, $3, 'Entrada inicial del lote')`,
            [id, user.id, stock],
          );
        }
        const result = await client.query(
          `SELECT ${BATCH_SELECT} FROM ${BATCH_FROM} WHERE l.id = $1`,
          [id],
        );
        return result.rows[0];
      });
      return { batch: mapBatch(batch) };
    }),

    UpdateBatch: operation("UpdateBatch", async (args, headers) => {
      const user = await requireRoles(headers, pool, WRITE_ROLES);
      const id = positiveId(args.id);
      const updates = [];
      const values = [];
      const changesStock = args.stock !== undefined;
      const fields = [
        ["medicamentoId", "medicamento_id", (value) => positiveId(value, "medicamentoId")],
        ["codigoLote", "codigo_lote", (value) => text(value, "codigoLote", 80)],
        ["fechaVencimiento", "fecha_vencimiento", (value) => isoDate(value, "fechaVencimiento")],
        ["stock", "stock", (value) => integer(value, "stock")],
        ["costoUnitario", "costo_unitario", (value) => money(value, "costoUnitario")],
        ["precioVenta", "precio_venta", (value) => money(value, "precioVenta")],
      ];
      for (const [inputName, column, validate] of fields) {
        if (args[inputName] === undefined) continue;
        values.push(validate(args[inputName]));
        updates.push(`${column} = $${values.length}`);
      }
      if (!updates.length) throw new AppError("VALIDATION_ERROR", "Debes enviar al menos un campo para actualizar.");
      const reason = changesStock
        ? text(args.motivo, "motivo", 300)
        : undefined;

      const row = await withTransaction(async (client) => {
        const existing = await client.query("SELECT * FROM lotes WHERE id = $1 FOR UPDATE", [id]);
        if (!existing.rowCount) throw notFound("El lote");
        if (args.medicamentoId !== undefined) {
          const nextMedicationId = positiveId(args.medicamentoId, "medicamentoId");
          await ensureActiveMedication(client, nextMedicationId);
          if (nextMedicationId !== String(existing.rows[0].medicamento_id)) {
            const history = await client.query(
              `SELECT EXISTS (SELECT 1 FROM inventario WHERE lote_id = $1)
                  OR EXISTS (SELECT 1 FROM detalle_venta WHERE lote_id = $1) AS has_history`,
              [id],
            );
            if (history.rows[0].has_history) {
              throw new AppError("BATCH_HAS_HISTORY", "No se puede cambiar el medicamento de un lote con movimientos o ventas asociados.", 409);
            }
          }
        }
        const before = existing.rows[0].stock;
        const after = changesStock ? integer(args.stock, "stock") : before;
        if (args.motivo !== undefined && !changesStock) {
          throw new AppError("VALIDATION_ERROR", "motivo solo se acepta al ajustar el stock.");
        }
        values.push(id);
        const updated = await client.query(
          `UPDATE lotes SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING id`,
          values,
        );
        if (changesStock && before !== after) {
          const movementQuantity = Math.abs(after - before);
          await client.query(
            `INSERT INTO inventario
              (lote_id, usuario_id, tipo, cantidad, stock_antes, stock_despues, motivo)
             VALUES ($1, $2, 'ajuste', $3, $4, $5, $6)`,
            [id, user.id, movementQuantity, before, after, reason],
          );
        }
        const selected = await client.query(
          `SELECT ${BATCH_SELECT} FROM ${BATCH_FROM} WHERE l.id = $1`,
          [updated.rows[0].id],
        );
        return selected.rows[0];
      });
      return { batch: mapBatch(row) };
    }),

    DeleteBatch: operation("DeleteBatch", async (args, headers) => {
      await requireRoles(headers, pool, ["administrador"]);
      const id = positiveId(args.id);
      await withTransaction(async (client) => {
        const existing = await client.query("SELECT id FROM lotes WHERE id = $1 FOR UPDATE", [id]);
        if (!existing.rowCount) throw notFound("El lote");
        const associated = await client.query(
          `SELECT EXISTS (SELECT 1 FROM inventario WHERE lote_id = $1)
              OR EXISTS (SELECT 1 FROM detalle_venta WHERE lote_id = $1) AS has_history`,
          [id],
        );
        if (associated.rows[0].has_history) {
          throw new AppError("BATCH_HAS_HISTORY", "No se puede eliminar un lote con movimientos o ventas asociados.", 409);
        }
        await client.query("DELETE FROM lotes WHERE id = $1", [id]);
      });
      return { success: true };
    }),

    ListExpirationAlerts: operation("ListExpirationAlerts", async (args, headers) => {
      await requireRoles(headers, pool, READ_ROLES);
      const { limit, offset } = pagination(args);
      const values = [];
      const conditions = [
        "l.stock > 0",
        "l.fecha_vencimiento <= CURRENT_DATE + 30",
      ];
      const result = await pageQuery(pool, {
        select: `${BATCH_SELECT}, (l.fecha_vencimiento - CURRENT_DATE)::INTEGER AS dias_para_vencer`,
        from: BATCH_FROM,
        conditions,
        values,
        orderBy: "l.fecha_vencimiento, l.id",
        limit,
        offset,
      });
      return {
        total: result.total,
        limit,
        offset,
        alerts: {
          alert: result.items.map((row) => ({
            batch: mapBatch(row),
            diasParaVencer: row.dias_para_vencer,
          })),
        },
      };
    }),
  };
}
