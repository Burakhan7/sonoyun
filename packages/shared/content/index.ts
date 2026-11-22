// Server-only entry point: this data contains the correct answers and must not reach the client.
import rawContent from './questions.json' with { type: 'json' };
import { contentSchema, type Content } from './schema.js';

export const content: Content = contentSchema.parse(rawContent);

export * from './schema.js';
