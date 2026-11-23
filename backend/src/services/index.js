import { createBatchOperations } from "./batches.js";
import { createInventoryOperations } from "./inventory.js";
import { createMedicationOperations } from "./medications.js";
import { createSalesOperations } from "./sales.js";
import { createSessionOperations } from "./sessions.js";
import { createUserOperations } from "./users.js";

export function createSoapServices(dependencies) {
  return {
    FarmaciaService: {
      FarmaciaPort: {
        ...createSessionOperations(dependencies),
        ...createUserOperations(dependencies),
        ...createMedicationOperations(dependencies),
        ...createBatchOperations(dependencies),
        ...createInventoryOperations(dependencies),
        ...createSalesOperations(dependencies),
      },
    },
  };
}
