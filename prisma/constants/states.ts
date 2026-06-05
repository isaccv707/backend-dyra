export const rawStates = [
  {
    name: 'Jalisco',
  },
  {
    name: 'Colima',
  },
];

export const STATES = rawStates.map((state) => ({
  ...state,
}));
