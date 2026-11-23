import { movementTypes, optionalDate, pagination, positiveId } from "../validation.js";
import { AppError } from "../errors.js";
import { requireRoles } from "../auth.js";
import { mapMovement, operation, pageQuery } from "./common.js";

const READ_ROLES = ["administrador", "operador", "auditor"];
const SELECT_MOVEMENT = `i.id, i.lote_id, i.venta_id, i.usuario_id,
  u.nombre AS usuario_nombre, u.rol AS usuario_rol, i.tipo, i.cantidad,
  i.stock_antes, i.stock_despues, i.motivo, i.fecha`;
const MOVEMENT_FROM = "inventario i JOIN usuarios u ON u.id = i.usuario_id";

function addMovementFilters(args, conditions, values, batchId) {
  if (batchId) {
    values.push(batchId);
    conditions.push(`lote_id = $${values.length}`);
  } else if (args.loteId !== undefined && args.loteId !== "") {
    values.push(positiveId(args.loteId, "loteId"));
    conditions.push(`lote_id = $${values.length}`);
  }
  if (args.ventaId !== undefined && args.ventaId !== "") {
    values.push(positiveId(args.ventaId, "ventaId"));
    conditions.push(`venta_id = $${values.length}`);
  }
  if (args.tipo !== undefined && args.tipo !== "") {
    if (!movementTypes.includes(args.tipo)) {
      throw new AppError("VALIDATION_ERROR", "tipo de movimiento no válido.");
    }
    values.push(args.tipo);
    conditions.push(`tipo = $${values.length}`);
  }
  const desde = optionalDate(args.fechaDesde, "fechaDesde");
  if (desde) {
    values.push(desde);
    conditions.push(`fecha >= $${values.length}::DATE`);
  }
  const hasta = optionalDate(args.fechaHasta, "fechaHasta");
  if (hasta) {
    values.push(hasta);
    conditions.push(`fecha < ($${values.length}::DATE + INTERVAL '1 day')`);
  }
}

export function createInventoryOperations({ pool }) {
  const listMovements = (batchId) => operation(
    batchId ? "ListInventoryMovementsByBatch" : "ListInventoryMovements",
    async (args, headers) => {
      await requireRoles(headers, pool, READ_ROLES);
      const { limit, offset } = pagination(args);
      const conditions = [];
      const values = [];
      addMovementFilters(args, conditions, values, batchId);
      const result = await pageQuery(pool, {
        select: SELECT_MOVEMENT,
        from: MOVEMENT_FROM,
        conditions,
        values,
        orderBy: "i.fecha DESC, i.id DESC",
        limit,
        offset,
      });
      return {
        total: result.total,
        limit,
        offset,
        movements: { movement: result.items.map(mapMovement) },
      };
    },
  );

  return {
    ListInventoryMovements: listMovements(),
    ListInventoryMovementsByBatch: operation("ListInventoryMovementsByBatch", async (args, headers) => {
      const batchId = positiveId(args.loteId, "loteId");
      return listMovements(batchId)(args, undefined, headers);
    }),
  };
}
