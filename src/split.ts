// Returns what each person pays, or null if the inputs can't be split.
// Works in whole cents and rounds each share up, so the bill is always covered.
export function splitBill(
  bill: number,
  tipPercent: number,
  people: number,
): number | null {
  if (!(bill >= 0) || !(tipPercent >= 0)) return null
  if (!Number.isInteger(people) || people < 1) return null

  const totalCents = Math.round(bill * 100 + bill * tipPercent)
  return Math.ceil(totalCents / people) / 100
}
