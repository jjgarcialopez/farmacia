import { authenticatedUser, createLoginThrottle, login } from "../auth.js";
import { operation } from "./common.js";

export function createSessionOperations({ pool }) {
  const throttle = createLoginThrottle();
  return {
    Login: operation("Login", async (args, _headers, req) => {
      return login(
        {
          correo: args.correo,
          password: args.password,
          ip: req?.socket?.remoteAddress,
        },
        pool,
        throttle,
      );
    }),

    ValidateSession: operation("ValidateSession", async (_args, headers) => ({
      valid: true,
      user: await authenticatedUser(headers, pool),
    })),
  };
}
