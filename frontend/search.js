export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

export function matchingMedicationsWithoutBatches(medications, batches, query) {
  const search = normalizeSearchText(query).trim();
  if (!search) return [];

  const medicationIdsWithBatches = new Set(batches.map((batch) => String(batch.medicamentoId)));
  return medications.filter((medication) => !medicationIdsWithBatches.has(String(medication.id))
    && normalizeSearchText(
      `${medication.nombre} ${medication.codigo} ${medication.principioActivo}`,
    ).includes(search));
}
