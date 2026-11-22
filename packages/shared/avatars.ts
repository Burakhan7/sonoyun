export const AVATARS = [
  { id: 'kartal', name: 'Kartal', emoji: '🦅', background: '#F4C98B' },
  { id: 'tilki', name: 'Tilki', emoji: '🦊', background: '#F7B9A0' },
  { id: 'baykus', name: 'Baykuş', emoji: '🦉', background: '#C9B8E8' },
  { id: 'kedi', name: 'Kedi', emoji: '🐱', background: '#FBE3A1' },
  { id: 'kopek', name: 'Köpek', emoji: '🐶', background: '#BFE3C6' },
  { id: 'panda', name: 'Panda', emoji: '🐼', background: '#CDE7F0' },
  { id: 'aslan', name: 'Aslan', emoji: '🦁', background: '#F9D58A' },
  { id: 'kaplan', name: 'Kaplan', emoji: '🐯', background: '#F7C6A3' },
  { id: 'ayi', name: 'Ayı', emoji: '🐻', background: '#E2CDB5' },
  { id: 'tavsan', name: 'Tavşan', emoji: '🐰', background: '#F6CFE0' },
  { id: 'kirpi', name: 'Kirpi', emoji: '🦔', background: '#E8D9B0' },
  { id: 'sincap', name: 'Sincap', emoji: '🐿️', background: '#F3C1A0' },
  { id: 'penguen', name: 'Penguen', emoji: '🐧', background: '#BCD8F2' },
  { id: 'yunus', name: 'Yunus', emoji: '🐬', background: '#A9DDF0' },
  { id: 'ahtapot', name: 'Ahtapot', emoji: '🐙', background: '#F2B8C6' },
  { id: 'kaplumbaga', name: 'Kaplumbağa', emoji: '🐢', background: '#C6E5B3' },
  { id: 'zurafa', name: 'Zürafa', emoji: '🦒', background: '#F8DDA0' },
  { id: 'fil', name: 'Fil', emoji: '🐘', background: '#D3D9E8' },
  { id: 'koala', name: 'Koala', emoji: '🐨', background: '#D6E3D1' },
  { id: 'rakun', name: 'Rakun', emoji: '🦝', background: '#D9D2C5' },
  { id: 'kurbaga', name: 'Kurbağa', emoji: '🐸', background: '#CBEBA6' },
  { id: 'papagan', name: 'Papağan', emoji: '🦜', background: '#B8E6D4' },
  { id: 'flamingo', name: 'Flamingo', emoji: '🦩', background: '#F9C5D1' },
  { id: 'geyik', name: 'Geyik', emoji: '🦌', background: '#E9CFAE' },
] as const;

export type Avatar = (typeof AVATARS)[number];
export type AvatarId = Avatar['id'];

export const AVATAR_IDS = AVATARS.map((avatar) => avatar.id) as [AvatarId, ...AvatarId[]];

export const ADJECTIVES = [
  'Enerjik',
  'Sakin',
  'Meraklı',
  'Uykucu',
  'Neşeli',
  'Cesur',
  'Utangaç',
  'Hızlı',
  'Bilge',
  'Şakacı',
  'Gizemli',
  'Tatlı',
  'Havalı',
  'Dalgın',
  'Hırslı',
  'Sevimli',
  'Çılgın',
  'Kibar',
  'Maceracı',
  'Yaratıcı',
  'Sabırlı',
  'Konuşkan',
  'Sessiz',
  'Asil',
  'Düşünceli',
  'Huysuz',
  'Pofuduk',
  'Şanslı',
  'Telaşlı',
  'Gezgin',
] as const;

export function getAvatar(id: AvatarId): Avatar {
  const avatar = AVATARS.find((candidate) => candidate.id === id);
  if (!avatar) throw new Error(`Unknown avatar: ${id}`);
  return avatar;
}
