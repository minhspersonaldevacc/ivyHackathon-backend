const LENGTH_TO_MM = { mm: 1, millimeter: 1, millimeters: 1, um: 0.001, micron: 0.001, microns: 0.001, in: 25.4, inch: 25.4, inches: 25.4 };

export function toMillimeters(value, unit) {
  const multiplier = LENGTH_TO_MM[String(unit).toLowerCase()];
  if (!multiplier) return { value, unit };
  return { value: Number(value) * multiplier, unit: "mm" };
}
