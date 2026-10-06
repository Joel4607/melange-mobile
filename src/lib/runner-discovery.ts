export function parseBudgetFilter(value: string): number | undefined {
  if (!value.trim()) return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter budgets in GH₵ with up to two decimal places.');
  const pesewas = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(pesewas) || pesewas > 100_000_000) throw new Error('Enter a budget between GH₵0 and GH₵1,000,000.');
  return pesewas;
}
