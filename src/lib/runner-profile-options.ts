export const transportOptions = [
  { id: 'walking', label: 'On foot', icon: '🚶' },
  { id: 'bicycle', label: 'Bicycle', icon: '🚲' },
  { id: 'motorbike', label: 'Motorbike', icon: '🛵' },
  { id: 'car', label: 'Car', icon: '🚗' },
] as const;

export const runnerServiceOptions = [
  { id: 'groceries', label: 'Groceries' }, { id: 'food', label: 'Food pickup' },
  { id: 'pharmacy', label: 'Pharmacy pickup' }, { id: 'delivery', label: 'Pickup & delivery' },
  { id: 'market', label: 'Market runs' }, { id: 'other', label: 'Other errands' },
] as const;
