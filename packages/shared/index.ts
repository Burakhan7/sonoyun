// Client-safe entry point. Never re-export ./content from here: it contains the correct answers.
export { CATEGORIES, CATEGORY_IDS } from './categories.js';
export type { Category, CategoryId } from './categories.js';
export { ADJECTIVES, AVATARS, AVATAR_IDS, getAvatar } from './avatars.js';
export type { Avatar, AvatarId } from './avatars.js';
export { ENGINES, ENGINE_IDS, MIN_CONTENT_PER_ENGINE } from './games.js';
export type { EngineDefinition, EngineId } from './games.js';
export {
  REPORT_REASONS,
  SOCKET_AUTH_ERRORS,
  SOCKET_ERROR_CODES,
  clientEventSchemas,
  handshakeAuthSchema,
  onlineCountSchema,
  opponentSchema,
  publicCardSchema,
  publicQuestionSchema,
  roundAnswerSchema,
  serverEventSchemas,
} from './events.js';
export type {
  ClientEventPayload,
  ClientToServerEvents,
  MatchFound,
  OnlineCount,
  Opponent,
  PublicCard,
  PublicQuestion,
  RoundAnswer,
  ServerEventPayload,
  ServerToClientEvents,
} from './events.js';
export {
  guestResponseSchema,
  identityLimitResponseSchema,
  publicUserSchema,
  userResponseSchema,
} from './api.js';
export type { GuestResponse, PublicUser } from './api.js';
