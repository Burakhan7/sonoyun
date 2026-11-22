// Client-safe entry point. Never re-export ./content from here: it contains the correct answers.
export { CATEGORIES, CATEGORY_IDS } from './categories.js';
export type { Category, CategoryId } from './categories.js';
export { ADJECTIVES, AVATARS, AVATAR_IDS, getAvatar } from './avatars.js';
export type { Avatar, AvatarId } from './avatars.js';
export { SOCKET_AUTH_ERRORS, handshakeAuthSchema, onlineCountSchema } from './events.js';
export type { ClientToServerEvents, OnlineCount, ServerToClientEvents } from './events.js';
export {
  guestResponseSchema,
  identityLimitResponseSchema,
  publicUserSchema,
  userResponseSchema,
} from './api.js';
export type { GuestResponse, PublicUser } from './api.js';
