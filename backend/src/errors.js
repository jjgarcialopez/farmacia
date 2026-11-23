export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export function toSoapFault(error, operation) {
  if (error instanceof AppError) {
    const fault = new Error(error.message);
    fault.Fault = {
      Code: { Value: error.status >= 500 ? "SOAP-ENV:Server" : "SOAP-ENV:Client" },
      Reason: { Text: `${error.code}: ${error.message}` },
      statusCode: error.status,
    };
    return fault;
  }

  if (error?.code === "23505") {
    return toSoapFault(new AppError("CONFLICT", "El registro ya existe.", 409), operation);
  }
  if (error?.code === "23503") {
    return toSoapFault(new AppError("CONFLICT", "El registro está relacionado con otros datos.", 409), operation);
  }
  if (error?.code === "23514" || error?.code === "22P02") {
    return toSoapFault(new AppError("VALIDATION_ERROR", "Los datos no cumplen las reglas del sistema.", 400), operation);
  }

  console.error(`Error interno en ${operation}.`, error);
  const fault = new Error("Ocurrió un error interno al procesar la operación.");
  fault.Fault = {
    Code: { Value: "SOAP-ENV:Server" },
    Reason: { Text: "INTERNAL_ERROR: Ocurrió un error interno al procesar la operación." },
    statusCode: 500,
  };
  return fault;
}

export async function invokeSoap(operation, handler, args, headers, req) {
  try {
    return await handler(args || {}, headers || {}, req);
  } catch (error) {
    throw toSoapFault(error, operation);
  }
}
