// Geometry adapted from DuoBar (MIT), copyright (c) 2026 Mike Li.
// Source: Mikeli7666/DuoBar @ 06a70af414737c0b0f6bb0985f5027e29f1377bf.
// See THIRD_PARTY_NOTICES/DuoBar.txt.
const diameter = 26.5;
const stroke = diameter * (18 / 230);
const radius = (diameter - stroke) / 2;
const point = (degrees: number) => {
  const radians = (degrees * Math.PI) / 180;
  return `${16 + Math.cos(radians) * radius},${15.2 + Math.sin(radians) * radius}`;
};

// Port of DuoArcShape.path(in:): a single 72-segment path, never a repeating dash.
export function duoUsageArc(progress: number) {
  const end = 150.1 + (389.9 - 150.1) * Math.min(1, Math.max(0, progress));
  return Array.from(
    { length: 73 },
    (_, index) => `${index === 0 ? 'M' : 'L'}${point(150.1 + ((end - 150.1) * index) / 72)}`,
  ).join(' ');
}

export const duoUsageGeometry = {
  stroke,
  arc: duoUsageArc(1),
  dotRadius: 2.477173913 / 2,
  // Keep DuoBar's stroke/dot proportions, placing all five scale gaps on
  // the same circle rather than flattening the lower scale into an inset row.
  dots: [4, 3, 2, 1].map((index) => {
    const angle = ((29.9 + (120.2 * index) / 5) * Math.PI) / 180;
    return { x: 16 + Math.cos(angle) * radius, y: 15.2 + Math.sin(angle) * radius };
  }),
  centerSize: 12.4 * 0.92,
  centerY: 16 - 1.25,
  inactiveOpacity: 0.3,
};
