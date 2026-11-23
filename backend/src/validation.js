import { AppError } from "./errors.js";

export const roles = ["administrador", "operador", "consulta", "auditor"];
export const saleStates = ["confirmada", "revertida"];
export const movementTypes = ["entrada", "salida", "ajuste", "reversión"];

export function text(value, field, maxLength, { required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (!required) return undefined;
    throw new AppError("VALIDATION_ERROR", `${field} es obligatorio.`);
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new AppError("VALIDATION_ERROR", `${field} debe ser texto.`);
  }
  const normalized = String(value).trim();
  if (!normalized && required) throw new AppError("VALIDATION_ERROR", `${field} es obligatorio.`);
  if (normalized.length > maxLength) {
    throw new AppError("VALIDATION_ERROR", `${field} no puede superar ${maxLength} caracteres.`);
  }
  return normalized || undefined;
}

export function positiveId(value, field = "id") {
  const raw = typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  const number = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(number)) {
    throw new AppError("VALIDATION_ERROR", `${field} debe ser un entero positivo.`);
  }
  return String(number);
}

export function integer(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  const number = Number(raw);
  if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new AppError("VALIDATION_ERROR", `${field} debe ser un entero entre ${min} y ${max}.`);
  }
  return number;
}

export function boolean(value, field, { optional = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (optional) return undefined;
    throw new AppError("VALIDATION_ERROR", `${field} debe ser true o false.`);
  }
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new AppError("VALIDATION_ERROR", `${field} debe ser true o false.`);
}

export function email(value) {
  const normalized = text(value, "El correo", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AppError("VALIDATION_ERROR", "El correo no tiene un formato válido.");
  }
  return normalized;
}

export function corporateEmail(value) {
  const normalized = email(value);
  if (!normalized.endsWith("@farmacia.com")) {
    throw new AppError("VALIDATION_ERROR", "El correo debe pertenecer al dominio @farmacia.com.");
  }
  return normalized;
}

export function password(value, { required = true } = {}) {
  if ((value === undefined || value === null || value === "") && !required) return undefined;
  if (typeof value !== "string" || value.length < 12) {
    throw new AppError("VALIDATION_ERROR", "La contraseña debe tener al menos 12 caracteres.");
  }
  if (value.length > 200) {
    throw new AppError("VALIDATION_ERROR", "La contraseña no puede superar 200 caracteres.");
  }
  return value;
}

export function role(value, { optional = false } = {}) {
  if ((value === undefined || value === null || value === "") && optional) return undefined;
  const normalized = text(value, "El rol", 20);
  if (!roles.includes(normalized)) {
    throw new AppError("VALIDATION_ERROR", "El rol no es válido.");
  }
  return normalized;
}

export function money(value, field) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new AppError("VALIDATION_ERROR", `${field} debe ser un valor monetario válido.`);
  }
  const normalized = String(value).trim();
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(normalized)) {
    throw new AppError("VALIDATION_ERROR", `${field} debe ser mayor o igual a cero y tener máximo dos decimales.`);
  }
  return normalized.includes(".") ? normalized.padEnd(normalized.indexOf(".") + 3, "0") : `${normalized}.00`;
}

export function isoDate(value, field) {
  let normalized;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new AppError("VALIDATION_ERROR", `${field} no es una fecha válida.`);
    }
    normalized = value.toISOString().slice(0, 10);
  } else {
    normalized = text(value, field, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new AppError("VALIDATION_ERROR", `${field} debe usar el formato YYYY-MM-DD.`);
  }
  if (normalized.startsWith("0000-")) {
    throw new AppError("VALIDATION_ERROR", `${field} no es una fecha válida.`);
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new AppError("VALIDATION_ERROR", `${field} no es una fecha válida.`);
  }
  return normalized;
}

export function pagination(args = {}) {
  const limit = args.limit === undefined || args.limit === "" ? 20 : integer(args.limit, "limit", { min: 1, max: 100 });
  const offset = args.offset === undefined || args.offset === "" ? 0 : integer(args.offset, "offset");
  return { limit, offset };
}

export function optionalDate(value, field) {
  return value === undefined || value === null || value === "" ? undefined : isoDate(value, field);
}

export function listOf(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
