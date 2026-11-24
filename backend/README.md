# Backend SOAP de farmacia

Este backend reemplaza la API SOAP de TechStore con operaciones explícitas para una farmacia. Usa Node.js, `soap`, PostgreSQL, bcrypt y JWT. El WSDL está en `backend/wsdl/farmacia.wsdl`; el esquema de base de datos está en `database/schema.sql`.

El esquema acordado no incluye auditoría, por lo que tampoco se exponen operaciones de auditoría. El frontend independiente consume este contrato SOAP; el backend conserva la validación de datos y permisos.

## Requisitos

- Node.js compatible con el proyecto y npm.
- PostgreSQL.
- Dependencias instaladas con `npm install`.

## Preparación

1. En PostgreSQL crea una base llamada `farmacia`:

   ```sql
   CREATE DATABASE farmacia WITH ENCODING 'UTF8';
   ```

2. Conéctate a `farmacia` y ejecuta `database/schema.sql`.
3. Copia `backend/.env.example` como `backend/.env` y configura la conexión:

   ```env
   DB_HOST=localhost
   DB_PORT=5432
   DB_USER=postgres
   DB_PASSWORD=tu_clave
   DB_NAME=farmacia
   ```

   También se acepta `DATABASE_URL`. Configura `JWT_SECRET` con al menos 32 bytes aleatorios; por ejemplo:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```

   Define `ADMIN_PASSWORD` con al menos 12 caracteres. No subas `backend/.env` al repositorio.
4. Crea el primer administrador:

   ```powershell
   npm run seed:admin
   ```

5. Inicia el servicio:

   ```powershell
   npm run server
   ```

   El servicio SOAP escucha en `http://localhost:4000/soap`; el WSDL está disponible en `http://localhost:4000/soap?wsdl`. `GET http://localhost:4000/health` comprueba tanto el proceso como la conexión con PostgreSQL. El catálogo también está disponible como consulta REST pública en `GET http://localhost:4000/medicamentos`, con filtros opcionales `q`, `principioActivo`, `activo`, `limit` y `offset`. Para ejecutar las pruebas: `npm run test:backend`.

## Autenticación y permisos

`Login` recibe correo y contraseña. Devuelve un JWT HS256 con vencimiento de dos horas. En operaciones protegidas se envía en el encabezado SOAP `AuthHeader`, no en el cuerpo:

```xml
<soapenv:Header>
  <farm:AuthHeader xmlns:farm="urn:farmacia:v1">
    <farm:token>JWT_DEVUELTO_POR_LOGIN</farm:token>
  </farm:AuthHeader>
</soapenv:Header>
```

Los roles son `administrador`, `operador`, `consulta` y `auditor`. El backend verifica el token y consulta el estado y rol actuales del usuario en PostgreSQL en cada operación protegida. Los usuarios inactivos no pueden iniciar ni mantener sesión. Las contraseñas nuevas requieren al menos 12 caracteres y se almacenan con bcrypt. Las cuentas creadas o cuyo correo se actualice mediante la gestión de usuarios deben usar el dominio corporativo `@farmacia.com`.

| Operación | administrador | operador | consulta | auditor |
|---|---:|---:|---:|---:|
| Consultar medicamentos y lotes | Sí | Sí | Sí | Sí |
| Crear o actualizar medicamentos y lotes | Sí | Sí | No | No |
| Activar o desactivar medicamentos / eliminar lotes | Sí | No | No | No |
| Consultar inventario | Sí | Sí | No | Sí |
| Consultar ventas | Sí | Sí | Sí | Sí |
| Crear o revertir ventas | Sí | Sí | No | No |
| Gestionar usuarios | Sí | No | No | No |

## Operaciones SOAP

- Sesión: `Login`, `ValidateSession`.
- Usuarios: `ListUsers`, `GetUser`, `CreateUser`, `UpdateUser`, `DeactivateUser`.
- Medicamentos: `ListMedications`, `GetMedication`, `CreateMedication`, `UpdateMedication`, `DeactivateMedication`, `ActivateMedication`.
- Lotes: `ListBatches`, `GetBatch`, `CreateBatch`, `UpdateBatch`, `DeleteBatch`, `ListExpirationAlerts`.
- Inventario: `ListInventoryMovements`, `ListInventoryMovementsByBatch`.
- Ventas: `ListSales`, `GetSale`, `PreviewSale`, `CreateSale`, `ReverseSale`.

`ListSales` permite filtrar por estado, rango de fechas y texto en número de venta, usuario o medicamento. `PreviewSale` cotiza los lotes y precios vigentes sin reservar stock; `CreateSale` vuelve a validar y bloquea los lotes dentro de la transacción, por lo que la cotización puede cambiar si el inventario se modifica antes de confirmar. Las operaciones de listado aceptan paginación con límite de 1 a 100 y offset no negativo. Los errores se devuelven como SOAP Faults; no se exponen hashes de contraseñas, credenciales ni trazas internas.

## Reglas transaccionales principales

- Al crear un lote con stock inicial se registra el movimiento de entrada correspondiente.
- Los ajustes de stock se reflejan como movimientos de inventario.
- La eliminación de lotes con movimientos o ventas asociados se rechaza.
- Las alertas incluyen lotes con stock que vencieron o vencen dentro de los próximos 30 días.
- Cotizar ventas calcula la distribución FEFO y el importe por lote sin modificar el inventario.
- Crear ventas bloquea los lotes elegibles, consume primero los próximos a vencer y actualiza venta, detalle, stock e inventario en una transacción.
- Revertir una venta confirmada repone el stock y registra movimientos de reversión en una transacción. No se puede revertir una venta más de una vez.
- Medicamentos y usuarios se desactivan en lugar de borrarse. La base restringe la eliminación de registros con historial relacionado.
