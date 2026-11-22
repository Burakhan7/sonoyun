export const CATEGORIES = [
  { id: 'mutfak', name: 'Mutfak & Yemek', emoji: '🍳' },
  { id: 'muzik', name: 'Müzik', emoji: '🎵' },
  { id: 'nostalji', name: "Nostalji (90'lar/2000'ler)", emoji: '🧒' },
  { id: 'okul', name: 'Okul & Kampüs', emoji: '🎓' },
  { id: 'is', name: 'İş & Ofis Hayatı', emoji: '💼' },
  { id: 'seyahat', name: 'Seyahat & Şehirler', emoji: '✈️' },
  { id: 'spor', name: 'Spor', emoji: '⚽' },
  { id: 'hayvanlar', name: 'Evcil Hayvanlar', emoji: '🐾' },
  { id: 'internet', name: 'İnternet & Meme Kültürü', emoji: '📱' },
  { id: 'sehir', name: 'Şehir & Toplu Taşıma', emoji: '🚌' },
  { id: 'kultur', name: 'Türk Kültürü & Gelenekler', emoji: '🎉' },
  { id: 'alisveris', name: 'Alışveriş & Para', emoji: '🛒' },
  { id: 'gece', name: 'Gece & Alışkanlıklar', emoji: '🌙' },
  { id: 'yasaydi', name: 'Ya Şöyle Olsaydı?', emoji: '🧠' },
  { id: 'dizi_film', name: 'Dizi & Film', emoji: '🎬' },
  { id: 'oyun', name: 'Oyun Dünyası', emoji: '🎮' },
] as const;

export type Category = (typeof CATEGORIES)[number];
export type CategoryId = Category['id'];

export const CATEGORY_IDS = CATEGORIES.map((category) => category.id) as [
  CategoryId,
  ...CategoryId[],
];
