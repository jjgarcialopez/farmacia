import { boolean, pagination, text } from "./validation.js";
import { mapMedication, pageQuery } from "./services/common.js";

const SELECT_MEDICATION = `id, codigo, nombre, principio_activo, presentacion,
  requiere_formula, precio_referencia, activo, creado_en`;

export async function listPublicMedications(searchParams, pool) {
  const filters = Object.fromEntries(searchParams.entries());
  const { limit, offset } = pagination(filters);
  const conditions = [];
  const values = [];
  const query = text(filters.q, "q", 100, { required: false });
  if (query) {
    values.push(`%${query}%`);
    conditions.push(`(nombre ILIKE $${values.length}
      OR codigo ILIKE $${values.length}
      OR principio_activo ILIKE $${values.length})`);
  }
  const activeIngredient = text(filters.principioActivo, "principioActivo", 100, { required: false });
  if (activeIngredient) {
    values.push(`%${activeIngredient}%`);
    conditions.push(`principio_activo ILIKE $${values.length}`);
  }
  if (filters.activo !== undefined && filters.activo !== "") {
    values.push(boolean(filters.activo, "activo"));
    conditions.push(`activo = $${values.length}`);
  }

  const result = await pageQuery(pool, {
    select: SELECT_MEDICATION,
    from: "medicamentos",
    conditions,
    values,
    orderBy: "nombre, id",
    limit,
    offset,
  });
  return {
    total: result.total,
    limit,
    offset,
    medicamentos: result.items.map(mapMedication),
  };
}
