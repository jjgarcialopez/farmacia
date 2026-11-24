# Farmacias Vital Salud frontend

Interfaz web independiente para el backend SOAP de farmacia. El frontend vive en esta carpeta y consume las operaciones disponibles de sesiones, usuarios, medicamentos, lotes, alertas, inventario y ventas; las reglas de negocio y autorización siguen en el backend.

## Iniciar

1. Configura e inicia PostgreSQL y el backend siguiendo [backend/README.md](../backend/README.md).
2. En `backend/.env`, configura el origen exacto desde el que abrirás la interfaz:

   ```env
   CORS_ORIGIN=http://localhost:5173
   ```

   Reinicia el backend después de cambiar la configuración. Abre tanto el backend como el frontend con `localhost` (no mezcles `localhost` y `127.0.0.1`).
3. En una terminal, desde la raíz del proyecto, instala la dependencia visual y ejecuta el frontend:

   ```powershell
   npm --prefix frontend install
   npm --prefix frontend run dev
   ```

4. Abre `http://localhost:5173` e inicia sesión con una cuenta creada en el backend. El frontend se conecta internamente con `http://localhost:4000/soap`.

## Publicar en Render

El frontend está preparado para desplegarse como un servicio web de Node.js independiente:

1. Sube los cambios del proyecto a GitHub.
2. En Render, crea un **Web Service** desde el mismo repositorio, con **Root Directory** `frontend`, **Build Command** `npm install` y **Start Command** `npm start`. Usa la misma región que el backend.
3. Cuando Render asigne una URL al frontend, configura `CORS_ORIGIN` en el servicio del backend con ese origen exacto, sin `/` al final; por ejemplo, `https://farmacia-frontend.onrender.com`.
4. Si cambia la URL pública del backend, actualiza `apiUrl` y `healthUrl` en `config.js` y vuelve a subir los cambios.

## Módulos

- **Resumen:** indicadores de medicamentos, existencias, vencimientos y ventas recientes.
- **Medicamentos:** consulta para todos los roles; gestión y activación/desactivación para administrador y farmacéutico.
- **Inventario:** consulta de existencias para todos los roles; registro, edición y ajuste de cantidades para administrador y farmacéutico.
- **Movimientos:** filtros por lote, venta, tipo y fechas, con nombre y rol del usuario que realizó cada movimiento; disponible para administrador y farmacéutico.
- **Ventas:** administrador y consulta pueden leer el historial; el vendedor registra ventas y solo consulta las propias; la reversión está reservada al administrador. El farmacéutico no tiene acceso al módulo de ventas.
- **Usuarios:** consulta, creación con usuario único sugerido desde el nombre y dominio fijo `@farmacia.com`, edición de datos, roles y contraseña, y desactivación/reactivación (administrador). El correo debe ser único; se permiten varios usuarios con el mismo rol.

La interfaz muestra acciones según el rol, pero el backend vuelve a validar cada permiso. Las listas recorren las páginas del servicio, cuyo tamaño máximo es 100. El frontend usa un servidor estático basado en módulos nativos y mantiene sus dependencias separadas de las del backend. La sesión se conserva únicamente en la pestaña actual.

Las operaciones que modifican datos muestran una confirmación SweetAlert2 que se cierra automáticamente después de 3 segundos.
