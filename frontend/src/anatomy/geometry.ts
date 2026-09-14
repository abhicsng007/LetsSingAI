// Sagittal (side-profile) anatomy geometry, authored in a 1000 x 760 model
// space (x grows to the right = the direction the singer faces, y grows down).
// Everything the AnatomyCanvas draws is positioned from these anchors so the
// whole instrument reads as one connected system.

export const MODEL_W = 1000;
export const MODEL_H = 760;

export type Pt = [number, number];

// Head + neck + torso outline (one continuous body silhouette).
export const BODY: Pt[] = [
  [548, 58], [614, 56], [688, 84], [744, 128], [776, 174],
  [792, 198], [812, 202], [910, 246], // brow -> nose bridge dip -> nose tip
  [856, 266], [890, 298], // subnasal notch -> upper lip
  [868, 324], [888, 350], // mouth -> lower lip
  [878, 440], [806, 476], [734, 492], // chin -> under-jaw
  [706, 556], [746, 620], [770, 690], [762, 748], // front neck -> chest -> belly
  [470, 748], [300, 748], // waist bottom
  [286, 616], [298, 508], // torso back
  [372, 490], [452, 474], // upper back -> back of neck
  [472, 404], [452, 296], // neck -> back of skull
  [444, 188], [486, 104], // occiput -> crown
];

// Nasal cavity air space (upper resonator).
export const NASAL: Pt[] = [
  [610, 268], [648, 250], [712, 238], [782, 234], [842, 240], [884, 252],
  [876, 230], [816, 210], [742, 204], [670, 212], [622, 230],
];

// Hard palate bone strip (roof of mouth / floor of nose).
export const HARD_PALATE: Pt[] = [
  [616, 266], [690, 262], [768, 264], [830, 270], [836, 280],
  [770, 276], [692, 276], [620, 280],
];

// Oral cavity air space (mouth resonator), roof is the hard palate.
export const ORAL: Pt[] = [
  [608, 288], [614, 304], [648, 320], [712, 332], [800, 336], [872, 334],
  [886, 328], [860, 306], [792, 292], [702, 286], [640, 284],
];

// Pharynx air column behind the tongue, linking mouth/nose down to the larynx.
export const PHARYNX: Pt[] = [
  [536, 470], [556, 428], [582, 372], [602, 312], [600, 290],
  [576, 300], [558, 362], [542, 422], [524, 468],
];

// Trachea tube.
export const TRACHEA: Pt[] = [
  [502, 492], [560, 492], [556, 616], [508, 616],
];

// Lung lobe.
export const LUNG: Pt[] = [
  [300, 506], [374, 488], [470, 496], [540, 540], [558, 612],
  [540, 692], [420, 716], [318, 692], [290, 600],
];

// Rib arcs (drawn as strokes over the chest).
export const RIBS: { x: number; y: number; w: number; h: number }[] = [
  { x: 300, y: 520, w: 250, h: 42 },
  { x: 300, y: 560, w: 262, h: 46 },
  { x: 300, y: 604, w: 256, h: 46 },
  { x: 300, y: 648, w: 236, h: 44 },
];

// Airway centre-line, from deep in the lungs up to the velum junction.
export const AIRWAY_BASE: Pt[] = [
  [372, 664], [452, 624], [516, 592], [528, 552], // lungs -> trachea
  [532, 512], [534, 490], // trachea -> glottis
  [540, 468], [556, 430], [576, 380], // lower pharynx
  [594, 330], [606, 296], [610, 284], // upper pharynx -> velum junction
];

// From the velum junction out through the mouth.
export const AIRWAY_ORAL: Pt[] = [
  [640, 316], [702, 330], [786, 334], [852, 334], [892, 332],
];

// From the velum junction up through the nose.
export const AIRWAY_NASAL: Pt[] = [
  [630, 262], [686, 244], [764, 240], [844, 246], [892, 252],
];

// Key landmark points (model coords).
export const GLOTTIS: Pt = [534, 486];
export const VELUM_HINGE: Pt = [608, 276];
export const JAW_HINGE: Pt = [458, 356];
export const NOSTRIL: Pt = [892, 250];
export const LIPS: Pt = [884, 332];

// Resonance-zone centres.
export const ZONE_CHEST: Pt = [420, 600];
export const ZONE_MOUTH: Pt = [720, 322];
export const ZONE_HEAD: Pt = [700, 176];
