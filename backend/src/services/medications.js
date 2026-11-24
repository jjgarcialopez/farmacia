import { AppError } from "../errors.js";
import { requireRoles } from "../auth.js";
import { boolean, money, pagination, positiveId, text } from "../validation.js";
import { mapMedication, operation, pageQuery, notFound } from "./common.js";

const READ_ROLES = ["administrador", "operador", "consulta", "auditor"];
const WRITE_ROLES = ["administrador", "operador"];
const SELECT_MEDICATION = `id, codigo, nombre, principio_activo, presentacion,
  requiere_formula, precio_referencia, activo, creado_en`;

export function createMedicationOperations({ pool }) {
  return {
    ListMedications: operation("ListMedications", async (args, headers) => {
      await requireRoles(headers, pool, READ_ROLES);
      const { limit, offset } = pagination(args);
      const values = [];
      const conditions = [];
      if (args.nombreOCodigo !== undefined && args.nombreOCodigo !== "") {
        values.push(`%${text(args.nombreOCodigo, "nombreOCodigo", 100)}%`);
        conditions.push(`(nombre ILIKE $${values.length} OR codigo ILIKE $${values.length})`);
      }
      if (args.principioActivo !== undefined && args.principioActivo !== "") {
        values.push(`%${text(args.principioActivo, "principioActivo", 100)}%`);
        conditions.push(`principio_activo ILIKE $${values.length}`);
      }
      if (args.activo !== undefined && args.activo !== "") {
        values.push(boolean(args.activo, "activo"));
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
        medications: { medication: result.items.map(mapMedication) },
      };
    }),

    GetMedication: operation("GetMedication", async (args, headers) => {
      await requireRoles(headers, pool, READ_ROLES);
      const id = positiveId(args.id);
      const result = await pool.query(
        `SELECT ${SELECT_MEDICATION} FROM medicamentos WHERE id = $1`,
        [id],
      );
      if (!result.rowCount) throw notFound("El medicamento");
      return { medication: mapMedication(result.rows[0]) };
    }),

    CreateMedication: operation("CreateMedication", async (args, headers) => {
      await requireRoles(headers, pool, WRITE_ROLES);
      const values = [
        text(args.codigo, "codigo", 50),
        text(args.nombre, "nombre", 150),
        text(args.principioActivo, "principioActivo", 150),
        text(args.presentacion, "presentacion", 120),
        args.requiereFormula === undefined ? false : boolean(args.requiereFormula, "requiereFormula"),
        args.precioReferencia === undefined ? "0.00" : money(args.precioReferencia, "precioReferencia"),
      ];
      const result = await pool.query(
        `INSERT INTO medicamentos
          (codigo, nombre, principio_activo, presentacion, requiere_formula, precio_referencia)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${SELECT_MEDICATION}`,
        values,
      );
      return { medication: mapMedication(result.rows[0]) };
    }),

    UpdateMedication: operation("UpdateMedication", async (args, headers) => {
      await requireRoles(headers, pool, WRITE_ROLES);
      const id = positiveId(args.id);
      const updates = [];
      const values = [];
      const fields = [
        ["codigo", "codigo", (value) => text(value, "codigo", 50)],
        ["nombre", "nombre", (value) => text(value, "nombre", 150)],
        ["principioActivo", "principio_activo", (value) => text(value, "principioActivo", 150)],
        ["presentacion", "presentacion", (value) => text(value, "presentacion", 120)],
        ["requiereFormula", "requiere_formula", (value) => boolean(value, "requiereFormula")],
        ["precioReferencia", "precio_referencia", (value) => money(value, "precioReferencia")],
      ];
      for (const [inputName, column, validate] of fields) {
        if (args[inputName] === undefined) continue;
        values.push(validate(args[inputName]));
        updates.push(`${column} = $${values.length}`);
      }
      if (!updates.length) throw new AppError("VALIDATION_ERROR", "Debes enviar al menos un campo para actualizar.");
      values.push(id);
      const result = await pool.query(
        `UPDATE medicamentos SET ${updates.join(", ")}
          WHERE id = $${values.length}
          RETURNING ${SELECT_MEDICATION}`,
        values,
      );
      if (!result.rowCount) throw notFound("El medicamento");
      return { medication: mapMedication(result.rows[0]) };
    }),

    DeactivateMedication: operation("DeactivateMedication", async (args, headers) => {
      await requireRoles(headers, pool, ["administrador"]);
      const id = positiveId(args.id);
      const result = await pool.query(
        `UPDATE medicamentos SET activo = FALSE
          WHERE id = $1
          RETURNING ${SELECT_MEDICATION}`,
        [id],
      );
      if (!result.rowCount) throw notFound("El medicamento");
      return { success: true, medication: mapMedication(result.rows[0]) };
    }),

    ActivateMedication: operation("ActivateMedication", async (args, headers) => {
      await requireRoles(headers, pool, ["administrador"]);
      const id = positiveId(args.id);
      const result = await pool.query(
        `UPDATE medicamentos SET activo = TRUE
          WHERE id = $1
          RETURNING ${SELECT_MEDICATION}`,
        [id],
      );
      if (!result.rowCount) throw notFound("El medicamento");
      return { success: true, medication: mapMedication(result.rows[0]) };
    }),
  };
}
