import { AppError, invokeSoap } from "../errors.js";

export function operation(name, handler) {
  return (args, _callback, headers, req) =>
    invokeSoap(name, () => handler(args || {}, headers || {}, req), args, headers, req);
}

export function whereClause(conditions) {
  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

export async function pageQuery(db, { select, from, conditions, values, orderBy, limit, offset }) {
  const where = whereClause(conditions);
  const count = await db.query(`SELECT COUNT(*)::INTEGER AS total FROM ${from} ${where}`, values);
  const rows = await db.query(
    `SELECT ${select} FROM ${from} ${where} ORDER BY ${orderBy}
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );
  return { total: count.rows[0].total, limit, offset, items: rows.rows };
}

export function notFound(resource) {
  return new AppError("NOT_FOUND", `${resource} no existe.`, 404);
}

export function soapArray(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function timestampText(value) {
  return value instanceof Date ? value.toISOString() : value;
}

export function mapUser(row) {
  return {
    id: String(row.id),
    nombre: row.nombre,
    correo: row.correo,
    rol: row.rol,
    activo: row.activo,
    creadoEn: row.creado_en,
  };
}

export function mapMedication(row) {
  return {
    id: String(row.id),
    codigo: row.codigo,
    nombre: row.nombre,
    principioActivo: row.principio_activo,
    presentacion: row.presentacion,
    requiereFormula: row.requiere_formula,
    precioReferencia: row.precio_referencia,
    activo: row.activo,
    creadoEn: row.creado_en,
  };
}

export function mapBatch(row) {
  return {
    id: String(row.id),
    medicamentoId: String(row.medicamento_id),
    medicamentoNombre: row.medicamento_nombre,
    codigoLote: row.codigo_lote,
    fechaVencimiento: row.fecha_vencimiento instanceof Date
      ? row.fecha_vencimiento.toISOString().slice(0, 10)
      : row.fecha_vencimiento,
    stock: row.stock,
    costoUnitario: row.costo_unitario,
    precioVenta: row.precio_venta,
  };
}

export function mapSaleItem(row) {
  return {
    loteId: String(row.lote_id),
    medicamentoId: String(row.medicamento_id),
    medicamentoNombre: row.medicamento_nombre,
    codigoLote: row.codigo_lote,
    cantidad: row.cantidad,
    precioUnitario: row.precio_unitario,
    subtotal: row.subtotal,
  };
}

export function mapSale(row, items = []) {
  return {
    id: String(row.id),
    numero: row.numero,
    usuarioId: String(row.usuario_id),
    usuarioNombre: row.usuario_nombre || "",
    cantidadProductos: row.cantidad_productos ?? new Set(items.map((item) => item.medicamentoId)).size,
    fecha: timestampText(row.fecha),
    total: row.total,
    estado: row.estado,
    items: { item: items },
  };
}

export function mapMovement(row) {
  const movement = {
    id: String(row.id),
    loteId: String(row.lote_id),
    usuarioId: String(row.usuario_id),
    usuarioNombre: row.usuario_nombre,
    usuarioRol: row.usuario_rol,
    tipo: row.tipo,
    cantidad: row.cantidad,
    stockAntes: row.stock_antes,
    stockDespues: row.stock_despues,
    motivo: row.motivo,
    fecha: timestampText(row.fecha),
  };
  if (row.venta_id !== null) movement.ventaId = String(row.venta_id);
  return movement;
}
