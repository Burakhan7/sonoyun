// Client-safe entry point. Never re-export ./content from here: it contains the correct answers.
export { CATEGORIES, CATEGORY_IDS } from './categories.js';
export type { Category, CategoryId } from './categories.js';
